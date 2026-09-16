const assert = require("assert");
const path = require("path");
const engine = require(path.join(__dirname, "..", "mapping-engine.js"));

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
const fruitRules = engine.applyBusinessRules({ mappings: [{ stockCode: "TCTO" }] });
assert.equal(fruitRules.mappings[0].webPrice, 400000);
assert.equal(fruitRules.mappings[0].perInvoiceMax, 1);
assert.equal(fruitRules.mappings.length, 1, "Kim Giang chỉ ghi đè dòng có sẵn, không tự thêm dòng.");

// Nhơn: file kho không có hoa quả nên rule phải TỰ THÊM 4 đĩa bán theo suất,
// tối đa một đĩa (bất kỳ loại) mỗi hóa đơn; áp lại lần nữa không nhân đôi.
const nhonFruit = engine.applyBusinessRules({ tenant: "parisnhon", mappings: [{ stockCode: "HH_Heneiken", status: "confirmed", webCode: "0000004" }] });
const nhonFruitRows = nhonFruit.mappings.filter(row => row.constraintGroup === "fruit_platter");
assert.equal(nhonFruitRows.length, 4, "Nhơn phải có 4 đĩa hoa quả bán theo suất.");
assert.deepEqual(nhonFruitRows.map(row => row.webCode).sort(), ["0000012", "0000013", "0000047", "0000048"]);
for (const row of nhonFruitRows) {
  assert.equal(row.status, "confirmed");
  assert.equal(row.availabilityMode, "per_invoice");
  assert.equal(row.perInvoiceMax, 1);
  assert.equal(row.constraintGroupMax, 1);
  assert.ok(row.synthetic, "Dòng tự thêm phải được đánh dấu synthetic.");
}
assert.equal(nhonFruit.mappings.find(row => row.webCode === "0000013").webPrice, 450000);
assert.equal(engine.applyBusinessRules(nhonFruit).mappings.length, 5, "Áp lại rule không được nhân đôi dòng.");
assert.equal(engine.applyBusinessRules({ mappings: [] }, "parisnhon").mappings.length, 4, "Tham số cơ sở ghi đè dataset.tenant.");
const nhonInventory = engine.buildInventory(nhonFruit);
const fruitStock = nhonInventory.find(item => item.webCode === "0000013");
assert.ok(fruitStock, "Đĩa hoa quả bán theo suất phải vào tồn khả dụng dù tồn kho bằng 0.");
assert.equal(fruitStock.availableQty, 1);
assert.equal(fruitStock.availabilityMode, "per_invoice");
assert.equal(fruitStock.constraintGroupMax, 1);
// Linh Đàm không có trong bảng: giữ nguyên.
const linhDam = engine.applyBusinessRules({ tenant: "parislinhdam", mappings: [{ stockCode: "TCTO" }] });
assert.equal(linhDam.mappings.length, 1);
assert.equal(linhDam.mappings[0].webPrice, undefined, "Linh Đàm phải tự ánh xạ, không mượn rule cơ sở khác.");
console.log("mapping-engine: OK");
