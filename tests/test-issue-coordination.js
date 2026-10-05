"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Coordination = require("../issue-coordination.js");

// --- Cờ thứ tự cơ sở ------------------------------------------------------

// Chỉ Linh Đàm và Kim Giang dùng chung dải số. Paris Nhơn có dải riêng nên
// không nằm trong dãy (kế toán chốt 29/09/2026).
assert.deepStrictEqual(Coordination.empty().tenantOrder,
  ["parislinhdam", "pariskimgiang"],
  "Thứ tự mặc định: Linh Đàm → Kim Giang");
assert.strictEqual(Coordination.sharesInvoiceRange("parislinhdam"), true);
assert.strictEqual(Coordination.sharesInvoiceRange("pariskimgiang"), true);
assert.strictEqual(Coordination.sharesInvoiceRange("parisnhon"), false, "Nhơn có dải số riêng");

assert.deepStrictEqual(Coordination.tenantsBefore(Coordination.empty(), "pariskimgiang"),
  ["parislinhdam"], "Kim Giang chờ Linh Đàm");
assert.deepStrictEqual(Coordination.tenantsBefore(Coordination.empty(), "parislinhdam"), [],
  "Cơ sở đầu dãy không phải chờ ai");
assert.deepStrictEqual(Coordination.tenantsAfter(Coordination.empty(), "parislinhdam"),
  ["pariskimgiang"]);
assert.deepStrictEqual(Coordination.tenantsAfter(Coordination.empty(), "pariskimgiang"), [],
  "Cơ sở cuối dãy không còn ai phía sau");
assert.deepStrictEqual(Coordination.tenantsBefore(Coordination.empty(), "parisnhon"), [],
  "Nhơn không phải chờ ai");

// Đổi thứ tự: đưa một cơ sở lên đầu.
const reordered = Coordination.setTenantOrder(Coordination.empty(),
  ["pariskimgiang", "parislinhdam"]);
assert.deepStrictEqual(reordered.tenantOrder, ["pariskimgiang", "parislinhdam"]);
assert.deepStrictEqual(Coordination.tenantsBefore(reordered, "pariskimgiang"), [],
  "Kim Giang lên đầu thì không phải chờ ai");

// Dãy thiếu/thừa/lạ phải được vá lại chứ không làm vỡ điều phối.
assert.deepStrictEqual(Coordination.normalizeOrder(["pariskimgiang"]),
  ["pariskimgiang", "parislinhdam"], "Cơ sở thiếu được bổ sung theo mặc định");
assert.deepStrictEqual(Coordination.normalizeOrder(["pariskimgiang", "pariskimgiang", "ma-la"]),
  ["pariskimgiang", "parislinhdam"], "Bỏ trùng và bỏ mã lạ");
assert.deepStrictEqual(Coordination.normalizeOrder([]),
  ["parislinhdam", "pariskimgiang"], "Dãy rỗng quay về mặc định");

// Bản ghi cũ chỉ có firstTenant phải nâng cấp được, không mất thiết lập.
assert.deepStrictEqual(Coordination.normalize({ firstTenant: "pariskimgiang" }).tenantOrder,
  ["pariskimgiang", "parislinhdam"],
  "firstTenant cũ được đưa lên đầu dãy mới");

// Storage cũ (từ khi Nhơn còn trong dãy) phải được làm sạch: Nhơn đứng đầu
// dãy cũ không được bắt Linh Đàm/Kim Giang chờ.
const legacyWithNhon = Coordination.normalize({
  tenantOrder: ["parisnhon", "parislinhdam", "pariskimgiang"],
  statements: { parisnhon: { importedAt: "2026-07-03T00:00:00Z", days: { "2026-07-01": { count: 5 } } } },
  cursors: { "2026-07-01": { parisnhon: { status: "running", count: 5 } } }
});
assert.deepStrictEqual(legacyWithNhon.tenantOrder, ["parislinhdam", "pariskimgiang"]);
assert.strictEqual(legacyWithNhon.statements.parisnhon, undefined, "Bỏ sao kê đối chiếu của Nhơn");
assert.deepStrictEqual(legacyWithNhon.cursors, {}, "Bỏ chốt tiến độ của Nhơn");

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
assert.deepStrictEqual(view.pendingBefore, [], "Linh Đàm đã xong nên không còn ai phải chờ");
assert.deepStrictEqual(view.nextTenants, [], "Kim Giang cuối dãy, không nhắc chuyển sang Nhơn");
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
assert(view.warnings.some(item => item.code === "other_should_go_first"));
assert.match(view.warnings.find(i => i.code === "other_should_go_first").text, /3 giao dịch/,
  "Cảnh báo phải nêu số giao dịch cụ thể");
