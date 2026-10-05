"use strict";

// Lưu API phiếu CÓ SẴN gặp lỗi mạng ("Failed to fetch") hoặc hết giờ: server có
// thể đã lưu, chỉ phản hồi rớt (đã thấy với phiếu mới 01000000781, Paris Nhơn
// 04/10/2026). Trước đây cả lô dừng ngay. Nay đọc lại để đối soát: khớp phương án
// thì đi tiếp; không khớp thì về Đã Accept (lưu lại cùng phương án là an toàn).
// Lỗi nghiệp vụ thường (server từ chối) vẫn dừng như cũ, không đối soát.

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

function makeBox({ saveError = null, serverSaved = true }) {
  const plan = { invoiceNo: "HD0126080003", items: [{ code: "0000004", qty: 2, price: 60000 }], grand: 429000, goods: 130000, hour: 260000, tax: 39000 };
  const transaction = { id: "t1", status: "batch_ready", credit: 429000, transactionDate: "2026-08-01", batchApprovedPlan: { ...plan } };
  const calls = { requests: [], verify: 0 };
  const box = {
    calls,
    statementDataset: { transactions: [transaction] },
    batchPlans: [{ transactionId: "t1", status: "batch_ready", plan: { ...plan } }],
    pageTenantSlug: "parisnhon",
    document: { getElementById: () => null },
    setTimeout: callback => { callback(); return 0; },
    assertRuntimeContext: () => {},
    batchButtonProxy: () => ({}),
    setStatus: () => {},
    saveBatchUiSession: async () => {},
    InvoiceMappingStore: { saveStatement: async () => {} },
    openAcceptedInvoiceForApi: async () => ({ applied: true, plan: { ...plan } }),
    request: async action => {
      calls.requests.push(action);
      if (action === "saveExistingInvoicePlanViaApi") {
        if (saveError) throw new Error(saveError);
        return { saved: true, savedRecordId: "rec-1", httpStatus: 200 };
      }
      if (action === "closeInvoiceDetail") return { closed: true };
      if (action === "getInvoiceUiState") return { detailVisible: false, listVisible: false };
      throw new Error(`Không mong đợi ${action}`);
    },
    // Đối soát sau lưu giả: đọc lại thấy phiếu theo phương án (server đã lưu) hay không.
    verifyBatchSavedInvoice: async () => {
      calls.verify += 1;
      const current = box.statementDataset.transactions[0];
      if (serverSaved) {
        current.status = "done";
        box.batchPlans[0].status = "done";
        return { verified: true, closed: true };
      }
      return { verified: false, closed: true, error: "Tiền hàng trên website 0 khác phương án 130000." };
    }
  };
  vm.createContext(box);
  vm.runInContext([
    "var statementDataset = this.statementDataset; var batchPlans = this.batchPlans;",
    "function findStatementTransaction(id) { return (statementDataset.transactions || []).find(item => String(item.id) === String(id)); }",
    fn("verificationFailureText"),
    fn("isUncertainSaveError"),
    "const GRAND_OVERRIDE_MAX_DIFF = 100; const formatMoney = value => String(value);",
    fn("planGrandMismatchError"),
    fn("saveBatchEntryViaApi"),
    "this.save = saveBatchEntryViaApi; this.isUncertain = isUncertainSaveError;",
    "this.state = () => ({ transaction: statementDataset.transactions[0], entry: batchPlans[0] });"
  ].join("\n"), box);
  return box;
}

