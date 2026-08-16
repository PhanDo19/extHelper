const assert = require("assert");
const path = require("path");
require(path.join(__dirname, "..", "xlsx-reader.js"));
const reader = globalThis.InvoiceXlsxReader;

const rows = [
  [null, null, null],
  ["Ngày KH thực hiện/Requesting date", "Ngày giao dịch/Transaction date", "Số bút toán/Reference number", "Ngân hàng đối tác / Remitter's bank", "Tài khoản đích/Remitter's account number", "Tên tài khoản đối ứng/Remitter's account name", "Diễn giải/Description", "Nợ/Debit", "Có/Credit", "Phí/Lãi Fee/Interest", "Thuế/Transaction VAT", "Số dư/Running balance", "Check HĐ đã xuất"],
  ["2026-06-30 03:11:16", "2026-06-30", "REF-1", "MB", "123", "", "DO LAM HUNG chuyen tien", null, 2377000, null, null, 9999999, "#N/A"],
  ["2026-07-01 03:26:26", "2026-06-30", "REF-2", "", "", "", "Tra lai so du", null, 12152, null, null, 10012151, "#N/A"],
  ["2026-06-29", "2026-06-29", "REF-3", "", "", "", "Debit only", 1000, null, null, null, 10011151, ""]
];

const transactions = reader.parseBankRows(rows);
assert.equal(transactions.length, 2);
assert.equal(transactions[0].transactionDate, "2026-06-30");
assert.equal(transactions[0].credit, 2377000);
assert.equal(transactions[0].status, "pending");
assert.equal(transactions[1].status, "review");
assert.equal(transactions[0].id, "REF-1");
assert.equal(reader.dateKey(46203, false), "2026-06-30");

// Kim Giang: invoice reconciliation follows Transaction date, not the
// earlier customer Requesting date shown in the first bank column.
const kimGiangRows = [
  ["Requesting date", "Transaction date", "Reference number", "Description", "Debit", "Credit", "Running balance"],
  ["2026-05-31 22:29:49", "2026-06-01", "KG-1", "VU THANH THANH chuyen tien QR", null, 3000000, 69996748]
];
const kimGiang = reader.parseBankRows(kimGiangRows, { tenantSlug: "pariskimgiang" });
assert.equal(kimGiang.length, 1);
assert.equal(kimGiang[0].transactionDate, "2026-06-01");
assert.equal(kimGiang[0].requestedAt, "2026-05-31 22:29:49");
console.log("bank statement parser: OK");
