"use strict";

// Giờ vào phiếu mới được chốt lúc Batch Review theo lưới 45 phút, chưa biết phòng
// nào còn trống. Ca thật Paris Nhơn 06/08/2026: chỉ 3 phòng 400.000đ (VIP 26/36/46),
// phiếu 1.540.000đ cần 51 phút 19:15→20:06 nhưng cả 3 phòng đều chồng giờ, Lưu API
// dừng lô với "Không còn phòng hát trống phù hợp" dù VIP 36 trống 19:03→19:59.
// Giờ vào/ra không đổi số tiền nên dời sang khung trống gần nhất, giữ thời lượng.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");

function extract(name) {
  const match = new RegExp(`\\n  (async )?function ${name}\\(`).exec(source);
  assert(match, `Không tìm thấy ${name}`);
  const start = match.index + 1;
  return source.slice(start, source.indexOf("\n  }\n", start) + 4);
}

function extractConst(name) {
  const start = source.indexOf(`  const ${name} =`);
  assert(start >= 0, `Không tìm thấy hằng ${name}`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
}

const box = {};
vm.createContext(box);
vm.runInContext([
  "const pageTenantSlug = 'parisnhon';",
  "let websiteRoomRates = null;",
  extractConst("DEFAULT_HOURLY_RATE"),
  extractConst("PARIS_NHON_ROOM_HOURLY_RATES"),
  extractConst("NEW_INVOICE_CHECKIN_START_MINUTES"),
  ...["normalizeRoomText", "roomAreaKey", "isRetailRoomName", "parseUiDateTime", "formatUiDateTime",
    "roomIsFreeForRange", "isIdleMapRoom", "websiteRoomRate", "isPageTenant", "roomHourlyRate",
    "rankIdleRoomsFromMap", "shiftedNewInvoiceWindow"].map(extract),
  "this.shift = shiftedNewInvoiceWindow; this.rank = rankIdleRoomsFromMap;"
].join("\n"), box);

// Sơ đồ phòng thật của Nhơn (đọc qua LayDanhSachBan ngày 04/10/2026).
const roomNames = ["BAN LE", "VIP 21", "VIP 22", "VIP 23", "VIP 26", "VIP 28", "VIP 31", "VIP 32", "VIP 33", "VIP 36",
  "VIP 38", "VIP 41", "VIP 42", "VIP 43", "VIP 46", "VIP 48", "VIP 51", "VIP 52", "VIP 55"];
const rooms = roomNames.map((name, index) => ({
  id: `room-${index}`, name, areaName: name === "BAN LE" ? "BÁN LẺ" : "TANG", status: 0, gio: "", counter: 0
}));

// Lịch thật ngày 06/08/2026 trên website (phòng, giờ vào-ra).
const day = [
  ["VIP 31", "21:22", "22:39"], ["VIP 41", "21:30", "22:38"], ["VIP 22", "17:44", "19:08"], ["VIP 21", "15:14", "16:24"],
  ["VIP 46", "18:30", "19:00"], ["VIP 46", "17:45", "18:15"], ["VIP 46", "17:00", "17:30"], ["VIP 36", "23:00", "23:30"],
  ["VIP 36", "22:15", "22:47"], ["VIP 36", "21:30", "22:02"], ["VIP 36", "20:45", "21:15"], ["VIP 36", "20:00", "20:30"],
  ["VIP 26", "19:15", "19:46"], ["VIP 26", "18:30", "19:01"], ["VIP 36", "17:45", "18:16"], ["VIP 36", "17:00", "17:32"],
  ["VIP 26", "23:00", "23:31"], ["VIP 26", "22:15", "22:47"], ["VIP 26", "21:30", "22:01"], ["VIP 26", "20:45", "21:15"],
  ["VIP 26", "20:00", "20:32"], ["VIP 46", "19:15", "19:47"], ["VIP 36", "18:30", "19:02"], ["VIP 28", "17:45", "18:17"],
  ["VIP 26", "17:00", "17:51"]
];
const at = time => { const [h, m] = time.split(":").map(Number); return new Date(2026, 7, 6, h, m).getTime(); };
function bookingsOf(entries) {
  const map = new Map();
  for (const [name, from, to] of entries) {
    if (!map.has(name)) map.set(name, []);
    map.get(name).push({ from: at(from), to: at(to) });
  }
  return map;
}
const bookings = bookingsOf(day);
const plan = { checkIn: "06/08/2026 19:15", checkOut: "06/08/2026 20:06", durationMinutes: 51 };

// Khung đã chốt: không phòng 400k nào trống (đúng như lỗi người dùng gặp).
assert.strictEqual(box.rank(rooms, bookings, plan.checkIn, plan.checkOut, 400000).length, 0);

// Dời sang khung gần nhất: VIP 36 trống từ 19:03, đủ 51 phút trước 20:00.
const shifted = box.shift(rooms, bookings, plan, 400000);
assert(shifted, "Phải tìm được khung trống trong buổi tối");
assert.strictEqual(shifted.checkIn, "06/08/2026 19:03");
assert.strictEqual(shifted.checkOut, "06/08/2026 19:54");
assert.strictEqual(shifted.room.name, "VIP 36");
assert.strictEqual(shifted.shiftMinutes, -12);
// Khung mới thật sự không chồng phiếu nào của phòng đó, và vẫn đúng đơn giá.
assert.strictEqual(box.rank(rooms, bookings, shifted.checkIn, shifted.checkOut, 400000)[0].name, "VIP 36");

// Phiếu kế tiếp cùng ngày (khung 19:03 vừa bị chiếm) tiếp tục tìm được chỗ khác.
const next = box.shift(rooms, bookingsOf([...day, ["VIP 36", "19:03", "19:54"]]), plan, 400000);
assert(next, "Vẫn còn VIP 46 trống từ 19:48");
assert.strictEqual(next.room.name, "VIP 46");
assert.strictEqual(next.checkIn, "06/08/2026 19:48");
assert.strictEqual(next.checkOut, "06/08/2026 20:39");

// Không bao giờ dời trước 17:00 hay tràn qua nửa đêm.
const late = box.shift(rooms, bookings, { checkIn: "06/08/2026 23:00", checkOut: "06/08/2026 23:51" }, 400000);
assert(late, "Có khung trống trước nửa đêm");
assert(late.checkIn >= "06/08/2026 17:00" && late.checkOut <= "06/08/2026 23:59", `Khung ${late.checkIn}→${late.checkOut} ra ngoài buổi tối`);
const fullDay = bookingsOf(["VIP 26", "VIP 36", "VIP 46"].map(name => [name, "17:00", "23:58"]));
assert.strictEqual(box.shift(rooms, fullDay, plan, 400000), null, "Hết chỗ thật thì trả null, không bịa phòng");

// Chỉ nhận phòng cùng đơn giá: phòng 600k trống không được dùng cho phương án 400k.
const only600Free = bookingsOf(["VIP 26", "VIP 36", "VIP 46"].map(name => [name, "17:00", "23:58"]));
assert.strictEqual(box.rank(rooms, only600Free, plan.checkIn, plan.checkOut, 400000).length, 0);
assert(box.rank(rooms, only600Free, plan.checkIn, plan.checkOut, 600000).length > 0);

// Quầy BÁN LẺ không bao giờ được chọn.
const shiftedAny = box.shift(rooms, new Map(), plan, 0);
assert.notStrictEqual(shiftedAny.room.name, "BAN LE");

// Luồng tạo phiếu: khung cũ hết phòng thì dời giờ, GHI phương án đã dời trước khi
// gửi API rồi tạo phiếu bằng phương án đó.
const submit = extract("submitNewInvoiceOnIdleRoom");
assert(submit.indexOf("shiftedNewInvoiceWindow(") < submit.indexOf("updateStatementTransaction("));
assert(submit.indexOf("updateStatementTransaction(") < submit.indexOf("submitNewInvoiceViaApi(transaction, effectivePlan, room)"));
assert.match(submit, /plannedCheckIn: plan\.checkIn, plannedCheckOut: plan\.checkOut/);

console.log("Dời giờ phiếu mới khi khung đã chốt hết phòng cùng giá: OK");
