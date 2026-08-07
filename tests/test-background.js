const assert = require("assert");
const path = require("path");

let listener;
let downloadOptions;
let createdTabOptions;
let removedTabId;
globalThis.chrome = {
  runtime: {
    lastError: null,
    onMessage: {
      addListener(callback) {
        listener = callback;
      }
    }
  },
  downloads: {
    download(options, callback) {
      downloadOptions = options;
      callback(42);
    }
  },
  tabs: {
    create(options, callback) {
      createdTabOptions = options;
      callback({ id: 77 });
    },
    remove(tabId, callback) {
      removedTabId = tabId;
      callback();
    }
  }
};

require(path.join(__dirname, "..", "background.js"));
assert.equal(typeof listener, "function");

let invalidResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.downloadStockState",
  filename: "../bad.json",
  content: "{}"
}, {}, response => { invalidResponse = response; }), false);
assert.strictEqual(invalidResponse.ok, false);

let validResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.downloadStockState",
  filename: "TonKho_ParisKimGiang_2026-07-29_120000.json",
  content: "{\"kind\":\"invoice-target-stock-state\"}"
}, {}, response => { validResponse = response; }), true);
assert.strictEqual(validResponse.ok, true);
assert.strictEqual(validResponse.downloadId, 42);
assert.strictEqual(downloadOptions.saveAs, false);
assert.match(downloadOptions.url, /^data:application\/json/);

let traceResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.downloadStockState",
  filename: "invoice-api-trace-2026-08-02T09-27-16-000Z.json",
  content: "{\"schemaVersion\":1,\"records\":[]}"
}, {}, response => { traceResponse = response; }), true);
assert.strictEqual(traceResponse.ok, true);
assert.strictEqual(downloadOptions.filename, "invoice-api-trace-2026-08-02T09-27-16-000Z.json");

// File hach toan "Xuat kho da phat hanh" nay la Excel nen di qua kenh nhi phan.
let issuedResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.downloadBinary",
  filename: "XuatKho_PhatHanh_2026-08-07_143012.xlsx",
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  base64: "UEsDBBQAAAAIAA=="
}, {}, response => { issuedResponse = response; }), true);
assert.strictEqual(issuedResponse.ok, true);
assert.strictEqual(downloadOptions.filename, "XuatKho_PhatHanh_2026-08-07_143012.xlsx");
assert.match(downloadOptions.url, /^data:application\/vnd\.openxmlformats/);

// Ten file la va base64 sai dinh dang deu bi chan.
let rejected;
listener({
  type: "invoiceTarget.downloadBinary",
  filename: "../evil.xlsx",
  base64: "UEsDBBQ="
}, {}, response => { rejected = response; });
assert.strictEqual(rejected.ok, false);
listener({
  type: "invoiceTarget.downloadBinary",
  filename: "XuatKho_PhatHanh_2026-08-07_143012.xlsx",
  base64: "khong-phai-base64!!"
}, {}, response => { rejected = response; });
assert.strictEqual(rejected.ok, false);

// Kenh JSON khong con nhan file .json cua luong phat hanh nua.
let legacy;
listener({
  type: "invoiceTarget.downloadStockState",
  filename: "XuatKho_PhatHanh_2026-08-07_143012.json",
  content: "{}"
}, {}, response => { legacy = response; });
assert.strictEqual(legacy.ok, false);

let openResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.openBatchWorkerTab",
  url: "http://banhang.thuanvietsoft.com/pariskimgiang/Form"
}, {}, response => { openResponse = response; }), true);
assert.strictEqual(openResponse.ok, true);
assert.strictEqual(openResponse.tabId, 77);
assert.strictEqual(createdTabOptions.active, true);

let closeResponse;
assert.strictEqual(listener({
  type: "invoiceTarget.closeCurrentBatchWorkerTab"
}, { tab: { id: 77 } }, response => { closeResponse = response; }), true);
assert.strictEqual(closeResponse.ok, true);
assert.strictEqual(removedTabId, 77);

console.log("Background download and Batch worker tabs: OK");
