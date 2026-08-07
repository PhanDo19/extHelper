const fs = require("fs");
const vm = require("vm");

const bridgeSource = fs.readFileSync("bridge.js", "utf8");
const contentSource = fs.readFileSync("content.js", "utf8");
const createFixture = JSON.parse(fs.readFileSync(
  "fixtures/api/create-invoice-init.sanitized.json",
  "utf8"
));
const fullFlowFixture = JSON.parse(fs.readFileSync(
  "fixtures/api/full-create-payment-flow.sanitized.json",
  "utf8"
));

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
  Date,
  location: {
    href: "http://banhang.thuanvietsoft.com/pariskimgiang/Form",
    origin: "http://banhang.thuanvietsoft.com"
  }
};
vm.createContext(context);
vm.runInContext(`
  let apiTraceArmedUntil = Date.now() + 60000;
  ${extractFunction(bridgeSource, "safeRequestHeaders")}
  ${extractFunction(bridgeSource, "shouldTraceApiRequest")}
  this.safeRequestHeaders = safeRequestHeaders;
  this.shouldTraceApiRequest = shouldTraceApiRequest;
`, context);

for (const url of [
  "/pariskimgiang/AddEdit/DoSave?is_ajax=1",
  "/pariskimgiang/AddEdit?TableID=x",
  "/pariskimgiang/GetDataSearchData?TableID=x",
  "/pariskimgiang/LayDuLieu?Loai=0",
  "/pariskimgiang/GridLookupData?TableID=x"
]) {
  if (!context.shouldTraceApiRequest("POST", url) && !context.shouldTraceApiRequest("GET", url)) {
    throw new Error(`Expected API trace match: ${url}`);
  }
}
if (context.shouldTraceApiRequest("GET", "https://example.com/AddEdit")) {
  throw new Error("Cross-origin request must not be traced.");
}
if (context.shouldTraceApiRequest("DELETE", "/pariskimgiang/AddEdit")) {
  throw new Error("DELETE must not be traced.");
}
if (context.shouldTraceApiRequest("GET", "/pariskimgiang/Images/icon.png")) {
  throw new Error("Static assets must not be traced.");
}

const headers = context.safeRequestHeaders({
  Authorization: "secret",
  Cookie: "session=secret",
  "Proxy-Authorization": "proxy-secret",
  "Content-Type": "application/x-www-form-urlencoded"
});
if (headers.Authorization || headers.Cookie || headers["Proxy-Authorization"]) {
  throw new Error("Sensitive headers leaked into trace.");
}
if (headers["Content-Type"] !== "application/x-www-form-urlencoded") {
  throw new Error("Content-Type unexpectedly removed.");
}

for (const marker of ["it-arm-api-trace", "it-export-api-trace", "armApiTrace", "getApiTrace"]) {
  if (!contentSource.includes(marker) && !bridgeSource.includes(marker)) {
    throw new Error(`Missing trace UI/bridge marker: ${marker}`);
  }
}

if (createFixture.persistentRecordCreated !== false) {
  throw new Error("Opening AddEdit with a blank RecordID must not be documented as a persistent create.");
}
const expectedInitFlow = [
  ["GET", "/pariskimgiang/AddEdit"],
  ["POST", "/pariskimgiang/DataGrid/GetDataSearchData"],
  ["POST", "/pariskimgiang/Service/GridLookupData"],
  ["POST", "/pariskimgiang/Service/GridLookupData"],
  ["POST", "/pariskimgiang/Service/GridLookupData"]
];
const actualInitFlow = createFixture.requests.map(item => [item.method, item.path]);
if (JSON.stringify(actualInitFlow) !== JSON.stringify(expectedInitFlow)) {
  throw new Error(`Unexpected create-form request order: ${JSON.stringify(actualInitFlow)}`);
}
if (createFixture.requests[0].query.RecordID !== "") {
  throw new Error("New form fixture must keep RecordID blank.");
}
if (createFixture.persistence.path !== "/pariskimgiang/AddEdit/DoSave?is_ajax=1") {
  throw new Error("DoSave persistence contract is missing from the fixture.");
}
if (!bridgeSource.includes("traceApi ? 131072 : 8000")) {
  throw new Error("API trace must retain enough AddEdit HTML to inspect hidden form fields.");
}

