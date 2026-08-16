const fs = require("fs");
const path = require("path");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

[
  'await request("armApiTrace")',
  'persistGeneratedInvoiceApiDebugLog({',
  'outcome: "success"',
  'outcome: "error"',
  'request("getApiTrace")',
  'chrome.storage.local.set({ [apiDebugStorageKey()]: payload })',
  'tenantLabel: pageTenantLabel',
  'id="it-export-latest-api-debug"',
  'invoice-api-debug-${pageTenantSlug}-${transactionDate}-${stamp}.json'
].forEach(invariant => {
  if (!content.includes(invariant)) throw new Error(`Missing automatic API debug invariant: ${invariant}`);
});

if (/\n\s*tenantLabel,/.test(content) || /\$\{tenantLabel\}/.test(content)) {
  throw new Error("Undefined tenantLabel reference remains in content script.");
}

if (!background.includes("invoice-api-debug-(pariskimgiang|parislinhdam)")) {
  throw new Error("Background download allowlist does not permit generated API debug logs.");
}

console.log("automatic generated-invoice API debug log: OK");
