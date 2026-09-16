// Tự tải lại trang khi website quá tải rồi chạy tiếp lô. Lỗi quá tải thật ghi
// nhận ở Nhơn (16/09/2026): "Rất tiếc, không thể xử lý, chi tiết: Uncaught
// Error: Cannot call method 'value' of kendoDropDownList before it is
// initialized" từ kendo.all.min.js sau khi chạy lô nhiều ngày.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function extractFunction(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

const box = {};
vm.createContext(box);
vm.runInContext(`${extractFunction("isPageOverloadError")}; this.isPageOverloadError = isPageOverloadError;`, box);

for (const message of [
  "Rất tiếc, không thể xử lý, chi tiết: Uncaught Error: Cannot call method 'value' of kendoDropDownList before it is initialized url: http://banhang.thuanvietsoft.com/Scripts/kendo.all.min.js?v=20241109092008 Line Number: 2396",
  "Danh sách phiếu chưa tải xong. Hãy thử lại.",
  "Danh sách phiếu chưa khởi tạo xong bộ lọc Kendo; hãy thử lại sau vài giây.",
  "Trang không phản hồi sau 30s (findInvoiceCandidates).",
  "Không mở/đọc được các phiếu ứng viên 01000000150; Trang không phản hồi sau 45s (readInvoiceItems).",
  "Website quá tải: Danh sách phiếu chưa tải xong. Hãy thử lại."
]) {
  assert(box.isPageOverloadError(new Error(message)), `Phải nhận diện là quá tải: ${message}`);
}
for (const message of [
  "Sai tiền giờ: form 258.000 ≠ phương án 264.000.",
  "Không tìm thấy phiếu chưa xuất 01000000260 trong danh sách ngày 2026-07-01 để đọc lại từ website.",
  "Tồn kho 0000045 chỉ còn 2, không thể ghi sổ 3.",
  "Phien dang nhap da het hoac bi co so khac chiem."
]) {
  assert(!box.isPageOverloadError(new Error(message)), `Không được coi là quá tải: ${message}`);
}

// --- Bất biến nguồn ------------------------------------------------------------
const runSource = extractFunction("runAcceptedBatchApi");
assert(runSource.includes('await scheduleAutoReloadResume("batch-api", error.message)'),
  "Lưu API gặp lỗi quá tải phải tải lại trang rồi chạy tiếp.");
assert(runSource.includes("savedSinceReload >= AUTO_RELOAD_EVERY_SAVED_INVOICES") && runSource.includes("{ planned: true }"),
  "Lưu API phải tự tải lại chủ động sau một số phiếu.");
assert(runSource.includes("autoResumeAttempts: 0"), "Lô xong phải reset số lần tải lại.");
assert(runSource.indexOf("isPageOverloadError(error)") < runSource.indexOf("Batch API đã dừng sau"),
  "Phải thử tải lại trước khi báo lô dừng.");

const reviewSource = extractFunction("buildBatchReview");
assert(reviewSource.includes('await scheduleAutoReloadResume("batch-review", error.message)'),
  "Batch Review gặp lỗi quá tải phải tải lại trang rồi tính lại.");
assert(reviewSource.includes("consecutiveOverloadEntries >= 3 && !onlyTransactionId") &&
  reviewSource.includes("throw new Error(`Website quá tải: ${previousEntry.reason}`)"),
  "Ba dòng lỗi quá tải liên tiếp phải dừng lô thay vì chạy hết với toàn lỗi.");

const scheduleSource = extractFunction("scheduleAutoReloadResume");
assert(scheduleSource.includes("attempts > AUTO_RELOAD_MAX_ATTEMPTS) return false"), "Phải giới hạn số lần tải lại vì lỗi.");
assert(scheduleSource.includes("location.reload()"), "Phải tải lại trang thật.");
assert(scheduleSource.indexOf("await saveBatchUiSession(") < scheduleSource.indexOf("location.reload()"),
  "Cờ tiếp tục phải được ghi vào storage TRƯỚC khi tải lại.");

