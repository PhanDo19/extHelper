const assert = require("assert");

let listener;
let downloadOptions;
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

console.log("Background download: OK");