(async () => {
  const probe = makeBox({});
  for (const message of ["Failed to fetch", "TypeError: NetworkError when attempting to fetch resource.", "network error",
    "Mất kết nối tới website (Failed to fetch) sau 3 lần thử; kiểm tra mạng rồi bấm lại.",
    "Trang không phản hồi sau 90s (saveExistingInvoicePlanViaApi)."]) {
    assert(probe.isUncertain(new Error(message)), `"${message}" là lỗi chưa rõ đã lưu hay chưa`);
  }
  for (const message of ["HÓA ĐƠN ĐÃ THAY ĐỔI VUI LÒNG THỰC HIỆN LẠI", "Website tu choi DoSave (HTTP 500).",
    "Phieu hien tai khong co dong hang mau de tao request API."]) {
    assert(!probe.isUncertain(new Error(message)), `"${message}" là lỗi chắc chắn, không được coi là đã lưu`);
  }

  // 1. Mất phản hồi nhưng server đã lưu: đối soát khớp, lô đi tiếp.
  const savedAnyway = makeBox({ saveError: "Failed to fetch", serverSaved: true });
  const result = await savedAnyway.save(0, null);
  assert.strictEqual(result.invoiceNo, "HD0126080003");
  assert.strictEqual(savedAnyway.calls.verify, 1, "Phải đọc lại để đối soát");
  assert.strictEqual(savedAnyway.calls.requests.filter(action => action === "saveExistingInvoicePlanViaApi").length, 1,
    "Không tự gửi lại lệnh lưu");
  assert.strictEqual(savedAnyway.state().transaction.status, "done");

  // 2. Mất phản hồi và server chưa lưu: về Đã Accept, không trừ kho, nêu cách chạy lại.
  const notSaved = makeBox({ saveError: "Failed to fetch", serverSaved: false });
  await assert.rejects(notSaved.save(0, null),
    /Mất phản hồi khi lưu HD0126080003 \(Failed to fetch\)[\s\S]*Tiền hàng trên website 0[\s\S]*về Đã Accept, bấm Lưu API/);
  assert.strictEqual(notSaved.state().transaction.status, "batch_ready");
  assert.strictEqual(notSaved.state().transaction.pendingPlan, undefined, "Không để lại phiếu chờ đối soát giả");
  assert.strictEqual(notSaved.state().entry.status, "batch_ready");

  // 3. Server từ chối rõ ràng: dừng ngay như cũ, không đối soát.
  const rejected = makeBox({ saveError: "HÓA ĐƠN ĐÃ THAY ĐỔI VUI LÒNG THỰC HIỆN LẠI" });
  await assert.rejects(rejected.save(0, null), /HÓA ĐƠN ĐÃ THAY ĐỔI/);
  assert.strictEqual(rejected.calls.verify, 0);
  assert.strictEqual(rejected.state().transaction.status, "batch_ready");

  // 4. Lưu bình thường: không đổi hành vi.
  const normal = makeBox({});
  await normal.save(0, null);
  assert.strictEqual(normal.calls.verify, 1);
  assert.strictEqual(normal.state().transaction.status, "done");

  // 5. Lô Lưu API tự tải lại rồi chạy tiếp khi rớt mạng, nhưng KHÔNG vì chặn chống
  // trùng phiếu hay mất đăng nhập (tải lại không gỡ được, chỉ lặp vô ích).
  const reloadBox = {};
  vm.createContext(reloadBox);
  vm.runInContext(`${fn("isPageOverloadError")}\n${fn("isBatchApiReloadable")}\nthis.reloadable = isBatchApiReloadable;`, reloadBox);
  for (const message of ["Failed to fetch", "Mất kết nối tới website (Failed to fetch) sau 3 lần thử; kiểm tra mạng rồi bấm lại.",
    "Mất phản hồi khi lưu HD0126080003 (Failed to fetch) và đọc lại chưa thấy phiếu theo phương án",
    "Danh sách phiếu chưa tải xong. Hãy thử lại.", "Trang không phản hồi sau 90s (saveExistingInvoicePlanViaApi)."]) {
    assert(reloadBox.reloadable(new Error(message)), `"${message}" phải được tải lại rồi chạy tiếp`);
  }
  for (const message of [
    "Giao dịch 2026-08-06 · 491.700đ đã có lần gửi API tạo phiếu lúc … Lỗi lần trước: Da tao phien 01000000781 (ID …) nhung buoc thanh toan loi: Failed to fetch Không tạo lại để tránh trùng phiếu.",
    "Phien dang nhap da het hoac bi co so khac chiem khi luu phieu.",
    "Không còn phòng hát trống phù hợp để tạo phiếu mới (không dùng quầy BÁN LẺ)",
    "HÓA ĐƠN ĐÃ THAY ĐỔI VUI LÒNG THỰC HIỆN LẠI"]) {
    assert(!reloadBox.reloadable(new Error(message)), `"${message.slice(0, 60)}…" không được tải lại`);
  }
  assert(fn("runAcceptedBatchApi").includes('isBatchApiReloadable(error) && await scheduleAutoReloadResume("batch-api", error.message)'));

  console.log("Lưu API phiếu có sẵn mất phản hồi: đọc lại thay vì dừng lô: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