assert.deepStrictEqual(view.pendingBefore, [{ tenant: "parislinhdam", count: 3 }]);

// Nhơn có dải số riêng: không ghi sổ điều phối, không cảnh báo, không chờ ai —
// kể cả khi Linh Đàm/Kim Giang còn việc hoặc có lô đứt dở cùng ngày.
let withNhon = Coordination.recordStatement(Coordination.empty(), "parislinhdam", statementRows);
withNhon = Coordination.recordStatement(withNhon, "pariskimgiang", kgRows);
withNhon = Coordination.markCursor(withNhon, "parislinhdam", "2026-07-01", { status: "running", count: 1 });
const nhonRecorded = Coordination.recordStatement(withNhon, "parisnhon", [
  { transactionDate: "2026-07-01", requestedAt: "2026-07-01 18:00", credit: 400000 }
]);
assert.strictEqual(nhonRecorded.statements.parisnhon, undefined, "Sao kê Nhơn không vào bảng dùng chung");
const nhonCursor = Coordination.markCursor(withNhon, "parisnhon", "2026-07-01", { status: "running", count: 1 });
assert.strictEqual(nhonCursor.cursors["2026-07-01"].parisnhon, undefined, "Chốt của Nhơn không được ghi");
view = Coordination.evaluate(withNhon, "parisnhon", "2026-07-01");
assert.deepStrictEqual(view.warnings, [], "Nhơn không nhận cảnh báo chéo cơ sở");
assert.deepStrictEqual(view.pendingBefore, []);
assert.deepStrictEqual(view.nextTenants, []);

// Ngược lại, lô dở của Nhơn (nếu có trong storage cũ) không làm phiền Kim Giang.
const staleNhonRun = { ...withNhon, cursors: { "2026-07-01": { parisnhon: { status: "running", count: 2 } } } };
view = Coordination.evaluate(staleNhonRun, "pariskimgiang", "2026-07-01");
assert(!view.warnings.some(item => item.code === "other_interrupted"),
  "Lô dở của Nhơn không phải việc của Kim Giang");

// 2. Chưa import sao kê cơ sở kia — khác hẳn với "họ không có việc".
const noStatement = Coordination.recordStatement(Coordination.empty(), "pariskimgiang", kgRows);
view = Coordination.evaluate(noStatement, "pariskimgiang", "2026-07-01");
assert(view.warnings.some(item => item.code === "missing_other_statement"));
assert.deepStrictEqual(view.pendingBefore, [],
  "Chưa import thì không đếm được, phải cảnh báo riêng chứ không coi là còn việc");

// 3. Cơ sở kia không có giao dịch ngày đó → chạy bình thường, KHÔNG cảnh báo.
// Đây là lý do phải chặn mềm, và nay phân biệt được với "chưa import".
let emptyDay = Coordination.recordStatement(Coordination.empty(), "parislinhdam", []);
emptyDay = Coordination.recordStatement(emptyDay, "pariskimgiang", kgRows);
view = Coordination.evaluate(emptyDay, "pariskimgiang", "2026-07-01");
assert.deepStrictEqual(view.warnings.map(item => item.code), [],
  "Cơ sở kia 0 giao dịch thì không chặn");

// 4. Lô của cơ sở kia bị đứt giữa chừng.
// Hai cơ sở dùng chung một domain nên cookie phiên ghi đè nhau: đăng nhập bên
// này đá bên kia ra login. Không thể có hai lô chạy đồng thời, nên chốt kẹt ở
// "running" nghĩa là lô trước dừng giữa chừng — một phần hóa đơn có thể đã được
// cấp số mà chưa vào sổ.
const running = Coordination.markCursor(state, "parislinhdam", "2026-07-03",
  { status: "running", count: 2 });
