"use strict";

// Ghi chú trong file hạch toán (sheet TheoPhieu, dòng phiếu tô vàng) cho hóa đơn
// có tổng khác số tiền sao kê — yêu cầu 06/10/2026, ví dụ:
//   ⚠ Hóa đơn lập ở 1.699.999đ, lệch -1đ so với sao kê 1.700.000đ do website làm tròn VAT.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
function fn(name) {
  const start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}
const constant = name => {
  const start = source.indexOf(`  const ${name} =`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
};

const transactions = [
  // Lập ở 1.699.999đ (Linh Đàm T7: mọi ca thật đều -1đ).
  { invoiceNo: "HD0126070001", transactionDate: "2026-07-01", credit: 1700000, acceptedGrandOverride: 1699999 },
  { invoiceNo: "HD0126070002", transactionDate: "2026-07-01", credit: 2233000 },
  { invoiceNo: "HD0126070003", transactionDate: "2026-07-02", credit: 500000 },
  // Một phiếu gắn hai giao dịch: so với giao dịch cùng ngày, sát tổng nhất.
  { invoiceNo: "HD0126070004", transactionDate: "2026-07-03", credit: 900000 },
  { invoiceNo: "HD0126070004", transactionDate: "2026-07-03", credit: 400001 }
];
const box = {
  formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
  parseUiDateTime: () => null,
  transactions
};
vm.createContext(box);
vm.runInContext([
  constant("GRAND_OVERRIDE_MAX_DIFF"),
  "function statementTransactionsForInvoiceNo(no) { return transactions.filter(item => item.invoiceNo === no); }",
  fn("uiDateKey"), fn("issuedInvoiceNotes"),
  "this.notes = entries => JSON.stringify([...issuedInvoiceNotes(entries)]);"
].join("\n"), box);
const notes = entries => new Map(JSON.parse(box.notes(entries)));

const result = notes([
  { invoiceNo: "HD0126070001", dateKey: "2026-07-01", grandTotal: 1699999 },
  { invoiceNo: "HD0126070002", dateKey: "2026-07-01", grandTotal: 2233000 },
  { invoiceNo: "HD0126070003", dateKey: "2026-07-02", grandTotal: 500001 },
  { invoiceNo: "HD0126070004", dateKey: "2026-07-03", grandTotal: 400000 },
  { invoiceNo: "HD-WEB", dateKey: "2026-07-03", grandTotal: 123000 },
  { invoiceNo: "HD0126070002", dateKey: "2026-07-01", grandTotal: 0 }
]);
assert.strictEqual(result.get("HD0126070001"),
  "⚠ Hóa đơn lập ở 1.699.999đ, lệch -1đ so với sao kê 1.700.000đ do website làm tròn VAT.",
  "Đúng câu ghi chú kế toán yêu cầu");
assert.strictEqual(result.has("HD0126070002"), false, "Khớp sao kê thì không ghi chú");
assert.strictEqual(result.get("HD0126070003"),
  "⚠ Hóa đơn lập ở 500.001đ, lệch +1đ so với sao kê 500.000đ do website làm tròn VAT.");
assert.strictEqual(result.get("HD0126070004"),
  "⚠ Hóa đơn lập ở 400.000đ, lệch -1đ so với sao kê 400.001đ do website làm tròn VAT.",
  "So với giao dịch sát tổng nhất");
assert.strictEqual(result.has("HD-WEB"), false, "Phiếu không gắn giao dịch sao kê thì không so");

// Lệch quá mức làm tròn VAT (chỉ có ở hóa đơn đồng bộ từ web): nhắc kiểm tra, không đổ cho VAT.
const far = notes([{ invoiceNo: "HD0126070002", dateKey: "2026-07-01", grandTotal: 1699999 }]);
assert.strictEqual(far.get("HD0126070002"),
  "⚠ Hóa đơn lập ở 1.699.999đ, lệch -533.001đ so với sao kê 2.233.000đ — kiểm tra lại với sao kê.");

// Đấu nối: ghi chú đi vào file xuất.
assert.match(source, /noteByInvoiceNo: issuedInvoiceNotes\(scoped\)/);

console.log("Ghi chú hóa đơn lệch sao kê trong file hạch toán: OK");
