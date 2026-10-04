"use strict";

// Phiếu bán hàng KHÔNG GẮN PHÒNG HÁT (không DBANID, không đơn giá giờ, form không
// có ô giờ vào/ra, Tiền giờ 0) không dùng được để khớp sao kê: phương án luôn có
// Tiền giờ. Ca thật Paris Nhơn 21/08/2026: Batch Review chọn 01000000142 (toàn
// tiền hàng 2.410.000đ) cho giao dịch 401.500đ, rồi Lưu API dừng ngay phiếu đầu
// (0/218) với "Phuong an thieu ngay hoa don hoac Gio vao/Ra hop le".

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8").replace(/\r\n/g, "\n");
function fn(source, name) {
  let start = source.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}

const box = {};
vm.createContext(box);
vm.runInContext(
  ["normalizeRoomText", "roomAreaKey", "isRetailRoomName", "isNoRoomInvoiceScan", "isRetailInvoiceScan", "unusableInvoiceLabel"]
    .map(name => fn(contentSource, name)).join("\n") +
  "\nthis.noRoom = isNoRoomInvoiceScan; this.unusable = isRetailInvoiceScan; this.label = unusableInvoiceLabel;",
  box
);

// scan() thật của bridge đọc trên website (04/10/2026).
const scan142 = { ready: true, invoiceNo: "01000000142", roomName: "", roomId: "", roomMissing: true, roomRate: 0,
  roomIsRetail: false, checkIn: "", checkOut: "", durationMinutes: 0, currentHour: 0, currentGoods: 2410000 };
const scan141 = { ready: true, invoiceNo: "01000000141", roomName: "VIP 22", roomId: "room-22", roomMissing: false, roomRate: 600000,
  roomIsRetail: false, checkIn: "21/08/2026 20:21", checkOut: "21/08/2026 20:51", durationMinutes: 30, currentHour: 303000, currentGoods: 100000 };

assert.strictEqual(box.noRoom(scan142), true, "Phiếu không gắn phòng phải bị nhận ra");
assert.strictEqual(box.unusable(scan142), true, "và bị bỏ qua như phiếu quầy BÁN LẺ");
assert.match(box.label(scan142), /không gắn phòng hát/);
assert.strictEqual(box.unusable(scan141), false, "Phiếu phòng hát bình thường vẫn dùng được");

// Không đọc được form (roomMissing không có/false) thì không kết luận là không phòng.
assert.strictEqual(box.unusable({ ...scan142, roomMissing: undefined }), false);
assert.strictEqual(box.unusable({ ...scan142, roomMissing: false }), false);
// Form phòng hát bản cũ không có ô giờ nhưng có Tiền giờ: không loại nhầm.
assert.strictEqual(box.unusable({ ...scan142, currentHour: 612000 }), false);
assert.strictEqual(box.unusable({ ...scan142, checkIn: "21/08/2026 20:00", checkOut: "21/08/2026 20:30" }), false);
// Quầy BÁN LẺ vẫn bị loại như cũ, kèm tên quầy trong lý do.
const retail = { ...scan141, roomName: "BAN LE", roomIsRetail: true };
assert.strictEqual(box.unusable(retail), true);
assert.match(box.label(retail), /quầy BÁN LẺ \(BAN LE\)/);
// Phương án phiếu mới (newInvoicePlanning) không bao giờ bị loại vì thiếu phòng.
assert.strictEqual(box.unusable({ ...scan142, newInvoicePlanning: true }), false);

// Bridge: chỉ báo roomMissing khi đọc được form; lưu phiếu có sẵn không phòng bị chặn
// với lý do rõ ràng và hướng dẫn Tính toán lại.
assert.match(fn(bridgeSource, "getOpenFormRoom"), /formRead: true/);
assert.match(fn(bridgeSource, "getOpenFormRoom"), /formRead: false/);
assert.match(bridgeSource, /roomMissing: Boolean\(openRoom\.formRead && !roomId && !roomName\)/);
const saveExisting = fn(bridgeSource, "saveExistingInvoicePlanViaApi");
assert.match(saveExisting, /if \(!isGuid\(String\(baseFields\.DBANID \|\| ""\)\.trim\(\)\)\) \{/);
assert.match(saveExisting, /không gắn phòng hát[\s\S]*Tính toán lại/);
assert(saveExisting.indexOf("không gắn phòng hát") < saveExisting.indexOf("postCurrentInvoiceViaApi"),
  "Phải chặn trước khi gửi request lưu");

// Batch Review dùng chung một hàm để bỏ qua khi dò phiếu và khi lập phương án.
const plan = fn(contentSource, "calculateBatchPlan");
assert.match(plan, /if \(isRetailInvoiceScan\(scan\)\)[\s\S]*unusableInvoiceLabel\(scan\)/);

console.log("Phiếu không gắn phòng hát bị bỏ qua như quầy BÁN LẺ: OK");
