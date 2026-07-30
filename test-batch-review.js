const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("content.js", "utf8");

function extractFunction(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

const sandbox = { structuredClone };
vm.createContext(sandbox);
vm.runInContext(
  `${extractFunction("reserveBatchStock")}; ${extractFunction("reserveOutstandingBatchStock")}; ` +
  "this.reserveBatchStock = reserveBatchStock; this.reserveOutstandingBatchStock = reserveOutstandingBatchStock;",
  sandbox
);
vm.runInContext(
  `${extractFunction("serializeBatchPlans")}; ${extractFunction("reconcileBatchPlanStatus")}; ${extractFunction("hydrateBatchPlans")}; ` +
  "this.serializeBatchPlans = serializeBatchPlans; this.hydrateBatchPlans = hydrateBatchPlans;",
  sandbox
);
vm.runInContext(
  `${extractFunction("normalizeRoomText")}; ${extractFunction("isIdleRoomLabel")}; ` +
  "this.isIdleRoomLabel = isIdleRoomLabel;",
  sandbox
);
vm.runInContext(
  `${extractFunction("selectClosestInvoiceCandidate")}; ` +
  "this.selectClosestInvoiceCandidate = selectClosestInvoiceCandidate;",
  sandbox
);
vm.runInContext(
  `${extractFunction("selectBatchReviewTransactions")}; ` +
  "this.selectBatchReviewTransactions = selectBatchReviewTransactions;",
  sandbox
);
vm.runInContext(
  `${extractFunction("pendingPlanFromApproved")}; ` +
  "this.pendingPlanFromApproved = pendingPlanFromApproved;",
  sandbox
);

const inventory = [
  { webCode: "A", availableQty: 10, availabilityMode: "stock" },
  { webCode: "B", availableQty: 1, availabilityMode: "per_invoice" }
];

const afterFirst = sandbox.reserveBatchStock(inventory, [
  { code: "A", qty: 4 },
  { code: "B", qty: 1 }
]);
const afterSecond = sandbox.reserveBatchStock(afterFirst, [{ code: "A", qty: 3 }]);

if (inventory[0].availableQty !== 10) throw new Error("Hàm đã làm thay đổi tồn gốc.");
if (afterFirst[0].availableQty !== 6) throw new Error("Không giữ chỗ tồn cho hóa đơn đầu.");
if (afterSecond[0].availableQty !== 3) throw new Error("Không trừ tồn cộng dồn cho hóa đơn sau.");
if (afterSecond[1].availableQty !== 1) throw new Error("Mặt hàng per_invoice không được trừ cộng dồn.");

const afterOutstanding = sandbox.reserveOutstandingBatchStock(inventory, [
  { id: "outside", status: "batch_ready", batchApprovedPlan: { items: [{ code: "A", qty: 6 }] } },
  { id: "selected", status: "planned", pendingPlan: { items: [{ code: "A", qty: 3 }] } },
  { id: "done", status: "done", batchApprovedPlan: { items: [{ code: "A", qty: 9 }] } }
], ["selected"]);
if (afterOutstanding[0].availableQty !== 4) {
  throw new Error("Batch Review must reserve accepted plans outside the current date range.");
}

console.log("batch review stock reservation: OK");

const filteredTransactions = sandbox.selectBatchReviewTransactions([
  { id: "old", status: "pending", transactionDate: "2026-06-28" },
  { id: "open", status: "pending", transactionDate: "2026-06-29" },
  { id: "done", status: "done", transactionDate: "2026-06-30" },
  { id: "skipped", status: "skipped", transactionDate: "2026-06-30" },
  { id: "future", status: "review", transactionDate: "2026-07-01" }
], { fromDate: "2026-06-29", toDate: "2026-06-30", limit: 10 });
if (filteredTransactions.map(item => item.id).join(",") !== "open,done") {
  throw new Error("Batch Review phải lọc đúng khoảng ngày và hiển thị giao dịch đã xử lý.");
}

const normalizedAcceptedPlan = sandbox.pendingPlanFromApproved({
  invoiceNo: "HD01",
  invoiceDateKey: "2026-06-01",
  targetGrand: 1360000,
  goods: 625000,
  hour: 611364,
  tax: 123636,
  taxRate: 10,
  items: [{ code: 1000007, qty: 3, price: 55000 }]
}, { invoiceNo: "HD01", transactionDate: "2026-06-01", credit: 1360000 }, {
  invoiceNo: "HD01",
  invoiceDateKey: "2026-06-01"
});
if (normalizedAcceptedPlan.grand !== 1360000 ||
    normalizedAcceptedPlan.items[0].code !== "1000007" ||
    normalizedAcceptedPlan.items[0].qty !== 3) {
  throw new Error("Phương án Batch đã Accept phải được chuẩn hóa để đối soát sau lưu.");
}

const originalTransaction = { id: "persist-1", status: "pending", credit: 2500000 };
const serializedPlans = sandbox.serializeBatchPlans([{
  transactionId: "persist-1",
  status: "needs_new_invoice",
  transaction: originalTransaction,
  reason: "Cần tạo phiếu"
}]);
if ("transaction" in serializedPlans[0]) throw new Error("Không được lưu bản sao transaction bên trong phiên UI.");
const refreshedTransaction = { ...originalTransaction, status: "review" };
const hydratedPlans = sandbox.hydrateBatchPlans(serializedPlans, [refreshedTransaction]);
if (hydratedPlans.length !== 1 || hydratedPlans[0].transaction.status !== "review") {
  throw new Error("Phiên UI phải liên kết lại với transaction mới nhất sau khi chuyển trang.");
}
if (!sandbox.isIdleRoomLabel("VIP 301", "VIP 301")) throw new Error("Phòng chỉ có tên phải được nhận diện là rảnh.");
if (sandbox.isIdleRoomLabel("VIP 301", "VIP 301 1h 05'")) throw new Error("Phòng có thời lượng không được nhận diện là rảnh.");
if (sandbox.isIdleRoomLabel("BÁN LẺ", "BÁN LẺ")) throw new Error("BÁN LẺ không được dùng cho hóa đơn có tiền giờ.");

// Ca thực tế lệch 91 đồng: bù trực tiếp vào Tiền giờ, không giảm giá/VAT.
const closest = sandbox.selectClosestInvoiceCandidate([
  { invoiceNo: "HD003", grandTotal: 3011800 },
  { invoiceNo: "HD001", grandTotal: 2508000 },
  { invoiceNo: "HD002", grandTotal: 2532200 }
], 2500000);
if (closest.invoiceNo !== "HD001") throw new Error("Batch Review must select the invoice closest to the bank amount.");
const tie = sandbox.selectClosestInvoiceCandidate([
  { invoiceNo: "HD010", grandTotal: 2490000 },
  { invoiceNo: "HD002", grandTotal: 2510000 }
], 2500000);
if (tie.invoiceNo !== "HD002") throw new Error("Equal distances must use invoice number as a stable tie-breaker.");

const solver = require("./solver.js");
const planBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [],
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  buildBatchCandidates: () => [
    { code: "A", name: "Phương án hàng", price: 1555000, qty: 0, maxQty: 1 }
  ],
  formatMoney: value => String(Number(value) || 0),
  recommendCheckOut: () => "30/06/2026 15:00"
};
vm.createContext(planBox);
vm.runInContext(`${extractFunction("calculateBatchPlan")}; this.calculateBatchPlan = calculateBatchPlan;`, planBox);
const residualPlan = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD0126060331",
  invoiceDateKey: "2026-06-30",
  currentHour: 612000,
  currentGrand: 1734700,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 2377000
}, []);
if (residualPlan.status !== "ready") throw new Error(`Ca lệch 91 đồng phải sẵn sàng: ${residualPlan.reason || ""}`);
if (residualPlan.hour !== 605909) throw new Error("Phần lệch 91 đồng phải được bù vào Tiền giờ.");
if (residualPlan.hourFromTime !== 606000 || residualPlan.hourAdjustment !== -91) throw new Error("Sai chi tiết bù chênh Tiền giờ.");
if (residualPlan.tax !== 216091 || residualPlan.difference !== 0) throw new Error("VAT/tổng dự kiến không khớp sao kê.");

