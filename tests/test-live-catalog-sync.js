const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "bridge.js"), "utf8");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");

assert(bridge.includes("async function fetchLatestProductCatalog()"));
assert(bridge.includes("/DataGrid/GetGridData"));
assert(bridge.includes('credentials: "same-origin"'));
assert(bridge.includes('take: "1000"'));
assert(bridge.includes('detail.action === "fetchLatestProductCatalog"'));
assert(content.includes('request("fetchLatestProductCatalog")'));
assert(content.includes('source: "Website API"'));
assert(content.includes("InvoiceMappingEngine.reconcileCatalog(mappingDataset, webCatalog)"));

// Không được chép thông tin xác thực từ cURL vào mã nguồn.
for (const secret of ["passhash=", "ASP.NET_SessionId=", "__RequestVerificationToken="]) {
  assert(!bridge.includes(secret), `Không được lưu ${secret} trong bridge.js`);
  assert(!content.includes(secret), `Không được lưu ${secret} trong content.js`);
}

console.log("Live catalog sync tests passed");
