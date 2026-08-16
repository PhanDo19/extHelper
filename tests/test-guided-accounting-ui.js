const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.21.0");
assert(content.includes("E_INVOICE_AMOUNT_TOLERANCE = 1"), "Phát hành phải chấp nhận sai số làm tròn tối đa 1 đồng");
assert(content.includes("function statementInvoiceMatch"), "Danh sách phát hành phải đối chiếu mã phiếu, ngày và tổng tiền với sao kê");
assert(content.includes("Giao dịch liên kết"), "Danh sách phát hành phải hiển thị giao dịch sao kê liên kết");
assert(content.includes("statementInvoiceMatch(row).valid"), "Phiếu sai ngày hoặc sai tiền không được chọn phát hành");
assert(css.includes(".it-einvoice-mismatch"), "Phiếu không khớp giao dịch phải được cảnh báo trực quan");
assert(content.includes("OPEN_STATEMENT_STATUSES"), "Dashboard và màn giao dịch phải dùng chung định nghĩa giao dịch chưa hoàn tất");
assert(content.includes('transactions.filter(isOpenStatementTransaction).length'), "Dashboard không được đếm giao dịch Bỏ qua là chưa hoàn tất");
assert(content.includes('filter === "open" && isOpenStatementTransaction(item)'), "Bộ lọc Chưa xử lý phải khớp số liệu trên dashboard");
assert(content.includes('class="it-reset-statement-transaction"'), "Giao dịch chờ đối soát phải có nút Làm lại khi phiếu bị mất");
assert(content.includes("async function resetStatementTransaction"), "Thiếu luồng gỡ phiếu đã mất và đưa giao dịch về Chờ xử lý");
const resetStatement = content.slice(
  content.indexOf("async function resetStatementTransaction"),
  content.indexOf("async function openStatementInvoice")
);
assert(resetStatement.includes('transaction.status = "pending"'), "Làm lại phải đưa giao dịch về Chờ xử lý");
assert(resetStatement.includes('transaction.invoiceNo = ""'), "Làm lại phải gỡ số phiếu đã mất");
assert(!resetStatement.includes("commit"), "Làm lại phiếu chưa đối soát không được ghi tồn kho");
assert(content.includes("MAX_SESSION_CANDIDATE_PROBES = 3"), "Batch Review phải giới hạn số phiếu mở để kiểm tra cho mỗi giao dịch");
assert(content.includes("SESSION_CANDIDATE_PROBE_TIMEOUT_MS = 5000"), "Mỗi lần đọc phiếu ứng viên phải có timeout ngắn để không làm treo cả Batch Review");
assert(content.includes("selectedCandidateLeftOpen"), "Phiếu ứng viên đã đọc phải được tái sử dụng, không đóng rồi mở lại");
assert(content.includes("buildBatchReview({ onlyTransactionId: String(transaction.id) })"), "Nút Tính toán lại chỉ được dựng lại giao dịch đang chọn");
const acceptRoundedGrand = content.slice(
  content.indexOf("async function acceptRoundedGrand"),
  content.indexOf("window.addEventListener(SAVE_BLOCKED")
);
assert(acceptRoundedGrand.includes("buildBatchReview({ onlyTransactionId: String(transaction.id) })"),
  "Chọn mức tổng gần nhất chỉ được tính lại giao dịch đang chọn");
assert(!acceptRoundedGrand.includes("await buildBatchReview();"),
  "Chọn mức tổng gần nhất không được tính lại toàn bộ Batch Review");
const resetRoundedGrand = content.slice(
  content.indexOf("async function resetRoundedGrand"),
  content.indexOf("async function recalculateAcceptedBatchPlan")
);
assert(resetRoundedGrand.includes("buildBatchReview({ onlyTransactionId: String(transaction.id) })"),
  "Xóa mức tổng điều chỉnh chỉ được tính lại giao dịch đang chọn");
assert(!resetRoundedGrand.includes("await buildBatchReview();"),
  "Xóa mức tổng điều chỉnh không được tính lại toàn bộ Batch Review");
assert(content.includes("Các phương án khác được giữ nguyên"), "UI phải xác nhận rõ tính lại một hóa đơn không ảnh hưởng cả Batch");
assert(content.includes('actual === expected'), "Batch Review must wait for the requested invoice, not a stale form");
assert(content.includes('class="it-save-new-api"'), "Phiếu mới đã Accept phải dùng nút chạy trọn flow API");
assert(content.includes('saveNewAcceptedBatchPlanViaApi'), "Thiếu handler tạo, lưu và đối soát phiếu mới");
assert(content.includes('bước này chưa phải là lưu thành công'), "Không được báo thành công ngay sau khi chỉ mở tab worker");
for (const id of [
  "it-home-dashboard", "it-workflow-progress", "it-home-back", "it-open-single", "it-sync-web",
  "it-manage-stock", "it-manage-mapping", "it-manage-statement", "it-manage-batch", "it-manage-einvoice",
  "it-import-web", "it-import-statement", "it-statement-import-button", "it-accounting-tenant",
  "it-accounting-from", "it-accounting-to", "it-accounting-refresh", "it-accounting-kpis", "it-accounting-queue"
]) {
  assert.equal((content.match(new RegExp(`id=\\"${id}\\"`, "g")) || []).length, 1, `${id} phải tồn tại đúng một lần`);
}
for (const fn of ["workflowSnapshot", "renderWorkflowDashboard", "showHomeDashboard", "applyPanelScreen",
  "accountingDashboardSnapshot", "renderAccountingDashboard", "refreshAccountingDashboard", "openAccountingDashboardAction"]) {
  assert(content.includes(`function ${fn}(`), `Thiếu ${fn}`);
}
assert(content.includes('const ignoredTransactions = transactions.filter'), "Dashboard phải tách giao dịch Bỏ qua khỏi số đã đối soát");
assert(content.includes('function openEInvoiceAdmin()'), "Thiếu bước mở màn phát hành hóa đơn trực tiếp");
assert(content.includes('function suggestedEInvoiceRange()'), "Phát hành phải kế thừa khoảng ngày của Batch Review");
assert(content.includes('await loadEInvoiceList();'), "Mở bước phát hành phải tự tải danh sách");
assert(content.includes('/5 bước đã sẵn sàng'), "Dashboard phải hiển thị đủ 5 bước kế toán");
for (const mode of ["home-mode", "single-mode", "stock-mode", "mapping-mode", "statement-mode", "batch-mode"]) {
  assert(content.includes(mode), `Thiếu mode ${mode}`);
}
assert(css.includes(".it-workflow-card"));
assert(css.includes("#it-panel.home-mode"));
assert(css.includes("#it-panel:not(.home-mode) .it-home-dashboard"));
assert(css.includes(".it-accounting-dashboard"), "Thiếu khung tổng quan kế toán");
assert(css.includes(".it-accounting-kpis"), "Thiếu giao diện KPI kế toán");
assert(css.includes(".it-accounting-queue"), "Thiếu hàng đợi công việc kế toán");
assert(content.includes("isInAccountingPeriod(item, period)"), "Dashboard phải lọc giao dịch theo kỳ");
assert(content.includes('data-action="${next.action}"'), "Mỗi lỗi phải có hành động tiếp theo");

console.log("Guided accounting UI tests passed");