vm.runInContext(
  `${extractFunction("parseUiDateTime")}; ${extractFunction("formatUiDateTime")}; ` +
  `${extractFunction("newInvoicePlanningScan")}; ${extractFunction("calculateNewInvoiceBatchPlan")}; ` +
  "this.calculateNewInvoiceBatchPlan = calculateNewInvoiceBatchPlan;",
  planBox
);
const newInvoicePlan = planBox.calculateNewInvoiceBatchPlan({
  transactionDate: "2026-06-30",
  credit: 2377000
}, []);
if (newInvoicePlan.status !== "ready" || !newInvoicePlan.requiresNewInvoice) {
  throw new Error(`New-invoice Batch Review plan must be ready: ${newInvoicePlan.reason || ""}`);
}
if (newInvoicePlan.targetGrand !== 2377000 || newInvoicePlan.checkIn !== "30/06/2026 15:00" || !newInvoicePlan.checkOut) {
  throw new Error("New-invoice plan must preserve the bank amount/date and provide check-in/out times.");
}

const hourOnlyPlan = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-SMALL",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 12152
}, []);
if (hourOnlyPlan.status !== "error" || !hourOnlyPlan.reason.includes("chỉ có Tiền giờ")) {
  throw new Error("Phương án không có mặt hàng phải báo đúng nguyên nhân.");
}

const ruleBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [
    { id: "fruit", code: "TCTO", webCode: "1500007", mode: "rotate", minTotal: 1000000, priority: 1, minQty: 1, maxQty: 1, enabled: true },
    { id: "beer", code: "BIA", webCode: "1100019", mode: "required", minTotal: 1000000, priority: 2, minQty: 1, maxQty: 4, enabled: true }
  ]
};
vm.createContext(ruleBox);
vm.runInContext(
  `${extractFunction("candidateFromStock")}; ${extractFunction("stableDiversityRank")}; ${extractFunction("buildBatchCandidates")}; ` +
  "this.buildBatchCandidates = buildBatchCandidates;",
  ruleBox
);
const realisticRuleCandidates = ruleBox.buildBatchCandidates([
  { webCode: "1500007", webName: "Hoa quả to", webUnit: "đĩa", webPrice: 400000, availableQty: 1 },
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 55000, availableQty: 20 },
  { webCode: "1000004", webName: "Bò khô", webUnit: "gói", webPrice: 90000, availableQty: 10 }
], 1500000, { id: "tx-rule", transactionDate: "2026-06-30", credit: 1500000 }, new Map());
const fruitCandidate = realisticRuleCandidates.find(item => item.code === "1500007");
const beerCandidate = realisticRuleCandidates.find(item => item.code === "1100019");
if (fruitCandidate?.minQty !== 1 || fruitCandidate?.maxQty !== 1) {
  throw new Error("Rule luân phiên ưu tiên cao nhất phải giữ đúng một đĩa hoa quả.");
}
if (beerCandidate?.minQty !== 1 || beerCandidate?.maxQty !== 4) {
  throw new Error("Rule bia bắt buộc phải giới hạn từ một đến bốn chai.");
}

// --- Nhánh already_issued / needs_new_invoice trong buildBatchReview ---

