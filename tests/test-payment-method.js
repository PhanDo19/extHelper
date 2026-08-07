const assert = require("assert");
const path = require("path");
const fs = require("fs");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

// Phiếu do extension lập đều bắt nguồn từ giao dịch chuyển khoản trong sao kê,
// nên PHUONGTHUCTT phải là "TM/CK" chứ không phải "TM" mặc định của website.
assert.match(source, /const INVOICE_PAYMENT_METHOD = "TM\/CK";/);

// Hằng số phải được khai báo TRƯỚC mọi chỗ dùng (const không được hoisted).
const declaration = source.indexOf("const INVOICE_PAYMENT_METHOD");
const uses = [...source.matchAll(/PHUONGTHUCTT: INVOICE_PAYMENT_METHOD/g)].map(match => match.index);
assert.strictEqual(uses.length, 2, "Phải đặt PHUONGTHUCTT ở cả 2 luồng lưu");
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
assert.match(buildPayload, /PHUONGTHUCTT: INVOICE_PAYMENT_METHOD/,
  "Luồng sửa phiếu phải ghi đè PHUONGTHUCTT");
assert.match(buildPayload, /expectsPaymentMethod: true/,
  "Payload do extension dựng phải bật kiểm tra phương thức thanh toán");

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
  if (expected?.expectsPaymentMethod &&
      String(fields.PHUONGTHUCTT || "") !== INVOICE_PAYMENT_METHOD) {
    throw new Error("sai phuong thuc");
  }
  return "ok";
`);
assert.strictEqual(check({ PHUONGTHUCTT: "TM/CK" }, { expectsPaymentMethod: true }, "TM/CK"), "ok");
assert.throws(() => check({ PHUONGTHUCTT: "TM" }, { expectsPaymentMethod: true }, "TM/CK"), /sai phuong thuc/);
assert.throws(() => check({}, { expectsPaymentMethod: true }, "TM/CK"), /sai phuong thuc/);
// Payload của website không bị chặn.
assert.strictEqual(check({ PHUONGTHUCTT: "TM" }, {}, "TM/CK"), "ok");

console.log("Phương thức thanh toán TM/CK: OK");
