const assert = require("assert");
const path = require("path");
require(path.join(__dirname, "..", "xlsx-reader.js"));

const reader = globalThis.InvoiceXlsxReader;
const rows = [
  ["TỔNG HỢP TỒN KHO"],
  ["Tháng 7 năm 2026"],
  [null, "Tên kho", "Mã hàng", "Tên hàng", "ĐVT", "Đầu kỳ", null, "Nhập kho", null, "Xuất kho", null, "Cuối kỳ", null, "Giá bán "],
  [null, null, null, null, null, "Số lượng", "Giá trị", "Số lượng", "Giá trị", "Số lượng", "Giá trị", "Số lượng", "Giá trị", null],
  [null, "Hàng hóa", "HH_Banhquyque", "Bánh quy que với cốc Sô cô la", "Hộp", 208, 5125304, 0, 0, 23, 0, 185, 5125304, 60000]
];

const parsed = reader.parseStockRows(rows);
assert.equal(parsed.length, 1);
assert.deepEqual(parsed[0], {
  stockCode: "HH_Banhquyque",
  stockName: "Bánh quy que với cốc Sô cô la",
  stockUnit: "Hộp",
  stockQty: 185,
  conversion: 1,
  availableQty: 185,
  salePrice: 60000
});

// XLSX rows commonly contain sparse cells for merged headers; they must not
// make header detection throw when an empty column is represented as a hole.
const sparseRows = rows.map(row => {
  const copy = [];
  row.forEach((value, index) => { if (value !== null) copy[index] = value; });
  return copy;
});
assert.equal(reader.parseStockRows(sparseRows).length, 1);
console.log("stock workbook parser (Kho HG): OK");
