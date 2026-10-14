"use strict";

// Rà soát sao kê ↔ phiếu trên website (yêu cầu 14/10/2026: đã có ca giao dịch bị
// thiếu phiếu). Mỗi giao dịch doanh thu phải có đúng một phiếu, đúng ngày, đúng
// tổng, chưa hủy; phiếu trên web không thuộc giao dịch nào được nêu để biết.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Audit = require("../invoice-audit.js");

const tx = (id, date, credit, status, invoiceNo, extra = {}) =>
  ({ id, transactionDate: date, credit, status, invoiceNo, ...extra });
const web = (invoiceNo, date, grandTotal, extra = {}) =>
  ({ invoiceNo, dateKey: date, grandTotal, issued: false, cancelled: false, ...extra });

const transactions = [
  tx("ok1", "2026-09-01", 500000, "done", "HD01"),
  // Lập ở 1.699.999đ (làm tròn VAT): so với mức Lập ở, không phải sao kê.
  tx("ok2", "2026-09-01", 1700000, "done", "HD02", { acceptedGrandOverride: 1699999 }),
  // Ca thật: đã xử lý nhưng phiếu không còn trên website.
  tx("lost", "2026-09-01", 4300000, "done", "HD03"),
  tx("cancel", "2026-09-02", 800000, "done", "HD04"),
  tx("dup1", "2026-09-02", 300000, "done", "HD05"),
  tx("dup2", "2026-09-02", 300000, "done", "HD05"),
  tx("nolink", "2026-09-02", 250000, "done", ""),
  tx("wrongday", "2026-09-03", 600000, "done", "HD06"),
  tx("wrongsum", "2026-09-03", 900000, "done", "HD07"),
  tx("pending", "2026-09-03", 450000, "pending", ""),
  tx("review", "2026-09-03", 25000000, "review", ""),
  tx("skip", "2026-09-03", 120000, "skipped", ""),
  // Ngoài khoảng: không rà, nhưng phiếu của nó không bị coi là "không thuộc giao dịch".
  tx("outside", "2026-08-31", 700000, "done", "HD08")
];
const webRows = [
  web("HD01", "2026-09-01", 500000, { issued: true, soHoaDon: "125" }),
  web("HD02", "2026-09-01", 1699999),
  web("HD04", "2026-09-02", 800000, { cancelled: true }),
  web("HD05", "2026-09-02", 300000),
  web("HD06", "2026-09-02", 600000),
  web("HD07", "2026-09-03", 950000),
  web("HD08", "2026-09-01", 700000),
  web("HD99", "2026-09-03", 380000),
  web("HD98", "2026-09-03", 410000, { issued: true, soHoaDon: "140" })
];

const result = Audit.audit({
  transactions,
  webRows,
  fromDate: "2026-09-01",
  toDate: "2026-09-03",
  expectedGrand: item => item.acceptedGrandOverride || item.credit
});

const kinds = result.problems.map(problem => `${problem.kind}:${problem.invoiceNo || problem.transactionId}`);
assert.deepStrictEqual(kinds, [
  "missing_on_web:HD03",
  "cancelled:HD04",
  "duplicate_link:HD05",
  "done_no_invoice:nolink",
  "date_mismatch:HD06",
  "amount_mismatch:HD07",
  "unfinished:pending",
  "unfinished:review",
  "web_unlinked:HD99",
  "web_unlinked:HD98"
]);
const byKind = kind => result.problems.find(problem => problem.kind === kind);
assert.strictEqual(byKind("missing_on_web").severity, "error");
assert.match(byKind("missing_on_web").detail, /Phiếu HD03 không còn trên website/);
assert.match(byKind("missing_on_web").hint, /Hoàn kho & lập lại/);
assert.match(byKind("duplicate_link").detail, /Phiếu HD05 được gắn cho 2 giao dịch/);
assert.deepStrictEqual(byKind("duplicate_link").transactionIds, ["dup1", "dup2"]);
assert.match(byKind("date_mismatch").detail, /ngày 02\/09\/2026, giao dịch ngày 03\/09\/2026/);
assert.match(byKind("amount_mismatch").detail, /tổng 950\.000đ, phải là 900\.000đ \(lệch \+50\.000đ\)/);
assert.match(result.problems.find(problem => problem.transactionId === "review").hint, /Là doanh thu/);
assert.strictEqual(result.problems.filter(problem => problem.kind === "web_unlinked").every(problem => problem.severity === "info"), true);
assert.match(result.problems.find(problem => problem.invoiceNo === "HD98").detail, /đã phát hành \(Số 140\)/);
assert(!kinds.some(kind => kind.includes("HD08")), "Phiếu gắn với giao dịch ngoài khoảng không bị coi là thừa");
assert(!result.problems.some(problem => problem.transactionId === "skip"), "Giao dịch Bỏ qua không phải doanh thu");
assert(!result.problems.some(problem => problem.transactionId === "ok2"), "Mức Lập ở hợp lệ không bị coi là lệch tổng");

