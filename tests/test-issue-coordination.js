"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Coordination = require("../issue-coordination.js");

// --- Cờ thứ tự cơ sở ------------------------------------------------------

assert.strictEqual(Coordination.empty().firstTenant, "parislinhdam",
  "Mặc định Linh Đàm phát hành trước");
assert.strictEqual(Coordination.setFirstTenant(Coordination.empty(), "pariskimgiang").firstTenant,
  "pariskimgiang", "Đổi được cờ sang Kim Giang");
// Giá trị lạ không được ghi đè cờ đang có.
assert.strictEqual(Coordination.setFirstTenant(Coordination.empty(), "khong-ton-tai").firstTenant,
  "parislinhdam", "Tenant không hợp lệ bị bỏ qua");
assert.strictEqual(Coordination.otherTenant("parislinhdam"), "pariskimgiang");
assert.strictEqual(Coordination.otherTenant("pariskimgiang"), "parislinhdam");

// --- Bảng sao kê đối chiếu -------------------------------------------------

const statementRows = [
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 09:15", credit: 1200000 },
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 20:05", credit: 800000 },
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 11:40", credit: 500000 },
  { transactionDate: "2026-07-02", requestedAt: "2026-07-02 10:00", credit: 300000 },
  // Debit không tạo việc hóa đơn nên không được đếm.
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 08:00", credit: 0 }
];

let state = Coordination.recordStatement(Coordination.empty(), "parislinhdam", statementRows, "2026-07-03T02:00:00Z");
const day1 = Coordination.statementSummary(state, "parislinhdam", "2026-07-01");
assert.strictEqual(day1.count, 3, "Chỉ đếm dòng Credit dương");
assert.deepStrictEqual(day1.transactions.map(item => item.at),
  ["2026-07-01 09:15", "2026-07-01 11:40", "2026-07-01 20:05"],
  "Giao dịch trong ngày phải sắp theo giờ tăng dần");
assert.strictEqual(Coordination.statementSummary(state, "parislinhdam", "2026-07-02").count, 1);
assert.strictEqual(Coordination.statementSummary(state, "pariskimgiang", "2026-07-01"), null,
  "Cơ sở chưa import thì không có bảng đối chiếu");

// Import lại phải THAY hẳn, không cộng dồn — sao kê mới là nguồn sự thật.
state = Coordination.recordStatement(state, "parislinhdam", statementRows, "2026-07-04T02:00:00Z");
assert.strictEqual(Coordination.statementSummary(state, "parislinhdam", "2026-07-01").count, 3,
  "Import lại cùng file không được nhân đôi số giao dịch");

// --- Chốt tiến độ ----------------------------------------------------------

state = Coordination.markCursor(state, "parislinhdam", "2026-07-01",
  { status: "done", lastSoHoaDon: "124", count: 3, updatedAt: "2026-07-05T01:00:00Z" });
const cursor = Coordination.cursorFor(state, "parislinhdam", "2026-07-01");
assert.strictEqual(cursor.status, "done");
assert.strictEqual(cursor.lastSoHoaDon, "124");
assert.strictEqual(Coordination.latestIssuedDate(state, "parislinhdam"), "2026-07-01");
assert.strictEqual(Coordination.latestIssuedDate(state, "pariskimgiang"), "",
  "Cơ sở chưa phát hành gì thì không có ngày nào");

// --- Kịch bản nghiệp vụ chính ---------------------------------------------
// Ngày 01/07: Linh Đàm 122-124 rồi Kim Giang 125-126.

const kgRows = [
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 13:00", credit: 900000 },
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 15:30", credit: 700000 }
];
state = Coordination.recordStatement(state, "pariskimgiang", kgRows, "2026-07-03T02:00:00Z");

// Kim Giang chạy SAU khi Linh Đàm đã xong ngày đó: không còn cảnh báo thứ tự.
let view = Coordination.evaluate(state, "pariskimgiang", "2026-07-01");
assert.strictEqual(view.goesFirst, false, "Kim Giang không phải cơ sở đi trước");
assert.strictEqual(view.otherDone, true, "Linh Đàm đã xong ngày 01/07");
assert.strictEqual(view.expectedOtherCount, 3, "Biết trước Linh Đàm có 3 giao dịch");
assert.deepStrictEqual(view.warnings.map(item => item.code), [],
  "Đúng thứ tự thì không cảnh báo gì");

// Linh Đàm là cơ sở đi trước nên luôn chạy được.
view = Coordination.evaluate(state, "parislinhdam", "2026-07-02");
assert.strictEqual(view.goesFirst, true);
assert.deepStrictEqual(view.warnings.map(item => item.code), []);

// --- Các nhánh cảnh báo ----------------------------------------------------

// 1. Cơ sở đi trước còn việc chưa phát hành.
let pending = Coordination.recordStatement(Coordination.empty(), "parislinhdam", statementRows);
pending = Coordination.recordStatement(pending, "pariskimgiang", kgRows);
view = Coordination.evaluate(pending, "pariskimgiang", "2026-07-01");
assert.deepStrictEqual(view.warnings.map(item => item.code), ["other_should_go_first"]);
assert.match(view.warnings[0].text, /3 giao dịch/, "Cảnh báo phải nêu số giao dịch cụ thể");

