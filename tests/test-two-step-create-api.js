const fs = require("fs");
const path = require("path");

const bridge = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const legacyStart = bridge.indexOf("async function createAndPayFreshInvoiceViaApiLegacy(expected)");
const wrapperStart = bridge.indexOf("async function createAndPayFreshInvoiceViaApi(expected)", legacyStart);
const end = bridge.indexOf("// ---------------------------------------------------------------------------", wrapperStart);
if (legacyStart < 0 || wrapperStart < 0 || end < 0) {
  throw new Error("Missing two-step fresh invoice flow.");
}
const flow = bridge.slice(legacyStart, wrapperStart);
const wrapper = bridge.slice(wrapperStart, end);

if (!bridge.includes("const actualPaymentAt = parseStoredDateTime(fields.GIOTHANHTOAN)")) {
  throw new Error("GIOTHANHTOAN must be verified against the accepted checkout time.");
}
if (bridge.includes("storedLocalDateKey(fields.GIOTHANHTOAN) !== invoiceDateKey")) {
  throw new Error("Existing invoices must not force payment time onto the statement/list date.");
}

if (!bridge.includes("const VIETNAM_UTC_OFFSET_HOURS = 7") ||
    !bridge.includes("Date.UTC(") ||
    !bridge.includes("-VIETNAM_UTC_OFFSET_HOURS")) {
  throw new Error("Document date must be serialized as Viet Nam midnight (UTC+7).");
}

[
  "mode: 0", "mode: 2", "Name: \"ThanhToan\"", "Name: \"LoaiQuy\"", "Name: \"LuuVet\"",
  "XUATHOADON: false", "NGAY: localMidnightIso(invoiceDateKey)",
  "NAME: sessionTag.NAME", "ID: sessionTag.ID", "LASTSAVEID: sessionTag.LASTSAVEID",
  "GIOTHANHTOAN: localUsDateTime(checkOut)", "GioClient: localServerDateTime(checkOut)",
  "GIOCLIENT: localServerDateTime(checkOut).replace(/-/g, \"/\")"
].forEach(invariant => {
  if (!flow.includes(invariant)) throw new Error(`Missing fresh-create invariant: ${invariant}`);
});
if (!wrapper.includes("createAndPayFreshInvoiceViaApiLegacy(expected)") ||
    !wrapper.includes('createProtocol: "mode0-then-mode2"')) {
  throw new Error("Live fresh-create action is not routed through the two-step protocol.");
}
if (!content.includes('request("createAndPayFreshInvoiceViaApi"')) {
  throw new Error("Batch flow is not connected to the fresh API action.");
}
if (!content.includes("ton kho chua bi tru") || !content.includes("latestTransaction?.apiSavedAt") ||
    !content.includes("verifyBatchSavedInvoice")) {
  throw new Error("Original Batch tab must verify server data before stock is committed.");
}
console.log("two-step backdated create/payment API flow: OK");
