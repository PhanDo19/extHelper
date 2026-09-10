const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.24.2");
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

// Một việc tiếp theo, một nút: kế toán không phải tự đọc 5 thẻ rồi tự chọn.
assert(content.includes("function nextWorkflowAction("), "Thiếu hàm chọn việc tiếp theo");
assert(content.includes("function renderNextAction("), "Thiếu thanh Việc tiếp theo trên màn hình chính");
assert.equal((content.match(/id="it-next-action"/g) || []).length, 1, "it-next-action phải tồn tại đúng một lần");
const nextAction = content.slice(
  content.indexOf("function nextWorkflowAction("),
  content.indexOf("function renderNextAction(")
);
assert(nextAction.includes("state.blockers[0]"),
  "Việc tiếp theo phải lấy mục chưa đạt đầu tiên, đúng thứ tự quy trình");
assert(nextAction.includes("done: true"), "Khi hết việc phải báo đã hoàn tất thay vì gợi ý bước sai");
// Thứ tự các bước quyết định việc nào hiện ra trước; đảo thứ tự sẽ dẫn kế toán sai bước.
const checkKeys = content
  .slice(content.indexOf("function accountingCloseSnapshot("), content.indexOf("const NEXT_ACTION_LABELS"))
  .match(/key: "(\w+)"/g) || [];
assert.deepEqual(
  checkKeys.map(item => item.replace(/key: "|"/g, "")),
  ["catalog", "stock", "mapping", "statement", "reconciliation", "issuance"],
  "Thứ tự kiểm tra phải đúng luồng 5 bước để việc tiếp theo không nhảy cóc"
);
for (const key of ["catalog", "stock", "mapping", "statement", "reconciliation", "issuance"]) {
  assert(new RegExp(`${key}: \\{ button:`).test(content), `Thiếu nhãn nút cho bước ${key}`);
}
assert(/renderNextAction\([a-zA-Z]*\);/.test(content), "Thanh Việc tiếp theo phải được cập nhật theo trạng thái");
// Snapshot duyệt toàn bộ giao dịch trong kỳ; setStatus chạy trong vòng lặp lưu
// từng phiếu nên dải kiểm tra và thanh Việc tiếp theo phải dùng chung một lần tính.
assert(content.includes("renderAccountingCloseStatus(closeState);") && content.includes("renderNextAction(closeState);"),
  "Không được tính lại accountingCloseSnapshot cho mỗi khối trên dashboard");
// Việc chạy tại chỗ tự gọi setStatus, mà setStatus vẽ lại chính thanh này. Không
// chặn thì nút đang khóa bị xóa giữa chừng và bấm lại được nhiều lần.
const renderNext = content.slice(
  content.indexOf("function renderNextAction(snapshot)"),
  content.indexOf("function accountingStatusLabel(")
);
assert(renderNext.includes('querySelector("#it-next-action-go:disabled")'),
  "Đang chạy việc tại chỗ thì không được vẽ đè nút lên chính nó");
assert(renderNext.includes("syncLatestWebCatalog({ currentTarget: go })"),
  "Phải truyền đúng nút vừa bấm để khóa được nút đó, không phải nút ở thẻ bước 1");
const syncCatalog = content.slice(
  content.indexOf("async function syncLatestWebCatalog("),
  content.indexOf("function showHomeDashboard(")
);
assert(/finally \{[\s\S]*renderNextAction\(\);[\s\S]*\}/.test(syncCatalog),
  "Đồng bộ xong phải vẽ lại thanh Việc tiếp theo, nếu không nhãn Đang đồng bộ… sẽ kẹt lại");
assert(css.includes(".it-next-action"), "Thiếu giao diện thanh Việc tiếp theo");
assert(css.includes('.it-workflow-card[data-state="done"] .it-step-copy p { display: none; }'),
  "Bước đã xong phải thu gọn để phần cần làm nổi lên trước");

// Nối bước 4 → 5: lưu API xong là mời sang phát hành ngay trên dòng trạng thái.
assert(/function setStatus\(message, kind, next\)/.test(content),
  "setStatus phải nhận được hành động tiếp theo");
const setStatusFn = content.slice(
  content.indexOf("function setStatus(message, kind, next)"),
  content.indexOf("function priorityInventory(")
);
assert(setStatusFn.includes("createTextNode(message)"),
  "Thông báo chứa số phiếu và lỗi từ website nên phải chèn bằng text node, không innerHTML");
// Bỏ comment trước khi kiểm tra, tránh báo nhầm khi comment có nhắc tên thuộc tính.
assert(!setStatusFn.replace(/\/\/[^\n]*/g, "").includes("innerHTML"),
  "setStatus không được dựng thông báo bằng innerHTML");
