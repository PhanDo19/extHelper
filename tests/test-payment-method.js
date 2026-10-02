const assert = require("assert");
const path = require("path");
const fs = require("fs");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

// Mọi phiếu extension lưu đều ghi PHUONGTHUCTT = TM/CK, kể cả dòng CK/TM của
// danh sách số tiền (kế toán chốt 02/10/2026). Hóa đơn điện tử lấy phương thức
// từ phiếu; bước phát hành chỉ gửi ID nên không đổi được về sau.
assert.match(source, /const INVOICE_PAYMENT_METHOD = "TM\/CK";/);
assert.match(source, /const CREATION_PAYMENT_METHODS = new Set\(\["CK", "TM", INVOICE_PAYMENT_METHOD\]\);/);
assert.match(source, /function invoiceCreationPaymentMethod\(expected\)/);
assert.match(source, /const DEFAULT_INVOICE_ADDRESS = "Kh\\u00e1ch kh\\u00f4ng cung c\\u1ea5p th\\u00f4ng tin";/,
  "Phải khai báo địa chỉ mặc định cho hóa đơn");
assert.strictEqual(
  [...source.matchAll(/DIACHIKHACH: String\(expected\?\.buyerAddress \|\| DEFAULT_INVOICE_ADDRESS\)/g)].length,
  2,
  "Phải gắn địa chỉ ở cả luồng cập nhật và luồng tạo phiếu mới"
);

// Hằng số phải được khai báo TRƯỚC mọi chỗ dùng (const không được hoisted).
const declaration = source.indexOf("const INVOICE_PAYMENT_METHOD");
const uses = [...source.matchAll(/PHUONGTHUCTT: paymentMethod/g)].map(match => match.index);
assert.strictEqual(uses.length, 2, "Phải đặt PHUONGTHUCTT ở luồng sửa và luồng tạo phiếu mới");
for (const use of uses) {
  assert(use > declaration, "INVOICE_PAYMENT_METHOD phải khai báo trước khi dùng");
}

// Không còn chỗ nào hardcode "TM" cho phương thức thanh toán.
assert(!/PHUONGTHUCTT: "TM"/.test(source), 'Vẫn còn PHUONGTHUCTT: "TM" bị hardcode');

// Luồng sửa phiếu có sẵn: overrides phải chứa PHUONGTHUCTT để ghi đè giá trị cũ
// của form thay vì để nguyên "TM".
const buildPayload = source.slice(
  source.indexOf("function buildCurrentSavePayload"),
  source.indexOf("function verifySaveResponse"));
assert.match(buildPayload, /PHUONGTHUCTT: paymentMethod/,
  "Luồng sửa phiếu phải ghi đè PHUONGTHUCTT theo phương thức nguồn");
assert.match(buildPayload, /const paymentMethod = invoiceCreationPaymentMethod\(expected\)/,
  "Luồng sửa phiếu phải chuẩn hóa phương thức thanh toán");
assert.match(buildPayload, /expectsPaymentMethod: true/,
  "Payload do extension dựng phải bật kiểm tra phương thức thanh toán");
assert.match(buildPayload, /TIENGIOPHONGCUOI: hour/,
  "Luồng sửa phiếu phải đồng bộ TIENGIO và TIENGIOPHONGCUOI");
assert.match(buildPayload, /overrides\.BATDAU = checkIn\.toISOString\(\)/,
  "BATDAU phải dùng cùng định dạng ISO UTC với request thật của website");

// Bộ kiểm tra chặn payload sai phương thức, nhưng CHỈ với payload do extension
// dựng. Payload bắt được từ nút Lưu của website là do website tạo (PHUONGTHUCTT
// "TM"), không được chặn nhầm.
const validator = source.slice(
  source.indexOf("function validateSavePayload"),
  source.indexOf("function buildCurrentSavePayload"));
assert.match(validator, /expected\?\.expectsPaymentMethod &&/,
  "Kiểm tra phương thức phải có điều kiện, không áp cho payload của website");

