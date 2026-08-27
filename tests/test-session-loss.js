"use strict";

// Hai cơ sở dùng chung một domain (banhang.thuanvietsoft.com/<coso>/...) nên
// cookie phiên gắn theo DOMAIN chứ không theo đường dẫn: đăng nhập cơ sở này
// ghi đè phiên của cơ sở kia và đá tab đó ra màn hình login.
//
// Nguy hiểm nhất là server thường trả HTTP 200 kèm HTML trang login thay vì
// 401/403. Nếu không nhận ra, JSON.parse thất bại lặng lẽ và lô phát hành chạy
// tiếp như không có gì xảy ra.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert(start >= 0, `Không tìm thấy hàm ${name} trong bridge.js`);
  const end = source.indexOf("\n  }", start) + 4;
  return source.slice(start, end);
}

const box = {};
vm.createContext(box);
vm.runInContext(`${extractFunction("isLoginRedirect")}; this.isLoginRedirect = isLoginRedirect;`, box);
const { isLoginRedirect } = box;

const api = "http://banhang.thuanvietsoft.com/parislinhdam/HoaDonDienTu/phatHanhHoaDon";

// --- Phải nhận ra là mất phiên ---------------------------------------------

assert(isLoginRedirect({ status: 401, url: api }, ""), "401 là mất phiên");
assert(isLoginRedirect({ status: 403, url: api }, ""), "403 là mất phiên");

// Trường hợp thật hay gặp nhất: 200 + HTML trang login sau khi fetch đi theo
// chuyển hướng.
assert(isLoginRedirect(
  { status: 200, url: "http://banhang.thuanvietsoft.com/Account/Login?ReturnUrl=%2fparislinhdam" },
  "<html><body>...</body></html>"
), "Chuyển hướng sang /Account/Login là mất phiên");

assert(isLoginRedirect({ status: 200, url: api },
  '<html><head><title>Đăng nhập</title></head><body><form action="/Account/Login"></form></body></html>'
), "HTML trang login kèm 200 phải bị bắt");

assert(isLoginRedirect({ status: 200, url: api },
  '<form id="loginForm" method="post"><input name="UserName"></form>'
), "Form đăng nhập phải bị bắt qua tên trường");

// --- KHÔNG được nhầm với phản hồi bình thường ------------------------------

assert(!isLoginRedirect({ status: 200, url: api },
  '{"code":1,"Tag":{"SOHOADON":"122"}}'
), "JSON hợp lệ không phải trang login");

assert(!isLoginRedirect({ status: 200, url: api },
  '[{"invoiceNo":"HD001"}]'
), "Mảng JSON không phải trang login");

// Phản hồi rỗng là bất thường nhưng không đủ căn cứ kết luận mất phiên.
assert(!isLoginRedirect({ status: 200, url: api }, ""), "Phản hồi rỗng chưa đủ căn cứ");

// JSON có chữ "login" trong dữ liệu vẫn là JSON, không phải trang login.
assert(!isLoginRedirect({ status: 200, url: api },
  '{"code":1,"message":"Vui long dang nhap lai sau"}'
), "Chuỗi 'đăng nhập' trong JSON không biến nó thành trang login");

// --- Phải được gọi ở cả hai luồng đổi trạng thái ---------------------------

// Phát hành hóa đơn: mất phiên giữa lô mà không dừng thì các hóa đơn sau bị bỏ
// qua trong im lặng, còn sổ thì thiếu bản ghi.
const eInvoiceCall = source.slice(
  source.indexOf("async function postEInvoiceApi"),
  source.indexOf("function isLoginRedirect")
);
assert(eInvoiceCall.includes("isLoginRedirect(response, responseText)"),
  "Luồng phát hành hóa đơn phải kiểm tra mất phiên");
assert(/isLoginRedirect[\s\S]{0,400}throw new Error/.test(eInvoiceCall),
  "Phát hiện mất phiên phải dừng hẳn, không chạy tiếp");

// Lưu phiếu: mất phiên ở đây từng bị báo là "không phải JSON", che mất nguyên
// nhân thật và dẫn người dùng đi sai hướng khắc phục.
const doSaveCall = source.slice(
  source.indexOf("async function postDoSavePayload"),
  source.indexOf("async function postDoSavePayload") + 4000
);
assert(doSaveCall.includes("isLoginRedirect(response, responseText)"),
  "Luồng lưu phiếu phải kiểm tra mất phiên");
// Bỏ comment trước khi so vị trí: comment giải thích cũng nhắc tới "khong phai
// JSON" nên nếu đo cả comment sẽ bắt nhầm chính lời giải thích.
const doSaveCode = doSaveCall.replace(/\/\/[^\n]*/g, "");
assert(doSaveCode.indexOf("isLoginRedirect") < doSaveCode.indexOf("khong phai JSON"),
  "Phải kiểm mất phiên TRƯỚC khi kết luận 'không phải JSON'");

console.log("Session loss tests passed");
