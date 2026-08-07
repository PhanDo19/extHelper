(function (root) {
  "use strict";
  // Hai chi nhanh (pariskimgiang, parislinhdam) ban tren cung MOT KHO VAT LY
  // nhung moi website danh mot bo ma rieng cho cung mot mat hang: 47/145 mat
  // hang trung ten ma khac ma (vd "Banh khoai tay chien" la 1000022 o Kim Giang
  // nhung 1000030 o Linh Dam, con 1000022 ben Linh Dam lai la "Hat macca").
  // Dung chung mapping se xuat sai mat hang tren hoa don da phat hanh.
  //
  // Vi vay:
  //   - Du lieu gan voi MA WEB (mapping, danh muc, quy tac uu tien) tach theo
  //     chi nhanh.
  //   - Du lieu gan voi GIAO DICH (sao ke, phien UI, so hoa don, so doi chieu)
  //     tach theo chi nhanh.
  //   - SO TON KHO dung chung theo stockCode, vi kho vat ly chi co mot: ban o
  //     chi nhanh nay thi chi nhanh kia phai thay giam tuong ung.
  const DEFAULT_TENANT = "pariskimgiang";

  function currentTenant() {
    const path = root.location?.pathname || "";
    return path.split("/").filter(Boolean)[0] || DEFAULT_TENANT;
  }

  // Chi nhanh mac dinh giu nguyen ten key cu de du lieu dang lam do khong mat.
  function tenantKey(baseKey) {
    const tenant = currentTenant();
    return tenant === DEFAULT_TENANT ? baseKey : `${baseKey}__${tenant}`;
  }

  const MAPPING_BASE_KEY = "invoiceTargetMappingDataset";
  const CATALOG_BASE_KEY = "invoiceTargetWebCatalog";
  const STATEMENT_BASE_KEY = "invoiceTargetBankStatement";
  const PRIORITY_RULES_BASE_KEY = "invoiceTargetPriorityRules";
  const LEDGER_BASE_KEY = "invoiceTargetVerificationLedger";
  const UI_SESSION_BASE_KEY = "invoiceTargetUiSession";
  const STOCK_STATE_META_KEY = "invoiceTargetStockStateMeta";
  const STOCK_STATE_BACKUP_KEY = "invoiceTargetStockStateBackup";
  const API_TEMPLATE_KEY = "invoiceTargetApiTemplate";
  const ISSUED_INVOICE_BASE_KEY = "invoiceTargetIssuedInvoices";
  // Ton kho dung chung cho moi chi nhanh, khoa theo stockCode (ma kho that).
  const SHARED_STOCK_KEY = "invoiceTargetSharedStock";
  // webCode cua quy tac uu tien chi dung o chi nhanh mac dinh; chi nhanh khac
  // phai tu chon lai ma hang tuong ung trong panel.
  const DEFAULT_PRIORITY_RULES = [
    { id: "rule-tcto", code: "TCTO", webCode: "1500007", minTotal: 1000000, priority: 1, mode: "rotate", minQty: 1, maxQty: 1, enabled: true },
    { id: "rule-wine", code: "RUOUVANGDO", webCode: "1300013", minTotal: 1000000, priority: 2, mode: "rotate", minQty: 1, maxQty: 1, enabled: true }
  ];

  function normalizePriorityRule(rule) {
    const minQty = Math.max(1, Math.floor(Number(rule?.minQty) || 1));
    const maxQty = Math.max(minQty, Math.floor(Number(rule?.maxQty) || minQty));
    return {
      ...rule,
      mode: rule?.mode === "required" ? "required" : "rotate",
      minQty,
      maxQty
    };
  }

  // --- Ton kho dung chung -----------------------------------------------------
  // Kho vat ly chi co mot nen so ton khong duoc luu rieng trong bang mapping cua
  // tung chi nhanh. Bang mapping van giu nguyen hinh dang cu (moi dong co
  // stockQty/availableQty) de phan con lai cua extension khong phai sua, nhung
  // gia tri thuc duoc dong bo qua kho chung khoa theo stockCode.
  const STOCK_FIELDS = ["stockQty", "availableQty"];

  async function loadSharedStock() {
    if (!globalThis.chrome?.storage?.local) return {};
    const stored = await chrome.storage.local.get(SHARED_STOCK_KEY);
    return stored[SHARED_STOCK_KEY] || {};
  }

  function applySharedStock(dataset, sharedStock) {
    for (const row of dataset?.mappings || []) {
      const shared = sharedStock[String(row.stockCode || "").trim()];
      if (!shared) continue;
      for (const field of STOCK_FIELDS) {
        if (Number.isFinite(Number(shared[field]))) row[field] = Number(shared[field]);
      }
    }
    return dataset;
  }

  function collectSharedStock(dataset, sharedStock) {
    const next = { ...sharedStock };
    for (const row of dataset?.mappings || []) {
      const code = String(row.stockCode || "").trim();
      if (!code) continue;
      next[code] = {
        ...next[code],
        ...Object.fromEntries(STOCK_FIELDS.map(field => [field, Number(row[field]) || 0]))
      };
    }
    return next;
  }

  async function load(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const key = tenantKey(MAPPING_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    const dataset = stored[key] || structuredClone(fallback);
    return applySharedStock(dataset, await loadSharedStock());
  }

  async function save(dataset) {
    if (!globalThis.chrome?.storage?.local) return dataset;
    await chrome.storage.local.set({
      [tenantKey(MAPPING_BASE_KEY)]: dataset,
      [SHARED_STOCK_KEY]: collectSharedStock(dataset, await loadSharedStock())
    });
    return dataset;
  }

  async function reset() {
    // Chi xoa mapping cua chi nhanh hien tai; kho chung giu nguyen vi chi nhanh
    // kia van dang dung.
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.remove(tenantKey(MAPPING_BASE_KEY));
    }
  }

  async function loadCatalog(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const key = tenantKey(CATALOG_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    // fallback do content.js chon san theo chi nhanh dang mo nen dung truc tiep;
    // ma web hai ben khong trung nhau, khong duoc muon cheo cua nhau.
    return stored[key] || structuredClone(fallback);
  }

  async function saveCatalog(catalog) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [tenantKey(CATALOG_BASE_KEY)]: catalog });
    }
    return catalog;
  }

  async function loadStatement() {
    if (!globalThis.chrome?.storage?.local) return { source: "", transactions: [] };
    const key = tenantKey(STATEMENT_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || { source: "", transactions: [] };
  }

  async function saveStatement(statement) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [tenantKey(STATEMENT_BASE_KEY)]: statement });
    }
    return statement;
  }

  function defaultPriorityRules() {
    // webCode 1500007/1300013 chi ton tai o chi nhanh mac dinh. Chi nhanh khac
    // bat dau voi danh sach rong de khong lap phuong an bang ma hang sai.
    if (currentTenant() !== DEFAULT_TENANT) return [];
    return structuredClone(DEFAULT_PRIORITY_RULES);
  }

  async function loadPriorityRules() {
    if (!globalThis.chrome?.storage?.local) return defaultPriorityRules().map(normalizePriorityRule);
    const key = tenantKey(PRIORITY_RULES_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return (stored[key] || defaultPriorityRules()).map(normalizePriorityRule);
  }

  async function savePriorityRules(rules) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [tenantKey(PRIORITY_RULES_BASE_KEY)]: rules });
    }
    return rules;
  }

  async function loadLedger() {
    if (!globalThis.chrome?.storage?.local) return { entries: [] };
    const key = tenantKey(LEDGER_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || { entries: [] };
  }

  async function loadUiSession() {
    if (!globalThis.chrome?.storage?.local) return null;
    const key = tenantKey(UI_SESSION_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function saveUiSession(session) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [tenantKey(UI_SESSION_BASE_KEY)]: session });
    }
    return session;
  }

  async function clearUiSession() {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.remove(tenantKey(UI_SESSION_BASE_KEY));
    }
  }

  async function loadStockStateMeta() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(STOCK_STATE_META_KEY);
    return stored[STOCK_STATE_META_KEY] || null;
  }

  async function saveStockStateMeta(meta) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [STOCK_STATE_META_KEY]: meta });
    return meta;
  }

  async function importStockState(mappingDataset, meta, backup) {
    if (globalThis.chrome?.storage?.local) {
      // Nhap ton kho cap nhat luon kho chung: ca hai chi nhanh phai thay cung
      // mot so ton sau khi nhap.
      await chrome.storage.local.set({
        [STOCK_STATE_BACKUP_KEY]: backup,
        [tenantKey(MAPPING_BASE_KEY)]: mappingDataset,
        [STOCK_STATE_META_KEY]: meta,
        [SHARED_STOCK_KEY]: collectSharedStock(mappingDataset, await loadSharedStock())
      });
    }
    return mappingDataset;
  }

  async function loadStockStateBackup() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(STOCK_STATE_BACKUP_KEY);
    return stored[STOCK_STATE_BACKUP_KEY] || null;
  }

  async function loadApiTemplate() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(API_TEMPLATE_KEY);
    return stored[API_TEMPLATE_KEY] || null;
  }

  async function saveApiTemplate(template) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [API_TEMPLATE_KEY]: template });
    return template;
  }

  async function clearApiTemplate() {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(API_TEMPLATE_KEY);
  }

  async function loadIssuedInvoices() {
    if (!globalThis.chrome?.storage?.local) return { entries: [] };
    const key = tenantKey(ISSUED_INVOICE_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || { entries: [] };
  }

  async function saveIssuedInvoices(book) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [tenantKey(ISSUED_INVOICE_BASE_KEY)]: book });
    }
    return book;
  }

  async function commitVerifiedInvoice(dataset, statement, ledger) {
    if (globalThis.chrome?.storage?.local) {
      // Xuat hang o chi nhanh nay phai tru vao kho chung de chi nhanh kia thay
      // duoc so ton da giam.
      await chrome.storage.local.set({
        [tenantKey(MAPPING_BASE_KEY)]: dataset,
        [tenantKey(STATEMENT_BASE_KEY)]: statement,
        [tenantKey(LEDGER_BASE_KEY)]: ledger,
        [SHARED_STOCK_KEY]: collectSharedStock(dataset, await loadSharedStock())
      });
    }
    return { dataset, statement, ledger };
  }

  root.InvoiceMappingStore = {
    load, save, reset, loadCatalog, saveCatalog, loadStatement, saveStatement,
    loadPriorityRules, savePriorityRules, loadLedger, loadUiSession, saveUiSession,
    clearUiSession, commitVerifiedInvoice, loadStockStateMeta, saveStockStateMeta,
    importStockState, loadStockStateBackup, loadApiTemplate, saveApiTemplate, clearApiTemplate,
    loadIssuedInvoices, saveIssuedInvoices, currentTenant
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
