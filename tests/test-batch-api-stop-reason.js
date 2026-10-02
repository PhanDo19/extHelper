// Lưu API dừng vì đối soát sau lưu thất bại phải nêu LÝ DO. Kim Giang 02/10/2026:
// "Batch API đã dừng sau 3/8 phiếu: Đã gửi API nhưng chưa đối soát được
// HD0126070309; tồn kho và sao kê chưa bị thay đổi." — lý do thật do
// verifyBatchSavedInvoice trả về đã bị thông báo dừng lô ghi đè mất.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
function fn(name) {
  let start = source.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}

const box = {};
vm.createContext(box);
vm.runInContext(`${fn("verificationFailureText")}; this.text = verificationFailureText;`, box);
assert.strictEqual(box.text({ error: "Tồn kho 1100027 chỉ còn 1, không thể ghi sổ 3." }),
  "Tồn kho 1100027 chỉ còn 1, không thể ghi sổ 3.");
assert.strictEqual(box.text({ error: "Kho chung TIGER không đủ để trừ 2" }), "Kho chung TIGER không đủ để trừ 2.");
assert.strictEqual(box.text({ error: "transaction-not-done" }), "sổ đối soát chưa ghi nhận phiếu.");
assert.strictEqual(box.text({ error: "no-pending-invoice" }), "dòng này không còn phiếu chờ đối soát.");
assert.strictEqual(box.text(null), "không rõ lỗi.");

const save = fn("saveBatchEntryViaApi");
assert(save.includes("chưa đối soát được ${plan.invoiceNo}: ${verificationFailureText(verification)}"),
  "Thông báo dừng lô phải kèm lý do đối soát thất bại");
assert(save.includes("Đối soát sau lưu"), "Phải chỉ cách xử lý tiếp: đối soát lại, không Lưu API lại");

console.log("lý do dừng Lưu API khi đối soát thất bại: OK");

// --- Bộ lọc Batch Review: biết ngay giao dịch nào đang lỗi -------------------------
{
  const filterBox = {};
  vm.createContext(filterBox);
  const constants = source.match(/const BATCH_FILTERS = \[[\s\S]*?\];\n  const BATCH_NORMAL_STATUSES = [^;]+;/)[0];
  vm.runInContext(`${constants}\n${fn("batchEntryError")}\n${fn("batchEntryMatchesFilter")}\n` +
    "this.match = batchEntryMatchesFilter; this.error = batchEntryError; this.filters = BATCH_FILTERS;", filterBox);
  const entries = [
    { id: "ok", status: "ready" },
    { id: "loi", status: "error" },
    { id: "do", status: "lookup_error" },
    { id: "chon", status: "needs_choice" },
    // Đã lưu nhưng đối soát thất bại: trạng thái vẫn "planned" nhưng là lỗi.
    { id: "doisoat", status: "planned", lastError: "Tồn kho 1100027 chỉ còn 1", lastErrorStatus: "planned" },
    { id: "cho", status: "planned" },
    // Lỗi cũ lúc còn batch_ready, nay đã xử lý xong: không còn là lỗi.
    { id: "xong", status: "done", lastError: "Trang không phản hồi sau 90s", lastErrorStatus: "batch_ready" },
    { id: "hd", status: "already_issued" }
  ];
  const ids = filter => entries.filter(entry => filterBox.match(entry, filter)).map(entry => entry.id);
  assert.deepStrictEqual(ids("issues"), ["loi", "do", "chon", "doisoat"]);
  assert.deepStrictEqual(ids("planned"), ["doisoat", "cho"]);
  assert.deepStrictEqual(ids("matched"), ["xong", "hd"]);
  assert.deepStrictEqual(ids("all"), entries.map(entry => entry.id));
  assert.strictEqual(filterBox.error(entries[4]), "Tồn kho 1100027 chỉ còn 1");
  assert.strictEqual(filterBox.error(entries[6]), "", "Lỗi cũ hết hiệu lực khi trạng thái đã đổi");
  assert(filterBox.filters.some(filter => filter.value === "issues"));

  const render = fn("renderBatchPlans");
  assert(render.includes('if (!batchEntryMatchesFilter(entry, batchStatusFilter)) return "";'),
    "Lọc khi dựng từng dòng để data-index vẫn là chỉ số trong batchPlans");
  assert(render.includes('batchEntryMatchesFilter(item, "issues")'), "Ô KPI Cần xử lý phải đếm cùng cách với bộ lọc");
  assert(render.includes('id="it-batch-filter"') && render.includes("batchStatusFilter = event.target.value"));
  const runAll = fn("runAcceptedBatchApi");
  const noteAt = runAll.indexOf("await noteBatchEntryError(currentIndex, error)");
  assert(noteAt > 0 && noteAt < runAll.indexOf("scheduleAutoReloadResume(\"batch-api\", error.message)"),
    "Lưu API lỗi phải ghi lỗi lên dòng đang xử lý, trước khi tự tải lại trang");
  assert(fn("saveAcceptedBatchPlanViaApi").includes("await noteBatchEntryError(index, error)"));
  assert(fn("verifyBatchSavedInvoice").includes("await noteBatchEntryError(index, error)"));
  console.log("bộ lọc Batch Review theo trạng thái lỗi: OK");
}
