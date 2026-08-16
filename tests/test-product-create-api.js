const fs = require("fs");
const path = require("path");

const bridge = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

for (const invariant of [
  "async function loadProductCreateFormData()",
  "async function createProductViaApi(product)",
  "PRODUCT_TABLE_ID_FOR_CREATE",
  "postDoSavePayload(payload)",
  'detail.action === "createProductViaApi"'
]) {
  if (!bridge.includes(invariant)) throw new Error(`Missing product API invariant: ${invariant}`);
}

for (const invariant of [
  'request("createProductViaApi"',
  "async function createSelectedMappedProducts()",
  "await createProductForMapping(row, draft)",
  "await persistCreatedProduct(row, draft, result)",
  'status: "confirmed"',
  "API không trả ID mặt hàng vừa tạo"
]) {
  if (!content.includes(invariant)) throw new Error(`Missing mapping workflow invariant: ${invariant}`);
}

const apiCall = content.indexOf('request("createProductViaApi"');
const localCommit = content.indexOf("await persistCreatedProduct(row, draft, result)", apiCall);
if (apiCall < 0 || localCommit < apiCall) {
  throw new Error("Mapping/catalog must only be committed after the create API succeeds.");
}

const batchStart = content.indexOf("async function createSelectedMappedProducts()");
const batchEnd = content.indexOf("function renderMappingAdmin()", batchStart);
const batchFlow = content.slice(batchStart, batchEnd);
if (!batchFlow.includes("for (const row of selected)")) {
  throw new Error("Selected products must be created sequentially, not in parallel.");
}
if (batchFlow.includes("Promise.all")) {
  throw new Error("Product create batch must stop safely at the first API error.");
}

console.log("direct product API + post-success mapping workflow: OK");
