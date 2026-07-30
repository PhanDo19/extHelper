const assert = require("assert");
const StockState = require("./stock-state.js");

function mappings(qty) {
  return {
    source: "KhoT5.xlsx",
    mappings: [
      { stockCode: "A", stockName: "Hàng A", availableQty: qty, status: "confirmed", webCode: "100", webPrice: 10000 },
      { stockCode: "B", stockName: "Hàng B", availableQty: 5, status: "confirmed", webCode: "101", webPrice: 20000 },
      { stockCode: "TCTO", availableQty: 0, availabilityMode: "per_invoice", status: "confirmed", webCode: "1500007" }
    ]
  };
}

const first = StockState.build({
  mappingDataset: mappings(10),
  exportId: "export-1",
  exportedAt: "2026-07-29T08:00:00.000Z",
  extensionVersion: "1.4.2"
});
assert.strictEqual(StockState.validate(first).valid, true);
assert.strictEqual(first.kind, "invoice-target-inventory-state");
assert.strictEqual(first.schemaVersion, 2);
assert.strictEqual(first.summary.stockItemCount, 2);
assert.strictEqual(first.inventory.rows.length, 2);
assert.strictEqual(JSON.stringify(first).includes("statementDataset"), false);
assert.strictEqual(JSON.stringify(first).includes("webCode"), false);

const second = StockState.build({
  mappingDataset: mappings(7),
  exportId: "export-2",
  parentExportId: "export-1",
  exportedAt: "2026-07-29T09:00:00.000Z"
});
const comparison = StockState.compare(mappings(10), second, {
  currentExportId: "export-1",
  exportedAt: first.exportedAt
});
assert.strictEqual(comparison.validation.valid, true);
assert.strictEqual(comparison.validation.warnings.length, 0);
assert.strictEqual(comparison.counts.decreased, 1);

const applied = StockState.applyToMapping(mappings(10), second);
assert.strictEqual(applied.mappings[0].availableQty, 7);
assert.strictEqual(applied.mappings[0].webCode, "100");
assert.strictEqual(applied.mappings[0].webPrice, 10000);
assert.strictEqual(applied.mappings[2].availabilityMode, "per_invoice");

const wrongBranch = structuredClone(second);
wrongBranch.parentExportId = "another-export";
assert.match(
  StockState.compare(mappings(10), wrongBranch, {
    currentExportId: "export-1",
    exportedAt: first.exportedAt
  }).validation.warnings.join(" "),
  /nhánh dữ liệu khác/
);

const corrupted = structuredClone(second);
corrupted.inventory.rows[0].availableQty = -1;
const corruptValidation = StockState.validate(corrupted);
assert.strictEqual(corruptValidation.valid, false);
assert.match(corruptValidation.errors.join(" "), /không hợp lệ/);

console.log("Inventory-only state package: OK");
