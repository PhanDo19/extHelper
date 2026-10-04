// Bố cục màn Kho (phản hồi 04/10/2026 kèm ảnh Paris Nhơn): tiêu đề "Kho vật lý
// dùng chung" ở cơ sở có kho riêng, dòng "Paris Nhon dung kho rieng" không dấu
// lặp lại, hai nút "Cập nhật kho chung" làm cùng một việc, nhóm nút lệch trong
// lưới 3 cột chứa 4 khối, khối Hoàn kho chiếm nửa màn hình.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
const css = fs.readFileSync(path.join(__dirname, "..", "content.css"), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf('<section id="it-stock-admin" hidden>');
const section = source.slice(start, source.indexOf('<section id="it-state-preview"', start));
assert(start > 0 && section.length > 0, "Không tìm thấy màn Kho");

assert(!section.includes("dung kho rieng"), "Không còn dòng không dấu lặp lại");
assert.strictEqual((section.match(/id="it-import-stock"/g) || []).length, 1, "Chỉ một nút cập nhật kho");
assert(!source.includes("it-open-stock-import"), "Nút trùng đã bỏ, kể cả chỗ gắn sự kiện");
assert(/<div class="it-stock-note-actions">\s*<button id="it-import-stock" type="button" class="primary">/.test(section),
  "Nút cập nhật kho là nút chính ở khối đầu");
for (const id of ["it-export-state", "it-import-state", "it-export-issued"]) {
  const at = section.indexOf(`id="${id}"`);
  assert(at > section.indexOf('class="it-stock-file-actions"') && at < section.indexOf("</div>", section.indexOf('class="it-stock-file-actions"') + 200) + 400,
    `${id} nằm trong nhóm thao tác file kho`);
}
const restock = section.slice(section.indexOf('<details class="it-tool-section it-restock-section">'), section.indexOf("</details>"));
assert(restock.length > 0, "Hoàn kho thu gọn trong <details>");
for (const id of ["it-restock-from", "it-restock-to", "it-restock-range"]) {
  assert(restock.includes(`id="${id}"`), `${id} vẫn còn trong mục Hoàn kho (restockVerifiedRange đọc theo id)`);
}
assert(section.indexOf('id="it-stock-kpis"') < section.indexOf('class="it-stock-toolbar"') &&
  section.indexOf('class="it-stock-toolbar"') < section.indexOf('<table class="it-stock-table">'),
  "Thứ tự: KPI → tìm/lọc → bảng");
const toolbar = section.slice(section.indexOf('class="it-stock-toolbar"'), section.indexOf("</div>", section.indexOf('class="it-stock-toolbar"')));
assert(toolbar.includes('id="it-stock-search"') && toolbar.includes('id="it-stock-filter"') && !toolbar.includes("<button"),
  "Thanh tìm/lọc chỉ gồm ô tìm và ô lọc");

assert(css.includes(".it-stock-toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 210px;"), "Thanh tìm/lọc hai cột");
assert(css.includes(".it-stock-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));"), "5 ô KPI tự xếp một hàng");
assert(css.includes(".it-shared-stock-note .it-eyebrow { color: #4c78af; }"), "Chữ nhỏ ở khối đầu đọc được trên nền sáng");
assert(!css.includes(".it-restock-box") && !css.includes(".it-stock-actions"), "Bỏ rule của bố cục cũ");

assert(source.includes('screen?.mode === "stock-mode" && pageTenantSlug === "parisnhon"') &&
  source.includes('"Bước 1 · Kho vật lý riêng"'), "Tiêu đề màn Kho ở Nhơn là kho riêng");

console.log("bố cục màn Kho: OK");
