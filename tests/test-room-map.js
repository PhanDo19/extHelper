// Sơ đồ phòng do website trả về (fixtures/room-map-parisnhon.json là response
// thật của Paris Nhơn): bridge phải đọc đúng khu/phòng/id, content phải chọn
// đúng phòng trống, không bao giờ chọn quầy BÁN LẺ, và tôn trọng giờ đã đặt.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "room-map-parisnhon.json"), "utf8"));

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  // Bỏ qua danh sách tham số trước: tham số mặc định kiểu `options = {}` có
  // cặp ngoặc nhọn riêng và sẽ làm phép đếm độ sâu kết thúc ngay ở đó.
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) { paramsEnd = index; break; }
  }
  if (paramsEnd < 0) throw new Error(`Không đọc được tham số của ${name}`);
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

// --- bridge: đọc sơ đồ ---------------------------------------------------------
const bridgeBox = {};
vm.createContext(bridgeBox);
vm.runInContext(
  `${extractFunction(bridgeSource, "looksLikeRoomMapText")}; ${extractFunction(bridgeSource, "parseRoomMapPayload")}; ` +
  "this.looksLikeRoomMapText = looksLikeRoomMapText; this.parseRoomMapPayload = parseRoomMapPayload;",
  bridgeBox
);
assert(bridgeBox.looksLikeRoomMapText(JSON.stringify(fixture)), "Response sơ đồ phòng phải được nhận diện theo hình dạng.");
assert(!bridgeBox.looksLikeRoomMapText(JSON.stringify({ Data: [{ CODE: "0000045", NAME: "Bia Tiger lon" }] })),
  "Danh mục mặt hàng không được nhận nhầm là sơ đồ phòng.");

const parsed = bridgeBox.parseRoomMapPayload(fixture);
assert(parsed, "Phải đọc được sơ đồ phòng Nhơn.");
assert.strictEqual(parsed.areas.length, 5, "Nhơn có 5 khu: BÁN LẺ, TANG 2-5.");
assert.strictEqual(parsed.rooms.length, 19, "Nhơn có 19 thẻ: 1 BAN LE + 18 VIP.");
assert.deepStrictEqual(parsed.areas.map(area => area.name), ["BÁN LẺ", "TANG 2", "TANG 3", "TANG 4", "TANG 5"]);
const banLe = parsed.rooms.find(room => room.name === "BAN LE");
assert.strictEqual(banLe.id, "6ce25a26-6800-41e8-bcd9-fabbe927a79e", "id BAN LE phải trùng DBANID trong log tạo phiếu 01000000260.");
assert.strictEqual(banLe.areaName, "BÁN LẺ");
const vip21 = parsed.rooms.find(room => room.name === "VIP 21");
assert.strictEqual(vip21.id, "c804693e-c19d-4491-bfce-f0cef9c2fd4a");
assert.strictEqual(vip21.areaId, "53f05f3d-8781-4aaf-85a4-8b94f463c1d3");
assert.strictEqual(vip21.status, 0);
assert.strictEqual(bridgeBox.parseRoomMapPayload({ code: 1, Tag: [] }), null, "Tag rỗng không phải sơ đồ.");
assert.strictEqual(bridgeBox.parseRoomMapPayload({ code: 1, Tag: { detail: {} } }), null, "Tag của DoSave không phải sơ đồ.");

// --- content: chọn phòng --------------------------------------------------------
const contentBox = {};
vm.createContext(contentBox);
vm.runInContext(
  [
    "normalizeRoomText", "roomAreaKey", "isRetailRoomName", "parseUiDateTime",
    "roomIsFreeForRange", "isIdleMapRoom", "rankIdleRoomsFromMap", "chooseIdleRoomFromMap"
  ].map(name => extractFunction(contentSource, name)).join(";\n") +
  ";\nthis.isIdleMapRoom = isIdleMapRoom; this.rankIdleRoomsFromMap = rankIdleRoomsFromMap; this.chooseIdleRoomFromMap = chooseIdleRoomFromMap;",
  contentBox
);
const rooms = parsed.rooms;
const noBookings = new Map();
const checkIn = "01/07/2026 17:45";
const checkOut = "01/07/2026 18:11";

assert(!contentBox.isIdleMapRoom(banLe), "BAN LE không bao giờ là phòng trống hợp lệ.");
assert(contentBox.isIdleMapRoom(vip21), "VIP 21 trạng thái 0, không giờ là phòng trống.");
assert(!contentBox.isIdleMapRoom({ ...vip21, status: 1 }), "Phòng đang hoạt động không được chọn.");
assert(!contentBox.isIdleMapRoom({ ...vip21, gio: "0h 25'" }), "Phòng có giờ đang chạy không được chọn.");
assert(!contentBox.isIdleMapRoom({ ...vip21, counter: 1 }), "Cờ quầy phải bị loại.");
assert(!contentBox.isIdleMapRoom({ ...vip21, name: "VIP 99", areaName: "BÁN LẺ" }), "Phòng trong khu BÁN LẺ phải bị loại.");

assert.strictEqual(contentBox.chooseIdleRoomFromMap(rooms, noBookings, checkIn, checkOut).name, "VIP 21",
  "Không có đặt chỗ thì lấy phòng trống đầu tiên theo thứ tự website, bỏ qua BAN LE.");
assert.strictEqual(contentBox.rankIdleRoomsFromMap(rooms, noBookings, checkIn, checkOut).length, 18);

