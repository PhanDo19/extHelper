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
  const MAPPING_BACKUP_KEY = "invoiceTargetMappingBackup";
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
  // Kim Giang va Linh Dam dung chung kho vat ly. Paris Nhon co kho rieng,
  // khong duoc doc/ghi vao ban ghi chung cua hai co so nay.
  function warehouseKey() {
    return currentTenant() === "parisnhon"
      ? `${SHARED_WAREHOUSE_KEY}__parisnhon`
      : SHARED_WAREHOUSE_KEY;
  }
  // So hoa don dien tu la dai dung chung cua ca hai co so, nen co thu tu, bang
  // sao ke doi chieu va chot tien do phat hanh KHONG duoc tach theo tenantKey.
  const ISSUE_COORDINATION_KEY = "invoiceTargetIssueCoordinationV1";
  // Lệnh "chuyển sang cơ sở kế tiếp để phát hành" ghi ở cơ sở vừa phát hành xong,
  // đọc ở cơ sở đích sau khi trang tải lại. Dùng chung, không qua tenantKey.
  const ISSUE_HANDOFF_KEY = "invoiceTargetIssueHandoffV1";
  // Lượt tự động phát hành theo khoảng ngày: chạy xuyên các cơ sở dùng chung dải
  // số nên trạng thái phải dùng chung, không qua tenantKey.
  const AUTO_ISSUE_KEY = "invoiceTargetAutoIssueV1";
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

  async function saveMappingBackup(dataset, meta = {}) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({
        [tenantKey(MAPPING_BACKUP_KEY)]: {
          dataset: structuredClone(dataset),
          meta: { ...meta, savedAt: new Date().toISOString() }
        }
      });
    }
    return dataset;
  }

  async function loadMappingBackup() {
    if (!globalThis.chrome?.storage?.local) return null;
    const key = tenantKey(MAPPING_BACKUP_KEY);
    const stored = await chrome.storage.local.get(key);
    return stored[key] || null;
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

  // Sao kê được cả tab gốc lẫn tab tạo phiếu phụ ghi. Mỗi lần ghi tăng
  // `revision`; ghi dựa trên bản cũ hơn bản đang lưu thì bị TỪ CHỐI thay vì âm
  // thầm đè mất thay đổi của tab kia. Web Locks (cùng origin nên các tab dùng
  // chung) giữ cho bước "kiểm tra rồi ghi" không xen kẽ giữa hai tab; trình
  // duyệt không có Web Locks thì vẫn kiểm tra, chỉ còn một khe rất nhỏ.
  const STATEMENT_CONFLICT = "statement-conflict";

  function withStorageLock(name, task) {
    const locks = root.navigator?.locks;
    return locks?.request ? locks.request(`invoice-target:${name}`, () => task()) : task();
  }

  function statementRevision(statement) {
    return Math.max(0, Math.floor(Number(statement?.revision) || 0));
  }

  async function assertStatementBase(key, statement) {
    const stored = (await chrome.storage.local.get(key))[key];
    if (!stored || statementRevision(stored) === statementRevision(statement)) return;
    const error = new Error(
      "Sao kê vừa được một tab khác cập nhật nên thao tác này chưa được lưu. " +
      "Hãy tải lại trang (F5) để lấy dữ liệu mới nhất rồi làm lại."
    );
    error.code = STATEMENT_CONFLICT;
    throw error;
  }

  async function saveStatement(statement) {
    if (!globalThis.chrome?.storage?.local) return statement;
    const key = tenantKey(STATEMENT_BASE_KEY);
    await withStorageLock(key, async () => {
      await assertStatementBase(key, statement);
      const revision = statementRevision(statement) + 1;
      await chrome.storage.local.set({ [key]: { ...statement, revision } });
      // Chỉ tăng bản trong bộ nhớ sau khi ghi thành công, để lần ghi lỗi không
      // làm lệch revision và tự gây xung đột ở lần sau.
      statement.revision = revision;
    });
    return statement;
  }

  // Đọc bản MỚI NHẤT, sửa và ghi trong cùng một khóa; trả về bản đã ghi. Dùng
  // cho lần ghi không được phép thất bại vì xung đột (ví dụ kết quả API tạo
  // phiếu đã được cấp số). `mutator` ném lỗi thì không ghi gì.
  async function mutateStatement(mutator) {
    if (!globalThis.chrome?.storage?.local) {
      const statement = { source: "", transactions: [] };
      await mutator(statement);
      return statement;
    }
    const key = tenantKey(STATEMENT_BASE_KEY);
    return withStorageLock(key, async () => {
      const stored = (await chrome.storage.local.get(key))[key];
      const latest = stored ? structuredClone(stored) : { source: "", transactions: [] };
      await mutator(latest);
      latest.revision = statementRevision(latest) + 1;
      await chrome.storage.local.set({ [key]: latest });
      return latest;
    });
  }

  function defaultPriorityRules() {
    // webCode 1500007/1300013 chi ton tai o chi nhanh mac dinh. Chi nhanh khac
    // bat dau voi danh sach rong de khong lap phuong an bang ma hang sai. Dia
    // hoa qua cua Nhon khong di qua rule uu tien: content.js dat toi thieu theo
    // NHOM fruit_platter de bon loai dia duoc luan phien.
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
    const key = warehouseKey();
    const stored = await chrome.storage.local.get(key);
    return stored[key] || structuredClone(fallback);
  }

  async function saveSharedWarehouse(warehouse) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [warehouseKey()]: warehouse });
    }
    return warehouse;
  }

  // Khong qua tenantKey: hai tab phai doc/ghi CUNG mot ban ghi, neu khong moi
  // ben se tuong minh di truoc va so hoa don trong ngay bi tron.
  async function loadIssueCoordination(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const stored = await chrome.storage.local.get(ISSUE_COORDINATION_KEY);
    return stored[ISSUE_COORDINATION_KEY] || structuredClone(fallback);
  }

  async function saveIssueCoordination(state) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({ [ISSUE_COORDINATION_KEY]: state });
    }
    return state;
  }

  async function loadIssueHandoff() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(ISSUE_HANDOFF_KEY);
    return stored[ISSUE_HANDOFF_KEY] || null;
  }

  async function saveIssueHandoff(handoff) {
    if (globalThis.chrome?.storage?.local) {
      if (handoff) await chrome.storage.local.set({ [ISSUE_HANDOFF_KEY]: handoff });
      else await chrome.storage.local.remove(ISSUE_HANDOFF_KEY);
    }
    return handoff;
  }

  async function loadAutoIssueJob() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(AUTO_ISSUE_KEY);
    return stored[AUTO_ISSUE_KEY] || null;
  }

  async function saveAutoIssueJob(job) {
    if (globalThis.chrome?.storage?.local) {
      if (job) await chrome.storage.local.set({ [AUTO_ISSUE_KEY]: job });
      else await chrome.storage.local.remove(AUTO_ISSUE_KEY);
    }
    return job;
  }

  async function commitVerifiedInvoice(dataset, statement, ledger, sharedWarehouse) {
    if (globalThis.chrome?.storage?.local) {
      const statementKey = tenantKey(STATEMENT_BASE_KEY);
      // Cùng khóa và cùng phép kiểm revision với saveStatement: sao kê lệch thì
      // từ chối CẢ lần ghi, để tồn kho và sổ đối soát không được ghi nửa vời.
      await withStorageLock(statementKey, async () => {
        await assertStatementBase(statementKey, statement);
        const revision = statementRevision(statement) + 1;
        const values = {
          [tenantKey(MAPPING_BASE_KEY)]: dataset,
          [statementKey]: { ...statement, revision },
          [tenantKey(LEDGER_BASE_KEY)]: ledger
        };
        // Phải dùng warehouseKey() như load/saveSharedWarehouse: ghi thẳng
        // SHARED_WAREHOUSE_KEY khiến mỗi lần đối soát ở Nhơn đè kho Nhơn lên kho
        // chung của Kim Giang/Linh Đàm, còn kho riêng của Nhơn không bao giờ bị trừ.
        if (sharedWarehouse) values[warehouseKey()] = sharedWarehouse;
        await chrome.storage.local.set(values);
        statement.revision = revision;
      });
    }
    return { dataset, statement, ledger, sharedWarehouse };
  }

  root.InvoiceMappingStore = {
    load, save, reset, loadCatalog, saveCatalog, loadStatement, saveStatement, mutateStatement,
    STATEMENT_CONFLICT,
    loadPriorityRules, savePriorityRules, loadLedger, loadUiSession, saveUiSession,
    clearUiSession, commitVerifiedInvoice, loadStockStateMeta, saveStockStateMeta,
    saveMappingBackup, loadMappingBackup,
    importStockState, loadStockStateBackup, loadApiTemplate, saveApiTemplate, clearApiTemplate,
    loadIssuedInvoices, saveIssuedInvoices, loadSharedWarehouse, saveSharedWarehouse, currentTenant,
    loadIssueCoordination, saveIssueCoordination, loadIssueHandoff, saveIssueHandoff,
    loadAutoIssueJob, saveAutoIssueJob
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