view = Coordination.evaluate(running, "pariskimgiang", "2026-07-03");
assert(view.warnings.some(item => item.code === "other_interrupted"),
  "Chốt kẹt running của cơ sở kia phải bị cảnh báo là lô đứt dở");
assert(!view.warnings.some(item => item.code === "other_running"),
  "Không còn khái niệm hai cơ sở chạy đồng thời");

// 4b. Lô đứt dở của CHÍNH cơ sở này còn sát sườn hơn.
const selfRunning = Coordination.markCursor(state, "pariskimgiang", "2026-07-04",
  { status: "running", count: 3 });
view = Coordination.evaluate(selfRunning, "pariskimgiang", "2026-07-04");
assert(view.warnings.some(item => item.code === "self_interrupted"),
  "Lô đứt dở của chính cơ sở này phải được cảnh báo");

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
assert.deepStrictEqual(restored.tenantOrder, state.tenantOrder, "Vòng lưu/đọc không đổi thứ tự");
assert.deepStrictEqual(Coordination.normalize(null).tenantOrder,
  ["parislinhdam", "pariskimgiang"],
  "Dữ liệu rỗng vẫn ra trạng thái dùng được");
assert.deepStrictEqual(Coordination.normalize({ tenantOrder: "hỏng", cursors: "hỏng" }).tenantOrder,
  ["parislinhdam", "pariskimgiang"], "Dữ liệu sai kiểu không làm vỡ");

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

// --- Bước kế tiếp sau khi một cơ sở phát hành xong (tự chuyển cơ sở) ---------

{
  const rows = (date, count) => Array.from({ length: count }, (_, index) =>
    ({ transactionDate: date, credit: 100000 + index, requestedAt: `${date}T1${index}:00:00` }));
  let flow = Coordination.recordStatement(Coordination.empty(), "parislinhdam",
    [...rows("2026-08-01", 2), ...rows("2026-08-02", 1)]);
  flow = Coordination.recordStatement(flow, "pariskimgiang",
    [...rows("2026-08-01", 3), ...rows("2026-08-03", 2)]);
  const done = (state, tenant, date) => Coordination.markCursor(state, tenant, date, { status: "done", count: 1 });

  // Linh Đàm xong 01/08 → Kim Giang cùng ngày (đứng sau trong dãy).
  flow = done(flow, "parislinhdam", "2026-08-01");
  assert.deepStrictEqual(Coordination.nextHandoff(flow, "parislinhdam", "2026-08-01"),
    { tenant: "pariskimgiang", dateKey: "2026-08-01" });
  // Kim Giang xong 01/08 → ngày kế, bắt đầu lại từ đầu dãy: Linh Đàm 02/08.
  flow = done(flow, "pariskimgiang", "2026-08-01");
  assert.deepStrictEqual(Coordination.nextHandoff(flow, "pariskimgiang", "2026-08-01"),
    { tenant: "parislinhdam", dateKey: "2026-08-02" });
  // Linh Đàm xong 02/08, Kim Giang không có giao dịch 02/08 → bỏ qua cơ sở rỗng,
  // sang 03/08 ở chỗ còn việc (chính Kim Giang).
  flow = done(flow, "parislinhdam", "2026-08-02");
  assert.deepStrictEqual(Coordination.nextHandoff(flow, "parislinhdam", "2026-08-02"),
    { tenant: "pariskimgiang", dateKey: "2026-08-03" });
  // Cùng cơ sở ngày kế: vẫn trả về để mời tải ngày đó, không chuyển trang.
  const onlyKg = Coordination.recordStatement(Coordination.empty(), "pariskimgiang",
    [...rows("2026-08-01", 1), ...rows("2026-08-02", 1)]);
  assert.deepStrictEqual(Coordination.nextHandoff(done(onlyKg, "pariskimgiang", "2026-08-01"), "pariskimgiang", "2026-08-01"),
    { tenant: "pariskimgiang", dateKey: "2026-08-02" });
  // Hết việc → null; Nhơn (dải riêng) không bao giờ chuyển.
  flow = done(flow, "pariskimgiang", "2026-08-03");
  assert.strictEqual(Coordination.nextHandoff(flow, "pariskimgiang", "2026-08-03"), null);
  assert.strictEqual(Coordination.nextHandoff(flow, "parisnhon", "2026-08-01"), null);
  // Đổi thứ tự (Kim Giang trước): Kim Giang xong 01/08 → Linh Đàm cùng ngày.
  let reversedFlow = Coordination.setTenantOrder(
    Coordination.recordStatement(Coordination.recordStatement(Coordination.empty(), "parislinhdam", rows("2026-08-01", 1)),
      "pariskimgiang", rows("2026-08-01", 1)),
    ["pariskimgiang", "parislinhdam"]);
  reversedFlow = done(reversedFlow, "pariskimgiang", "2026-08-01");
  assert.deepStrictEqual(Coordination.nextHandoff(reversedFlow, "pariskimgiang", "2026-08-01"),
    { tenant: "parislinhdam", dateKey: "2026-08-01" });
  assert.strictEqual(Coordination.nextHandoff(done(reversedFlow, "parislinhdam", "2026-08-01"), "parislinhdam", "2026-08-01"), null);
}

