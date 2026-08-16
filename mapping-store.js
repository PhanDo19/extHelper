(function (root) {
  "use strict";
  // Mỗi chi nhánh có danh mục web/mã web riêng, nhưng Kim Giang và Linh Đàm
  // đang dùng chung một kho vật lý. Vì vậy mapping vẫn tách theo chi nhánh,
  // còn số lượng vật lý được lưu ở SHARED_WAREHOUSE_KEY dùng chung.
  //
  // Vi vay:
  //   - Du lieu gan voi MA WEB (mapping, danh muc, quy tac uu tien) tach theo
  //     chi nhanh.
  //   - Du lieu gan voi GIAO DICH (sao ke, phien UI, so hoa don, so doi chieu)
  //     tach theo chi nhanh.
  //   - SO TON KHO, metadata/backup kho va mau API cung tach theo chi nhanh.
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
  const SHARED_WAREHOUSE_KEY = "invoiceTargetSharedWarehouseV1";
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

  async function load(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const key = tenantKey(MAPPING_BASE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || structuredClone(fallback);
  }

  async function save(dataset) {
    if (!globalThis.chrome?.storage?.local) return dataset;
    await chrome.storage.local.set({ [tenantKey(MAPPING_BASE_KEY)]: dataset });
    return dataset;
  }

  async function reset() {
    // Chi xoa mapping/kho cua chi nhanh hien tai.
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
    const key = tenantKey(STOCK_STATE_META_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function saveStockStateMeta(meta) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [tenantKey(STOCK_STATE_META_KEY)]: meta });
    return meta;
  }

  async function importStockState(mappingDataset, meta, backup) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({
        [tenantKey(STOCK_STATE_BACKUP_KEY)]: backup,
        [tenantKey(MAPPING_BASE_KEY)]: mappingDataset,
        [tenantKey(STOCK_STATE_META_KEY)]: meta
      });
    }
    return mappingDataset;
  }

  async function loadStockStateBackup() {
    if (!globalThis.chrome?.storage?.local) return null;
    const key = tenantKey(STOCK_STATE_BACKUP_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function loadApiTemplate() {
    if (!globalThis.chrome?.storage?.local) return null;
    const key = tenantKey(API_TEMPLATE_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
  }

  async function saveApiTemplate(template) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [tenantKey(API_TEMPLATE_KEY)]: template });
    return template;
  }

  async function clearApiTemplate() {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(tenantKey(API_TEMPLATE_KEY));
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

  async function loadSharedWarehouse(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const stored = await chrome.storage.local.get(SHARED_WAREHOUSE_KEY);
    return stored[SHARED_WAREHOUSE_KEY] || structuredClone(fallback);
  }

  async function saveSharedWarehouse(warehouse) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [SHARED_WAREHOUSE_KEY]: warehouse });
    }
    return warehouse;
  }

  async function commitVerifiedInvoice(dataset, statement, ledger, sharedWarehouse) {
    if (globalThis.chrome?.storage?.local) {
      const values = {
        [tenantKey(MAPPING_BASE_KEY)]: dataset,
        [tenantKey(STATEMENT_BASE_KEY)]: statement,
        [tenantKey(LEDGER_BASE_KEY)]: ledger
      };
      if (sharedWarehouse) values[SHARED_WAREHOUSE_KEY] = sharedWarehouse;
      await chrome.storage.local.set(values);
    }
    return { dataset, statement, ledger, sharedWarehouse };
  }

  root.InvoiceMappingStore = {
    load, save, reset, loadCatalog, saveCatalog, loadStatement, saveStatement,
    loadPriorityRules, savePriorityRules, loadLedger, loadUiSession, saveUiSession,
    clearUiSession, commitVerifiedInvoice, loadStockStateMeta, saveStockStateMeta,
    importStockState, loadStockStateBackup, loadApiTemplate, saveApiTemplate, clearApiTemplate,
    loadIssuedInvoices, saveIssuedInvoices, loadSharedWarehouse, saveSharedWarehouse, currentTenant
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