const runBatchApi = content.slice(
  content.indexOf("async function runAcceptedBatchApi("),
  content.indexOf("async function confirmAlreadyIssued(")
);
assert(/action: "einvoice"/.test(runBatchApi),
  "Lưu API xong phải mời sang bước phát hành hóa đơn");
assert(!/openEInvoiceAdmin\(\)/.test(runBatchApi),
  "Phát hành hóa đơn không hoàn tác được nên không được tự chạy sau khi lưu API");
assert(css.includes(".it-status-next"), "Thiếu giao diện nút đi tiếp trên dòng trạng thái");
// Kỳ sao kê theo tháng: kế toán vẫn phải tự xem lại và sửa được khoảng ngày.
for (const id of ["it-einvoice-from-date", "it-einvoice-to-date", "it-batch-from-date", "it-batch-to-date"]) {
  assert.equal((content.match(new RegExp(`id=\\"${id}\\"`, "g")) || []).length, 1,
    `${id} phải giữ nguyên để kế toán xem xét kỳ sao kê`);
}

// Nối bước 5 → xuất hạch toán: phát hành xong là mời xuất file ngay tại chỗ.
const issueFlowEnd = content.slice(
  content.indexOf("async function issueSelectedEInvoices("),
  content.indexOf("function stockNameByWebCode(")
);
assert(issueFlowEnd.includes('action: "issued-export"'),
  "Phát hành xong phải mời xuất file hạch toán");
assert(issueFlowEnd.includes("const canExportIssued = succeeded > 0 && !missingItems && !failures.length"),
  "Chỉ mời xuất hạch toán khi đã phát hành được và không hóa đơn nào thiếu mặt hàng");
assert(!/exportIssuedInvoices\(\)/.test(issueFlowEnd),
  "Không được tự xuất file; kế toán phải chủ động bấm sau khi xem kết quả phát hành");
const dashboardAction = content.slice(
  content.indexOf("function openAccountingDashboardAction("),
  content.indexOf("function refreshAccountingDashboard(")
);
for (const [action, handler] of [
  ["issued-export", "exportIssuedInvoices"],
  ["export", "exportAccountingReport"]
]) {
  assert(new RegExp(`action === "${action}"\\) ${handler}\\(\\)`).test(dashboardAction),
    `Action ${action} phải gọi ${handler}`);
}
// Thanh Việc tiếp theo lúc hoàn tất phát ra data-action="export"; thiếu nhánh này
// thì nút chỉ chạy nhờ lối gọi riêng, bấm từ chỗ khác sẽ im lặng không làm gì.
assert(/data-action="export"/.test(content) && dashboardAction.includes('action === "export"'),
  "data-action phát ra trên UI phải có nhánh xử lý tương ứng");

// Panel kéo tay được, nên lưới bên trong phải đo bề rộng PANEL chứ không phải
// bề rộng cửa sổ. Hỏng chỗ này thì CSS vẫn chạy, chỉ layout sai khi thu nhỏ panel.
assert(/#it-panel \{[^}]*container: it-panel \/ inline-size/.test(css),
  "#it-panel phải là container để lưới bên trong bám bề rộng panel");
assert(!/#it-panel \{[^}]*min-width: 430px/.test(css),
  "min-width cứng 430px chặn panel hẹp lại; giới hạn dưới do enablePanelResize giữ");
const containerBlocks = css.match(/@container it-panel \(max-width: 700px\)/g) || [];
assert(containerBlocks.length >= 3, "Các lưới bên trong panel phải chuyển sang @container");
// Rule định nghĩa kích thước CHÍNH panel không thể tự đo mình bằng container query.
for (const block of css.split("@container it-panel").slice(1)) {
  const body = block.slice(0, block.indexOf("\n}"));
  assert(!/^\s*#it-panel\s*[,{]/m.test(body),
    "@container không được chứa selector đặt kích thước cho chính #it-panel");
}
const viewportBlock = css.slice(css.indexOf("@media (max-width: 700px) {"));
assert(/#it-panel[^}]*width: calc\(100vw - 16px\)/.test(viewportBlock),
  "Bề rộng panel khi cửa sổ hẹp vẫn phải theo viewport");
// Header mỏng lại ở màn hẹp nên mép dính của thanh công cụ phải đổi theo.
assert(/@media \(max-width: 700px\)[\s\S]*--it-header-offset: 46px/.test(css),
  "Màn hẹp header cao 46px (top:-12px + 58px), thanh dính phải dùng đúng số này");
// Bảng rộng phải cuộn trong khung riêng, nếu không sẽ đẩy phình chính container.
assert(/\.it-table-wrap \{[^}]*overflow: auto/.test(css),
  "Bảng rộng hơn panel phải cuộn trong .it-table-wrap");