// Lệnh chuyển cơ sở ghi ở cơ sở này, đọc ở cơ sở kia: khóa dùng chung.
assert(/ISSUE_HANDOFF_KEY = "[^"]+"/.test(storeSource), "Thiếu khóa lưu lệnh chuyển cơ sở");
assert(!/tenantKey\(ISSUE_HANDOFF_KEY\)/.test(storeSource), "Lệnh chuyển cơ sở phải dùng khóa chung");

// --- Đấu nối trong content.js ---------------------------------------------

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

// Bảng đối chiếu phải được trích ngay khi import sao kê, nếu không cơ sở kia
// không bao giờ biết trước bên này có bao nhiêu việc.
const importFlow = contentSource.slice(
  contentSource.indexOf("async function importStatementFile(event)"),
  contentSource.indexOf("function stockReservationByCode(")
);
assert(importFlow.includes("InvoiceIssueCoordination.recordStatement"),
  "Import sao kê phải trích bảng đối chiếu cho cơ sở kia");
assert(importFlow.includes("pageTenantSlug"),
  "Bảng đối chiếu phải gắn đúng cơ sở của tab đang mở");

const issueFlow = contentSource.slice(
  contentSource.indexOf("async function issueSelectedEInvoices("),
  contentSource.indexOf("function stockNameByWebCode(")
);
// Lô trộn nhiều ngày sẽ chiếm phần số mà cơ sở kia cần cho ngày sớm hơn, và
// phát hành rồi thì không hoàn tác được — nên đây là CHẶN CỨNG, không phải
// cảnh báo cho qua.
assert(/if \(batchDates\.length > 1\) \{[\s\S]{0,400}throw new Error/.test(issueFlow),
  "Lô trộn nhiều ngày phải bị chặn cứng, không được chỉ cảnh báo");
assert(issueFlow.indexOf("batchDates.length > 1") < issueFlow.indexOf("window.confirm"),
  "Phải chặn TRƯỚC khi hỏi xác nhận, không để người dùng xác nhận rồi mới báo lỗi");

// Danh sách phát hành phải được khóa theo đúng một ngày ngay từ lúc tải, để
// không bao giờ có nhiều ngày cho người dùng tích chọn.
const loadList = contentSource.slice(
  contentSource.indexOf("async function loadEInvoiceList()"),
  contentSource.indexOf("function statementInvoiceNos(")
);
assert(loadList.includes("const toDate = fromDate"),
  "loadEInvoiceList phải ép Đến ngày bằng Ngày phát hành");
const suggestRange = contentSource.slice(
  contentSource.indexOf("function suggestedEInvoiceRange()"),
  contentSource.indexOf("async function openEInvoiceAdmin(")
);
assert(suggestRange.includes("toDate: fromDate"),
  "Khoảng ngày gợi ý cho màn phát hành cũng phải là một ngày");
// Ô Đến ngày còn đó để không phá bố cục, nhưng không được sửa tay.
assert(/id="it-einvoice-to-date"[^>]*readonly/.test(contentSource),
  "Ô Đến ngày phải chỉ đọc vì lô luôn khóa một ngày");
// Chuyển ngày nhanh: đây là cách thay thế cho việc quét cả khoảng.
for (const id of ["it-einvoice-prev-day", "it-einvoice-next-day"]) {
  assert(contentSource.includes(`id="${id}"`), `Thiếu nút chuyển ngày ${id}`);
}
// Trạng thái điều phối phải đọc lại ngay trước khi đánh giá: tab kia có thể vừa ghi.
assert(issueFlow.indexOf("loadIssueCoordination") < issueFlow.indexOf("InvoiceIssueCoordination.evaluate"),
  "Phải đọc lại chốt từ storage trước khi đánh giá cảnh báo");
assert(issueFlow.includes("coordinationWarning"), "Cảnh báo chéo cơ sở phải vào hộp thoại xác nhận");
// Đánh dấu running trước khi chạy, done sau khi chạy.
assert(issueFlow.includes('status: "running"'), "Phải đánh dấu đang chạy cho tab kia biết");
assert(issueFlow.includes('status: "done"'), "Chạy xong phải ghi chốt");
assert(issueFlow.indexOf('status: "running"') < issueFlow.indexOf('status: "done"'),
  "running phải được đặt trước khi vòng phát hành bắt đầu");
// Chốt chỉ được ghi sau khi hộp thoại đã xác nhận, không phải trước.
assert(issueFlow.indexOf("if (!confirmed)") < issueFlow.indexOf('status: "running"'),
  "Không được ghi chốt khi người dùng còn chưa xác nhận");
assert(issueFlow.includes("InvoiceIssueCoordination.checkContinuity"),
  "Chạy xong phải kiểm tra tính liên tục của số hóa đơn");

// Chốt phải được gỡ khỏi "running" NGAY TRONG khối finally. Nếu để ở phần tổng
// kết bên dưới, một lỗi trong vòng lặp (mất phiên, mất mạng) sẽ thoát ra ngoài
// và bỏ qua toàn bộ phần đó — chốt kẹt ở "running" vĩnh viễn, khiến mọi lần
// chạy sau đều bị cảnh báo "lô trước đứt giữa chừng" dù thực tế đã xong.
const finallyBlock = issueFlow.slice(
  issueFlow.indexOf("} finally {"),
  issueFlow.indexOf("const missingItems")
);
assert(finallyBlock.includes('status: "done"'),
  "Chốt phải được ghi trong finally để lô hỏng giữa chừng không làm kẹt trạng thái running");
assert(finallyBlock.includes("saveIssueCoordination"),
  "finally phải lưu chốt xuống storage, không chỉ đổi trong bộ nhớ");
// Lưu hỏng cũng không được kéo theo cả luồng: bắt lỗi tại chỗ.
assert(/try \{[\s\S]{0,200}saveIssueCoordination[\s\S]{0,200}catch/.test(finallyBlock),
  "Lỗi khi lưu chốt phải được bắt tại chỗ, không ném ra khỏi finally");
// Xong một cơ sở thì chuyển sang bước kế tiếp do nextHandoff tính (cơ sở sau
// trong dãy còn việc cùng ngày, hết thì ngày kế từ đầu dãy).
assert(issueFlow.includes("InvoiceIssueCoordination.nextHandoff(issueCoordination, pageTenantSlug, batchDateKey)"),
  "Xong phải tính bước kế tiếp theo dãy thứ tự, không phải 'cơ sở kia'");
assert(issueFlow.indexOf("const handoff =") > issueFlow.indexOf("} finally {"),
  "Chỉ tính bước kế tiếp SAU khi chốt done của cơ sở này đã ghi");
assert(/autoRedirect: clean/.test(issueFlow) &&
  /const clean = !failures\.length && !warnings\.length && !missingItems && !leftHere/.test(issueFlow),
  "Chỉ tự chuyển khi lô sạch; có lỗi/cảnh báo/phiếu sót thì để người dùng tự bấm");

// Cờ thứ tự là thiết lập dùng chung nên khi đổi phải đọc lại rồi mới ghi, tránh
// xóa mất chốt mà tab kia vừa ghi vào cùng bản ghi.
const tenantPicker = contentSource.slice(
  contentSource.indexOf('node.querySelector("#it-einvoice-tenant-order")')
);
assert(tenantPicker.indexOf("loadIssueCoordination") < tenantPicker.indexOf("saveIssueCoordination"),
  "Đổi thứ tự phải đọc lại bản ghi dùng chung trước khi ghi đè");
assert(contentSource.includes('id="it-einvoice-tenant-order"'), "Thiếu ô thứ tự phát hành");

console.log("Issue coordination tests passed");