// VIP 21 đã có phiếu chồng giờ trong ngày → sang VIP 22; phòng đã dùng nhưng
// giờ rời nhau vẫn hợp lệ nhưng đứng sau phòng chưa dùng.
const overlap = new Map([["VIP 21", [{ from: Date.parse("2026-07-01T17:00:00"), to: Date.parse("2026-07-01T18:00:00") }]]]);
assert.strictEqual(contentBox.chooseIdleRoomFromMap(rooms, overlap, checkIn, checkOut).name, "VIP 22");
const disjoint = new Map([["VIP 21", [{ from: Date.parse("2026-07-01T20:00:00"), to: Date.parse("2026-07-01T21:00:00") }]]]);
const rankedDisjoint = contentBox.rankIdleRoomsFromMap(rooms, disjoint, checkIn, checkOut);
assert.strictEqual(rankedDisjoint[0].name, "VIP 22", "Phòng chưa dùng trong ngày đứng trước.");
assert.strictEqual(rankedDisjoint[rankedDisjoint.length - 1].name, "VIP 21", "Phòng đã dùng nhưng giờ rời nhau vẫn còn trong danh sách, ở cuối.");

// Mọi VIP đều bận, chỉ còn BAN LE trống → không chọn gì.
const onlyRetailIdle = rooms.map(room => room.name === "BAN LE" ? room : { ...room, status: 1 });
assert.strictEqual(contentBox.chooseIdleRoomFromMap(onlyRetailIdle, noBookings, checkIn, checkOut), null,
  "Chỉ còn BAN LE trống thì không được lập phiếu có tiền giờ.");

// --- bất biến nguồn --------------------------------------------------------------
const autoOpenSource = extractFunction(contentSource, "autoOpenIdleRoomInvoiceForm");
for (const marker of [
  "await loadRoomMapForSelection()",
  "rankIdleRoomsFromMap(roomMap.rooms, bookings, plannedCheckIn, plannedCheckOut)",
  "await openRoomCardByName(ranked[0], diagnostics)"
]) {
  assert(autoOpenSource.includes(marker), `autoOpenIdleRoomInvoiceForm thiếu: ${marker}`);
}
const openBySource = extractFunction(contentSource, "openRoomCardByName");
assert(openBySource.includes('request("getOpenFormRoom")') && openBySource.includes('request("closeInvoiceDetail")'),
  "Sau khi mở form phải đối chiếu DBANID với phòng đã chọn và đóng form nếu lệch.");
assert(contentSource.includes('request("getRoomMap", { refresh: true })'), "Phải xin bản sơ đồ mới nhất trước khi chọn phòng.");
for (const marker of [
  'else if (detail.action === "getRoomMap")',
  'else if (detail.action === "getOpenFormRoom")',
  "captureRoomMapResponse(meta, body, this.status, xhrResponseText(this, ROOM_MAP_TEXT_LIMIT))",
  "captureRoomMapResponse({ method, url, headers }, init?.body, response.status, text.slice(0, ROOM_MAP_TEXT_LIMIT))"
]) {
  assert(bridgeSource.includes(marker), `bridge thiếu: ${marker}`);
}

// Bridge phải được nạp ở document_start: sơ đồ phòng được website tải ngay khi
// trang sẵn sàng, móc XHR/fetch ở document_idle là đã muộn và không bắt được gì.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const bridgeEntry = (manifest.content_scripts || []).find(entry => (entry.js || []).includes("bridge.js"));
assert(bridgeEntry, "manifest phải khai báo bridge.js");
assert.strictEqual(bridgeEntry.run_at, "document_start", "bridge.js phải chạy ở document_start để bắt được sơ đồ phòng.");
assert.strictEqual(bridgeEntry.world, "MAIN", "bridge.js phải chạy trong MAIN world để móc fetch/XHR của website.");
// Không có thao tác DOM nào ở cấp cao nhất của bridge cần trang dựng xong.
for (const forbidden of ["  document.querySelector", "  document.getElementById", "  document.body."]) {
  assert(!bridgeSource.split("\n").some(line => line.startsWith(forbidden)),
    `bridge.js không được truy cập DOM ở cấp cao nhất lúc nạp: ${forbidden.trim()}`);
}

// Endpoint gọi thẳng phải đúng như request đã xác nhận từ Network, đi theo cơ
// sở của trang hiện tại, dùng cookie phiên (không tự gắn cookie), và được ưu
// tiên trước bản bắt thụ động khi content xin bản mới.
const fetchDirectSource = extractFunction(bridgeSource, "fetchRoomMapDirect");
for (const marker of [
  'const ROOM_MAP_ENDPOINT = "Khuvuccontrol/LayDanhSachBan?is_ajax=1";',
  'const ROOM_MAP_REQUEST_BODY = Object.freeze({ DKHUVUCID: "_ALL_", UITHIETKE: 0, MODE: 0 });'
]) {
  assert(bridgeSource.includes(marker), `bridge thiếu: ${marker}`);
}
assert(fetchDirectSource.includes("shopBasePath()"), "Endpoint sơ đồ phòng phải đi theo cơ sở của trang hiện tại.");
assert(fetchDirectSource.includes('credentials: "same-origin"'), "Phải dùng cookie phiên của trình duyệt.");
assert(!/cookie/i.test(fetchDirectSource), "Không được tự gắn Cookie vào request.");
assert(fetchDirectSource.includes("isLoginRedirect(response, responseText)"), "Mất phiên phải bị nhận diện, không coi HTML login là sơ đồ.");
const getRoomMapSource = extractFunction(bridgeSource, "getRoomMap");
assert(getRoomMapSource.indexOf("await fetchRoomMapDirect()") < getRoomMapSource.indexOf("rebuildRequestBody(roomMapCapture)"),
  "Gọi thẳng endpoint phải được thử trước khi gọi lại request đã bắt.");

console.log("room map selection: OK");
