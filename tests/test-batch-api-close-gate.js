const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

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

const saveBatchStart = source.indexOf("async function saveBatchEntryViaApi(");
const saveBatchEnd = source.indexOf("\n  async function saveNewBatchEntryViaWorker(", saveBatchStart);
const saveBatchSource = source.slice(saveBatchStart, saveBatchEnd);
for (const directApiGuard of [
  "openAcceptedInvoiceForApi(index, proxy)",
  'request("saveExistingInvoicePlanViaApi"',
  "transaction.pendingPlan = {",
  'try { await request("closeInvoiceDetail"); } catch (_) {}'
]) {
  if (!saveBatchSource.includes(directApiGuard)) {
    throw new Error(`Missing direct existing-invoice API guard: ${directApiGuard}`);
  }
}
if (saveBatchSource.includes("applyAcceptedBatchPlan(")) {
  throw new Error("Batch API must not mutate invoice items through the UI before DoSave.");
}
for (const bridgeApiGuard of [
  "function existingInvoiceApiDetailRows(",
  "async function saveExistingInvoicePlanViaApi(",
  "fetchProductRowsForApiPlan(expected?.items, warehouseId)",
  "postCurrentInvoiceViaApi(expected, detailRows)",
  'detail.action === "saveExistingInvoicePlanViaApi"'
]) {
  if (!bridgeSource.includes(bridgeApiGuard)) {
    throw new Error(`Missing direct API detail builder: ${bridgeApiGuard}`);
  }
}

console.log("existing invoice direct API path: OK");

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

for (const readinessGuard of [
  "const pagerSelects = pagerElement ? Array.from(pagerElement.querySelectorAll(\"select\")) : [];",
  "pagerSelects.every(select =>",
  "throw new Error(\"Danh sách phiếu chưa khởi tạo xong bộ lọc Kendo; hãy thử lại sau vài giây.\")"
]) {
  if (!bridgeSource.includes(readinessGuard)) {
    throw new Error(`Missing Kendo invoice-list readiness guard: ${readinessGuard}`);
  }
}

for (const roundedGrandGuard of [
  "amount: transaction.acceptedGrandOverride || transaction.credit",
  "async function resetRoundedGrand(event)",
  "delete transaction.acceptedGrandOverride",
  'table.querySelectorAll(".it-reset-rounded")'
]) {
  if (!source.includes(roundedGrandGuard)) {
    throw new Error(`Missing rounded-grand recovery guard: ${roundedGrandGuard}`);
  }
}

if (bridgeSource.includes('window.alert("Tiền mặt chưa khớp Tổng tiền.')) {
  throw new Error("Save blocking must not use a native alert.");
}
for (const saveBlockedGuard of [
  'const SAVE_BLOCKED = "invoice-target-mvp:save-blocked";',
  "window.dispatchEvent(new CustomEvent(SAVE_BLOCKED",
  "window.addEventListener(SAVE_BLOCKED"
]) {
  if (!source.includes(saveBlockedGuard) && !bridgeSource.includes(saveBlockedGuard)) {
    throw new Error(`Missing non-blocking save warning: ${saveBlockedGuard}`);
  }
}

console.log("Kendo readiness / rounded-grand recovery: OK");
