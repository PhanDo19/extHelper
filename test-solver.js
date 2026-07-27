const assert = require("assert");
const solver = require("./solver.js");

assert.strictEqual(solver.deriveGoodsTarget(935000, 1675300, 1675300, 10), 935000);
assert.strictEqual(solver.deriveGoodsTarget(935000, 1675300, 1785300, 10), 1035000);

const accountingTargets = solver.deriveInvoiceTargets(1675300, 588000, 10);
assert.deepStrictEqual(accountingTargets, {
  preTaxTarget: 1523000,
  vatTarget: 152300,
  currentHour: 588000,
  goodsTarget: 935000
});

const exact = solver.solveQuantities([
  { code: "A", name: "A", price: 400000, qty: 1 },
  { code: "B", name: "B", price: 45000, qty: 11 },
  { code: "C", name: "C", price: 20000, qty: 2 }
], 935000, { maxQty: 99, tolerance: 0 });
assert.strictEqual(exact.exact, true);
assert.strictEqual(exact.actual, 935000);

const changed = solver.solveQuantities([
  { code: "A", name: "A", price: 40000, qty: 1 },
  { code: "B", name: "B", price: 65000, qty: 1 }
], 235000, { maxQty: 10, tolerance: 0 });
assert.strictEqual(changed.actual, 235000);

console.log("solver tests: OK");

const bounded = solver.solveQuantities([
  { code: "LIMITED", name: "Limited", price: 50000, qty: 0, maxQty: 2 },
  { code: "OTHER", name: "Other", price: 20000, qty: 0, maxQty: 10 }
], 250000, { maxQty: 99, tolerance: 0 });
const limited = bounded.items.find(item => item.code === "LIMITED");
assert.ok(limited.newQty <= 2, "quantity must not exceed per-item stock limit");

const fruit = solver.solveQuantities([
  { code: "TC", price: 350000, qty: 0, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 },
  { code: "TCTO", price: 450000, qty: 0, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 }
], 800000, { maxQty: 99, tolerance: 1000000 });
const fruitQty = fruit.items.reduce((sum, item) => sum + item.newQty, 0);
assert.ok(fruitQty <= 1, "TC and TCTO combined must be at most one per invoice");

const required = solver.solveQuantities([
  { code: "TCTO", price: 450000, qty: 0, minQty: 1, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 },
  { code: "WINE", price: 650000, qty: 0, minQty: 0, maxQty: 10 },
  { code: "WATER", price: 20000, qty: 0, minQty: 0, maxQty: 20 }
], 1500000, { maxQty: 20, tolerance: 0 });
assert.strictEqual(required.items.find(item => item.code === "TCTO").newQty, 1, "checked priority item must appear at least once");

const hourBalanced = solver.solveQuantities([
  { code: "A", price: 450000, qty: 0, maxQty: 1 },
  { code: "B", price: 45000, qty: 0, maxQty: 20 },
  { code: "C", price: 20000, qty: 0, maxQty: 20 }
], 935000, { maxQty: 20, tolerance: 0, preTaxTarget: 1523000, currentHour: 588000, hourStep: 6000 });
assert.strictEqual(hourBalanced.actual + hourBalanced.hourActual, 1523000, "goods plus quantized singing fee must match pre-tax target");

const residualBalanced = solver.solveQuantities([
  { code: "A", price: 1555000, qty: 0, maxQty: 1 }
], 1548909, { maxQty: 20, tolerance: 0, preTaxTarget: 2160909, currentHour: 612000, hourStep: 6000 });
assert.strictEqual(residualBalanced.hourActual, 606000, "singing fee must stay on a valid time-derived step");
assert.strictEqual(residualBalanced.hourDiscount, 91, "small residual must be identified for direct singing-fee adjustment");
assert.strictEqual(residualBalanced.actual + residualBalanced.hourActual - residualBalanced.hourDiscount, 2160909, "direct singing-fee adjustment must make pre-tax total exact");
