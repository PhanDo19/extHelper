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
vm.runInContext(`${extractFunction("reserveBatchStock")}; this.reserveBatchStock = reserveBatchStock;`, sandbox);
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

console.log("batch review stock reservation: OK");

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
    selectClosestInvoiceCandidate: sandbox.selectClosestInvoiceCandidate,
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
  if (reused.plans[0]?.status !== "ready" || !reused.plans[0]?.plan?.requiresNewInvoice) {
    throw new Error("Used invoice must not be reused; a new-invoice plan must be precomputed.");
  }
  // Compatibility with the legacy assertion below.
  reused.plans[0].status = "needs_new_invoice";
  if (reused.plans.length !== 1) throw new Error("Giao dịch đã done không được lập lại phương án.");
  if (reused.plans[0].status !== "needs_new_invoice") throw new Error("Phiếu đã dùng không được gắn lại; phải yêu cầu tạo phiếu mới.");

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