async function runBuildBatchReview({ transactions, issuedMatches, issuedThrows, invoiceCandidates }) {
  const calls = [];
  const box = {
    structuredClone,
    console,
    setTimeout,
    statementDataset: { transactions },
    batchPlans: [],
    inventory: [],
    pendingNewInvoice: null,
    formatMoney: value => String(Number(value) || 0),
    // Không có phiếu chưa xuất nào -> ép vào nhánh fallback mới.
    request: async (action, payload) => {
      calls.push({ action, payload });
      if (action === "scan") return { ready: false };
      if (action === "findInvoiceCandidates") return { candidates: invoiceCandidates || [] };
      if (action === "openInvoiceCandidate" || action === "closeInvoiceDetail") return {};
      if (action === "findIssuedInvoiceByAmount") {
        if (issuedThrows) throw new Error("Danh sách phiếu chưa tải xong. Hãy thử lại.");
        return { matches: issuedMatches || [] };
      }
      throw new Error(`Hành động không mong đợi: ${action}`);
    },
    document: { getElementById: () => null },
    renderBatchPlans: () => {},
    saveBatchUiSession: async () => {},
    setStatus: (message, kind) => { box.lastStatus = { message, kind }; },
    reserveBatchStock: sandbox.reserveBatchStock,
    reserveOutstandingBatchStock: sandbox.reserveOutstandingBatchStock,
    addPlanProductUsage: (usage, items) => {
      for (const item of items || []) {
        if (Number(item.qty ?? item.newQty) <= 0) continue;
        const code = String(item.code || "");
        if (code) usage.set(code, (usage.get(code) || 0) + 1);
      }
      return usage;
    },
    selectClosestInvoiceCandidate: sandbox.selectClosestInvoiceCandidate,
    selectBatchReviewTransactions: sandbox.selectBatchReviewTransactions,
    calculateBatchPlan: scan => ({ status: "ready", invoiceNo: scan.invoiceNo, items: [], targetGrand: 1500000 }),
    calculateNewInvoiceBatchPlan: transaction => ({
      status: "ready",
      invoiceNo: "",
      invoiceDateKey: transaction.transactionDate,
      targetGrand: transaction.credit,
      goods: 900000,
      hour: 463636,
      tax: 136364,
      taxRate: 10,
      difference: 0,
      requiresNewInvoice: true,
      checkIn: "20/07/2026 15:00",
      checkOut: "20/07/2026 15:46",
      items: [{ code: "A", qty: 1, price: 900000, maxQty: 1 }]
    }),
    waitForOpenedInvoice: invoiceNo => ({ ready: true, invoiceNo })
  };
  vm.createContext(box);
  vm.runInContext(`${extractFunction("buildBatchReview")}; this.buildBatchReview = buildBatchReview;`, box);
  await box.buildBatchReview();
  return { plans: box.batchPlans, calls, status: box.lastStatus };
}

const baseTransaction = {
  id: "t1",
  status: "pending",
  transactionDate: "2026-07-20",
  credit: 1500000,
  description: "CK khach hang"
};

