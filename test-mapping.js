const assert = require("assert");
const engine = require("./mapping-engine.js");

const dataset = {
  mappings: [
    { stockCode: "A", status: "confirmed", availableQty: 2.9, conversion: 1, webCode: "1", webName: "Hàng A", webUnit: "gói", webPrice: 10000 },
    { stockCode: "B", status: "confirmed", availableQty: 3, conversion: 1, webCode: "1", webName: "Hàng A", webUnit: "gói", webPrice: 10000 },
    { stockCode: "C", status: "review", availableQty: 99, conversion: 1, webCode: "2", webName: "Hàng C", webPrice: 20000 },
    { stockCode: "D", status: "confirmed", availableQty: 0, conversion: 1, webCode: "3", webName: "Hàng D", webPrice: 30000 }
  ]
};

assert.equal(engine.normalizeText("  Chân Gà - CAY  "), "chan ga cay");
const inventory = engine.buildInventory(dataset);
assert.equal(inventory.length, 1);
assert.equal(inventory[0].availableQty, 5);
assert.deepEqual(inventory[0].stockCodes, ["A", "B"]);
assert.equal(engine.summarize(dataset).eligible, 2);
const catalog = [
  { webCode: "10", webName: "Nước suối Lavie 350ml", webUnit: "chai", webPrice: 15000 },
  { webCode: "11", webName: "Bia Tiger", webUnit: "chai", webPrice: 45000 }
];
const fresh = engine.mergeStockSnapshot([
  { stockCode: "LAVIE", stockName: "Lavie 350 ml", stockUnit: "chai", availableQty: 12, salePrice: 15000 }
], catalog, []);
assert.equal(fresh[0].status, "review");
assert.equal(fresh[0].webCode, "10");
const preserved = engine.mergeStockSnapshot([
  { stockCode: "OLD", stockName: "Tên mới", availableQty: 7, salePrice: 1 }
], catalog, [{ stockCode: "OLD", status: "confirmed", webCode: "11", webName: "Bia Tiger", webUnit: "chai", webPrice: 45000 }]);
assert.equal(preserved[0].status, "confirmed");
assert.equal(preserved[0].webCode, "11");
assert.equal(preserved[0].availableQty, 7);
const reconcileData = { mappings: [
  { stockCode: "KEEP", status: "confirmed", webCode: "10", webName: "Cũ", webUnit: "chai", webPrice: 1 },
  { stockCode: "GONE", status: "confirmed", webCode: "99", webName: "Đã xóa", webPrice: 1 }
] };
const report = engine.reconcileCatalog(reconcileData, catalog);
assert.equal(report.updated, 1);
assert.equal(report.missing, 1);
assert.equal(reconcileData.mappings[0].webPrice, 15000);
assert.equal(reconcileData.mappings[1].status, "review");
console.log("mapping-engine: OK");
