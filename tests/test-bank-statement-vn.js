// Sao ke ban tieng Viet (saoKeLD.xlsx): tieu de hoan toan tieng Viet, khong co
// chu "Transaction date"/"Credit" nen parser cu bao "khong tim thay tieu de".
const assert = require("assert");
const path = require("path");
require(path.join(__dirname, "..", "xlsx-reader.js"));
const reader = globalThis.InvoiceXlsxReader;

const rows = [
  ["Chủ tài khoản: CTY CO PHAN DICH VU GIAI TRI MEDIA STAR"],
  ["Địa chỉ: . Thon Thuong Xa Thanh Liet Huyen Thanh Tri Thanh pho Ha Noi"],
  [null, null, null, null, null, "511386722"],
  ["BẢNG SAO KÊ GIAO DỊCH - Số tài khoản (VND): 9566228888"],
  ["Từ ngày: 01/06/2026    Đến ngày: 04/07/2026"],
  [null, null, null, "Số dư đầu", "(-) Tổng tiền rút ra", "(+) Tổng tiền gửi vào", "Số dư cuối"],
  [null, null, null, "821,785,387.00", "1,397,644,945.00", "921,639,441.00", "345,779,883.00"],
  ["Ngày hiệu lực", "Ngày giao dịch", "Số GD", "Nội dung giao dịch", "Số tiền rút ra", "Số tiền gửi vào", "Số dư", "Check đã xuất HĐ"],
  ["01/06/2026", "30/05/2026 14:58:04", "4613", "PHAM THI HAI YEN CHUYEN TIEN GD 6150IBT1CJ9CPA81 300526-14:58:04", "", 1639000, 823424387, "#N/A"],
  ["01/06/2026", "30/05/2026 17:13:20", "4615", "NOP TIEN GD 6150MSCBD2TMIGTV 300526-17:13:19", "", 124555000, 950379387, "#N/A"],
  ["03/06/2026", "03/06/2026 10:00:00", "4638", "NGUYEN VAN A CHUYEN TIEN GD XYZ", "", 6168800, 960000000, 6168800],
  ["04/06/2026", "04/06/2026 09:00:00", "4700", "CTY MEDIA THANH TOAN TIEN GACH LAT", 5000000, "", 955000000, "#N/A"]
];

const transactions = reader.parseBankRows(rows);

// Chi giu dong co tien gui vao; dong chi tien (cot F trong) bi loai.
assert.equal(transactions.length, 3, "Phai doc duoc 3 giao dich tien vao");

// Ngay lap phieu lay theo "Ngay hieu luc" de moi dong nam gon trong ky sao ke:
// giao dich phat sinh 30/05 nhung thuoc sao ke thang 06.
assert.equal(transactions[0].transactionDate, "2026-06-01", "Phai lay ngay hieu luc, khong lay ngay giao dich");
assert.equal(transactions[0].requestedAt, "2026-05-30 14:58:04", "Gio giao dich thuc phai duoc giu lai");

// "So GD" dung lam id on dinh.
assert.equal(transactions[0].id, "4613");
assert.equal(transactions[0].reference, "4613");

assert.equal(transactions[0].credit, 1639000);
assert.equal(transactions[0].description.startsWith("PHAM THI HAI YEN"), true);
assert.equal(transactions[0].status, "pending", "Chuyen tien -> pending");
assert.equal(transactions[1].status, "review", "Nop tien -> review");

// #N/A la loi cong thuc VLOOKUP, khong phai ghi chu that.
assert.equal(transactions[0].invoiceCheck, "", "#N/A phai bi loai bo");
assert.equal(transactions[1].invoiceCheck, "");

// Dong da co so tien o cot check -> da xuat hoa don, khong lap phieu lai.
assert.equal(transactions[2].id, "4638");
assert.equal(transactions[2].invoiceCheck, "6168800");
assert.equal(transactions[2].status, "ignored", "Dong da xuat HD phai bi bo qua");

// Cot "So tien rut ra" phai duoc nhan dien la debit.
const debitRow = reader.parseBankRows(rows.concat([
  ["05/06/2026", "05/06/2026 08:00:00", "4701", "Test debit va credit cung dong", 200000, 900000, 111, "#N/A"]
]));
const mixed = debitRow.find(item => item.id === "4701");
assert.equal(mixed.debit, 200000, "Phai doc duoc cot so tien rut ra");
assert.equal(mixed.credit, 900000);

console.log("bank statement parser (ban tieng Viet): OK");