const continueSource = extractFunction("continueAfterAutoReload");
assert(continueSource.indexOf("await ensureInvoiceListScreen(") < continueSource.indexOf("runAcceptedBatchApi("),
  "Phải chờ danh sách Bán hàng dựng xong rồi mới chạy tiếp.");
assert(continueSource.includes("await buildBatchReview()"), "Batch Review phải được tính lại sau khi tải lại.");

const restoreSource = extractFunction("restoreUiSession");
assert(restoreSource.includes("void continueAfterAutoReload(resume)"), "Khôi phục phiên phải chạy tiếp theo cờ.");
assert(restoreSource.indexOf("await saveBatchUiSession(") < restoreSource.indexOf("void continueAfterAutoReload(resume)") ||
  restoreSource.lastIndexOf("await saveBatchUiSession(") < restoreSource.indexOf("void continueAfterAutoReload(resume)"),
  "Cờ phải được xóa TRƯỚC khi chạy tiếp để không lặp vô hạn.");
assert(restoreSource.includes("AUTO_RESUME_MAX_AGE_MS"), "Cờ cũ quá hạn không được tự chạy.");

const sessionSource = extractFunction("saveBatchUiSession");
assert(sessionSource.includes("autoResume: null") && sessionSource.includes("autoResumeAttempts: Number(uiSession?.autoResumeAttempts) || 0"),
  "Mỗi lần lưu phiên phải xóa cờ tiếp tục nhưng giữ số lần đã tải lại.");

// --- Context mồ côi ("Extension context invalidated") -----------------------------
// Chrome ném lỗi này khi extension vừa Reload/cập nhật mà tab còn content script
// cũ. Dòng trạng thái phải đổi thành hướng dẫn F5 kèm nút tải lại, và Batch
// Review/Lưu API phải chặn ngay từ đầu thay vì chạy hết lô rồi mới vỡ ở bước lưu.
const runtimeBox = { globalThis: {} };
vm.createContext(runtimeBox);
vm.runInContext(
  `${extractFunction("runtimeContextAlive")}; ${extractFunction("isInvalidRuntimeContext")}; ` +
  "this.isInvalidRuntimeContext = isInvalidRuntimeContext;",
  runtimeBox
);
assert(runtimeBox.isInvalidRuntimeContext("Extension context invalidated."), "Chuỗi lỗi của Chrome phải được nhận diện.");
assert(runtimeBox.isInvalidRuntimeContext(new Error("Extension context invalidated.")), "Error của Chrome phải được nhận diện.");
assert(!runtimeBox.isInvalidRuntimeContext("Danh sách phiếu chưa tải xong. Hãy thử lại."), "Lỗi quá tải không phải context mồ côi.");

const statusSource = extractFunction("setStatus");
assert(statusSource.includes("isInvalidRuntimeContext(message)") && statusSource.includes('action: "reload"'),
  "setStatus phải đổi lỗi context mồ côi thành hướng dẫn F5 kèm nút tải lại.");
assert(statusSource.includes("message === RUNTIME_REFRESH_MESSAGE"), "Hướng dẫn F5 tự ném ra cũng phải có nút tải lại.");
const dashboardActionSource = extractFunction("openAccountingDashboardAction");
assert(dashboardActionSource.includes('if (action === "reload") { location.reload(); return; }'),
  "Nút tải lại phải gọi location.reload() ngay, không đi qua chrome.*.");
const reviewHead = extractFunction("buildBatchReview");
assert(reviewHead.indexOf("assertRuntimeContext();") > 0 && reviewHead.indexOf("assertRuntimeContext();") < reviewHead.indexOf('await request("scan")'),
  "Batch Review phải kiểm tra context còn sống trước khi làm việc.");
const runHead = extractFunction("runAcceptedBatchApi");
assert(runHead.indexOf("assertRuntimeContext();") > 0 && runHead.indexOf("assertRuntimeContext();") < runHead.indexOf("for (const index of indexes)"),
  "Lưu API phải kiểm tra context còn sống trước vòng lặp.");

console.log("auto reload and resume: OK");