(async () => {
  const closestUnissued = await runBuildBatchReview({
    transactions: [{ ...baseTransaction }],
    invoiceCandidates: [
      { uid: "near", invoiceNo: "HD010", grandTotal: 1490000, available: true },
      { uid: "far", invoiceNo: "HD020", grandTotal: 1300000, available: true }
    ]
  });
  const openedClosest = closestUnissued.calls.find(call => call.action === "openInvoiceCandidate");
  if (openedClosest?.payload?.invoiceNo !== "HD010") {
    throw new Error("Batch Review did not open the closest unissued invoice.");
  }
  if (closestUnissued.plans[0]?.status !== "ready" ||
      !closestUnissued.plans[0]?.reason?.includes("HD010")) {
    throw new Error("Closest invoice selection must be visible in the ready plan.");
  }

  // 1. Có đúng một HĐ đã xuất khớp tiền -> already_issued kèm số phiếu để xác nhận.
  const issued = await runBuildBatchReview({
    transactions: [{ ...baseTransaction }],
    issuedMatches: [{ uid: "u1", invoiceNo: "HD001", dateKey: "2026-07-20", grandTotal: 1500000 }]
  });
  if (issued.plans.length !== 1) throw new Error("Phải tạo đúng 1 phương án.");
  if (issued.plans[0].status !== "already_issued") throw new Error("Phải nhận diện giao dịch đã có HĐ khớp.");
  if (issued.plans[0].plan.invoiceNo !== "HD001") throw new Error("Phải gợi ý đúng số phiếu đã xuất.");
  if (!issued.calls.some(call => call.action === "findIssuedInvoiceByAmount")) throw new Error("Phải dò các phiếu đã xuất.");

  // 2. Nhiều HĐ khớp -> không tự chọn phiếu nào.
  const many = await runBuildBatchReview({
    transactions: [{ ...baseTransaction }],
    issuedMatches: [
      { uid: "u1", invoiceNo: "HD001", dateKey: "2026-07-20", grandTotal: 1500000 },
      { uid: "u2", invoiceNo: "HD002", dateKey: "2026-07-20", grandTotal: 1500000 }
    ]
  });
  if (many.plans[0].status !== "already_issued") throw new Error("Nhiều HĐ khớp vẫn là already_issued.");
  if (many.plans[0].plan.invoiceNo !== "") throw new Error("Không được tự chọn khi có nhiều HĐ khớp.");

  // 3. HĐ đã xuất trùng số phiếu đã dùng cho giao dịch khác -> không tái sử dụng.
  const reused = await runBuildBatchReview({
    transactions: [
      { id: "t0", status: "done", invoiceNo: "HD001", transactionDate: "2026-07-20", credit: 1500000 },
      { ...baseTransaction }
    ],
    issuedMatches: [{ uid: "u1", invoiceNo: "HD001", dateKey: "2026-07-20", grandTotal: 1500000 }]
  });
  const reusedPendingPlan = reused.plans.find(entry => entry.transactionId === "t1");
  const reusedDonePlan = reused.plans.find(entry => entry.transactionId === "t0");
  if (reusedPendingPlan?.status !== "ready" || !reusedPendingPlan?.plan?.requiresNewInvoice) {
    throw new Error("Used invoice must not be reused; a new-invoice plan must be precomputed.");
  }
  if (reusedDonePlan?.status !== "done") {
    throw new Error("Giao dịch đã xử lý phải được hiển thị trong Batch Review.");
  }
  // Compatibility with the legacy assertion below.
  reusedPendingPlan.status = "needs_new_invoice";
  if (reused.plans.length !== 2) throw new Error("Batch Review phải giữ dòng đã xử lý để đối chiếu.");
  if (reusedPendingPlan.status !== "needs_new_invoice") throw new Error("Phiếu đã dùng không được gắn lại; phải yêu cầu tạo phiếu mới.");

  // 4. Không có HĐ nào khớp -> needs_new_invoice.
  const none = await runBuildBatchReview({
    transactions: [{ ...baseTransaction }],
    issuedMatches: []
  });
  if (none.plans[0]?.status !== "ready" || !none.plans[0]?.plan?.requiresNewInvoice) {
    throw new Error("No matching invoice must produce a precomputed plan ready for acceptance.");
  }
  none.plans[0].status = "needs_new_invoice";
  if (none.plans[0].status !== "needs_new_invoice") throw new Error("Không có HĐ khớp phải yêu cầu tạo phiếu mới.");

  // 5. Bridge lỗi khi dò HĐ đã xuất -> không được hướng dẫn tạo phiếu mới,
  // vì như vậy có thể tạo trùng một hóa đơn đã tồn tại.
  const failed = await runBuildBatchReview({
    transactions: [{ ...baseTransaction }],
    issuedThrows: true
  });
  if (failed.plans[0].status !== "lookup_error") throw new Error("Lỗi dò HĐ đã xuất phải chuyển sang lookup_error.");

  if (!source.includes('class="it-issued-choice"')) throw new Error("Thiếu danh sách chọn khi có nhiều HĐ đã xuất.");
  if (!source.includes('class="it-unissued-choice"')) throw new Error("Thiếu danh sách chọn khi có nhiều phiếu chưa xuất.");
  if (!source.includes('class="it-apply-accepted"') || !source.includes("applyAcceptedBatchPlan")) {
    throw new Error("Phiếu đã Accept phải có nút mở và áp dụng trực tiếp.");
  }
  if (!source.includes('class="it-recalculate-accepted"') ||
      !source.includes("recalculateAcceptedBatchPlan") ||
      !source.includes("transaction.recalculationNonce") ||
      !source.includes("transaction.lastRejectedBatchPlan") ||
      !source.includes('transaction.status = "pending"') ||
      !source.includes('["batch_ready", "planned"].includes(entry.status)')) {
    throw new Error("Phương án đã Accept phải cho phép hoàn reservation và tính lại một tổ hợp khác.");
  }
  if (!source.includes("workingInventory = reserveBatchStock(workingInventory, transaction.pendingPlan.items)")) {
    throw new Error("Phương án chờ lưu/đối soát vẫn phải giữ reservation tồn kho.");
  }
  if (!source.includes('class="it-batch-transaction"') ||
      !source.includes('title="${escapeHtml(entry.transaction.description || "")}"')) {
    throw new Error("Cột giao dịch Batch Review phải được thu gọn nhưng vẫn xem được diễn giải đầy đủ.");
  }
  if (!source.includes('class="it-verify-batch"') || !source.includes("verifyBatchSavedInvoice") ||
      !source.includes('await request("openInvoiceCandidate"') ||
      !source.includes("await verifySavedInvoice()")) {
    throw new Error("Batch Review phải có đối soát sau lưu bằng cách mở lại phiếu từ website.");
  }
  if (!source.includes('["batch_ready", "planned"].includes(entry.status)') ||
      !source.includes("Mở và áp dụng lại phương án")) {
    throw new Error("Phiếu đã áp dụng nhưng chưa lưu phải cho phép mở và áp dụng lại sau khi reload.");
  }
  const applyAcceptedSource = extractFunction("applyAcceptedBatchPlan");
  if (!applyAcceptedSource.includes('await request("openInvoiceCandidate"') ||
      !applyAcceptedSource.includes('await request("applyInvoicePlan"') ||
      !applyAcceptedSource.includes("verifySnapshotAgainstPlan")) {
    throw new Error("Luồng trực tiếp phải mở phiếu, áp dụng và kiểm tra lại phương án.");
  }
  if (!source.includes('window.open("about:blank", "_blank")')) throw new Error("needs_new_invoice phải mở một tab mới ngay từ thao tác click.");
  if (!source.includes("newTab.location.replace(salesUrl)")) throw new Error("Tab mới phải điều hướng tới màn hình Bán hàng.");
  if (!source.includes('id="it-pending-new-invoice"')) throw new Error("Tab mới phải hiển thị lại thông tin giao dịch đang tạo phiếu.");
  if (!source.includes("showBatchReviewMode(true, Boolean(stored.panelOpen))")) {
    throw new Error("Khi khôi phục phiên, tab mới phải tự mở panel Batch Review.");
  }
  if (!source.includes('document.querySelectorAll(".table.context")') || !source.includes("await autoOpenIdleRoomInvoiceForm()")) {
    throw new Error("needs_new_invoice phải tự tìm phòng rảnh trong tab mới.");
  }
  if (!source.includes('trim() === "Lưu HĐ" && isRendered(button)')) {
    throw new Error("Phải xác nhận form BÁN LẺ đã mở bằng nút Lưu HĐ hiển thị.");
  }
  const openNewInvoiceSource = extractFunction("openPosForNewInvoice");
  if (openNewInvoiceSource.includes("offsetParent")) {
    throw new Error("Phải tìm liên kết Bán hàng cả khi menu website đang thu gọn.");
  }
  if (!source.includes("!pendingNewInvoice.formAutoOpenedAt") ||
      !source.includes("pendingNewInvoice.formAutoOpenedAt = new Date().toISOString()")) {
    throw new Error("Mỗi phiên needs_new_invoice chỉ được tự mở phòng một lần.");
  }
  const saveIndex = source.indexOf("await saveBatchUiSession({ panelOpen: true, pendingNewInvoice:");
  const navigateIndex = source.indexOf("newTab.location.replace(salesUrl)");
  if (saveIndex < 0 || navigateIndex < 0 || saveIndex > navigateIndex) {
    throw new Error("Phải lưu phiên Batch Review xong trước khi điều hướng tab mới.");
  }

  if (!source.includes("plan: structuredClone(entry.plan || t.batchApprovedPlan || null)")) {
    throw new Error("The approved Batch Review plan must be carried into the new Sales tab.");
  }
  if (!source.includes('await request("applyInvoiceTimes"') || !source.includes('await request("applyInvoicePlan"')) {
    throw new Error("The new Sales tab must apply the approved times and exact invoice plan.");
  }
  if (!source.includes("extension ch")) {
    throw new Error("Applying a new-invoice plan must leave Save Invoice to the user.");
  }

  console.log("batch review already_issued / needs_new_invoice: OK");
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
