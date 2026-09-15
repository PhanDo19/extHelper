const assert = require("assert");
const path = require("path");

require(path.join(__dirname, "..", "xlsx-reader.js"));
const reader = globalThis.InvoiceXlsxReader;

const rows = [
  ["Số TT", "Ngày hóa đơn", "Hình thức TT", "", "Chia lại DT ", "", "Hóa đơn", "Kí hiệu"],
  ["", "", "CK", "TM", "CK", "TM", "", ""],
  [1, 1, 3000000, 0, 2727272.727272727, 0, "", ""],
  [2, 2, 0, 241950.5, 0, 219955, "", ""],
  [3, 2, 0, 440000.00000000006, 0, 400000, "", ""],
  [3, 3, 0, 0, 0, 0, "", ""]
];

const parsed = reader.parseInvoiceAmountRows(rows, { month: 7, year: 2026 });
assert.equal(parsed.length, 3);
assert.deepEqual(parsed.map(item => [item.dateKey, item.paymentMethod, item.grandTotal]), [
  ["2026-07-01", "CK", 3000000],
  ["2026-07-02", "TM", 241950.5],
  ["2026-07-02", "TM", 440000]
]);
assert.equal(parsed[0].amountNeedsReview, false);
assert.equal(parsed[1].amountNeedsReview, true);
assert.equal(parsed[2].amountNeedsReview, false);
assert.equal(parsed[1].grandTotalRounded, 241951);
assert.equal(parsed[1].netTotal, 219955);
assert.equal(parsed[0].sourceKey, "2026-07-01|3000000|CK|row:3");
assert.throws(() => reader.parseInvoiceAmountRows(rows, { month: 0, year: 2026 }), /tháng và năm/);
assert.throws(() => reader.parseInvoiceAmountRows(rows, { month: 7 }), /tháng và năm/);

console.log("invoice amount parser: OK");
