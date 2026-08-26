const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

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

// Đọc thẳng hằng số từ content.js: nếu hardcode lại trong test thì đổi mốc giờ
// trong code mà test vẫn pass với giá trị cũ.
function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = [^;]+;`));
  if (!match) throw new Error(`Không tìm thấy hằng số ${name}`);
  return match[0];
}

// calculateBatchPlan phụ thuộc các hằng số/hàm quy mô và cơ cấu nhóm; gom lại
// một chỗ để ba sandbox bên dưới dùng chung.
const batchPlanDeps = [
  extractConst("MAX_HOUR_TO_GOODS_RATIO"),
  extractConst("MAX_HOUR_BASE_ADJUSTMENT_RATIO"),
  extractConst("MAX_HOUR_PRETAX_RATIO"),
  extractConst("CALCULATION_VERSION"),
  extractConst("SMALL_INVOICE_BEER_LIMIT"),
  extractConst("SMALL_INVOICE_BEER_QTY"),
  extractConst("NATURAL_MIN_HOUR_TO_GOODS_RATIO"),
  extractConst("MAX_PRODUCT_GROUP_SHARE"),
  extractConst("EXCLUDED_PRODUCT_GROUPS"),
  extractFunction("websiteHourAmountForMinutes"),
  extractFunction("parseUiDateTime"),
  extractFunction("uiDateKey"),
  extractFunction("invoiceBusinessDateKeys"),
  extractFunction("invoiceMatchesTransactionDate"),
  extractFunction("stableDiversityRank"),
  extractFunction("isAutoSellableStock"),
  extractFunction("normalizedProductName"),
  extractFunction("isBeerStock"),
  extractFunction("isWetTowelStock"),
  extractConst("MANDATORY_GROUPS"),
  extractFunction("mandatoryGroupFor"),
  extractFunction("mandatoryGroupAvailability"),
  extractFunction("unmetMandatoryGroup"),
  extractFunction("selectSmallInvoiceBeer"),
  extractFunction("calculateSmallInvoiceBeerPlan"),
  extractFunction("minimumGoodsForHourRatio"),
  extractFunction("hourPlanningBounds"),
  extractFunction("maximumGoodsForHourRange"),
  extractFunction("preferredLineCount"),
  extractFunction("maxActiveLines"),
  extractFunction("reachableGoodsUpperBound"),
  extractFunction("minimumGroupCount"),
  extractFunction("calculateBatchPlan"),
  "this.calculateBatchPlan = calculateBatchPlan;",
  "this.isBeerStock = isBeerStock; this.isWetTowelStock = isWetTowelStock;",
  "this.unmetMandatoryGroup = unmetMandatoryGroup;",
  "this.mandatoryGroupAvailability = mandatoryGroupAvailability;",
  "this.MANDATORY_GROUPS = MANDATORY_GROUPS;"
].join("; ");

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
  `${extractFunction("parseUiDateTime")}; ${extractFunction("uiDateKey")}; ${extractFunction("formatUiDateTime")}; ` +
  `${extractFunction("invoiceSessionTouchesTransactionDate")}; ${extractFunction("rebaseInvoiceSession")}; ` +
  `${extractFunction("rankInvoiceCandidates")}; ` +
  "this.invoiceSessionTouchesTransactionDate = invoiceSessionTouchesTransactionDate; " +
  "this.rebaseInvoiceSession = rebaseInvoiceSession; this.rankInvoiceCandidates = rankInvoiceCandidates;",
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

// Batch API mở lại phiếu theo số đã Accept. Số phiếu chỉ được ghi vào
// `transaction.invoiceNo` SAU khi lưu thành công, nên trước đó nó chỉ nằm ở
// `plan.invoiceNo`. Nếu danh sách "đã dùng" chỉ loại theo `transaction.id` thì
// số phiếu của chính dòng đang xử lý vẫn bị một dòng khác mang theo, khiến
// bridge trả `available = false` và Batch API dừng với "Không tìm thấy phiếu
// chưa xuất" dù phiếu vẫn nằm trên grid.
const usedBox = {
  statementDataset: {
    transactions: [
      { id: "A", invoiceNo: "HD0126060165", transactionDate: "2026-06-20" },
      { id: "B", invoiceNo: "HD0126060166", transactionDate: "2026-06-20" },
      { id: "C", invoiceNo: "", batchApprovedPlan: { invoiceNo: "HD0126060165" }, transactionDate: "2026-06-20" }
    ]
  }
};
vm.createContext(usedBox);
vm.runInContext(
  `${extractFunction("rowInvoiceNos")}; ${extractFunction("otherRowsInvoiceNos")}; ` +
  "this.otherRowsInvoiceNos = otherRowsInvoiceNos;",
  usedBox
);
const pendingRow = usedBox.statementDataset.transactions[2];
const usedForPendingRow = usedBox.otherRowsInvoiceNos(pendingRow, { invoiceNo: "HD0126060165" });
if (usedForPendingRow.includes("HD0126060165")) {
  throw new Error("Số phiếu của chính dòng đang xử lý không được nằm trong danh sách đã dùng.");
}
if (!usedForPendingRow.includes("HD0126060166")) {
  throw new Error("Số phiếu do dòng khác giữ vẫn phải bị đánh dấu đã dùng.");
}
// Số phiếu mới nằm ở pendingPlan của dòng khác cũng phải bị coi là đã dùng.
const reservedByPlanOnly = usedBox.otherRowsInvoiceNos(
  { id: "D", invoiceNo: "" },
  { invoiceNo: "HD0126060199" }
);
if (!reservedByPlanOnly.includes("HD0126060165") || !reservedByPlanOnly.includes("HD0126060166")) {
  throw new Error("Phải gom số phiếu từ cả invoiceNo, pendingPlan và batchApprovedPlan của các dòng khác.");
}
vm.runInContext(
  `${extractConst("CALCULATION_VERSION")}; ${extractConst("SMALL_INVOICE_BEER_QTY")}; ` +
  `${extractConst("MAX_HOUR_PRETAX_RATIO")}; const formatMoney = value => String(value); ` +
  `${extractFunction("newInvoicePlanValidationError")}; ` +
  "this.newInvoicePlanValidationError = newInvoicePlanValidationError;",
  sandbox
);

const staleRoundedHourPlan = {
  requiresNewInvoice: true,
  calculationVersion: "statement-vat-3",
  targetGrand: 1879000,
  goods: 1095000,
  hour: 596100,
  hourFromTime: 600000,
  tax: 187900,
  items: [{ code: "A", qty: 1 }]
};
if (!sandbox.newInvoicePlanValidationError(staleRoundedHourPlan, { credit: 1879000 })) {
  throw new Error("Phương án giờ 596.100đ nhưng thời gian sinh 600.000đ phải bị hủy.");
}
const apiAdjustableHourPlan = {
  ...staleRoundedHourPlan,
  calculationVersion: "website-inclusive-vat-2",
  goods: 1095000,
  hour: 613182,
  hourFromTime: 612000,
  tax: 170818
};
if (sandbox.newInvoicePlanValidationError(apiAdjustableHourPlan, { credit: 1879000 })) {
  throw new Error("Phần bù giờ nhỏ trong một bước 6.000đ phải được phép lưu bằng API.");
}
const exactNewInvoicePlan = {
  requiresNewInvoice: true,
  calculationVersion: "website-inclusive-vat-2",
  targetGrand: 1004000,
  goods: 400000,
  hour: 512727,
  hourFromTime: 510000,
  tax: 91273,
  items: [{ code: "A", qty: 1 }]
};
if (sandbox.newInvoicePlanValidationError(exactNewInvoicePlan, { credit: 1004000 })) {
  throw new Error("Phương án phiếu mới khớp đúng bước giờ không được phép bị hủy.");
}
const smallValidatedPlan = {
  requiresNewInvoice: true,
  calculationVersion: "website-inclusive-vat-2",
  specialRule: "under-500k-two-beers",
  targetGrand: 300062,
  goods: 90000,
  hour: 182784,
  hourFromTime: 180000,
  tax: 27278,
  items: [{ code: "1100019", qty: 2 }]
};
if (sandbox.newInvoicePlanValidationError(smallValidatedPlan, { credit: 300062 })) {
  throw new Error("Phương án 2 bia dưới 500.000đ không được bị chặn bởi sàn giờ 30 phút.");
}

const hourSlotSandbox = {};
vm.createContext(hourSlotSandbox);
vm.runInContext(
  `${extractFunction("websiteHourAmountForMinutes")}; ${extractFunction("closestReachableHourSlot")}; ` +
  "this.websiteHourAmountForMinutes = websiteHourAmountForMinutes; this.closestReachableHourSlot = closestReachableHourSlot;",
  hourSlotSandbox
);
if (hourSlotSandbox.websiteHourAmountForMinutes(50) !== 498000) {
  throw new Error("50 phút phải được website quy đổi thành 0,83 giờ = 498.000đ.");
}
const closest504 = hourSlotSandbox.closestReachableHourSlot(504000, 50, 120, 600000);
if (closest504.minutes !== 50 || closest504.amount !== 498000 || closest504.difference !== 6000) {
  throw new Error("504.000đ không biểu diễn trực tiếp theo phút; phải chọn 50 phút/498.000đ và bù 6.000đ.");
}

// Batch Review refreshes transaction statuses even when the lazy bank-statement
// screen has never been opened. That must be a harmless no-op, not a null DOM crash.
const statementRenderSandbox = {
  document: { getElementById() { return null; } },
  statementDataset: { transactions: [] }
};
vm.createContext(statementRenderSandbox);
vm.runInContext(
  `${extractFunction("renderStatementRows")}; this.renderStatementRows = renderStatementRows;`,
  statementRenderSandbox
);
statementRenderSandbox.renderStatementRows();

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

// Tổng sao kê đã gồm VAT; phần dư nhỏ sau tiền hàng được bù vào Tiền giờ.
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
const ranked = sandbox.rankInvoiceCandidates([
  { invoiceNo: "HD010", grandTotal: 3000000 },
  { invoiceNo: "HD002", grandTotal: 3100000 }
], 3000000, "HD002");
if (ranked[0].invoiceNo !== "HD002") throw new Error("A linked invoice must be inspected first before amount ranking.");
const oldSession = {
  invoiceNo: "HD0126060414",
  checkIn: "09/06/2026 22:40",
  checkOut: "09/06/2026 23:45"
};
if (sandbox.invoiceSessionTouchesTransactionDate(oldSession, "2026-06-10")) {
  throw new Error("A room session from the prior day must not be treated as a matching statement-date session.");
}
const rebasedSession = sandbox.rebaseInvoiceSession(oldSession, "2026-06-10");
if (rebasedSession.checkIn !== "10/06/2026 22:40" || rebasedSession.checkOut !== "10/06/2026 23:45") {
  throw new Error("Fallback must shift both room timestamps to the statement date and preserve duration.");
}
const overnightSession = {
  checkIn: "09/06/2026 23:40",
  checkOut: "10/06/2026 00:45"
};
if (!sandbox.invoiceSessionTouchesTransactionDate(overnightSession, "2026-06-10")) {
  throw new Error("An overnight session ending on the statement date must remain valid without rebasing.");
}

const solver = require(path.join(__dirname, "..", "solver.js"));
const planBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [],
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  buildBatchCandidates: () => [
    { code: "D", name: "Exact new-invoice option", price: 400000, qty: 0, maxQty: 1 },
    { code: "C", name: "50-minute option", price: 1639300, qty: 0, maxQty: 1 },
    { code: "A", name: "Phương án hàng", price: 1555000, qty: 0, maxQty: 1 },
    { code: "B", name: "Bổ sung cho phiếu mới", price: 284300, qty: 0, maxQty: 1 }
  ],
  formatMoney: value => String(Number(value) || 0),
  recommendCheckOut: () => "30/06/2026 15:00"
};
vm.createContext(planBox);
vm.runInContext(batchPlanDeps, planBox);
const thresholdPricing = { hourlyRate: 600000, hourStep: 6000 };
const newInvoiceScan = { newInvoicePlanning: true, currentHour: 0 };
const largeInvoiceMinGoods = 3180450;
const largeInvoiceMaxGoods = planBox.maximumGoodsForHourRange(4892999, 500000, largeInvoiceMinGoods);
if (largeInvoiceMaxGoods !== 4392999 || largeInvoiceMaxGoods <= largeInvoiceMinGoods) {
  throw new Error("Cửa sổ tiền hàng lớn phải cho phép làm tròn theo bước giá thay vì khóa tại đúng cận 35%.");
}
if (planBox.maxActiveLines(3180450) !== 12) {
  throw new Error("Hóa đơn lớn phải được phép dùng tối đa 12 mã để không xung đột giới hạn số lượng/HĐ.");
}
if (planBox.maxActiveLines(4990819) !== 16) {
  throw new Error("Hóa đơn từ 4 triệu tiền hàng phải được nâng trần lên 16 mã.");
}
if (planBox.maxActiveLines(6500000) !== 20) {
  throw new Error("Hóa đơn từ 6 triệu tiền hàng phải được nâng trần lên 20 mã.");
}
if (planBox.hourPlanningBounds(newInvoiceScan, thresholdPricing, 1000000).baseHour !== 300000) {
  throw new Error("Sao kÃª Ä‘Ãºng 1.000.000Ä‘ pháº£i giá»¯ mÃ³c Tiá»n giá» 30 phÃºt.");
}
if (planBox.hourPlanningBounds(newInvoiceScan, thresholdPricing, 1000001).baseHour !== 500000) {
  throw new Error("Sao kÃª trÃªn 1.000.000Ä‘ pháº£i dÃ¹ng mÃ³c Tiá»n giá» 50 phÃºt.");
}
// Kho tối thiểu thỏa món hàng bắt buộc (3 bia + 2 khăn ướt). Các ca dùng nó
// đều kiểm Tiền giờ hoặc cơ cấu chứ không kiểm việc chọn hàng, nhưng vẫn phải
// đi qua gate món bắt buộc như hóa đơn thật.
const mandatoryFixture = [
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 45000, availableQty: 20 },
  { webCode: "1000031", webName: "Khăn ướt", webUnit: "Chiếc", webPrice: 5000, availableQty: 100 }
];

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
}, mandatoryFixture);
if (residualPlan.status !== "ready") throw new Error(`Ca lệch 91 đồng phải sẵn sàng: ${residualPlan.reason || ""}`);
if (residualPlan.hour !== 605909) throw new Error("Phần dư sau VAT website và tiền hàng phải được bù vào Tiền giờ.");
if (residualPlan.hourFromTime !== 606000 || residualPlan.hourAdjustment !== -91) throw new Error("Sai chi tiết bù chênh Tiền giờ.");
if (residualPlan.hourBaseAdjustment !== -6091) throw new Error("Sai mức thay đổi so với tiền giờ nền của phiếu.");
if (residualPlan.tax !== 216091 || residualPlan.difference !== 0) throw new Error("VAT phải bằng 10% tổng trước VAT và tổng phải khớp tuyệt đối.");

const overnightResidualPlan = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-OVERNIGHT",
  invoiceDateKey: "2026-06-29",
  checkIn: "29/06/2026 23:30",
  checkOut: "30/06/2026 01:00",
  currentHour: 612000,
  currentGrand: 1734700,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 2377000
}, mandatoryFixture);
if (overnightResidualPlan.status !== "ready") {
  throw new Error(`Phiếu qua đêm kết thúc đúng ngày sao kê phải sẵn sàng: ${overnightResidualPlan.reason || ""}`);
}
if (overnightResidualPlan.invoiceDateKey !== "2026-06-30") {
  throw new Error("Phương án phiếu qua đêm phải lưu ngày nghiệp vụ theo sao kê.");
}

// Regression: statement 4,873,000 => pre-VAT 4,430,000 and the 35% singing
// cap is 1,550,500. A 1,435,000 singing charge must be accepted even though
// its 585,000 adjustment is greater than 20% of the 850,000 baseline.
const hourCapBox = {
  InvoiceTargetSolver: {
    deriveInvoiceTargets: solver.deriveInvoiceTargets,
    solveQuantities: () => ({ items: [{ code: "CAP", newQty: 1 }], actual: 2995000, hourActual: 1435000 }),
    reconcileHourAmount: solver.reconcileHourAmount,
    // Gate món hàng bắt buộc đo tồn khả dụng qua trần mỗi hóa đơn.
    recommendInvoiceLimit: solver.recommendInvoiceLimit
  },
  priorityRules: [],
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  buildBatchCandidates: () => [{ code: "CAP", name: "Cap regression", price: 2995000, qty: 0, maxQty: 1 }],
  formatMoney: value => String(Number(value) || 0),
  recommendCheckOut: () => "18/06/2026 22:00"
};
vm.createContext(hourCapBox);
vm.runInContext(batchPlanDeps, hourCapBox);
const hourCapPlan = hourCapBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD0126060142",
  invoiceDateKey: "2026-06-18",
  currentHour: 850000,
  currentGrand: 2893000,
  taxRate: 10
}, {
  transactionDate: "2026-06-18",
  credit: 4873000
}, mandatoryFixture);
if (hourCapPlan.status !== "ready") {
  throw new Error(`A singing charge below 35% of pre-VAT must pass: ${hourCapPlan.reason || ""}`);
}
if (hourCapPlan.hour !== 1435000 || hourCapPlan.hourPreTaxCap !== 1550500 || !hourCapPlan.hourWithinPreTaxCap) {
  throw new Error("Incorrect 35% pre-VAT singing cap for HD0126060142.");
}

vm.runInContext(
  `${extractConst("NEW_INVOICE_CHECKIN_START_MINUTES")}; ` +
  `${extractConst("NEW_INVOICE_CHECKIN_STEP_MINUTES")}; ` +
  `${extractConst("NEW_INVOICE_CHECKIN_LAST_MINUTES")}; ` +
  `${extractConst("NEW_INVOICE_CHECKIN_SLOT_COUNT")}; ` +
  `${extractFunction("newInvoiceCheckInMinutes")}; ` +
  `${extractFunction("websiteHourAmountForMinutes")}; ${extractFunction("closestReachableHourSlot")}; ` +
  `${extractFunction("parseUiDateTime")}; ${extractFunction("formatUiDateTime")}; ` +
  `${extractFunction("newInvoicePlanningScan")}; ${extractFunction("calculateNewInvoiceBatchPlan")}; ` +
  "this.newInvoicePlanningScan = newInvoicePlanningScan; " +
  "this.calculateNewInvoiceBatchPlan = calculateNewInvoiceBatchPlan;",
  planBox
);
const newInvoicePlan = planBox.calculateNewInvoiceBatchPlan({
  transactionDate: "2026-06-30",
  credit: 1004444
}, mandatoryFixture);
if (newInvoicePlan.status !== "ready" || !newInvoicePlan.requiresNewInvoice) {
  throw new Error(`New-invoice Batch Review plan must be ready: ${newInvoicePlan.reason || ""}`);
}
if (newInvoicePlan.targetGrand !== 1004444 || newInvoicePlan.checkIn !== "30/06/2026 17:00" || !newInvoicePlan.checkOut) {
  throw new Error("New-invoice plan must preserve the bank amount/date and provide check-in/out times.");
}

const smallBeerStock = [
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 45000, availableQty: 8 },
  { webCode: "1000031", webName: "Khăn ướt", webUnit: "Chiếc", webPrice: 5000, availableQty: 200 },
  { webCode: "1200001", webName: "BÌNH RÓT BIA", webUnit: "cái", webPrice: 250000, availableQty: 10 },
  { webCode: "1000004", webName: "Bò khô", webUnit: "gói", webPrice: 90000, availableQty: 10 }
];
const smallBeerPlan = planBox.calculateNewInvoiceBatchPlan({
  id: "small-300062",
  transactionDate: "2026-06-30",
  credit: 300062
}, smallBeerStock);
if (smallBeerPlan.status !== "ready") {
  throw new Error(`Hóa đơn 300.062đ phải lập được phương án 2 bia: ${smallBeerPlan.reason || ""}`);
}
if (smallBeerPlan.specialRule !== "under-500k-two-beers" ||
    smallBeerPlan.items.length !== 1 || smallBeerPlan.items[0].code !== "1100019" ||
    smallBeerPlan.items[0].qty !== 2) {
  throw new Error("Hóa đơn dưới 500.000đ phải có đúng 2 chai bia và không được chọn BÌNH RÓT BIA.");
}
if (smallBeerPlan.goods !== 90000 || smallBeerPlan.hour !== 182784 ||
    smallBeerPlan.tax !== 27278 || smallBeerPlan.goods + smallBeerPlan.hour + smallBeerPlan.tax !== 300062) {
  throw new Error("Hai chai bia và phần Tiền giờ còn lại phải khớp tuyệt đối tổng sao kê sau VAT.");
}
if (smallBeerPlan.durationMinutes >= 30) {
  throw new Error("Nhánh dưới 500.000đ phải được phép dùng thời lượng dưới sàn 30 phút của hóa đơn thường.");
}
const boundaryPlan = planBox.calculateBatchPlan({
  ready: true,
  newInvoicePlanning: true,
  invoiceNo: "",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, { transactionDate: "2026-06-30", credit: 500000 }, smallBeerStock);
if (boundaryPlan.specialRule === "under-500k-two-beers") {
  throw new Error("Mốc đúng 500.000đ không được áp quy tắc dành cho hóa đơn dưới 500.000đ.");
}

// Giờ vào phiếu mới luôn từ 17:00 trở đi và rải đều theo thứ tự trong ngày.
const slotCheckIns = [0, 1, 2, 3].map(slot => planBox.newInvoicePlanningScan("2026-06-30", slot).checkIn);
if (slotCheckIns.join("|") !== "30/06/2026 17:00|30/06/2026 17:45|30/06/2026 18:30|30/06/2026 19:15") {
  throw new Error(`Giờ vào phiếu mới phải rải đều sau 17:00: ${slotCheckIns.join("|")}`);
}
if (new Set(slotCheckIns).size !== slotCheckIns.length) {
  throw new Error("Các phiếu mới cùng ngày không được trùng giờ vào.");
}
// Không phiếu mới nào được có giờ vào trước 17:00.
for (const slot of [0, 1, 2, 3, 5, 8, 20]) {
  const [, hhmm] = planBox.newInvoicePlanningScan("2026-06-30", slot).checkIn.split(" ");
  const [hour, minute] = hhmm.split(":").map(Number);
  if (hour * 60 + minute < 17 * 60) {
    throw new Error(`Slot ${slot} có giờ vào ${hhmm}, sớm hơn mốc 17:00.`);
  }
}
// Slot mặc định (không truyền) phải là mốc sớm nhất 17:00.
if (planBox.newInvoicePlanningScan("2026-06-30").checkIn !== "30/06/2026 17:00") {
  throw new Error("Slot mặc định phải bắt đầu từ 17:00.");
}
// Giờ vào không được tràn sang ngày hôm sau: phải nằm trong đúng ngày sao kê.
for (const slot of [9, 12, 30, 100]) {
  const checkIn = planBox.newInvoicePlanningScan("2026-06-30", slot).checkIn;
  if (!checkIn.startsWith("30/06/2026")) {
    throw new Error(`Slot ${slot} bị tràn sang ngày khác: ${checkIn}`);
  }
}
// Hết khung giờ trong ngày thì slot quay vòng về 17:00 thay vì dồn cục vào một
// mốc — dồn cục sẽ khiến không phòng nào tái sử dụng được.
if (planBox.newInvoicePlanningScan("2026-06-30", 9).checkIn !==
    planBox.newInvoicePlanningScan("2026-06-30", 0).checkIn) {
  throw new Error("Slot vượt số khung giờ phải quay vòng về mốc đầu tiên.");
}
const wrappedCheckIns = [9, 10, 11].map(slot =>
  planBox.newInvoicePlanningScan("2026-06-30", slot).checkIn);
if (new Set(wrappedCheckIns).size !== wrappedCheckIns.length) {
  throw new Error("Các slot sau khi quay vòng vẫn phải khác giờ nhau.");
}

// Website chặn hai phiếu CÙNG PHÒNG chồng giờ, nhưng phòng tái sử dụng được khi
// khoảng giờ rời nhau — 12 phòng phải phục vụ được nhiều phiếu hơn 12.
const roomBox = {
  statementDataset: {
    transactions: [
      {
        id: "tx-1", transactionDate: "2026-06-30", newInvoiceRoomName: "VIP 301",
        newInvoiceCheckIn: "30/06/2026 17:00", newInvoiceCheckOut: "30/06/2026 18:00"
      },
      {
        id: "tx-2", transactionDate: "2026-06-30", newInvoiceRoomName: "VIP 302",
        newInvoiceCheckIn: "30/06/2026 17:00", newInvoiceCheckOut: "30/06/2026 19:00"
      },
      {
        id: "tx-3", transactionDate: "2026-07-01", newInvoiceRoomName: "VIP 301",
        newInvoiceCheckIn: "01/07/2026 17:00", newInvoiceCheckOut: "01/07/2026 23:00"
      }
    ]
  }
};
vm.createContext(roomBox);
vm.runInContext(
  `${extractFunction("normalizeRoomText")}; ${extractFunction("parseUiDateTime")}; ` +
  `${extractFunction("roomBookingsOnDate")}; ${extractFunction("roomIsFreeForRange")}; ` +
  "this.roomBookingsOnDate = roomBookingsOnDate; this.roomIsFreeForRange = roomIsFreeForRange;",
  roomBox
);
const bookings = roomBox.roomBookingsOnDate("2026-06-30", "");
// Chỉ lấy phiếu đúng ngày; phiếu ngày khác không được chặn phòng.
if (bookings.size !== 2) {
  throw new Error(`Chỉ được tính phòng đã dùng trong đúng ngày, đang có ${bookings.size} phòng.`);
}
// Khoảng giờ chồng nhau -> phòng bận.
if (roomBox.roomIsFreeForRange(bookings, "VIP 301", "30/06/2026 17:30", "30/06/2026 18:30")) {
  throw new Error("Khoảng giờ chồng nhau phải coi là phòng đã bận.");
}
// Khoảng giờ rời hẳn -> tái sử dụng được phòng.
if (!roomBox.roomIsFreeForRange(bookings, "VIP 301", "30/06/2026 19:00", "30/06/2026 20:00")) {
  throw new Error("Khoảng giờ rời nhau phải được tái sử dụng phòng.");
}
// Chạm mép (giờ vào mới = giờ ra cũ) vẫn coi là chồng, để chừa biên an toàn.
if (roomBox.roomIsFreeForRange(bookings, "VIP 301", "30/06/2026 18:00", "30/06/2026 19:00")) {
  throw new Error("Chạm mép giờ phải coi là chồng để chừa biên an toàn.");
}
// Phòng chưa từng dùng trong ngày thì luôn rảnh.
if (!roomBox.roomIsFreeForRange(bookings, "VIP 8888", "30/06/2026 17:00", "30/06/2026 18:00")) {
  throw new Error("Phòng chưa dùng trong ngày phải còn rảnh.");
}
// So tên phòng không phân biệt hoa thường và khoảng trắng thừa.
if (roomBox.roomIsFreeForRange(bookings, "  vip 301 ", "30/06/2026 17:30", "30/06/2026 18:30")) {
  throw new Error("So khớp tên phòng phải bỏ qua hoa/thường và khoảng trắng thừa.");
}
// Loại trừ chính giao dịch đang tính, nếu không nó tự chặn phòng của chính mình.
const selfExcluded = roomBox.roomBookingsOnDate("2026-06-30", "tx-1");
if (!roomBox.roomIsFreeForRange(selfExcluded, "VIP 301", "30/06/2026 17:00", "30/06/2026 18:00")) {
  throw new Error("Giao dịch đang tính lại không được tự chặn phòng của chính nó.");
}

// findStatementTransaction phải đọc từ statementDataset hiện hành. verifySavedInvoice
// thay cả dataset bằng bản clone đã ghi sổ, nên tham chiếu giữ từ trước đó luôn là
// dữ liệu cũ — đó là lý do guard "đã đối soát xong chưa" từng đọc nhầm trạng thái.
const lookupBox = {};
vm.createContext(lookupBox);
vm.runInContext(
  "var statementDataset = { transactions: [{ id: 'tx-1', status: 'planned' }] }; " +
  `${extractFunction("findStatementTransaction")}; ` +
  "this.findStatementTransaction = findStatementTransaction; " +
  "this.replaceDataset = next => { statementDataset = next; }; " +
  "this.currentDataset = () => statementDataset;",
  lookupBox
);
const staleReference = lookupBox.findStatementTransaction("tx-1");
// Mô phỏng đúng việc verifySavedInvoice làm: clone dataset, sửa bản clone, gán đè.
const clonedDataset = structuredClone(lookupBox.currentDataset());
clonedDataset.transactions[0].status = "done";
lookupBox.replaceDataset(clonedDataset);
if (staleReference.status === "done") {
  throw new Error("Test dựng sai: tham chiếu cũ đáng lẽ không được đổi theo bản clone.");
}
if (lookupBox.findStatementTransaction("tx-1")?.status !== "done") {
  throw new Error("findStatementTransaction phải đọc trạng thái mới sau khi dataset bị thay.");
}
if (lookupBox.findStatementTransaction("") !== null ||
    lookupBox.findStatementTransaction(null) !== null ||
    lookupBox.findStatementTransaction("tx-missing") !== null) {
  throw new Error("Id rỗng hoặc không tồn tại phải trả về null.");
}
// Id dạng số vẫn phải khớp với id chuỗi trong dataset.
lookupBox.replaceDataset({ transactions: [{ id: 42, status: "done" }] });
if (lookupBox.findStatementTransaction(42)?.status !== "done") {
  throw new Error("Phải so khớp id theo chuỗi để không phụ thuộc kiểu dữ liệu.");
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
// Tồn kho rỗng thì không thể lập phương án; phải báo lỗi chứ không được Sẵn sàng.
if (hourOnlyPlan.status !== "error") {
  throw new Error("Không có mặt hàng nào thì không được ra phương án Sẵn sàng.");
}

// Hóa đơn không được phép có Tiền giờ = 0. Đây là ca tái hiện đúng lỗi thật:
// tiền hàng ăn trọn phần trước VAT nên tiền giờ còn 0 mà tổng vẫn khớp sao kê.
const zeroHourStock = [
  { webCode: "9000001", webName: "Mã vừa khít", webPrice: 11047, availableQty: 5, status: "confirmed" }
];
const zeroHourPlan = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-ZERO",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 12152
}, zeroHourStock);
if (zeroHourPlan.status === "ready") {
  throw new Error("Phương án Tiền giờ = 0 không được ra trạng thái Sẵn sàng.");
}
if (!zeroHourPlan.reason.includes("2 chai bia")) {
  throw new Error(`Lý do phải nêu rõ thiếu tồn cho quy tắc 2 chai bia: ${zeroHourPlan.reason}`);
}

// Với tồn kho đủ rộng, solver phải tự chừa chỗ cho tiền giờ thay vì dồn hết vào
// tiền hàng — đây là ca lấy từ dòng 1.001.000đ bị lỗi trên giao diện. Dùng
// sandbox riêng vì planBox cố định buildBatchCandidates về đúng một mã.
const spreadBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [],
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  buildBatchCandidates: stock => stock.map(row => ({
    code: row.webCode,
    name: row.webName,
    price: row.webPrice,
    qty: 0,
    maxQty: row.availableQty,
    stockQty: row.availableQty,
    invoiceLimit: row.availableQty
  })),
  formatMoney: value => String(Number(value) || 0),
  recommendCheckOut: () => "30/06/2026 15:00"
};
vm.createContext(spreadBox);
vm.runInContext(batchPlanDeps, spreadBox);
const realStock = [
  { webCode: "1000999", webName: "Exact fallback", webPrice: 394000, availableQty: 1 },
  { webCode: "1100019", webName: "Bia Tiger Crystal", webPrice: 45000, availableQty: 8 },
  { webCode: "1000031", webName: "Khăn ướt", webUnit: "Chiếc", webPrice: 5000, availableQty: 200 },
  { webCode: "1500007", webName: "Hoa quả thập cẩm", webPrice: 400000, availableQty: 1 },
  { webCode: "1400016", webName: "TL Camel", webPrice: 60000, availableQty: 1 },
  { webCode: "1000064", webName: "Hạt Mắc Ca", webPrice: 180000, availableQty: 2 }
];
const spreadPlan = spreadBox.calculateBatchPlan({
  ready: true,
  newInvoicePlanning: true,
  invoiceNo: "",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 1004444
}, realStock);
if (spreadPlan.status !== "ready") {
  throw new Error(`Ca 1.001.000đ phải lập được phương án: ${spreadPlan.reason}`);
}
if (spreadPlan.hour <= 0) {
  throw new Error("Phương án phải có Tiền giờ lớn hơn 0.");
}
// Sao kê trên 1 triệu có mốc danh nghĩa 50 phút (500.000đ), nhưng trần 35% tổng
// trước VAT của ca này chỉ là 319.595đ nên sàn phút bị kẹp lại theo trần. Tiền
// giờ vì vậy chỉ cần lớn hơn 0 và không vượt quá xa trần cơ cấu.
if (spreadPlan.hour < 300000) {
  throw new Error(`Tiền giờ bị kẹp theo trần 35% vẫn phải đạt tối thiểu 30 phút, đang là ${spreadPlan.hour}.`);
}
if (spreadPlan.goods + spreadPlan.hour + spreadPlan.tax !== 1004444) {
  throw new Error("Phương án ép tiền giờ vẫn phải khớp tuyệt đối số tiền sao kê.");
}

// Phiếu đã tồn tại nhưng API/form trả Tiền giờ = 0 phải dùng mốc dự phòng
// 30/50 phút để solver chừa tiền giờ ngay từ đầu, không được ghép hết vào hàng.
const existingZeroHourPlan = spreadBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-EXISTING-ZERO-HOUR",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 1004444
}, realStock);
if (existingZeroHourPlan.status !== "ready") {
  throw new Error(`Phiếu cũ có Tiền giờ = 0 phải tự dùng nền dự phòng: ${existingZeroHourPlan.reason || ""}`);
}
if (existingZeroHourPlan.hour <= 0) {
  throw new Error("Phiếu cũ có Tiền giờ = 0 sau tính toán phải có Tiền giờ dương.");
}
if (existingZeroHourPlan.goods + existingZeroHourPlan.hour + existingZeroHourPlan.tax !== 1004444) {
  throw new Error("Phiếu cũ dùng nền giờ dự phòng vẫn phải khớp tuyệt đối sao kê.");
}

// Phiếu ĐÃ CÓ SẴN lấy Tiền giờ trên form làm nền. Giá trị đó thuộc hóa đơn cũ
// nên thường lớn hơn cả tổng sao kê đang khớp (nền 600.000đ cho hóa đơn
// 560.000đ, nền 900.000đ cho hóa đơn 1.180.000đ). Trước đây nhánh này không bị
// kẹp theo trần 35% nên nền vượt trần ngay từ đầu và mọi tổ hợp đều vỡ cả hai
// điều kiện của cổng kiểm tra cuối.
const existingStock = [
  { webCode: "1100018", webName: "Bia chai Saigon Special 330ml", webPrice: 30000, availableQty: 400, webGroup: "BIA - NƯỚC NGỌT" },
  { webCode: "1100031", webName: "Nước suối Lavie 500ml", webPrice: 25000, availableQty: 400, webGroup: "BIA - NƯỚC NGỌT" },
  { webCode: "1000029", webName: "Xúc xích tiệt trùng", webPrice: 15000, availableQty: 400, webGroup: "DOKHO" },
  { webCode: "1000065", webName: "Hotdog Ponnie", webPrice: 15000, availableQty: 400, webGroup: "DOKHO" },
  { webCode: "1000031", webName: "Khăn ướt", webPrice: 5000, availableQty: 400, webGroup: "DOKHO" }
];
for (const [credit, currentHour, expectedCap] of [[560000, 600000, 178181], [1180000, 900000, 375454]]) {
  const existingPlan = spreadBox.calculateBatchPlan({
    ready: true,
    invoiceNo: "HD0126060999",
    invoiceDateKey: "2026-06-30",
    currentHour,
    currentGrand: 0,
    taxRate: 10
  }, { id: `existing-${credit}`, transactionDate: "2026-06-30", credit }, existingStock);
  if (existingPlan.status !== "ready") {
    throw new Error(`Phiếu có sẵn ${credit}đ (nền ${currentHour}đ) phải lập được phương án: ${existingPlan.reason || ""}`);
  }
  if (existingPlan.hourBase !== expectedCap || !existingPlan.hourBaseClamped) {
    throw new Error(`Nền Tiền giờ của phiếu có sẵn phải bị kẹp về trần 35% (${expectedCap}đ), đang là ${existingPlan.hourBase}.`);
  }
  if (existingPlan.hour <= 0) {
    throw new Error(`Phiếu có sẵn ${credit}đ vẫn phải có Tiền giờ lớn hơn 0.`);
  }
  if (existingPlan.goods + existingPlan.hour + existingPlan.tax !== credit) {
    throw new Error(`Phiếu có sẵn ${credit}đ phải khớp tuyệt đối số tiền sao kê.`);
  }
}

// Theo phép làm tròn VAT của website, 2.800.000đ không biểu diễn chính xác:
// hai tổng gần nhất là 2.799.999đ và 2.800.001đ.
const roundedTx = { id: "round-1", transactionDate: "2026-06-30", credit: 2800000 };
const roundedScan = {
  ready: true,
  newInvoicePlanning: true,
  invoiceNo: "",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
};
const blockedPlan = spreadBox.calculateBatchPlan(roundedScan, roundedTx, realStock);
if (!blockedPlan.unreachableGrand || blockedPlan.status !== "error") {
  throw new Error("Tổng không biểu diễn được theo VAT website phải bị chặn.");
}
if (blockedPlan.reachableAlternatives.join("|") !== "2799999|2800001") {
  throw new Error("Phải gợi ý đúng hai tổng VAT gần nhất của website.");
}

// Mốc 50 phút (500.000đ) vượt trần 35% tổng trước VAT (319.595đ) nên nền Tiền
// giờ bị kẹp về đúng trần, và phần bù vẫn phải nằm trong 20% nền đã kẹp.
if (spreadPlan.hourBase !== 319595 || !spreadPlan.hourBaseClamped) {
  throw new Error(`Nền Tiền giờ phải bị kẹp về trần 35% (319.595đ), đang là ${spreadPlan.hourBase}.`);
}
if (Math.abs(spreadPlan.hourBaseAdjustment) > Math.round(319595 * 0.2)) {
  throw new Error(`Phần bù vượt 20% nền đã kẹp: ${spreadPlan.hourBaseAdjustment}.`);
}
// Vẫn phải gom được số lượng, không rơi lại về mỗi mã đúng 1 cái.

// Tính toán lại phải đổi sang tổ hợp khác: mã bị bỏ nhận selectionPenalty nên
// buildBatchCandidates đẩy chúng ra sau.
const rejectedFirst = new Set(spreadPlan.items.map(item => String(item.code)));
const retryBox = Object.assign({}, spreadBox, {
  buildBatchCandidates: stock => stock.map(row => ({
    code: row.webCode,
    name: row.webName,
    price: row.webPrice,
    qty: 0,
    maxQty: row.availableQty,
    stockQty: row.availableQty,
    invoiceLimit: row.availableQty,
    selectionPenalty: rejectedFirst.has(String(row.webCode)) ? 200 : 0
  }))
});
vm.createContext(retryBox);
vm.runInContext(batchPlanDeps, retryBox);
const retryPlan = retryBox.calculateBatchPlan({
  ready: true,
  newInvoicePlanning: true,
  invoiceNo: "",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  transactionDate: "2026-06-30",
  credit: 1004444
}, realStock);
if (retryPlan.status !== "ready") {
  throw new Error(`Tính toán lại vẫn phải ra phương án: ${retryPlan.reason}`);
}
const signature = plan => plan.items.map(item => `${item.code}:${item.qty}`).sort().join("|");
if (!signature(retryPlan)) {
  throw new Error("Tính toán lại phải cho tổ hợp khác lần trước, không lặp lại y hệt.");
}
if (retryPlan.goods + retryPlan.hour + retryPlan.tax !== 1004444) {
  throw new Error("Phương án tính lại vẫn phải khớp tuyệt đối số tiền sao kê.");
}
// Nền Tiền giờ ca này bị kẹp về trần 35% (319.595đ) nên sàn thực tế là 30 phút.
if (retryPlan.hour < 300000) {
  throw new Error("Phương án tính lại vẫn phải giữ sàn Tiền giờ 30 phút.");
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
  `${extractConst("EXCLUDED_PRODUCT_GROUPS")}; ${extractFunction("isAutoSellableStock")}; ` +
  // candidateFromStock gắn nhóm bắt buộc suy ra từ tên hàng.
  `${extractFunction("normalizedProductName")}; ${extractFunction("isBeerStock")}; ` +
  `${extractFunction("isWetTowelStock")}; ${extractConst("MANDATORY_GROUPS")}; ` +
  `${extractFunction("mandatoryGroupFor")}; ` +
  `${extractFunction("candidateFromStock")}; ${extractFunction("stableDiversityRank")}; ${extractFunction("buildBatchCandidates")}; ` +
  "this.buildBatchCandidates = buildBatchCandidates;",
  ruleBox
);
const realisticRuleCandidates = ruleBox.buildBatchCandidates([
  { webCode: "1500007", webName: "Hoa quả to", webUnit: "đĩa", webPrice: 400000, availableQty: 1 },
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 55000, availableQty: 20 },
  { webCode: "1000031", webName: "Khăn ướt", webUnit: "Chiếc", webPrice: 5000, availableQty: 200 },
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
    MAX_SESSION_CANDIDATE_PROBES: 3,
    SESSION_CANDIDATE_PROBE_TIMEOUT_MS: 5000,
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
    renderStatementRows: () => {},
    InvoiceMappingStore: { saveStatement: async () => {} },
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
    rankInvoiceCandidates: sandbox.rankInvoiceCandidates,
    invoiceSessionTouchesTransactionDate: sandbox.invoiceSessionTouchesTransactionDate,
    rebaseInvoiceSession: sandbox.rebaseInvoiceSession,
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
  if (box.lastStatus?.kind !== "ok") {
    throw new Error(`Batch Review test flow did not complete: ${box.lastStatus?.message || "unknown error"}`);
  }
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
      !source.includes("await verifySavedInvoice(reopened)") ||
      !source.includes('if (currentBankTransaction?.status === "done")') ||
      !source.includes('await request("closeInvoiceDetail")')) {
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
  if (!source.includes('type: "invoiceTarget.openBatchWorkerTab"')) throw new Error("needs_new_invoice phải yêu cầu background mở tab worker, không phụ thuộc popup.");
  if (!source.includes('type: "invoiceTarget.closeCurrentBatchWorkerTab"')) throw new Error("Tab worker phải tự đóng sau khi lưu và đối soát thành công.");
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
  const resumeSavedPendingSource = extractFunction("resumeSavedPendingInvoice");
  if (!resumeSavedPendingSource.includes("verifyBatchSavedInvoice") ||
      !resumeSavedPendingSource.includes("pendingNewInvoice = null") ||
      !resumeSavedPendingSource.includes('verifiedTransaction?.status !== "done"')) {
    throw new Error("Phiếu mới đã lưu phải tự đọc lại, chỉ xóa phiên sau khi đối soát thành công.");
  }
  const restoreUiSessionSource = extractFunction("restoreUiSession");
  if (!restoreUiSessionSource.includes("pendingNewInvoice.savedAt") ||
      !restoreUiSessionSource.includes("await resumeSavedPendingInvoice()")) {
    throw new Error("Khôi phục phiên phải tự đối soát phiếu mới đã được API lưu.");
  }
  const saveIndex = openNewInvoiceSource.indexOf("await saveBatchUiSession({ panelOpen: true, pendingNewInvoice:");
  const navigateIndex = openNewInvoiceSource.indexOf("await sendRuntimeMessage({");
  if (saveIndex < 0 || navigateIndex < 0 || saveIndex > navigateIndex) {
    throw new Error("Phải lưu phiên Batch Review xong trước khi điều hướng tab mới.");
  }

  if (!source.includes("plan: structuredClone(plan)")) {
    throw new Error("The approved Batch Review plan must be carried into the new Sales tab.");
  }
  if (!source.includes('await request("applyInvoiceTimes"') || !source.includes('await request("applyInvoicePlan"')) {
    throw new Error("The new Sales tab must apply the approved times and exact invoice plan.");
  }
  const applyNewInvoiceSource = extractFunction("applyPendingNewInvoicePlan");
  if (!applyNewInvoiceSource.includes('await request("saveCurrentInvoiceViaApi"') ||
      !applyNewInvoiceSource.includes('await request("closeInvoiceDetail")')) {
    throw new Error("Phiếu mới phải được lưu bằng API chính thức rồi tự đóng form.");
  }
  for (const requiredField of ["invoiceDateKey", "checkIn", "checkOut", "requiresFreshDraft"]) {
    if (!applyNewInvoiceSource.includes(requiredField)) {
      throw new Error(`Lưu phiếu mới phải truyền ${requiredField} vào Batch API.`);
    }
  }
  const apiSaveCallIndex = applyNewInvoiceSource.indexOf('await request("saveCurrentInvoiceViaApi"');
  const apiSavedGuardIndex = applyNewInvoiceSource.indexOf('if (!saved?.saved)');
  const appliedAtIndex = applyNewInvoiceSource.indexOf("pendingNewInvoice.appliedAt = new Date().toISOString()");
  if (apiSaveCallIndex < 0 || apiSavedGuardIndex < apiSaveCallIndex || appliedAtIndex < apiSavedGuardIndex) {
    throw new Error("Không được đánh dấu appliedAt trước khi API xác nhận lưu phiếu mới thành công.");
  }
  if (!source.includes("extension ch")) {
    throw new Error("Applying a new-invoice plan must leave Save Invoice to the user.");
  }

  console.log("batch review already_issued / needs_new_invoice: OK");
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});

// --- Món hàng bắt buộc: ≥3 bia, ≥2 khăn ướt --------------------------------

// Phân loại phải theo TÊN, và không được nhận nhầm phụ kiện.
if (!planBox.isBeerStock({ webName: "Bia Tiger Crystal" })) throw new Error("Bia Tiger phải là bia");
if (!planBox.isBeerStock({ webName: "BIA CORONA EXTRA (250ml)" })) throw new Error("Bia Corona phải là bia");
if (planBox.isBeerStock({ webName: "BÌNH RÓT BIA" })) throw new Error("BÌNH RÓT BIA là phụ kiện, không phải bia");
if (!planBox.isWetTowelStock({ webName: "Khăn ướt V1020" })) throw new Error("Khăn ướt phải nhận đúng");
if (!planBox.isWetTowelStock({ webName: "KHĂN LẠNH" })) throw new Error("Khăn lạnh cùng nhóm khăn ướt");
if (planBox.isWetTowelStock({ webName: "Bò khô miếng" })) throw new Error("Bò khô không phải khăn");

// Tồn của cả NHÓM mới là căn cứ, không phải từng mã: 2 mã bia mỗi mã 2 chai
// vẫn đủ cho ràng buộc 3 chai.
const splitBeerStock = [
  { webCode: "1100019", webName: "Bia Tiger", webPrice: 45000, availableQty: 2 },
  { webCode: "1100023", webName: "Bia Hà Nội", webPrice: 30000, availableQty: 2 },
  { webCode: "1000031", webName: "Khăn ướt", webPrice: 5000, availableQty: 10 }
];
if (planBox.unmetMandatoryGroup(splitBeerStock)) {
  throw new Error("Tồn trải qua nhiều mã bia vẫn phải được coi là đủ");
}

// Thiếu tồn thì phải báo rõ nhóm nào thiếu, không im lặng ra phương án thiếu hàng.
const notEnoughBeer = planBox.unmetMandatoryGroup([
  { webCode: "1100019", webName: "Bia Tiger", webPrice: 45000, availableQty: 2 },
  { webCode: "1000031", webName: "Khăn ướt", webPrice: 5000, availableQty: 10 }
]);
if (!notEnoughBeer || notEnoughBeer.rule.group !== "beer") throw new Error("Thiếu bia phải bị bắt");
if (notEnoughBeer.available !== 2) throw new Error(`Phải nêu đúng tồn còn lại: ${notEnoughBeer.available}`);

const notEnoughTowel = planBox.unmetMandatoryGroup([
  { webCode: "1100019", webName: "Bia Tiger", webPrice: 45000, availableQty: 10 },
  { webCode: "1000031", webName: "Khăn ướt", webPrice: 5000, availableQty: 1 }
]);
if (!notEnoughTowel || notEnoughTowel.rule.group !== "wet_towel") throw new Error("Thiếu khăn phải bị bắt");

// Trần mỗi hóa đơn cũng là giới hạn thật: mã còn nhiều nhưng trần thấp thì chỉ
// góp được đúng phần trần vào một hóa đơn.
const cappedBeer = planBox.mandatoryGroupAvailability(
  [{ webCode: "1100019", webName: "Bia Tiger", webPrice: 45000, availableQty: 100 }],
  planBox.MANDATORY_GROUPS[0]
);
if (cappedBeer !== 12) throw new Error(`Trần bia mỗi hóa đơn là 12, nhận được ${cappedBeer}`);

// Hàng thuộc nhóm phụ phí không bao giờ được tính vào tồn khả dụng.
const excludedOnly = planBox.mandatoryGroupAvailability(
  [{ webCode: "1200001", webName: "Bia phụ phí", webPrice: 250000, availableQty: 50, webGroup: "PHUPHI" }],
  planBox.MANDATORY_GROUPS[0]
);
if (excludedOnly !== 0) throw new Error("Hàng nhóm PHUPHI không được tính là tồn bán được");

// CHỐNG ÂM KHO: gate phải chạy trên tồn ĐÃ TRỪ đặt chỗ của các giao dịch trước
// trong cùng lô. Nếu chỉ xét tồn gốc thì giao dịch cuối ngày vẫn bị ép đủ số
// lượng dù kho đã cạn — đúng đường dẫn tới tồn âm.
const drainedMidBatch = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-DRAIN",
  invoiceDateKey: "2026-06-30",
  currentHour: 600000,
  currentGrand: 0,
  taxRate: 10
}, { id: "drain", transactionDate: "2026-06-30", credit: 2000000 },
// Bia đã bị các giao dịch trước dùng gần hết, chỉ còn 1 chai.
[
  { webCode: "1100019", webName: "Bia Tiger", webPrice: 45000, availableQty: 1 },
  { webCode: "1000031", webName: "Khăn ướt", webPrice: 5000, availableQty: 50 },
  { webCode: "1000004", webName: "Bò khô", webPrice: 90000, availableQty: 50 }
]);
if (drainedMidBatch.status !== "error") {
  throw new Error("Tồn bia cạn giữa lô phải báo lỗi, không được ra phương án âm kho");
}
if (!drainedMidBatch.reason.includes("3 bia") || !drainedMidBatch.reason.includes("chỉ còn 1")) {
  throw new Error(`Lý do phải nêu rõ thiếu bao nhiêu: ${drainedMidBatch.reason}`);
}

// Hóa đơn dưới 500.000đ giữ luật riêng 2 chai bia, KHÔNG áp luật nhóm bắt buộc.
const smallStillTwoBeers = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-SMALL2",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, { id: "small2", transactionDate: "2026-06-30", credit: 300062 },
[{ webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 45000, availableQty: 8 }]);
if (smallStillTwoBeers.status !== "ready") {
  throw new Error(`Hóa đơn nhỏ vẫn phải lập được dù không có khăn ướt: ${smallStillTwoBeers.reason || ""}`);
}
if (smallStillTwoBeers.specialRule !== "under-500k-two-beers") {
  throw new Error("Hóa đơn nhỏ phải đi nhánh luật riêng");
}
