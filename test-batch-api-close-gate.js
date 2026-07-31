const fs = require("fs");

const source = fs.readFileSync("content.js", "utf8");
const bridgeSource = fs.readFileSync("bridge.js", "utf8");

for (const invariant of [
  "const transaction = findStatementTransaction(entry?.transactionId)",
  "return { applied: true, invoiceNo, transactionId: String(transaction.id) }",
  'closeResult = await request("closeInvoiceDetail")',
  "transaction = findStatementTransaction(entry?.transactionId)",
  "if (!applyResult?.applied)",
  'const closedAfterSave = await request("closeInvoiceDetail")',
  "if (!closedAfterSave?.closed)",
  "const verification = await verifyBatchSavedInvoice",
  "if (!verification?.verified || !verification?.closed)",
  'const uiState = await request("getInvoiceUiState")',
  "if (uiState?.detailVisible || !uiState?.listVisible)"
]) {
  if (!source.includes(invariant)) {
    throw new Error(`Missing batch API close gate: ${invariant}`);
  }
}

const verifyStart = source.indexOf("async function verifyBatchSavedInvoice(");
const verifyEnd = source.indexOf("\n  async function chooseUnissuedInvoice(", verifyStart);
const verifySource = source.slice(verifyStart, verifyEnd);
for (const outcome of [
  "verified: true, closed: false",
  "verified: true, closed: true",
  "verified: false, closed: false"
]) {
  if (!verifySource.includes(outcome)) {
    throw new Error(`Missing reconciliation outcome: ${outcome}`);
  }
}

console.log("batch API close gate: OK");

for (const lookupGuard of [
  "const invoiceListCache = new Map();",
  "async function waitForInvoiceListRow(invoiceNo, uid, timeout = 5000)",
  "const initial = await waitForInvoiceListRow(invoiceNo, uid);",
  "const cachedRows = invoiceListCache.get(String(dateKey));",
  "invoiceListCache.set(String(dateKey), rows.map(row => ({ ...row })));",
  "(invoiceNo && (element.innerText || \"\").includes(String(invoiceNo)))",
  "const currentRows = invoiceListRows();",
  "if (unissuedRadio.checked &&",
  "currentRows.every(row => row.dateKey === dateKey)",
  "cached: true"
]) {
  if (!bridgeSource.includes(lookupGuard)) {
    throw new Error(`Missing same-day invoice-list reuse guard: ${lookupGuard}`);
  }
}

console.log("same-day invoice-list reuse: OK");
