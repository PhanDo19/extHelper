const assert = require("assert");
const path = require("path");
const solver = require(path.join(__dirname, "..", "solver.js"));

assert.strictEqual(solver.deriveGoodsTarget(935000, 1675300, 1675300, 10), 935000);
assert.strictEqual(solver.deriveGoodsTarget(935000, 1675300, 1785300, 10), 1035000);

const accountingTargets = solver.deriveInvoiceTargets(1675300, 588000, 10);
assert.deepStrictEqual(accountingTargets, {
  preTaxTarget: 1523000,
  vatTarget: 152300,
  grandReachable: true,
  calculatedGrand: 1675300,
  reachableAlternatives: [1675300, 1675299],
  currentHour: 588000,
  goodsTarget: 935000
});

// Tổng sao kê đã gồm VAT: chia ngược 1,1 rồi tính VAT trên tổng trước thuế.
assert.strictEqual(solver.statementVat(3000000, 10), 272727);
assert.deepStrictEqual(solver.deriveInvoiceTargets(3000000, 600000, 10), {
  preTaxTarget: 2727273,
  vatTarget: 272727,
  grandReachable: true,
  calculatedGrand: 3000000,
  reachableAlternatives: [3000000, 2999999],
  currentHour: 600000,
  goodsTarget: 2127273
});
assert.strictEqual(solver.deriveInvoiceTargets(2800000, 0, 10).grandReachable, false);
assert.deepStrictEqual(solver.deriveInvoiceTargets(2800000, 0, 10).reachableAlternatives, [2799999, 2800001]);

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

const rotated = solver.solveQuantities([
  { code: "A", name: "A", price: 50000, qty: 0, maxQty: 1, selectionPenalty: 18 },
  { code: "B", name: "B", price: 50000, qty: 0, maxQty: 1, selectionPenalty: 2 },
  { code: "C", name: "C", price: 50000, qty: 0, maxQty: 1, selectionPenalty: 9 }
], 50000, { maxQty: 1, tolerance: 0, preferredLineCount: 1, maxActiveLines: 1 });
assert.strictEqual(
  rotated.items.find(item => item.newQty > 0).code,
  "B",
  "controlled diversity must prefer the lower per-transaction selection penalty"
);

console.log("solver tests: OK");

const bounded = solver.solveQuantities([
  { code: "LIMITED", name: "Limited", price: 50000, qty: 0, maxQty: 2 },
  { code: "OTHER", name: "Other", price: 20000, qty: 0, maxQty: 10 }
], 250000, { maxQty: 99, tolerance: 0 });
const limited = bounded.items.find(item => item.code === "LIMITED");
assert.ok(limited.newQty <= 2, "quantity must not exceed per-item stock limit");

const fruit = solver.solveQuantities([
  { code: "TC", price: 350000, qty: 0, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 },
  { code: "TCTO", price: 400000, qty: 0, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 }
], 800000, { maxQty: 99, tolerance: 1000000 });
const fruitQty = fruit.items.reduce((sum, item) => sum + item.newQty, 0);
assert.ok(fruitQty <= 1, "TC and TCTO combined must be at most one per invoice");