// Chạy thử chính đoạn kiểm tra đó.
const check = new Function("fields", "expected", "INVOICE_PAYMENT_METHOD", `
  const method = String(expected?.paymentMethod || INVOICE_PAYMENT_METHOD);
  if (expected?.expectsPaymentMethod &&
      String(fields.PHUONGTHUCTT || "") !== method) {
    throw new Error("sai phuong thuc");
  }
  return "ok";
`);
assert.strictEqual(check({ PHUONGTHUCTT: "TM/CK" }, { expectsPaymentMethod: true }, "TM/CK"), "ok");
assert.throws(() => check({ PHUONGTHUCTT: "TM" }, { expectsPaymentMethod: true }, "TM/CK"), /sai phuong thuc/);
assert.throws(() => check({}, { expectsPaymentMethod: true }, "TM/CK"), /sai phuong thuc/);
// Payload của website không bị chặn.
assert.strictEqual(check({ PHUONGTHUCTT: "TM" }, {}, "TM/CK"), "ok");

// Dòng CK hay TM của danh sách số tiền, hay giao dịch sao kê không mang phương
// thức, đều lưu thành TM/CK ở MỌI cơ sở (kế toán chốt 02/10/2026; trước đó dòng
// CK/TM giữ nguyên CK hoặc TM nên hóa đơn điện tử ra "CK"/"TM").
const methodStart = source.indexOf("function invoiceCreationPaymentMethod(expected)");
let methodEnd = -1;
for (let index = source.indexOf("{", methodStart), depth = 0; index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  if (source[index] === "}") depth -= 1;
  if (depth === 0) { methodEnd = index + 1; break; }
}
const invoiceCreationPaymentMethod = new Function(
  "INVOICE_PAYMENT_METHOD", "CREATION_PAYMENT_METHODS", "location",
  `${source.slice(methodStart, methodEnd)}; return invoiceCreationPaymentMethod;`
)("TM/CK", new Set(["CK", "TM", "TM/CK"]), { pathname: "/pariskimgiang/BanHang" });
for (const tenantSlug of ["pariskimgiang", "parislinhdam", "parisnhon"]) {
  assert.strictEqual(invoiceCreationPaymentMethod({ paymentMethod: "CK", tenantSlug }), "TM/CK",
    `${tenantSlug}: dòng CK vẫn lưu TM/CK`);
  assert.strictEqual(invoiceCreationPaymentMethod({ paymentMethod: "tm", tenantSlug }), "TM/CK",
    `${tenantSlug}: dòng TM vẫn lưu TM/CK`);
  assert.strictEqual(invoiceCreationPaymentMethod({ tenantSlug }), "TM/CK",
    `${tenantSlug}: giao dịch sao kê không có phương thức vẫn ra TM/CK`);
}
assert.throws(() => invoiceCreationPaymentMethod({ paymentMethod: "THE" }), /khong hop le/,
  "Phương thức lạ vẫn bị chặn");

// Người mua của khách không lấy hóa đơn: "Bán cho người tiêu dùng" (kế toán chốt
// 02/10/2026), thay cho mặc định "Khách lẻ - Không lấy hóa đơn" của website, ở
// cả luồng cập nhật và luồng tạo phiếu mới.
const buyerDeclaration = source.match(/const DEFAULT_INVOICE_BUYER = "([^"]+)";/);
assert(buyerDeclaration, "Phải khai báo người mua mặc định");
assert.strictEqual(JSON.parse(`"${buyerDeclaration[1]}"`), "Bán cho người tiêu dùng");
assert.strictEqual(
  [...source.matchAll(/NGUOIMUAHANG: String\(expected\?\.buyerName \|\| DEFAULT_INVOICE_BUYER\)/g)].length,
  2,
  "Phải gắn người mua ở cả luồng cập nhật và luồng tạo phiếu mới"
);

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
assert.strictEqual(contentSource.match(/const DEFAULT_INVOICE_BUYER = "([^"]+)";/)?.[1], buyerDeclaration[1],
  "Người mua dự phòng trong content.js phải trùng bridge.js");
assert(!/Danh sách số tiền hiện chỉ dùng cho Paris Nhơn/.test(contentSource),
  "Nhập danh sách số tiền CK/TM không còn giới hạn ở Nhơn");
assert(!/pageTenantSlug === "parisnhon"[^\n]*it-import-invoice-amount/.test(contentSource) &&
  !/amountImportControls = pageTenantSlug === "parisnhon"/.test(contentSource),
  "Nút nhập danh sách số tiền phải hiện ở mọi cơ sở");

console.log("Phương thức thanh toán TM/CK: OK");
