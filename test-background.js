const assert = require("assert");

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

require("./background.js");
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
