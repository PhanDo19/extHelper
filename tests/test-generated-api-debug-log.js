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

const debugAllowlist = /invoice-api-debug-\(([a-z|]+)\)/.exec(background);
const debugTenants = debugAllowlist ? debugAllowlist[1].split("|") : [];
if (!["pariskimgiang", "parislinhdam", "parisnhon"].every(t => debugTenants.includes(t))) {
  throw new Error("Background download allowlist does not permit generated API debug logs.");
}

// Tải file log là tùy chọn và không được làm hỏng luồng tạo phiếu:
// - có ô bật/tắt tự tải, log vẫn luôn được lưu vào storage trước khi tải;
// - lỗi tải file (hủy hộp thoại lưu của Chrome) chỉ ghi console, không ném ra;
// - context mồ côi phải bị chặn TRƯỚC khi gửi API tạo phiếu, và log thành công
//   nằm NGOÀI try của lời gọi API để lỗi ghi log không làm mất kết quả lưu.
[
  'const API_DEBUG_AUTO_DOWNLOAD_KEY = "invoiceTarget.apiDebug.autoDownload"',
  'id="it-api-debug-auto-download"',
  'if (!apiDebugAutoDownload) return payload;',
  'payload.downloadError = String(error?.message || error || "");',
  'await loadApiDebugAutoDownload();'
].forEach(invariant => {
  if (!content.includes(invariant)) throw new Error(`Missing API debug download option invariant: ${invariant}`);
});
const storeIndex = content.indexOf('chrome.storage.local.set({ [apiDebugStorageKey()]: payload })');
const downloadIndex = content.indexOf('invoice-api-debug-${pageTenantSlug}-${transactionDate}-${stamp}.json');
if (storeIndex < 0 || downloadIndex < 0 || storeIndex > downloadIndex) {
  throw new Error("The API debug log must be stored before any download attempt.");
}
const applyStart = content.indexOf("async function applyPendingNewInvoicePlan(");
const guardIndex = content.indexOf("assertRuntimeContext();", applyStart);
const createIndex = content.indexOf('apiSaved = await request("createAndPayFreshInvoiceViaApi", apiExpected);', applyStart);
const successLogIndex = content.indexOf('outcome: "success"', applyStart);
const createCatchIndex = content.indexOf("} catch (error) {", createIndex);
if (applyStart < 0 || guardIndex < 0 || createIndex < 0 || guardIndex > createIndex) {
  throw new Error("applyPendingNewInvoicePlan must assert the extension runtime before calling the create API.");
}
if (successLogIndex < 0 || createCatchIndex < 0 || successLogIndex < createCatchIndex) {
  throw new Error("The success debug log must run outside the create API try block.");
}
if (!content.includes("Không thể xuất API debug log sau khi lưu thành công")) {
  throw new Error("A failed success-log write must be swallowed, not rethrown.");
}

console.log("automatic generated-invoice API debug log: OK");
