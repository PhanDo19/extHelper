// Mặt hàng của phương án/hóa đơn mở ở DÒNG RIÊNG rộng hết bảng, không lồng bảng
// con trong ô (phản hồi 03/10/2026: mở "N mã" phải kéo thanh cuộn ngang mới thấy
// số lượng/giá vì bảng con rộng tối thiểu 480px nằm trong cột 92px).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8");
function fn(name) {
  const start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}

const box = {
  formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
  escapeHtml: value => String(value == null ? "" : value).replace(/[&<>"']/g, char =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char])
};
vm.createContext(box);
vm.runInContext([
  "const openDetailRows = new Set();",
  ...["detailRowId", "detailToggleHtml", "itemsDetailRowHtml", "shortSessionText"].map(fn),
  "this.api = { openDetailRows, detailRowId, detailToggleHtml, itemsDetailRowHtml, shortSessionText };"
].join("\n"), box);
const { api } = box;

const id = api.detailRowId("it-batch-detail", "t 1/2");
assert.strictEqual(id, "it-batch-detail-t_1_2", "Mã dòng chỉ gồm ký tự an toàn cho id/selector");

const items = [
  { code: "1100027", name: "Bia Tiger <lon>", qty: 5, price: 20000, stockQty: 120, maxQty: 12 },
  { code: "1000031", name: "Khăn ướt", qty: 2, price: 5000, stockQty: 300, maxQty: 6 },
  { code: "1300013", name: "Rượu vang", qty: 0, price: 450000, stockQty: 3, maxQty: 1 }
];
const row = api.itemsDetailRowHtml(id, items, 6, { leadingCells: 1, showStock: true });
assert(row.startsWith(`<tr class="it-detail-row" id="${id}" hidden>`), "Dòng chi tiết ẩn mặc định");
assert(row.includes('<td></td><td colspan="5">'), "Ô đầu trống (cột chọn), bảng con trải hết các cột còn lại");
assert(row.includes("Bia Tiger &lt;lon&gt;"), "Tên hàng phải được escape");
assert(/Tổng tiền hàng<\/td><td class="it-num"><b>110\.000<\/b>/.test(row), "Dòng tổng = Σ SL × đơn giá");
assert(row.includes('class="it-detail-unused"'), "Mã không dùng (SL 0) được làm mờ");
assert(row.includes("<th class=\"it-num\">Tồn trước</th>"), "Batch hiện cả tồn trước và giới hạn/HĐ");

// Mở rồi vẽ lại bảng: vẫn mở, nút ghi đúng trạng thái.
api.openDetailRows.add(id);
assert(!api.itemsDetailRowHtml(id, items, 6, { leadingCells: 1 }).includes(" hidden>"), "Dòng đang mở vẫn mở sau khi vẽ lại");
assert(api.detailToggleHtml(id, "2 mã").includes('aria-expanded="true"'));

// Mặt hàng không có giá (sổ phát hành cũ): chỉ Mã/Tên/SL, không có dòng tổng.
const noPrice = api.itemsDetailRowHtml("x", [{ code: "A", name: "B", qty: 3 }], 7, { leadingCells: 1, note: "Theo sổ" });
assert(!noPrice.includes("Đơn giá") && !noPrice.includes("tfoot") && noPrice.includes('colspan="6"') && noPrice.includes("Theo sổ"));

assert.strictEqual(api.shortSessionText("27/07/2026 20:00", "27/07/2026 20:58"), "27/07 20:00 → 20:58");
assert.strictEqual(api.shortSessionText("29/06/2026 23:30", "30/06/2026 01:00"), "29/06 23:30 → 30/06 01:00");

// Bất biến nguồn: không còn bảng con trong ô, bảng Batch 6 cột, gắn nút mở dòng.
const batch = fn("renderBatchPlans");
const einvoice = fn("renderEInvoiceRows");
for (const [name, body] of [["Batch Review", batch], ["Phát hành", einvoice]]) {
  assert(!/<details><summary>\$\{[^}]*\} mã/.test(body) && !body.includes("<details><summary>"), `${name}: không lồng bảng mặt hàng trong <details> của ô`);
  assert(body.includes("itemsDetailRowHtml(detailId") && body.includes("bindDetailToggles(table)"), `${name}: dùng dòng chi tiết riêng`);
}
assert(batch.includes("<th>Giao dịch</th><th>Phiếu</th><th>Phương án</th><th>Trạng thái</th><th>Thao tác</th>"));
assert(batch.includes('<td colspan="6">Không có giao dịch nào'), "Dòng rỗng phải trải đúng 6 cột");
assert(!/\.it-batch-table \{[^}]*min-width: 1100px/.test(css), "Bảng Batch không còn ép rộng 1.100px");
assert(!css.includes("#it-einvoice-admin .it-batch-table { min-width: 900px; }"), "Bảng Phát hành không còn ép rộng 900px");

console.log("dòng chi tiết mặt hàng không cần cuộn ngang: OK");