const required = solver.solveQuantities([
  { code: "TCTO", price: 400000, qty: 0, minQty: 1, maxQty: 1, constraintGroup: "fruit_platter", constraintGroupMax: 1 },
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
assert.strictEqual(residualBalanced.hourDiscount, 0, "hour discount must always be 0");
assert.strictEqual(residualBalanced.preTaxDifference, 91, "time-derived fee is 91 dong above the exact pre-tax target");

const reconciledHour = solver.reconcileHourAmount(
  residualBalanced.actual,
  2160909,
  residualBalanced.hourActual
);
assert.deepStrictEqual(reconciledHour, {
  finalHourAmount: 605909,
  hourFromTime: 606000,
  hourAdjustment: -91
});
assert.strictEqual(
  residualBalanced.actual + reconciledHour.finalHourAmount,
  2160909,
  "fractional remainder must be absorbed directly into the hour amount"
);

assert.strictEqual(
  solver.recommendInvoiceLimit({ webCode: "1000064", webName: "Hạt Mắc Ca", webUnit: "Hộp" }),
  2,
  "macadamia must be limited to two boxes per invoice"
);
assert.strictEqual(
  solver.recommendInvoiceLimit({ webCode: "1500007", availabilityMode: "per_invoice", availableQty: 1 }),
  1,
  "fruit platter must stay limited to one per invoice"
);
assert.strictEqual(
  solver.recommendInvoiceLimit({ webCode: "1300013", webName: "Rượu vang", webUnit: "chai" }),
  1,
  "wine must be limited to one bottle per invoice by default"
);
assert.strictEqual(
  solver.recommendInvoiceLimit({ webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai" }),
  12,
  "beer may use a larger group-sized limit"
);

const realistic = solver.solveQuantities([
  { code: "1500007", name: "Hoa quả to", price: 400000, qty: 0, minQty: 1, maxQty: 1 },
  { code: "1300013", name: "Rượu vang", price: 650000, qty: 0, maxQty: 1 },
  { code: "1000064", name: "Mắc Ca", price: 180000, qty: 0, maxQty: 2 },
  { code: "1000004", name: "Bò khô", price: 90000, qty: 0, maxQty: 3 },
  { code: "1000010", name: "Hạt dẻ", price: 65000, qty: 0, maxQty: 3 },
  { code: "1100031", name: "Lavie", price: 25000, qty: 0, maxQty: 6 },
  { code: "1100032", name: "Trà tắc", price: 40000, qty: 0, maxQty: 6 }
], 1548909, {
  maxQty: 20,
  tolerance: 0,
  preTaxTarget: 2160909,
  currentHour: 612000,
  hourStep: 6000,
  preferredLineCount: 5,
  maxActiveLines: 6
});
const realisticMacadamia = realistic.items.find(item => item.code === "1000064");
const realisticActiveLines = realistic.items.filter(item => item.newQty > 0);
assert.ok(realisticMacadamia.newQty <= 2, "realistic plan must not use six macadamia boxes");
assert.ok(realisticActiveLines.length >= 4, "realistic plan should spread the amount across several products");
assert.ok(realisticActiveLines.length <= 6, "realistic plan must stay reviewable with at most six product lines");
assert.strictEqual(
  realistic.actual + solver.reconcileHourAmount(realistic.actual, 2160909, realistic.hourActual).finalHourAmount,
  2160909,
  "realistic plan must still reconcile exactly before VAT"
);

require(path.join(__dirname, "..", "inventory-data.js"));
const mappingEngine = require(path.join(__dirname, "..", "mapping-engine.js"));
const realCandidates = mappingEngine.buildInventory(global.InvoiceInventoryData)
  .map(stock => {
    const stockQty = Math.max(0, Math.floor(Number(stock.availableQty) || 0));
    const invoiceLimit = solver.recommendInvoiceLimit(stock);
    return {
      code: stock.webCode,
      name: stock.webName,
      price: Number(stock.webPrice),
      qty: 0,
      maxQty: Math.min(stockQty, invoiceLimit),
      minQty: String(stock.webCode) === "1500007" ? 1 : 0,
      constraintGroup: stock.constraintGroup,
      constraintGroupMax: stock.constraintGroupMax
    };
  })
  .sort((a, b) => Number(b.minQty || 0) - Number(a.minQty || 0));
const realInvoicePlan = solver.solveQuantities(realCandidates, 1548909, {
  maxQty: 20,
  tolerance: 0,
  preTaxTarget: 2160909,
  currentHour: 612000,
  hourStep: 6000,
  preferredLineCount: 5,
  maxActiveLines: 6
});
const realInvoiceItems = realInvoicePlan.items.filter(item => item.newQty > 0);
assert.ok(
  realInvoiceItems.find(item => item.code === "1000064").newQty <= 2,
  "the real 2,377,000 plan must cap macadamia at two boxes"
);
assert.ok(
  realInvoiceItems.length >= 3 && realInvoiceItems.length <= 6,
  "the real 2,377,000 plan must contain a reviewable number of product lines"
);
assert.strictEqual(
  realInvoicePlan.actual + solver.reconcileHourAmount(realInvoicePlan.actual, 2160909, realInvoicePlan.hourActual).finalHourAmount,
  2160909,
  "the real 2,377,000 plan must still match the pre-tax target"
);

const ratioConstrained = solver.solveQuantities([
  { code: "A", name: "A", price: 100000, qty: 0, maxQty: 20 }
], 200000, {
  maxQty: 20,
  tolerance: 0,
  preTaxTarget: 1500000,
  currentHour: 1300000,
  hourStep: 100000,
  minHourAmount: 100000,
  minGoodsAmount: 500000
});
assert.ok(
  ratioConstrained.actual >= 500000,
  "minimum goods amount must override an unrealistic old goods target"
);
assert.ok(
  ratioConstrained.hourActual <= ratioConstrained.actual * 2,
  "singing fee must not exceed twice the goods amount"
);

const impossibleHourRange = solver.solveQuantities([
  { code: "A", name: "A", price: 100000, qty: 0, maxQty: 7 }
], 200000, {
  maxQty: 20,
  tolerance: 0,
  preTaxTarget: 1000000,
  currentHour: 200000,
  hourStep: 100000,
  minHourAmount: 100000,
  maxHourAmount: 250000,
  minGoodsAmount: 750000,
  enforceHourRange: true
});
assert.strictEqual(
  impossibleHourRange.items,
  undefined,
  "solver must reject every combination above the hard singing-fee cap"
);

// --- Món hàng bắt buộc theo NHÓM ------------------------------------------
// "Ít nhất 3 bia" là ràng buộc trên TỔNG của mọi mã bia, không phải trên một mã
// cụ thể: 2 Tiger + 1 Hà Nội vẫn hợp lệ. Đây là điểm khác biệt so với minQty
// từng mã, vốn sẽ ép cùng một mã lên mọi hóa đơn và cạn tồn mã đó.
const beerAndTowel = [
  { code: "1100019", name: "Bia Tiger", price: 45000, qty: 0, maxQty: 12, constraintGroup: "beer", constraintGroupMin: 3 },
  { code: "1100023", name: "Bia Hà Nội", price: 30000, qty: 0, maxQty: 12, constraintGroup: "beer", constraintGroupMin: 3 },
  { code: "1000031", name: "Khăn ướt", price: 5000, qty: 0, maxQty: 4, constraintGroup: "wet_towel", constraintGroupMin: 2 },
  { code: "1000009", name: "Đậu phộng", price: 30000, qty: 0, maxQty: 4 }
];
const groupTotal = (result, group) => result.items
  .filter(item => item.constraintGroup === group)
  .reduce((sum, item) => sum + item.newQty, 0);

const withRequired = solver.solveQuantities(beerAndTowel, 500000, { maxQty: 20, tolerance: 20000 });
assert(withRequired.items, "phải tìm được phương án khi tồn đủ");
assert(groupTotal(withRequired, "beer") >= 3, "phải có ít nhất 3 bia trên tổng mọi mã bia");
assert(groupTotal(withRequired, "wet_towel") >= 2, "phải có ít nhất 2 khăn ướt");

// Tồn eo hẹp: mỗi mã bia chỉ còn 2, nên bắt buộc phải TRẢI qua hai mã mới đủ 3.
// Nếu ràng buộc bị hiểu nhầm thành "3 cái của một mã" thì không có lời giải.
const splitAcrossCodes = solver.solveQuantities([
  { code: "1100019", name: "Bia Tiger", price: 45000, qty: 0, maxQty: 2, constraintGroup: "beer", constraintGroupMin: 3 },
  { code: "1100023", name: "Bia Hà Nội", price: 30000, qty: 0, maxQty: 2, constraintGroup: "beer", constraintGroupMin: 3 },
  { code: "1000031", name: "Khăn ướt", price: 5000, qty: 0, maxQty: 4, constraintGroup: "wet_towel", constraintGroupMin: 2 }
], 300000, { maxQty: 20, tolerance: 50000 });
assert(splitAcrossCodes.items, "phải giải được khi số lượng bắt buộc trải qua nhiều mã");
assert(groupTotal(splitAcrossCodes, "beer") >= 3, "tổng bia vẫn phải đạt 3 dù mỗi mã chỉ còn 2");
assert(splitAcrossCodes.items.filter(item =>
  item.constraintGroup === "beer" && item.newQty > 0).length >= 2,
  "phải dùng ít nhất hai mã bia mới đủ số lượng");

// Ràng buộc nhóm KHÔNG được phép vượt trần từng mã: đó là đường dẫn tới tồn âm.
for (const item of splitAcrossCodes.items) {
  assert(item.newQty <= item.maxQty, `${item.code} vượt trần tồn: ${item.newQty} > ${item.maxQty}`);
}

// Món hàng bắt buộc phải thắng cả tiêu chí khớp tiền: thà lệch tiền còn hơn
// phát hành hóa đơn thiếu bia. Ở đây phương án khớp tiền tuyệt đối (1 đậu phộng)
// lại thiếu bia, nên solver phải bỏ nó.
const beatsExactMatch = solver.solveQuantities([
  { code: "1100023", name: "Bia Hà Nội", price: 30000, qty: 0, maxQty: 12, constraintGroup: "beer", constraintGroupMin: 3 },
  { code: "1000009", name: "Đậu phộng", price: 30000, qty: 0, maxQty: 4 }
], 30000, { maxQty: 20, tolerance: 200000 });
assert(groupTotal(beatsExactMatch, "beer") >= 3,
  "ràng buộc bắt buộc phải thắng cả phương án khớp tiền tuyệt đối");

// Không khai constraintGroupMin thì hành vi cũ giữ nguyên.
const noConstraint = solver.solveQuantities([
  { code: "A", name: "A", price: 50000, qty: 0, maxQty: 10 }
], 200000, { maxQty: 20, tolerance: 0 });
assert.strictEqual(noConstraint.items.reduce((sum, item) => sum + item.newQty, 0), 4,
  "không có ràng buộc nhóm thì kết quả không đổi");