// 2. Chưa import sao kê cơ sở kia — khác hẳn với "họ không có việc".
const noStatement = Coordination.recordStatement(Coordination.empty(), "pariskimgiang", kgRows);
view = Coordination.evaluate(noStatement, "pariskimgiang", "2026-07-01");
assert.deepStrictEqual(view.warnings.map(item => item.code), ["missing_other_statement"]);
assert.strictEqual(view.expectedOtherCount, null, "Chưa import thì không biết số giao dịch");

// 3. Cơ sở kia không có giao dịch ngày đó → chạy bình thường, KHÔNG cảnh báo.
// Đây là lý do phải chặn mềm, và nay phân biệt được với "chưa import".
let emptyDay = Coordination.recordStatement(Coordination.empty(), "parislinhdam", []);
emptyDay = Coordination.recordStatement(emptyDay, "pariskimgiang", kgRows);
view = Coordination.evaluate(emptyDay, "pariskimgiang", "2026-07-01");
assert.deepStrictEqual(view.warnings.map(item => item.code), [],
  "Cơ sở kia 0 giao dịch thì không chặn");

// 4. Cơ sở kia đang chạy dở.
const running = Coordination.markCursor(state, "parislinhdam", "2026-07-03",
  { status: "running", count: 2 });
view = Coordination.evaluate(running, "pariskimgiang", "2026-07-03");
assert(view.warnings.some(item => item.code === "other_running"),
  "Phải cảnh báo khi cơ sở kia đang phát hành dở cùng ngày");

// 5. Cơ sở kia đã vượt sang ngày sau → số sẽ chèn ngược.
const ahead = Coordination.markCursor(state, "parislinhdam", "2026-07-09",
  { status: "done", lastSoHoaDon: "180", count: 4 });
view = Coordination.evaluate(ahead, "pariskimgiang", "2026-07-05");
assert(view.warnings.some(item => item.code === "other_ahead"),
  "Phải cảnh báo khi cơ sở kia đã phát hành ngày lớn hơn");

// --- Kiểm tra tính liên tục sau lô ----------------------------------------

assert.strictEqual(Coordination.checkContinuity(["122", "123", "124"]).ok, true);
assert.strictEqual(Coordination.checkContinuity([]).ok, true, "Lô rỗng không coi là đứt");
assert.strictEqual(Coordination.checkContinuity(["122"]).ok, true, "Một hóa đơn luôn liên tục");
// Thứ tự đầu vào lộn xộn vẫn phải nhận ra là liên tục.
assert.strictEqual(Coordination.checkContinuity(["124", "122", "123"]).ok, true);

const broken = Coordination.checkContinuity(["122", "123", "126"]);
assert.strictEqual(broken.ok, false, "Đứt quãng phải bị phát hiện");
assert.deepStrictEqual(broken.gaps, [{ after: 123, before: 126, missing: 2 }]);
assert.strictEqual(broken.from, 122);
assert.strictEqual(broken.to, 126);

// --- Chuẩn hóa dữ liệu hỏng -----------------------------------------------

const restored = Coordination.normalize(JSON.parse(JSON.stringify(state)));
assert.strictEqual(restored.firstTenant, state.firstTenant, "Vòng lưu/đọc không đổi cờ");
assert.strictEqual(Coordination.normalize(null).firstTenant, "parislinhdam",
  "Dữ liệu rỗng vẫn ra trạng thái dùng được");
assert.strictEqual(Coordination.normalize({ firstTenant: "bậy", cursors: "hỏng" }).firstTenant,
  "parislinhdam", "Dữ liệu sai kiểu không làm vỡ");

// --- Đấu nối vào extension -------------------------------------------------

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const scripts = manifest.content_scripts.flatMap(item => item.js || []);
assert(scripts.includes("issue-coordination.js"), "manifest phải nạp issue-coordination.js");
assert(scripts.indexOf("issue-coordination.js") < scripts.indexOf("content.js"),
  "Module phải nạp trước content.js");
// Dữ liệu điều phối là dải số dùng chung hai cơ sở nên KHÔNG được tách theo tenant.
const storeSource = fs.readFileSync(path.join(__dirname, "..", "mapping-store.js"), "utf8");
assert(/ISSUE_COORDINATION_KEY = "[^"]+"/.test(storeSource), "Thiếu khóa lưu điều phối");
const coordBlock = storeSource.slice(storeSource.indexOf("async function loadIssueCoordination"));
assert(!/tenantKey\(ISSUE_COORDINATION_KEY\)/.test(storeSource),
  "Khóa điều phối phải dùng chung, không qua tenantKey");
assert(coordBlock.includes("ISSUE_COORDINATION_KEY"), "load/save phải dùng đúng khóa dùng chung");

console.log("Issue coordination tests passed");
