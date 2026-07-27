(function (root) {
  "use strict";
  const KEY = "invoiceTargetMappingDataset";
  const CATALOG_KEY = "invoiceTargetWebCatalog";
  const STATEMENT_KEY = "invoiceTargetBankStatement";
  const PRIORITY_RULES_KEY = "invoiceTargetPriorityRules";
  const LEDGER_KEY = "invoiceTargetVerificationLedger";
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
    loadPriorityRules, savePriorityRules, loadLedger, commitVerifiedInvoice
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
