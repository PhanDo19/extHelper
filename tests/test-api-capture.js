const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
const storeSource = fs.readFileSync(path.join(__dirname, "..", "mapping-store.js"), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

const context = {
  URL,
  URLSearchParams,
  Date,
  location: {
    href: "http://banhang.thuanvietsoft.com/pariskimgiang/Form",
    origin: "http://banhang.thuanvietsoft.com"
  }
};
vm.createContext(context);
vm.runInContext(`
  let saveCaptureArmedUntil = Date.now() + 60000;
  ${extractFunction(bridgeSource, "safeRequestHeaders")}
  ${extractFunction(bridgeSource, "shouldCaptureSaveRequest")}
  this.safeRequestHeaders = safeRequestHeaders;
  this.shouldCaptureSaveRequest = shouldCaptureSaveRequest;
`, context);

if (!context.shouldCaptureSaveRequest("POST", "/pariskimgiang/AddEdit?TableID=x")) {
  throw new Error("Same-origin AddEdit POST must be captured while armed.");
}
if (context.shouldCaptureSaveRequest("GET", "/pariskimgiang/AddEdit?TableID=x")) {
  throw new Error("GET must never be treated as an invoice save.");
}
if (context.shouldCaptureSaveRequest("POST", "/pariskimgiang/KetNoiThietBi")) {
  throw new Error("Unrelated background POST must not be captured.");
}
if (context.shouldCaptureSaveRequest("POST", "https://example.com/AddEdit")) {
  throw new Error("Cross-origin request must not be captured.");
}

const safe = context.safeRequestHeaders({
  "Content-Type": "application/json",
  Authorization: "secret",
  Cookie: "session=secret",
  "X-Requested-With": "XMLHttpRequest"
});
if (safe.Authorization || safe.Cookie) throw new Error("Sensitive headers were retained.");
if (safe["Content-Type"] !== "application/json") throw new Error("Content type was removed.");

for (const method of ["loadApiTemplate", "saveApiTemplate", "clearApiTemplate"]) {
  if (!storeSource.includes(`function ${method}(`)) throw new Error(`Missing store method ${method}`);
}

console.log("API save capture guards: OK");
