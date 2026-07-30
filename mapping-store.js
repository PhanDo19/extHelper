(function (root) {
  "use strict";
  const KEY = "invoiceTargetMappingDataset";
  const CATALOG_KEY = "invoiceTargetWebCatalog";
  const STATEMENT_KEY = "invoiceTargetBankStatement";
  const PRIORITY_RULES_KEY = "invoiceTargetPriorityRules";
  const LEDGER_KEY = "invoiceTargetVerificationLedger";
  const UI_SESSION_KEY = "invoiceTargetUiSession";
  const STOCK_STATE_META_KEY = "invoiceTargetStockStateMeta";
  const STOCK_STATE_BACKUP_KEY = "invoiceTargetStockStateBackup";
  const DEFAULT_PRIORITY_RULES = [
    { id: "rule-tcto", code: "TCTO", webCode: "1500007", minTotal: 1000000, priority: 1, enabled: true },
    { id: "rule-wine", code: "RUOUVANGDO", webCode: "1300013", minTotal: 1000000, priority: 2, enabled: true }
  ];

  async function load(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] || structuredClone(fallback);
  }

  async function save(dataset) {
    if (!globalThis.chrome?.storage?.local) return dataset;
    await chrome.storage.local.set({ [KEY]: dataset });
    return dataset;
  }

  async function reset() {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(KEY);
  }

  async function loadCatalog(fallback) {
    if (!globalThis.chrome?.storage?.local) return structuredClone(fallback);
    const stored = await chrome.storage.local.get(CATALOG_KEY);
    return stored[CATALOG_KEY] || structuredClone(fallback);
  }

  async function saveCatalog(catalog) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [CATALOG_KEY]: catalog });
    return catalog;
  }

  async function loadStatement() {
    if (!globalThis.chrome?.storage?.local) return { source: "", transactions: [] };
    const stored = await chrome.storage.local.get(STATEMENT_KEY);
    return stored[STATEMENT_KEY] || { source: "", transactions: [] };
  }

  async function saveStatement(statement) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [STATEMENT_KEY]: statement });
    return statement;
  }

  async function loadPriorityRules() {
    if (!globalThis.chrome?.storage?.local) return structuredClone(DEFAULT_PRIORITY_RULES);
    const stored = await chrome.storage.local.get(PRIORITY_RULES_KEY);
    return stored[PRIORITY_RULES_KEY] || structuredClone(DEFAULT_PRIORITY_RULES);
  }

  async function savePriorityRules(rules) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [PRIORITY_RULES_KEY]: rules });
    return rules;
  }

  async function loadLedger() {
    if (!globalThis.chrome?.storage?.local) return { entries: [] };
    const stored = await chrome.storage.local.get(LEDGER_KEY);
    return stored[LEDGER_KEY] || { entries: [] };
  }

  async function loadUiSession() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(UI_SESSION_KEY);
    return stored[UI_SESSION_KEY] || null;
  }

  async function saveUiSession(session) {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.set({ [UI_SESSION_KEY]: session });
    return session;
  }

  async function clearUiSession() {
    if (globalThis.chrome?.storage?.local) await chrome.storage.local.remove(UI_SESSION_KEY);
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
      await chrome.storage.local.set({
        [STOCK_STATE_BACKUP_KEY]: backup,
        [KEY]: mappingDataset,
        [STOCK_STATE_META_KEY]: meta
      });
    }
    return mappingDataset;
  }

  async function loadStockStateBackup() {
    if (!globalThis.chrome?.storage?.local) return null;
    const stored = await chrome.storage.local.get(STOCK_STATE_BACKUP_KEY);
    return stored[STOCK_STATE_BACKUP_KEY] || null;
  }

  async function commitVerifiedInvoice(dataset, statement, ledger) {
    if (globalThis.chrome?.storage?.local) {
      await chrome.storage.local.set({
        [KEY]: dataset,
        [STATEMENT_KEY]: statement,
        [LEDGER_KEY]: ledger
      });
    }
    return { dataset, statement, ledger };
  }

  root.InvoiceMappingStore = {
    load, save, reset, loadCatalog, saveCatalog, loadStatement, saveStatement,
    loadPriorityRules, savePriorityRules, loadLedger, loadUiSession, saveUiSession,
    clearUiSession, commitVerifiedInvoice, loadStockStateMeta, saveStockStateMeta,
    importStockState, loadStockStateBackup
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
