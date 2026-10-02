// Script console scripts/sua-nguoi-mua-tmck.js: sửa người mua + phương thức
// thanh toán của phiếu đã lưu trước bản 1.29.4, không chạy lại batch.
process.env.TZ = "Asia/Ho_Chi_Minh";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "scripts", "sua-nguoi-mua-tmck.js"), "utf8");
const sandbox = { __SUA_NGUOI_MUA_TEST__: {}, console: { ...console, warn: () => {} }, setTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const lib = sandbox.__SUA_NGUOI_MUA_TEST__.lib;
assert.ok(lib, "Script phải dừng ở móc test trước khi đụng tới trang");

// Giá trị phải trùng bridge.js: phiếu mới và phiếu sửa bằng script ra cùng một kiểu.
const bridge = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
assert.strictEqual(lib.NEW_BUYER, JSON.parse(`"${bridge.match(/const DEFAULT_INVOICE_BUYER = "([^"]+)";/)[1]}"`));
assert.strictEqual(lib.NEW_PAYMENT, bridge.match(/const INVOICE_PAYMENT_METHOD = "([^"]+)";/)[1]);

// --- Chọn phiếu ---------------------------------------------------------------
const header = overrides => ({
  NAME: "01000000123", SOHD: "", NGUOIMUAHANG: "Khách lẻ - Không lấy hóa đơn", PHUONGTHUCTT: "CK",
  DIACHIKHACH: "Khách không cung cấp thông tin", ...overrides
});
assert.deepStrictEqual({ ...lib.classify(header()).changes },
  { NGUOIMUAHANG: "Bán cho người tiêu dùng", PHUONGTHUCTT: "TM/CK" }, "Phiếu cũ của extension: đổi cả hai");
assert.deepStrictEqual({ ...lib.classify(header({ NGUOIMUAHANG: "Bán cho người tiêu dùng", PHUONGTHUCTT: "TM" })).changes },
  { PHUONGTHUCTT: "TM/CK" }, "Người mua đã đúng thì chỉ đổi phương thức");
assert.deepStrictEqual({ ...lib.classify(header({ DIACHIKHACH: "" })).changes },
  { NGUOIMUAHANG: "Bán cho người tiêu dùng", PHUONGTHUCTT: "TM/CK", DIACHIKHACH: "Khách không cung cấp thông tin" });
// Người dùng chốt 02/10/2026: mọi phiếu TM cũng thành TM/CK, kể cả người mua trống
// (vd HD0126070007). Extension chỉ ghi người mua từ 07/08/2026, nên phiếu nó lưu
// trước đó cũng TM + người mua trống như phiếu nhân viên.
assert.deepStrictEqual({ ...lib.classify(header({ NGUOIMUAHANG: "", PHUONGTHUCTT: "TM" })).changes },
  { PHUONGTHUCTT: "TM/CK", NGUOIMUAHANG: "Bán cho người tiêu dùng" });
assert.ok(lib.classify(header({ NGUOIMUAHANG: "   ", PHUONGTHUCTT: "CK" })).changes);
assert.strictEqual(lib.classify(header({ NGUOIMUAHANG: "Bán cho người tiêu dùng", PHUONGTHUCTT: "tm/ck" })).skip, "đã đúng",
  "Chạy lại không sửa lại phiếu đã đúng");
assert.match(lib.classify(header({ NGUOIMUAHANG: "CÔNG TY CỔ PHẦN CÔNG NGHỆ SYSTECH", PHUONGTHUCTT: "TM" })).skip,
  /người mua khác/, "Không được ghi đè người mua thật");
assert.strictEqual(lib.classify(header({ SOHD: "968" })).skip, "đã xuất hóa đơn");
assert.strictEqual(lib.classify(header(), { issuedNo: "969" }).skip, "đã xuất hóa đơn");
assert.strictEqual(lib.classify(header(), { cancelled: true }).skip, "đã hủy");
assert.strictEqual(lib.classify(header(), { retail: true }).skip, "quầy BÁN LẺ");
// Không phân biệt dấu/hoa thường khi nhận ra người mua mặc định của website.
assert.ok(lib.classify(header({ NGUOIMUAHANG: "khách lẻ - không lấy hóa đơn" })).changes);

// Chỉ phiếu ghi đúng TM hoặc CK là phiếu extension tạo (người dùng chốt 02/10/2026,
// sau khi chạy thử trên web thật: không lọc thì script nhắm 534/535 phiếu chưa
// xuất của Linh Đàm tháng 7, gồm cả phiếu nhân viên tự lập).
assert.ok(lib.classify(header({ PHUONGTHUCTT: "TM" })).changes);
assert.ok(lib.classify(header({ PHUONGTHUCTT: " ck " })).changes, "Không phân biệt hoa thường/khoảng trắng");
assert.strictEqual(lib.classify(header({ PHUONGTHUCTT: "" })).skip, "thanh toán (trống)", "Phiếu nhân viên tự lập không bị sửa");
assert.strictEqual(lib.classify(header({ PHUONGTHUCTT: "Tiền mặt" })).skip, "thanh toán Tiền mặt");
assert.strictEqual(lib.classify(header({ PHUONGTHUCTT: "TM/CK" })).skip, "thanh toán TM/CK",
  "Phiếu đã là TM/CK (luồng sao kê) không nằm trong phạm vi sửa");

// --- Chỉ phiếu CHƯA XUẤT HÓA ĐƠN theo danh sách của website ----------------------
// Chạy thử trên web thật 02/10/2026: phải giới hạn đúng các phiếu chưa xuất; API
// LayDuLieu trả cả phiếu đã xuất nên không được lấy thẳng làm danh sách cần sửa.
{
  const listRows = [
    { ID: "AAAA-1", NAME: "01000000101" },
    { ID: "bbbb-2", NAME: "01000000102" }, // đã xuất: không có trong danh sách Chưa xuất
    { ID: "cccc-3", NAME: "01000000103" }
  ];
  const split = lib.splitByWebsiteStatus(listRows, new Set(["aaaa-1", "01000000103"]));
  assert.deepStrictEqual(Array.from(split.candidates, row => row.NAME), ["01000000101", "01000000103"],
    "Khớp theo ID (không phân biệt hoa thường) hoặc số phiếu");
  assert.deepStrictEqual(Array.from(split.issued, row => row.NAME), ["01000000102"]);
  assert.strictEqual(lib.splitByWebsiteStatus(listRows, new Set()).candidates.length, 0,
    "Danh sách Chưa xuất rỗng thì không sửa phiếu nào");
}

// --- Payload chỉ đổi người mua/phương thức ---------------------------------------
const maps = [
  ["NAME", "01000000123"], ["NGAY", "2026-07-12T17:00:00.000Z"], ["BATDAU", "2026-07-13 20:00:00"],
  ["BATDAUPHONGCUOI", "2026-07-13T13:00:00.000Z"], ["KETTHUC", "2026-07-13T14:00:00.000Z"],
  ["GIOTHANHTOAN", "7/13/2026 9:00:00 PM"], ["DBANID", "c843f2a2-5d95-466c-baae-7da153514aae"],
  ["TIENGIO", 600000], ["TIENGIOPHONGCUOI", "600000.00"], ["TIENHANG", 400000], ["TIENTHUE", 100000],
  ["TONGCONG", 1100000], ["TIENMAT", "1100000.00"], ["KHACHDUA", "1100000.00"], ["TIENTHANHTOAN", "1100000.00"],
  ["TRALAI", "0.00"], ["DONGIA", "600000.00"], ["SOHD", ""], ["LASTSAVEID", "d4ae0958-5fb6-4670-8a93-e2ba0d9e8a99"],
  ["NGUOIMUAHANG", "Khách lẻ - Không lấy hóa đơn"], ["PHUONGTHUCTT", "CK"], ["DIACHIKHACH", "Khách không cung cấp thông tin"]
].map(([Field, Value]) => ({ Field, Value }));
const formData = { _RecordID: "faf32398-ea93-49cd-a159-d1cff7679291", ModeQuanLy: 30, Loai: 0, mapper: { Maps: maps } };
const detailRows = [
  { ID: "6009da28-8739-4a02-91ed-21bb43bc36d7", DMATHANGID: "a", SLXUAT: 4, SLXUATCHUAQUYDOI: 4, DONGIA: 45000, THANHTIEN: 180000, DMATHANG_CODE: "1100027" },
  { ID: "94ed2b32-79e5-4334-8627-bd7a0d1ec8d6", DMATHANGID: "b", SLXUAT: 1, SLXUATCHUAQUYDOI: 1, DONGIA: 220000, THANHTIEN: 220000, DMATHANG_CODE: "1000038" }
];
lib.checkDetailRows(detailRows, 400000, "01000000123");
// Phiếu "chỉ hát" (tiền hàng 0) không có dòng hàng: hợp lệ. Có tiền hàng mà không
// đọc được dòng nào thì phải chặn, nếu không lưu sẽ xóa mất dòng hàng.
lib.checkDetailRows([], 0, "01000000124");
assert.throws(() => lib.checkDetailRows([], 400000, "01000000123"), /không có dòng hàng/);
assert.throws(() => lib.checkDetailRows(detailRows, 0, "01000000123"), /khác tiền hàng/);
assert.throws(() => lib.checkDetailRows(detailRows, 450000, "01000000123"), /khác tiền hàng/);

const changes = lib.classify(Object.fromEntries(maps.map(m => [m.Field, m.Value]))).changes;
const payload = lib.buildPayload(formData, detailRows, changes);
assert.strictEqual(payload.mode, 2);
assert.strictEqual(payload.ID, formData._RecordID);
assert.strictEqual(payload.clientMap.ID, formData._RecordID);
assert.strictEqual(payload.clientMap.Grids[0].Data, detailRows, "Gửi đúng các dòng hàng đang có (giữ ID dòng)");
const sent = Object.fromEntries(payload.clientMap.Maps.map(m => [m.Field, m.Value]));
assert.strictEqual(sent.NGUOIMUAHANG, "Bán cho người tiêu dùng");
assert.strictEqual(sent.PHUONGTHUCTT, "TM/CK");
const instant = value => lib.parseTime(value).getTime();
for (const field of ["BATDAUPHONGCUOI", "KETTHUC", "GIOTHANHTOAN", "NGAY"]) {
  assert.strictEqual(instant(sent[field]), instant(Object.fromEntries(maps.map(m => [m.Field, m.Value]))[field]), `${field} giữ nguyên thời điểm`);
}
assert.strictEqual(instant(sent.BATDAU), instant("2026-07-13 20:00:00"));
const timeFields = new Set(["NGAY", "BATDAU", "BATDAUPHONGCUOI", "KETTHUC", "GIOTHANHTOAN", "TIENGIOPHONGCUOI"]);
for (const { Field, Value } of maps) {
  if (timeFields.has(Field) || Field in changes) continue;
  assert.strictEqual(sent[Field], Value, `${Field} không được đổi`);
}
assert.strictEqual(Number(sent.TIENGIOPHONGCUOI), 600000);
assert.strictEqual(payload.clientMap.Maps.length, maps.length, "Không thêm/bớt trường");

// --- Đọc lại sau khi lưu ---------------------------------------------------------
const before = Object.fromEntries(maps.map(m => [m.Field, m.Value]));
const after = { ...before, ...changes, LASTSAVEID: "new" };
assert.deepStrictEqual([...lib.verifyAfterSave(before, after, changes)], []);
assert.match(lib.verifyAfterSave(before, { ...after, TONGCONG: 1000000 }, changes).join(";"), /TONGCONG/);
assert.match(lib.verifyAfterSave(before, { ...after, NGUOIMUAHANG: before.NGUOIMUAHANG }, changes).join(";"), /NGUOIMUAHANG/);
assert.match(lib.verifyAfterSave(before, { ...after, KETTHUC: "2026-07-13T15:00:00.000Z" }, changes).join(";"), /giờ vào\/ra/);
assert.match(lib.verifyAfterSave(before, { ...after, DBANID: "khac" }, changes).join(";"), /phòng/);

// --- Rớt mạng: thử lại thay vì dừng cả lô ------------------------------------------
// Chạy thật 02/10/2026: cứ khoảng 50 phiếu lại "Failed to fetch" và script dừng.
assert.ok(lib.isNetworkError(new TypeError("Failed to fetch")));
assert.ok(lib.isNetworkError(new Error("NetworkError when attempting to fetch resource.")));
assert.ok(lib.isNetworkError(new Error("HoaDonDienTu/LayDuLieu không trả JSON (HTTP 502); có thể đã mất phiên đăng nhập.")));
assert.ok(lib.isNetworkError(new Error("Không đọc được form phiếu abc (HTTP 503).")));
assert.ok(!lib.isNetworkError(new Error("HD01: đã lưu nhưng đọc lại thấy sai: TONGCONG 1 (trước 2).")),
  "Lỗi dữ liệu không được thử lại");
assert.ok(!lib.isNetworkError(new Error("HD01 vừa bị sửa ở nơi khác trong lúc chạy.")));
assert.ok(!lib.isNetworkError(new Error("Không đọc được form phiếu abc (HTTP 200).")));

(async () => {
  let calls = 0;
  const value = await lib.withRetry("thử", async () => {
    calls += 1;
    if (calls < 3) throw new TypeError("Failed to fetch");
    return "xong";
  }, [1, 1, 1]);
  assert.strictEqual(value, "xong");
  assert.strictEqual(calls, 3, "Rớt mạng 2 lần thì lần 3 phải chạy tiếp");

  calls = 0;
  await assert.rejects(lib.withRetry("thử", async () => { calls += 1; throw new TypeError("Failed to fetch"); }, [1, 1]),
    /Failed to fetch/);
  assert.strictEqual(calls, 3, "Hết số lần thử thì báo lỗi");

  calls = 0;
  await assert.rejects(lib.withRetry("thử", async () => { calls += 1; throw new Error("sai dữ liệu"); }, [1, 1]), /sai dữ liệu/);
  assert.strictEqual(calls, 1, "Lỗi không phải mạng thì không thử lại");

  console.log("script sửa người mua/TM-CK: OK");
})().catch(error => { console.error(error); process.exit(1); });