// Menu chuyển bước: nhảy thẳng giữa các bước, không phải quay về màn hình chính.
assert.equal((content.match(/id="it-screen-tabs"/g) || []).length, 1, "Thiếu menu chuyển bước");
for (const screen of ["home", "stock", "mapping", "statement", "batch", "einvoice"]) {
  assert(new RegExp(`data-screen="${screen}"`).test(content), `Menu thiếu tab ${screen}`);
}
assert(content.includes("function markActiveScreenTab("), "Phải đánh dấu tab đang mở");
// Bước 5 là sub-tab của màn Giao dịch nên không có mode riêng.
const markTab = content.slice(
  content.indexOf("function markActiveScreenTab("),
  content.indexOf("async function syncLatestWebCatalog(")
);
assert(markTab.includes('statementSubtab === "einvoice"'),
  "Tab Phát hành phải sáng khi đang ở sub-tab phát hành");
assert(/markActiveScreenTab\("statement-mode"\)/.test(content),
  "Đổi sub-tab cũng phải cập nhật menu");
assert(css.includes(".it-screen-tabs"), "Thiếu giao diện menu chuyển bước");
// Thanh tab có flex-wrap nên chiều cao đổi theo bề rộng panel; hằng số CSS không
// đủ, phải đo thật rồi ghi vào biến mốc dính.
assert(content.includes("function syncTabsOffset("), "Thiếu hàm đo mốc dính của menu");
assert(/--it-tabs-offset/.test(css) && /setProperty\("--it-tabs-offset"/.test(content),
  "Mốc dính dưới menu phải được đo và ghi lại");
for (const sel of [".it-mapping-toolbar", ".it-batch-actions"]) {
  assert(new RegExp(`\\${sel} \\{[^}]*top: var\\(--it-tabs-offset\\)`).test(css),
    `${sel} phải dính dưới menu, không chồng lên menu`);
}
assert(/ResizeObserver/.test(content), "Panel đổi kích thước thì phải đo lại mốc dính");
// Giảm mật độ ở tab đầu: chi tiết gập lại, thiết lập kỳ đưa lên trên cùng.
assert(content.includes('id="it-workflow-steps"') && content.includes('id="it-accounting-details"'),
  "Phần chi tiết ở màn hình chính phải gập được để giảm mật độ");
assert(content.indexOf('class="it-period-bar"') < content.indexOf('id="it-next-action"'),
  "Thiết lập kỳ phải nằm trên cùng màn hình chính");
assert(!content.includes("it-welcome-card") && !css.includes(".it-welcome-card"),
  "Thẻ chào mừng đã gộp vào thanh kỳ; không để lại CSS mồ côi");
// Hàng sub-tab cũ trùng chức năng với menu chuyển bước nên đã bỏ.
assert(!content.includes('class="it-subtabs"') && !css.includes(".it-subtabs"),
  "Không để lại hàng sub-tab trùng menu, kể cả CSS mồ côi");
// Bước 3 và bước 5 dùng chung một section, nên tiêu đề panel phải tự đổi theo
// bước đang xem; nếu không, ở bước 5 vẫn đề "Bước 3 · Giao dịch ngân hàng".
const subtabFn = content.slice(
  content.indexOf("function showStatementSubtab(name)"),
  content.indexOf("function renderStatementRows(")
);
assert(subtabFn.includes("Bước 5 · Phát hành hóa đơn") && subtabFn.includes("Bước 3 · Giao dịch ngân hàng"),
  "Tiêu đề panel phải đổi theo bước đang xem");
assert(subtabFn.includes("markActiveScreenTab"), "Đổi bước phải cập nhật menu");
// Dòng bối cảnh gộp 4 dòng thành một hàng chip; chi tiết chuyển vào tooltip.
const stockSummary = content.slice(
  content.indexOf("function stockSummaryHtml()"),
  content.indexOf("const OPEN_STATEMENT_STATUSES")
);
assert(!/<br>/.test(stockSummary), "Dòng bối cảnh phải gộp một hàng, không xuống dòng bằng <br>");
assert(/title="\$\{escapeHtml\(chip\.title\)\}"/.test(stockSummary),
  "Chi tiết đầy đủ phải nằm ở tooltip và được escape");
// Nhãn cơ sở và nguồn kho là chuỗi tự do nên bắt buộc escape trước khi nội suy.
for (const value of ["pageTenantLabel", "warehouseSource"]) {
  assert(new RegExp(`escapeHtml\\(${value}\\)`).test(stockSummary),
    `${value} phải qua escapeHtml`);
}
assert(css.includes(".it-stock-source span"), "Thiếu giao diện chip cho dòng bối cảnh");

console.log("Guided accounting UI tests passed");
