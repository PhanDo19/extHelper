const fs = require("fs");

const bridge = fs.readFileSync("bridge.js", "utf8");
const content = fs.readFileSync("content.js", "utf8");

const start = bridge.indexOf("async function createAndPayFreshInvoiceViaApi");
const end = bridge.indexOf("window.addEventListener(REQUEST", start);
if (start < 0 || end < 0) throw new Error("Missing API-only fresh invoice flow.");
const flow = bridge.slice(start, end);

[
  "mode: 0",
  "mode: 2",
  "session.body.Tag",
  "sessionTag.LASTSAVEID",
  "sessionTag.detail",
  "Name: \"ThanhToan\"",
  "Name: \"LoaiQuy\"",
  "XUATHOADON: false",
  "createAndPayFreshInvoiceViaApi"
].forEach(invariant => {
  if (!flow.includes(invariant)) throw new Error(`Missing two-step invariant: ${invariant}`);
});

if (flow.indexOf("mode: 0") > flow.indexOf("mode: 2")) {
  throw new Error("Session save must happen before close/payment save.");
}
if (!content.includes('request("createAndPayFreshInvoiceViaApi"')) {
  throw new Error("New-invoice Batch flow is not connected to the two-step API action.");
}
if (!bridge.includes('candidate.source === "window.formData" && !candidate.recordId')) {
  throw new Error("Fresh blank formData must beat stale parent invoice GUIDs.");
}

console.log("two-step create/payment API flow: OK");