const expectedFullFlow = [
  ["open-new", "GET", "/pariskimgiang/AddEdit"],
  ["open-new", "POST", "/pariskimgiang/DataGrid/GetDataSearchData"],
  ["open-new", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["open-new", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["open-new", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["save-session", "POST", "/pariskimgiang/AddEdit/DoSave?is_ajax=1"],
  ["reopen-session", "GET", "/pariskimgiang/AddEdit"],
  ["reopen-session", "POST", "/pariskimgiang/DataGrid/GetDataSearchData"],
  ["reopen-session", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["reopen-session", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["reopen-session", "POST", "/pariskimgiang/Service/GridLookupData"],
  ["close-and-pay", "POST", "/pariskimgiang/AddEdit/DoSave?is_ajax=1"]
];
const actualFullFlow = fullFlowFixture.requestSequence.map(item => [
  item.phase,
  item.method,
  item.path
]);
if (JSON.stringify(actualFullFlow) !== JSON.stringify(expectedFullFlow)) {
  throw new Error(`Unexpected full API flow: ${JSON.stringify(actualFullFlow)}`);
}
if (fullFlowFixture.requestCount !== expectedFullFlow.length) {
  throw new Error("Full-flow fixture request count is stale.");
}
if (fullFlowFixture.sessionSave.mode !== 0 || fullFlowFixture.paymentSave.mode !== 2) {
  throw new Error("New invoice must save the room session before closing and paying it.");
}
if (fullFlowFixture.sessionSave.response.code !== 1
    || fullFlowFixture.paymentSave.response.code !== 1) {
  throw new Error("Both DoSave responses must use the business-success contract.");
}
if (!fullFlowFixture.sessionSave.response.Tag.ID
    || !fullFlowFixture.sessionSave.response.Tag.LASTSAVEID) {
  throw new Error("Session save must supply invoice ID and LASTSAVEID for the payment save.");
}
if (fullFlowFixture.paymentSave.clientMap.ID !== "<INVOICE_ID>"
    || fullFlowFixture.paymentSave.clientMap.Maps.LASTSAVEID !== "<SESSION_LASTSAVE_ID>") {
  throw new Error("Payment save must reuse IDs returned by the session save.");
}

const payment = fullFlowFixture.paymentSave.clientMap;
const grand = Number(payment.Maps.TONGCONG);
const paymentRows = Object.fromEntries(payment.CustomPostTable.flatMap(table =>
  table.Data.map(row => [`${table.Name}.${row.truong}`, Number(row.value)])));
for (const key of [
  "ThanhToan.KHACHDUA",
  "LoaiQuy.TIENMAT",
  "LoaiQuy.TIENTHANHTOAN"
]) {
  if (paymentRows[key] !== grand) {
    throw new Error(`${key} must equal TONGCONG.`);
  }
}
if (paymentRows["ThanhToan.TRALAI"] !== 0) {
  throw new Error("TRALAI must be zero for an exact cash payment.");
}
if (Number(payment.Maps.TIENHANG) + Number(payment.Maps.TIENGIO)
    + Number(payment.Maps.TIENTHUE) !== grand) {
  throw new Error("Payment money components do not add up to TONGCONG.");
}
if (payment.CustomPost.XUATHOADON !== false) {
  throw new Error("Trace fixture must not issue an electronic invoice.");
}
if (!fullFlowFixture.verifiedOutcome.roomReleased
    || !fullFlowFixture.verifiedOutcome.invoiceVisibleInList) {
  throw new Error("End-to-end verification outcome is incomplete.");
}
if (fullFlowFixture.security.containsCookie
    || fullFlowFixture.security.containsAuthorization
    || fullFlowFixture.security.containsProxyAuthorization) {
  throw new Error("Full-flow fixture reports that sensitive headers are present.");
}
for (const forbiddenProperty of ['"Cookie":', '"Authorization":', '"Proxy-Authorization":']) {
  if (JSON.stringify(fullFlowFixture).includes(forbiddenProperty)) {
    throw new Error(`Sensitive header leaked into full-flow fixture: ${forbiddenProperty}`);
  }
}

console.log("API trace guards, init fixture and 12-request full-flow contract: OK");