assert.strictEqual(result.revenueCount, 11, "11 giao dịch doanh thu trong khoảng (bỏ 'Bỏ qua' và ngoài khoảng)");
assert.strictEqual(result.matchedCount, 2, "Chỉ ok1, ok2 khớp hoàn toàn");
assert.strictEqual(result.errorCount, 8);
assert.strictEqual(result.infoCount, 2);
assert.strictEqual(result.webInvoiceCount, 8, "Không tính phiếu đã hủy");
assert.deepStrictEqual(result.days, [
  { dateKey: "2026-09-01", transactions: 3, matched: 2, webInvoices: 3, issued: 1, errors: 1 },
  { dateKey: "2026-09-02", transactions: 4, matched: 0, webInvoices: 2, issued: 0, errors: 3 },
  { dateKey: "2026-09-03", transactions: 4, matched: 0, webInvoices: 3, issued: 1, errors: 4 }
]);

// Sạch: không có vấn đề.
const clean = Audit.audit({
  transactions: [tx("a", "2026-09-05", 500000, "done", "HD10")],
  webRows: [web("HD10", "2026-09-05", 500001)],
  fromDate: "2026-09-05", toDate: "2026-09-05"
});
assert.strictEqual(clean.errorCount, 0, "Lệch 1đ nằm trong dung sai");
assert.strictEqual(clean.matchedCount, 1);

// --- Đấu nối trong content.js ---------------------------------------------------
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
function fn(name) {
  let start = source.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}
// Cùng quy tắc với phát hành: mức "Lập ở" hợp lệ, dung sai 1đ.
assert.match(fn("statementAuditFor"), /tolerance: E_INVOICE_AMOUNT_TOLERANCE/);
assert.match(fn("statementAuditFor"), /grandOverrideFor\(transaction\)/);
// Rà soát cả khoảng: đọc MỌI phiếu (không lọc trạng thái) của khoảng ngày.
assert.match(fn("runInvoiceAudit"), /request\("fetchEInvoiceList", \{ fromDate, toDate \}\)/);
// Màn Phát hành có khối Rà soát; tải danh sách một ngày cũng tự rà ngày đó.
for (const id of ["it-audit-section", "it-audit-from", "it-audit-to", "it-audit-run", "it-audit-result"]) {
  assert(fn("renderEInvoiceAdmin").includes(`id="${id}"`), `Thiếu ${id}`);
}
assert.match(fn("loadEInvoiceList"), /const dayAudit = statementAuditFor\(fromDate, toDate, eInvoiceRows\);/);
// Tự động phát hành dừng khi giao dịch đã xử lý mà thiếu phiếu hợp lệ.
assert.match(fn("autoIssueBlockers"), /statementAuditFor\(day, day, eInvoiceRows\)/);
assert.match(source, /AUTO_ISSUE_AUDIT_BLOCKING_KINDS = new Set\(\["missing_on_web", "cancelled", "duplicate_link", "done_no_invoice"\]\)/);

// Bảng kết quả: KPI, ngày thiếu/thừa phiếu, từng vấn đề (lỗi tô đỏ, thông tin tô vàng).
const nodes = { "it-audit-result": { innerHTML: "" }, "it-audit-summary": { textContent: "" } };
const box = {
  document: { getElementById: id => nodes[id] || null },
  formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
  escapeHtml: value => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  result
};
vm.createContext(box);
vm.runInContext(`let lastInvoiceAudit = result; ${fn("viDay")} ${fn("renderInvoiceAuditResult")} renderInvoiceAuditResult();`, box);
const html = nodes["it-audit-result"].innerHTML;
assert.match(nodes["it-audit-summary"].textContent, /01\/09\/2026 – 03\/09\/2026: 8 vấn đề cần xử lý/);
assert.match(html, /<span class="bad"><b>8<\/b> cần xử lý<\/span>/);
assert.match(html, /<tr class="it-audit-error"><td>01\/09\/2026<\/td><td class="it-money">4\.300\.000<\/td><td>HD03<\/td><td>⚠ Phiếu HD03 không còn trên website/);
assert.match(html, /<tr class="it-audit-info"><td>03\/09\/2026<\/td><td class="it-money">380\.000<\/td><td>HD99<\/td>/);
assert.match(html, /<table class="it-batch-table it-audit-days">[\s\S]*<td>01\/09\/2026<\/td><td>3<\/td><td>2<\/td><td>3<\/td><td>1<\/td><td>1<\/td>/,
  "Ngày 01/09: 3 giao dịch, 2 có phiếu khớp — thấy ngay ngày thiếu phiếu");
const cleanBox = { ...box, result: clean };
nodes["it-audit-result"].innerHTML = "";
vm.createContext(cleanBox);
vm.runInContext(`let lastInvoiceAudit = result; ${fn("viDay")} ${fn("renderInvoiceAuditResult")} renderInvoiceAuditResult();`, cleanBox);
assert.match(nodes["it-audit-result"].innerHTML, /✓ Mọi giao dịch doanh thu đều có đúng một phiếu khớp/);

// Nạp vào extension trước content.js.
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const scripts = manifest.content_scripts.find(script => (script.js || []).includes("content.js")).js;
assert(scripts.indexOf("invoice-audit.js") >= 0 && scripts.indexOf("invoice-audit.js") < scripts.indexOf("content.js"),
  "invoice-audit.js phải nạp trước content.js");

console.log("Rà soát sao kê ↔ phiếu trên website: OK");
