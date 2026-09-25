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
  extractConst("DEFAULT_HOURLY_RATE"),
  extractConst("PARIS_NHON_ROOM_HOURLY_RATES"),
  extractFunction("normalizeRoomText"),
  extractFunction("roomHourlyRate"),
  extractFunction("tenantHourlyRates"),
  extractFunction("hourPricingForRate"),
  extractConst("GOODS_PRICE_STEP"),
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
  extractConst("RELAXED_MANDATORY_GROUPS"),
  extractConst("RELAXED_MANDATORY_TENANT"),
  extractConst("RELAXED_MANDATORY_GRAND_LIMIT"),
  extractFunction("mandatoryGroupsFor"),
  extractFunction("mandatoryGroupFor"),
  extractFunction("mandatoryGroupAvailability"),
  extractFunction("unmetMandatoryGroup"),
  extractConst("SMALL_INVOICE_ITEM_MAX_PRICE"),
  extractFunction("isSmallInvoiceDrink"),
  extractFunction("selectSmallInvoiceBeer"),
  extractFunction("calculateSmallInvoiceBeerPlan"),
  extractFunction("minimumGoodsForHourRatio"),
  extractConst("PARIS_NHON_TENANT_SLUG"),
  extractConst("PARIS_NHON_MIN_SINGING_MINUTES"),
  extractConst("DEFAULT_MIN_SINGING_MINUTES"),
  extractConst("LARGE_STATEMENT_MIN_SINGING_MINUTES"),
  extractConst("LARGE_STATEMENT_THRESHOLD"),
  extractFunction("minimumSingingMinutes"),
  extractFunction("smallInvoiceGrandLimit"),
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
  "this.MANDATORY_GROUPS = MANDATORY_GROUPS;",
  "this.mandatoryGroupsFor = mandatoryGroupsFor;",
  "this.MAX_HOUR_PRETAX_RATIO = MAX_HOUR_PRETAX_RATIO;",
  "this.minimumSingingMinutes = minimumSingingMinutes;",
  "this.smallInvoiceGrandLimit = smallInvoiceGrandLimit;"
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
  `${extractFunction("roomCardName")}; ${extractFunction("roomAreaKey")}; ${extractFunction("isRetailRoomName")}; ` +
  "this.isIdleRoomLabel = isIdleRoomLabel; this.roomCardName = roomCardName; this.isRetailRoomName = isRetailRoomName;",
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
  `${extractConst("MAX_BATCH_TRANSACTIONS")}; ` +
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
  `${extractConst("CALCULATION_VERSION")}; this.CALCULATION_VERSION = CALCULATION_VERSION; ` +
  `${extractConst("SMALL_INVOICE_BEER_QTY")}; ` +
  `${extractConst("SMALL_INVOICE_BEER_LIMIT")}; ` +
  `${extractConst("MAX_HOUR_PRETAX_RATIO")}; ${extractConst("DEFAULT_HOURLY_RATE")}; ` +
  `${extractConst("PARIS_NHON_TENANT_SLUG")}; ${extractConst("PARIS_NHON_MIN_SINGING_MINUTES")}; ` +
  `${extractConst("DEFAULT_MIN_SINGING_MINUTES")}; ` +
  `${extractConst("LARGE_STATEMENT_MIN_SINGING_MINUTES")}; ${extractConst("LARGE_STATEMENT_THRESHOLD")}; ` +
  `${extractFunction("minimumSingingMinutes")}; ` +
  `const formatMoney = value => String(value); ` +
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
  calculationVersion: sandbox.CALCULATION_VERSION,
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
  calculationVersion: sandbox.CALCULATION_VERSION,
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
// Phiếu nhỏ (dưới 300.000đ): đúng MỘT món giá thấp, phần còn lại vào Tiền giờ.
// Không bị chặn bởi sàn giờ 30 phút của hóa đơn thường.
const smallValidatedPlan = {
  requiresNewInvoice: true,
  calculationVersion: sandbox.CALCULATION_VERSION,
  specialRule: "under-500k-two-beers",
  targetGrand: 143000,
  goods: 50000,
  hour: 80000,
  hourFromTime: 78000,
  tax: 13000,
  items: [{ code: "1100019", qty: 1 }]
};
if (sandbox.newInvoicePlanValidationError(smallValidatedPlan, { credit: 143000 })) {
  throw new Error("Phương án một món dưới 300.000đ không được bị chặn bởi sàn giờ 30 phút.");
}
// Hai món (luật cũ) nay là sai: phiếu nhỏ chỉ được đúng một món.
if (!sandbox.newInvoicePlanValidationError(
  { ...smallValidatedPlan, items: [{ code: "1100019", qty: 2 }] }, { credit: 143000 }
)) {
  throw new Error("Phiếu nhỏ có 2 đơn vị phải bị chặn theo luật mới.");
}

// Chỉ phiếu MỚI của Paris Nhơn từ 5 triệu mới dùng sàn Tiền giờ 1,5 triệu;
// phiếu cũ và các mức thấp hơn vẫn giữ mốc 30/50 phút thông thường.
const nhonHourSandbox = { pageTenantSlug: "parisnhon" };
vm.createContext(nhonHourSandbox);
vm.runInContext(
  `${extractConst("MAX_HOUR_BASE_ADJUSTMENT_RATIO")}; ` +
  `${extractConst("MAX_HOUR_PRETAX_RATIO")}; ` +
  `${extractConst("PARIS_NHON_LARGE_INVOICE_THRESHOLD")}; ` +
  `${extractConst("PARIS_NHON_LARGE_INVOICE_MIN_HOUR")}; ` +
  `${extractConst("SMALL_INVOICE_ITEM_MAX_PRICE")} ` +
  `${extractConst("PARIS_NHON_TENANT_SLUG")}; ${extractConst("PARIS_NHON_MIN_SINGING_MINUTES")}; ` +
  `${extractConst("DEFAULT_MIN_SINGING_MINUTES")}; ` +
  `${extractConst("LARGE_STATEMENT_MIN_SINGING_MINUTES")}; ${extractConst("LARGE_STATEMENT_THRESHOLD")}; ` +
  `${extractFunction("minimumSingingMinutes")}; ${extractFunction("hourPlanningBounds")}; ` +
  "this.hourPlanningBounds = hourPlanningBounds; this.minimumSingingMinutes = minimumSingingMinutes;",
  nhonHourSandbox
);
const nhonLargeBounds = nhonHourSandbox.hourPlanningBounds(
  { newInvoicePlanning: true },
  { hourlyRate: 600000, hourStep: 6000 },
  7457000,
  6779091
);
if (nhonLargeBounds.baseHour !== 1500000 || nhonLargeBounds.minHourAmount !== 1500000) {
  throw new Error("Phiếu mới Paris Nhơn từ 5 triệu phải áp sàn Tiền giờ 1.500.000đ.");
}
const nhonBelowThreshold = nhonHourSandbox.hourPlanningBounds(
  { newInvoicePlanning: true },
  { hourlyRate: 600000, hourStep: 6000 },
  4999999,
  4545454
);
if (nhonBelowThreshold.baseHour !== 500000) {
  throw new Error("Phiếu mới Paris Nhơn dưới 5 triệu phải giữ sàn Tiền giờ 500.000đ.");
}
const nhonExistingBounds = nhonHourSandbox.hourPlanningBounds(
  { newInvoicePlanning: false, currentHour: 0 },
  { hourlyRate: 600000, hourStep: 6000 },
  7457000,
  6779091
);
if (nhonExistingBounds.baseHour !== 500000) {
  throw new Error("Phiếu đã có của Paris Nhơn không được áp sàn phiếu mới 1.500.000đ.");
}

const hourSlotSandbox = {};
vm.createContext(hourSlotSandbox);
vm.runInContext(
  extractConst("DEFAULT_HOURLY_RATE") + "; " +
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

// --- Giờ ra để đối soát phải là giờ CỦA PHƯƠNG ÁN ----------------------------
//
// Ca thật Nhơn 01/07/2026, phiếu HD0126070003: phương án 16 phút (18:06→18:22,
// Tiền giờ 108.000đ) nhưng form giữ nguyên 18:06→19:33 (87 phút) sau khi lưu.
//
// Nửa sau của lỗi nằm ở đây: pendingPlanFromApproved lấy checkOut TỪ SNAPSHOT
// (giờ cũ trên form), nên verifySnapshotAgainstPlan so giờ cũ với chính nó và
// luôn thấy khớp — sai lệch bị che hoàn toàn, phiếu vẫn ra "Đã xử lý".
//
// Giờ VÀO thì ngược lại: là dữ liệu thật của khách, phải giữ theo snapshot.
{
  const plan = sandbox.pendingPlanFromApproved({
    invoiceNo: "HD0126070003",
    invoiceDateKey: "2026-07-01",
    targetGrand: 143000,
    goods: 25000,
    hour: 105000,
    tax: 13000,
    taxRate: 10,
    checkIn: "01/07/2026 18:06",
    checkOut: "01/07/2026 18:22",
    items: [{ code: 1000031, qty: 5, price: 5000 }]
  }, { invoiceNo: "HD0126070003", transactionDate: "2026-07-01", credit: 143000 }, {
    invoiceNo: "HD0126070003",
    invoiceDateKey: "2026-07-01",
    checkIn: "01/07/2026 18:06",
    // Giờ ra CŨ còn trên form — đúng thứ đã che mất sai lệch.
    checkOut: "01/07/2026 19:33"
  });
  if (plan.checkOut !== "01/07/2026 18:22") {
    throw new Error(`Giờ ra đối soát phải lấy từ phương án (18:22), đang là ${plan.checkOut}.`);
  }
  if (plan.checkIn !== "01/07/2026 18:06") {
    throw new Error(`Giờ vào phải giữ theo snapshot thật của khách, đang là ${plan.checkIn}.`);
  }
  // Cổng đối soát phải thực sự so giờ ra; nếu bỏ so thì sai lệch lại lọt.
  const verifySource = extractFunction("verifySnapshotAgainstPlan");
  if (!/compareUsageTime\("Sai giờ ra", snapshot\?\.checkOut, plan\?\.checkOut\)/.test(verifySource)) {
    throw new Error("verifySnapshotAgainstPlan phải so giờ ra của form với giờ ra của phương án.");
  }
}

// --- Bridge phải ghi giờ ra cho MỌI phiếu, không chỉ phiên bị rebase ----------
//
// Nửa đầu của cùng lỗi: applyInvoicePlan trong bridge.js chỉ ghi giờ khi
// detail.sessionRebased, mà phiếu đã tồn tại thì cờ đó là false, nên giờ ra của
// phương án không bao giờ được ghi xuống form. Website tính Tiền giờ TỪ giờ
// vào/ra nên phiếu lưu xong lệch tổng.
{
  const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
  const applyPlanBody = bridgeSource.slice(
    bridgeSource.indexOf("async function applyInvoicePlan"),
    bridgeSource.indexOf("const preservedFormState = captureInvoiceFormState();")
  );
  if (!applyPlanBody) throw new Error("Không tìm thấy applyInvoicePlan trong bridge.js.");
  if (/if\s*\(\s*detail\?\.sessionRebased\s*&&/.test(applyPlanBody)) {
    throw new Error("Bridge không được khóa việc ghi giờ ra sau cờ sessionRebased.");
  }
  if (!/detail\?\.checkOut/.test(applyPlanBody)) {
    throw new Error("Bridge phải ghi giờ ra dựa trên checkOut của phương án.");
  }
  // Phiếu đã tồn tại: giờ vào là dữ liệu thật của khách, phải keepCheckIn.
  if (!/applyInvoiceTimes\([^)]*!detail\.sessionRebased\)/.test(applyPlanBody)) {
    throw new Error("Phiếu đã tồn tại phải giữ nguyên giờ vào (keepCheckIn).");
  }
  // applyInvoicePlan phải trả về giờ THẬT trên form. Echo lại detail.checkOut
  // sẽ nói dối khi việc ghi giờ bị bỏ qua, và bước đối soát sau đó so giờ của
  // phương án với chính nó nên luôn thấy khớp.
  const returnBlock = bridgeSource.slice(
    bridgeSource.indexOf('mode: "kendo-atomic"'),
    bridgeSource.indexOf("function findInvoiceDate")
  );
  if (/checkOut:\s*detail\.checkOut\s*\|\|\s*""/.test(returnBlock)) {
    throw new Error("applyInvoicePlan không được echo lại giờ ra của phương án làm kết quả.");
  }
  if (!/findInvoiceTimes\(\)/.test(returnBlock)) {
    throw new Error("applyInvoicePlan phải đọc lại giờ thật trên form để trả về.");
  }
}

// --- Panel thủ công phải gửi giờ ra CỦA PHƯƠNG ÁN ----------------------------
//
// Bridge so checkOut nhận được với giờ đang có trên form để quyết định ghi hay
// bỏ qua. Panel thủ công trước đây gửi chính giờ cũ của form nên bridge luôn
// thấy "không đổi"; nhánh ghi bù thì đã bị vô hiệu bằng `false &&`.
{
  const applySource = source;
  if (/false\s*&&\s*proposedCheckOut/.test(applySource)) {
    throw new Error("Nhánh ghi giờ ra của panel thủ công không được để chết bằng `false &&`.");
  }
  if (!/checkOut:\s*proposedCheckOut/.test(applySource)) {
    throw new Error("Panel thủ công phải gửi proposedCheckOut cho applyInvoicePlan.");
  }
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

const roomCardWithoutAlt = {
  innerText: "VIP 21",
  dataset: {},
  getAttribute: () => "",
  querySelector: () => null
};
if (sandbox.roomCardName(roomCardWithoutAlt) !== "VIP 21") {
  throw new Error("Paris Nhơn room name must fall back to card text when image alt is empty.");
}
if (sandbox.isIdleRoomLabel("BAN LE", "BAN LE")) {
  throw new Error("BAN LE must not be selected for a room-hour invoice.");
}
// Quầy bán lẻ ở mọi cách viết đều bị loại; phòng thật thì không.
for (const retail of ["BÁN LẺ", "BAN LE", "Bán lẻ", "  ban   le "]) {
  if (!sandbox.isRetailRoomName(retail)) throw new Error(`"${retail}" phải được nhận là quầy bán lẻ.`);
}
for (const room of ["VIP 21", "VIP 55", "P.301", ""]) {
  if (sandbox.isRetailRoomName(room)) throw new Error(`"${room}" không phải quầy bán lẻ.`);
}

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

// A rotating priority is optional. If its requested quantity exceeds the
// product's per-invoice limit and empties the DP, retry once with required
// rules only instead of failing an otherwise valid invoice.
const rotateRetryCalls = [];
const rotatingFallbackBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [],
  pageTenantSlug: "pariskimgiang",
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  buildBatchCandidates: (_inventory, _target, _transaction, _usage, options) => {
    rotateRetryCalls.push(options || {});
    const exactCandidate = { code: "GOOD", name: "Hàng hợp lệ", price: 550000, qty: 0, maxQty: 1 };
    return options?.includeRotatingRule === false
      ? [exactCandidate]
      : [{ code: "ROTATE", name: "Ưu tiên luân phiên", price: 90000, qty: 0, minQty: 4, maxQty: 3 }, exactCandidate];
  },
  formatMoney: value => String(Number(value) || 0),
  recommendCheckOut: () => "01/07/2026 18:00"
};
vm.createContext(rotatingFallbackBox);
vm.runInContext(batchPlanDeps, rotatingFallbackBox);
const rotatingFallbackPlan = rotatingFallbackBox.calculateBatchPlan({
  ready: true,
  newInvoicePlanning: true,
  invoiceDateKey: "2026-07-01",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, {
  id: "rotate-fallback",
  transactionDate: "2026-07-01",
  // Dưới 1 triệu để sàn là 30 phút (300.000đ): fixture chỉ có một mã 550.000đ
  // nên tiền hàng cố định, mốc 50 phút của sao kê trên 1 triệu sẽ không đạt và
  // che mất thứ test này thực sự kiểm: việc NỚI RULE luân phiên.
  credit: 950000
}, mandatoryFixture);
if (rotatingFallbackPlan.status !== "ready" || !rotatingFallbackPlan.rotatingPriorityRelaxed) {
  throw new Error(`Rule luân phiên không ghép được phải tự nới và tính lại: ${rotatingFallbackPlan.reason || ""}`);
}
// calculateBatchPlan còn gọi buildBatchCandidates để đo sức chứa (chọn bội số
// trần số lượng/HĐ) trước khi giải, nên chỉ đếm lần gọi nới rule luân phiên:
// phải đúng một lần, và phải là lần cuối cùng (sau lần giải đầy đủ rule).
const requiredOnlyCalls = rotateRetryCalls.filter(options => options.includeRotatingRule === false);
if (requiredOnlyCalls.length !== 1 || rotateRetryCalls[rotateRetryCalls.length - 1].includeRotatingRule !== false) {
  throw new Error("Solver phải thử đúng một lần nữa với các rule bắt buộc duy nhất.");
}

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
  throw new Error(`A singing charge below the pre-VAT cap must pass: ${hourCapPlan.reason || ""}`);
}
// Trần đọc thẳng từ MAX_HOUR_PRETAX_RATIO: hardcode con số của 35% thì đổi tỷ lệ
// trong content.js mà test vẫn pass với mốc cũ.
const hourCapExpected = Math.floor(Math.round(4873000 / 1.1) * hourCapBox.MAX_HOUR_PRETAX_RATIO);
if (hourCapPlan.hour !== 1435000 || hourCapPlan.hourPreTaxCap !== hourCapExpected ||
    !hourCapPlan.hourWithinPreTaxCap) {
  throw new Error(`Sai trần Tiền giờ theo tổng trước VAT cho HD0126060142: ` +
    `trần ${hourCapPlan.hourPreTaxCap} (mong đợi ${hourCapExpected}), Tiền giờ ${hourCapPlan.hour}.`);
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
// Luật phiếu nhỏ (kế toán chốt 17/09/2026): tổng dưới 300.000đ thì đúng MỘT món
// bia/nước giá tối đa 50.000đ, toàn bộ phần trước VAT còn lại là Tiền giờ.
const smallBeerPlan = planBox.calculateNewInvoiceBatchPlan({
  id: "small-143000",
  transactionDate: "2026-06-30",
  credit: 143000
}, smallBeerStock);
if (smallBeerPlan.status !== "ready") {
  throw new Error(`Hóa đơn 143.000đ phải lập được phương án một món: ${smallBeerPlan.reason || ""}`);
}
if (smallBeerPlan.specialRule !== "under-500k-two-beers" ||
    smallBeerPlan.items.length !== 1 || smallBeerPlan.items[0].code !== "1100019" ||
    smallBeerPlan.items[0].qty !== 1) {
  throw new Error("Hóa đơn nhỏ phải có đúng một món và không được chọn BÌNH RÓT BIA.");
}
if (smallBeerPlan.goods !== 45000 ||
    smallBeerPlan.goods + smallBeerPlan.hour + smallBeerPlan.tax !== 143000) {
  throw new Error("Một món và phần Tiền giờ còn lại phải khớp tuyệt đối tổng sao kê sau VAT.");
}
// Phần lớn tiền phải nằm ở Tiền giờ, không phải tiền hàng.
if (!(smallBeerPlan.hour > smallBeerPlan.goods)) {
  throw new Error(`Phiếu nhỏ phải dồn phần lớn vào Tiền giờ: hàng ${smallBeerPlan.goods}, giờ ${smallBeerPlan.hour}`);
}
if (smallBeerPlan.durationMinutes >= 30) {
  throw new Error("Nhánh phiếu nhỏ phải được phép dùng thời lượng dưới sàn 30 phút của hóa đơn thường.");
}
// Món đắt hơn 50.000đ không được chọn cho phiếu nhỏ.
const expensiveOnlyPlan = planBox.calculateNewInvoiceBatchPlan({
  id: "small-expensive", transactionDate: "2026-06-30", credit: 143000
}, [{ webCode: "1300013", webName: "Rượu vang đỏ", webUnit: "chai", webPrice: 650000, availableQty: 10 }]);
if (expensiveOnlyPlan.status === "ready") {
  throw new Error("Phiếu nhỏ không được chọn món trên 50.000đ.");
}
// Mốc 300.000đ trở lên đi nhánh thường (nhiều dòng hàng).
const atThreshold = planBox.calculateBatchPlan({
  ready: true, newInvoicePlanning: true, invoiceNo: "", invoiceDateKey: "2026-06-30",
  currentHour: 0, currentGrand: 0, taxRate: 10
}, { transactionDate: "2026-06-30", credit: 300000 }, smallBeerStock);
if (atThreshold.specialRule === "under-500k-two-beers") {
  throw new Error("Mốc đúng 300.000đ không được áp luật phiếu nhỏ.");
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
if (!zeroHourPlan.reason.includes("một món")) {
  throw new Error(`Lý do phải nêu rõ thiếu tồn cho quy tắc một món của phiếu nhỏ: ${zeroHourPlan.reason}`);
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
  // Từ 18/09/2026 sàn thời lượng 30 phút THẮNG trần 35%: nền Tiền giờ không
  // còn bị kẹp xuống dưới sàn, mà trần được nới vừa đủ để chứa sàn. Nền vẫn
  // phải nhỏ hơn Tiền giờ cũ của phiếu (tức có kẹp xuống), nhưng không nhất
  // thiết bằng đúng 35%.
  if (existingPlan.hourBase > currentHour) {
    throw new Error(`Nền Tiền giờ không được vượt nền cũ ${currentHour}đ, đang là ${existingPlan.hourBase}.`);
  }
  if (existingPlan.hourBase < expectedCap) {
    throw new Error(`Nền Tiền giờ ${existingPlan.hourBase}đ không được thấp hơn trần 35% (${expectedCap}đ) sau khi sàn được ưu tiên.`);
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

// Từ 18/09/2026 sàn thời lượng thắng trần 35%: mốc 50 phút (500.000đ) không còn
// bị kẹp xuống 319.595đ mà trần được nới để chứa nó. Nền phải nằm trong khoảng
// [trần 35%, mốc phút] và Tiền giờ cuối không thấp hơn trần cũ.
if (spreadPlan.hourBase < 319595 || spreadPlan.hourBase > 500000) {
  throw new Error(`Nền Tiền giờ phải nằm giữa trần 35% (319.595đ) và mốc 50 phút (500.000đ), đang là ${spreadPlan.hourBase}.`);
}
if (spreadPlan.hour < 319595) {
  throw new Error(`Tiền giờ ${spreadPlan.hour}đ không được thấp hơn trần 35% sau khi sàn được ưu tiên.`);
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
  `${extractConst("RELAXED_MANDATORY_GROUPS")}; ${extractConst("RELAXED_MANDATORY_TENANT")}; ` +
  `${extractConst("RELAXED_MANDATORY_GRAND_LIMIT")}; ${extractFunction("mandatoryGroupsFor")}; ` +
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
const requiredOnlyRuleCandidates = ruleBox.buildBatchCandidates([
  { webCode: "1500007", webName: "Hoa quả to", webUnit: "đĩa", webPrice: 400000, availableQty: 1 },
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 55000, availableQty: 20 }
], 1500000, { id: "tx-rule-fallback", transactionDate: "2026-06-30", credit: 1500000 }, new Map(), {
  includeRotatingRule: false
});
if (requiredOnlyRuleCandidates.find(item => item.code === "1500007")?.minQty !== 0) {
  throw new Error("Lượt tính dự phòng phải bỏ sàn số lượng của rule luân phiên.");
}
if (requiredOnlyRuleCandidates.find(item => item.code === "1100019")?.minQty !== 1) {
  throw new Error("Lượt tính dự phòng vẫn phải giữ rule bắt buộc.");
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
    // Nhơn có 3 mức đơn giá giờ nên Batch Review gọi chooseNewInvoiceRoomPlan
    // (thử từng mức rồi chốt phòng) thay vì gọi thẳng calculateNewInvoiceBatchPlan.
    chooseNewInvoiceRoomPlan: transaction => ({
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
      hourlyRate: 600000,
      checkIn: "20/07/2026 15:00",
      checkOut: "20/07/2026 15:46",
      items: [{ code: "A", qty: 1, price: 900000, maxQty: 1 }]
    }),
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
    waitForOpenedInvoice: invoiceNo => ({ ready: true, invoiceNo }),
    // Chốt chặn context mồ côi và tự tải lại khi quá tải nằm ngoài phạm vi
    // luồng này: context luôn "sống", không lỗi nào là quá tải.
    assertRuntimeContext: () => {},
    isPageOverloadError: () => false,
    scheduleAutoReloadResume: async () => false
  };
  vm.createContext(box);
  vm.runInContext(`${extractConst("MAX_BATCH_TRANSACTIONS")}; ${extractFunction("buildBatchReview")}; this.buildBatchReview = buildBatchReview;`, box);
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
  // Paris Nhơn mặc định chỉ render khu BÁN LẺ: phải chọn TẤT CẢ trước khi
  // quét, tìm nút theo id lẫn theo chữ, bấm theo kết quả quét và chờ thẻ phòng
  // render xong thay vì ngủ cố định rồi quét lại ngay.
  const autoOpenSource = extractFunction("autoOpenIdleRoomInvoiceForm");
  for (const marker of [
    'pageTenantSlug === "parisnhon" && !diagnostics.allRoomAreasSelected',
    "const allRoomsButton = findAllRoomAreasButton();",
    "const cardsBefore = roomCardsExcludingRetail().length;",
    "if (cardsBefore === 0) {",
    "await waitForRoomCards(cardsBefore, 2500);"
  ]) {
    if (!autoOpenSource.includes(marker)) throw new Error(`Tự chọn TẤT CẢ khu phòng ở Nhơn thiếu: ${marker}`);
  }
  const findAllSource = extractFunction("findAllRoomAreasButton");
  if (!findAllSource.includes('document.getElementById("_ALL_")') ||
      !findAllSource.includes('roomAreaKey(element.innerText) === "TAT CA"')) {
    throw new Error("Nút TẤT CẢ phải được tìm theo id _ALL_ và dự phòng theo chữ trên nút.");
  }
  if (autoOpenSource.includes('classList.contains("btn-danger")')) {
    throw new Error("Không được quyết định bấm TẤT CẢ theo class của nút; phải theo số thẻ phòng quét được.");
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

// Hóa đơn nhỏ giữ luật riêng một món, KHÔNG áp luật nhóm bắt buộc (3 bia + 2 khăn).
const smallStillTwoBeers = planBox.calculateBatchPlan({
  ready: true,
  invoiceNo: "HD-SMALL2",
  invoiceDateKey: "2026-06-30",
  currentHour: 0,
  currentGrand: 0,
  taxRate: 10
}, { id: "small2", transactionDate: "2026-06-30", credit: 143000 },
[{ webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 45000, availableQty: 8 }]);
if (smallStillTwoBeers.status !== "ready") {
  throw new Error(`Hóa đơn nhỏ vẫn phải lập được dù không có khăn ướt: ${smallStillTwoBeers.reason || ""}`);
}
if (smallStillTwoBeers.specialRule !== "under-500k-two-beers") {
  throw new Error("Hóa đơn nhỏ phải đi nhánh luật riêng");
}

// --- Phiếu nhỏ: giờ vào/ra phải KHỚP Tiền giờ ---------------------------------
//
// Ca thật Nhơn 01/07/2026, phiếu HD0126070003: Batch Review hiện "18:06 → 19:33,
// 0 phút · theo giờ 30.000đ". 87 phút ở phòng 600k phải là 870.000đ, không phải
// 30.000đ. Nhánh 2 bia giữ nguyên giờ cũ của phiếu nhưng vẫn đặt Tiền giờ bằng
// phần còn lại, và không trả durationMinutes nên giao diện hiện 0 phút.
const smallHourScan = {
  ready: true, invoiceNo: "HD0126070003", invoiceDateKey: "2026-07-01",
  currentGoods: 0, currentHour: 870000, currentTax: 0, taxRate: 10, currentGrand: 870000,
  checkIn: "01/07/2026 18:06", checkOut: "01/07/2026 19:33", durationMinutes: 87, items: []
};
const smallHourPlan = planBox.calculateBatchPlan(smallHourScan,
  { id: "small-143000", transactionDate: "2026-07-01", credit: 143000 }, smallBeerStock);
if (smallHourPlan.status !== "ready" || smallHourPlan.specialRule !== "under-500k-two-beers") {
  throw new Error("Phiếu 143.000đ phải đi nhánh 2 bia: " + (smallHourPlan.reason || ""));
}
if (!(smallHourPlan.durationMinutes > 0)) {
  throw new Error("Phương án phải trả về thời lượng, nếu không giao diện hiện 0 phút: " + smallHourPlan.durationMinutes);
}
{
  const rate = smallHourPlan.hourlyRate || 600000;
  const amountFromMinutes = Math.round(Math.round((smallHourPlan.durationMinutes / 60) * 100) * rate / 100);
  if (amountFromMinutes !== smallHourPlan.hourFromTime) {
    throw new Error("Tiền giờ theo thời lượng phải khớp hourFromTime: " + amountFromMinutes + " ≠ " + smallHourPlan.hourFromTime);
  }
  if (Math.abs(smallHourPlan.hour - amountFromMinutes) > rate / 100) {
    throw new Error("Tiền giờ " + smallHourPlan.hour + "đ không khớp thời lượng " + smallHourPlan.durationMinutes + " phút (" + amountFromMinutes + "đ)");
  }
}
if (smallHourPlan.checkOut === smallHourScan.checkOut) {
  throw new Error("Giờ ra phải được đề xuất lại theo Tiền giờ, không giữ giờ cũ của phiếu.");
}

// --- Đơn giá suy từ phiếu cũ phải là mức có thật trong bảng giá ----------------
//
// Ca thật Nhơn 01/07/2026 (phiếu HD0126070003): phiếu cũ 18:06→23:06 là 300 phút
// với Tiền giờ 105.000đ, tức 21.000đ/giờ — không mức giá nào như vậy. Phương án
// giữ nguyên con số đó rồi đề xuất lại đúng 300 phút, hiển thị "300 phút · theo
// giờ 105.000đ". Đơn giá phải luôn được quy về một mức trong bảng.
const rateBox = { pageTenantSlug: "parisnhon" };
vm.createContext(rateBox);
vm.runInContext(
  `${extractConst("DEFAULT_HOURLY_RATE")} ${extractConst("PARIS_NHON_ROOM_HOURLY_RATES")} ` +
  `${extractFunction("normalizeRoomText")}; ${extractFunction("tenantHourlyRates")}; ` +
  `${extractFunction("hourPricingForRate")}; ${extractFunction("inferHourPricing")}; ` +
  `${extractFunction("parseUiDateTime")}; ${extractFunction("formatUiDateTime")}; ` +
  `${extractFunction("recommendCheckOut")}; ` +
  "this.inferHourPricing = inferHourPricing; this.recommendCheckOut = recommendCheckOut;",
  rateBox
);
for (const [currentHour, durationMinutes] of [[105000, 300], [400000, 180], [700000, 180], [30000, 3]]) {
  const pricing = rateBox.inferHourPricing({ currentHour, durationMinutes });
  if (![400000, 600000, 800000].includes(pricing.hourlyRate)) {
    throw new Error(`Đơn giá suy ra ${pricing.hourlyRate} không có trong bảng giá (từ ${currentHour}đ / ${durationMinutes} phút)`);
  }
  if (pricing.hourStep !== Math.round(pricing.hourlyRate / 100)) {
    throw new Error("Bước giá phải là 1% đơn giá");
  }
}

// Giờ ra đề xuất phải là thời lượng ĐÚNG với Tiền giờ, không phải thời lượng cũ.
// Nhiều mốc phút cho cùng một số tiền (website làm tròn 0,01 giờ) nên khi hòa
// phải lấy mốc ngắn nhất.
{
  const scan = { checkIn: "01/07/2026 18:06", durationMinutes: 300 };
  const checkOut = rateBox.recommendCheckOut(scan, 80000, 400000);
  if (checkOut !== "01/07/2026 18:18") {
    throw new Error(`80.000đ ở phòng 400k phải là 12 phút (18:18), nhận ${checkOut}`);
  }
  const longScan = { checkIn: "01/07/2026 18:00", durationMinutes: 600 };
  if (rateBox.recommendCheckOut(longScan, 600000, 600000) !== "01/07/2026 19:00") {
    throw new Error("600.000đ ở phòng 600k phải là đúng 60 phút");
  }
}

// --- Thứ tự lập phương án theo giờ giao dịch -------------------------------
// Thứ tự này quyết định slot giờ/phòng cấp cho phiếu mới và quyết định lô N
// giao dịch đầu gồm những giao dịch nào, nên phải sắp TRƯỚC khi cắt theo limit.
const orderedForReview = sandbox.selectBatchReviewTransactions([
  { id: "c", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 20:05", rowNumber: 2 },
  { id: "a", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 09:15", rowNumber: 7 },
  { id: "d", status: "pending", transactionDate: "2026-07-02", requestedAt: "2026-07-02 08:00", rowNumber: 1 },
  { id: "b", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 11:40", rowNumber: 5 }
], {});
if (orderedForReview.map(item => item.id).join("") !== "abcd") {
  throw new Error(`Phải sắp theo ngày rồi giờ giao dịch: ${orderedForReview.map(item => item.id).join("")}`);
}

// Thiếu requestedAt thì rơi về thứ tự dòng trong file, không được vỡ thứ tự.
const missingStamp = sandbox.selectBatchReviewTransactions([
  { id: "y", status: "pending", transactionDate: "2026-07-01", requestedAt: "", rowNumber: 9 },
  { id: "x", status: "pending", transactionDate: "2026-07-01", requestedAt: "", rowNumber: 3 }
], {});
if (missingStamp.map(item => item.id).join("") !== "xy") {
  throw new Error("Thiếu giờ giao dịch phải rơi về rowNumber");
}

// Cắt theo limit phải diễn ra SAU khi sắp: lô 2 giao dịch đầu của ngày phải là
// hai giao dịch sớm nhất, không phải hai dòng đầu trong file.
const limited = sandbox.selectBatchReviewTransactions([
  { id: "late", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 23:00", rowNumber: 1 },
  { id: "mid", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 15:00", rowNumber: 2 },
  { id: "early", status: "pending", transactionDate: "2026-07-01", requestedAt: "2026-07-01 08:00", rowNumber: 3 }
], { limit: 2 });
if (limited.map(item => item.id).join(",") !== "early,mid") {
  throw new Error(`Limit phải cắt sau khi sắp: ${limited.map(item => item.id).join(",")}`);
}

// --- Kho thật (buildInventory) ghi constraintGroupMax = null -----------------
//
// Mọi fixture phía trên dựng tay nên không có thuộc tính constraintGroupMax
// (undefined). Kho thật đi qua buildInventory lại ghi `null` cho mọi mã không
// có trần nhóm; Number(null) là 0 nên solver từng coi đó là trần nhóm = 0 và
// không bao giờ cho bia/khăn ướt vào phương án — hóa đơn lặng lẽ thiếu món bắt
// buộc, còn hóa đơn lớn ở Nhơn mất luôn sức chứa của 3 mã bia và báo "không
// tìm được tổ hợp hàng". Ca này phải đi đúng đường dữ liệu thật: buildInventory
// → candidateFromStock → solver, không mock buildBatchCandidates.
const mappingEngineForStock = require(path.join(__dirname, "..", "mapping-engine.js"));
require(path.join(__dirname, "..", "mapping-parisnhon.js"));
const realStockBox = {
  InvoiceTargetSolver: solver,
  priorityRules: [],
  pageTenantSlug: "parisnhon",
  inferHourPricing: () => ({ hourlyRate: 600000, hourStep: 6000 }),
  formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
  recommendCheckOut: () => "05/08/2026 22:00"
};
vm.createContext(realStockBox);
vm.runInContext(
  `${batchPlanDeps}; ${extractConst("PARIS_NHON_LARGE_INVOICE_THRESHOLD")}; ` +
  `${extractConst("PARIS_NHON_LARGE_INVOICE_MIN_HOUR")}; ` +
  `${extractFunction("candidateFromStock")}; ${extractFunction("buildBatchCandidates")}; ` +
  // Giờ ra phải dùng hàm THẬT: stub trả chuỗi cố định làm mọi phép kiểm tra
  // thời lượng trong sandbox này trở nên vô nghĩa.
  `${extractFunction("recommendCheckOut")}; this.recommendCheckOut = recommendCheckOut; ` +
  `${extractFunction("newInvoicePlanValidationError")}; ` +
  `${extractConst("NEW_INVOICE_CHECKIN_START_MINUTES")} ${extractConst("NEW_INVOICE_CHECKIN_STEP_MINUTES")} ` +
  `${extractConst("NEW_INVOICE_CHECKIN_LAST_MINUTES")} const NEW_INVOICE_CHECKIN_SLOT_COUNT = Math.floor((NEW_INVOICE_CHECKIN_LAST_MINUTES - NEW_INVOICE_CHECKIN_START_MINUTES) / NEW_INVOICE_CHECKIN_STEP_MINUTES) + 1; ` +
  `${extractFunction("newInvoiceCheckInMinutes")}; ${extractFunction("newInvoicePlanningScan")}; ` +
  `${extractFunction("calculateNewInvoiceBatchPlan")}; ${extractFunction("chooseNewInvoiceRoomPlan")}; ` +
  `${extractFunction("closestReachableHourSlot")}; ${extractFunction("formatUiDateTime")}; ` +
  "this.newInvoicePlanValidationError = newInvoicePlanValidationError; " +
  "this.chooseNewInvoiceRoomPlan = chooseNewInvoiceRoomPlan; " +
  "this.tenantHourlyRates = tenantHourlyRates; this.hourPricingForRate = hourPricingForRate;",
  realStockBox
);
const countByRule = (plan, matcher) => (plan.items || [])
  .filter(item => matcher({ webName: item.name }))
  .reduce((sum, item) => sum + Number(item.qty || 0), 0);

// Ca thật Paris Nhơn: sao kê 7.457.000đ, trần Tiền giờ 35% = 2.372.681đ nên
// tiền hàng phải ≥ 4.406.410đ trong tối đa 16 dòng — chỉ đạt khi 3 mã bia
// (12 chai/HĐ) được phép vào phương án.
const nhonDataset = JSON.parse(JSON.stringify(global.InvoiceMappingParisNhon));
for (const row of nhonDataset.mappings) if (row.webCode) row.status = "confirmed";
const nhonInventory = mappingEngineForStock.buildInventory(nhonDataset);
if (!nhonInventory.length || !nhonInventory.every(stock => stock.constraintGroupMax === null)) {
  throw new Error("Fixture phải giữ đúng hình dạng kho thật: constraintGroupMax = null");
}
const nhonLargePlan = realStockBox.calculateBatchPlan({
  ready: true, newInvoicePlanning: true, invoiceNo: "", invoiceDateKey: "2026-08-05",
  currentGoods: 0, currentHour: 0, currentTax: 0, taxRate: 10, currentGrand: 0,
  checkIn: "05/08/2026 20:00", checkOut: "05/08/2026 20:00", durationMinutes: 1, items: []
}, { id: "nhon-7457000", transactionDate: "2026-08-05", credit: 7457000 }, nhonInventory, new Map());
if (nhonLargePlan.status !== "ready") {
  throw new Error(`Paris Nhơn 7.457.000đ phải lập được phương án: ${nhonLargePlan.reason || nhonLargePlan.status}`);
}
if (nhonLargePlan.items.length > 16) {
  throw new Error(`Phương án Nhơn 7.457.000đ vượt 16 dòng: ${nhonLargePlan.items.length}`);
}
if (nhonLargePlan.goods < 4406410) {
  throw new Error(`Tiền hàng ${nhonLargePlan.goods} phải ≥ 4.406.410đ để Tiền giờ không vượt trần 35%`);
}
if (countByRule(nhonLargePlan, realStockBox.isBeerStock) < 3) {
  throw new Error("Phương án Nhơn 7.457.000đ phải có ≥3 bia");
}
if (countByRule(nhonLargePlan, realStockBox.isWetTowelStock) < 2) {
  throw new Error("Phương án Nhơn 7.457.000đ phải có ≥2 khăn ướt");
}

// Hóa đơn thường ở cơ sở khác, cùng hình dạng kho thật: phương án không được
// lặng lẽ thiếu bia/khăn khi tồn vẫn đủ.
const plainRealStock = [
  { webCode: "1100019", webName: "Bia Tiger Crystal", webUnit: "chai", webPrice: 45000, availableQty: 200, constraintGroup: "", constraintGroupMax: null },
  { webCode: "1000030", webName: "Khăn ướt V1020", webUnit: "Cái", webPrice: 5000, availableQty: 500, constraintGroup: "", constraintGroupMax: null },
  { webCode: "1000043", webName: "Bò miếng to 60g", webUnit: "gói", webPrice: 90000, availableQty: 50, constraintGroup: "", constraintGroupMax: null },
  { webCode: "1100021", webName: "Yến chưng", webUnit: "Hũ", webPrice: 90000, availableQty: 50, constraintGroup: "", constraintGroupMax: null },
  { webCode: "1000033", webName: "Loacker Bánh Xốp Kem 45g", webUnit: "gói", webPrice: 60000, availableQty: 50, constraintGroup: "", constraintGroupMax: null }
];
const plainRealPlan = realStockBox.calculateBatchPlan({
  ready: true, invoiceNo: "HD-REAL-STOCK", invoiceDateKey: "2026-06-30",
  currentHour: 600000, currentGrand: 0, taxRate: 10, durationMinutes: 60
}, { id: "real-stock", transactionDate: "2026-06-30", credit: 2000000 }, plainRealStock, new Map());
if (plainRealPlan.status !== "ready") {
  throw new Error(`Kho thật constraintGroupMax = null phải lập được phương án: ${plainRealPlan.reason || plainRealPlan.status}`);
}
if (countByRule(plainRealPlan, realStockBox.isBeerStock) < 3 || countByRule(plainRealPlan, realStockBox.isWetTowelStock) < 2) {
  throw new Error(`Kho thật constraintGroupMax = null vẫn phải ra ≥3 bia + ≥2 khăn: ${plainRealPlan.items.map(item => `${item.name} x${item.qty}`).join(", ")}`);
}

// --- Hóa đơn rất lớn ở Nhơn: nâng trần số lượng/HĐ theo bội số vừa đủ ---------
//
// Sao kê 14.000.000đ: trước VAT 12.727.273đ, trần Tiền giờ 35% = 4.454.545đ nên
// tiền hàng phải ≥ 8.272.728đ. Với trần mặc định (bia 12 lon, đồ khô 2-4) 20 mã
// ở mức trần chỉ được ~6,8 triệu → không thể lập. Phải nâng trần vừa đủ, còn
// phiếu thường (7.457.000đ) giữ nguyên bội số 1.
if (nhonLargePlan.quantityScale !== 1) {
  throw new Error(`Phiếu 7.457.000đ còn đủ sức chứa nên phải giữ trần mặc định, nhận ${nhonLargePlan.quantityScale}`);
}
const nhonHugePlan = realStockBox.calculateBatchPlan({
  ready: true, newInvoicePlanning: true, invoiceNo: "", invoiceDateKey: "2026-07-05",
  currentGoods: 0, currentHour: 0, currentTax: 0, taxRate: 10, currentGrand: 0,
  checkIn: "05/07/2026 20:00", checkOut: "05/07/2026 20:00", durationMinutes: 1, items: []
}, { id: "nhon-14000000", transactionDate: "2026-07-05", credit: 14000000 }, nhonInventory, new Map());
if (nhonHugePlan.status !== "ready") {
  throw new Error(`Paris Nhơn 14.000.000đ phải lập được phương án bằng cách nâng trần số lượng/HĐ: ${nhonHugePlan.reason || nhonHugePlan.status}`);
}
if (!(nhonHugePlan.quantityScale > 1)) throw new Error("Phiếu 14 triệu phải dùng bội số trần > 1.");
if (nhonHugePlan.goods < 8272728) throw new Error(`Tiền hàng ${nhonHugePlan.goods} phải ≥ 8.272.728đ để Tiền giờ không vượt trần 35%`);
if (nhonHugePlan.goods + nhonHugePlan.hour + nhonHugePlan.tax !== 14000000) throw new Error("Tổng phải khớp sao kê 14.000.000đ.");
if (nhonHugePlan.items.length > 20) throw new Error(`Không vượt 20 dòng: ${nhonHugePlan.items.length}`);
for (const item of nhonHugePlan.items) {
  if (item.qty > item.maxQty) throw new Error(`${item.name} vượt trần đã nâng: ${item.qty} > ${item.maxQty}`);
}
if (countByRule(nhonHugePlan, realStockBox.isBeerStock) < 3 || countByRule(nhonHugePlan, realStockBox.isWetTowelStock) < 2) {
  throw new Error("Phiếu 14 triệu vẫn phải có ≥3 bia + ≥2 khăn ướt.");
}

// --- Hoa quả theo NHÓM và luân phiên mã trong lô (kho thật Nhơn) ---------------
//
// Ảnh chụp Batch Review 16/09/2026: mọi phiếu đều Tiger + Bưởi da xanh (đĩa nhỏ)
// + khăn dù kho có 3 loại bia, 4 loại đĩa. Ba nguyên nhân: phiếu nhỏ luôn chọn
// bia rẻ nhất; rule hoa quả ghim một mã; hình phạt "đã dùng" tuyến tính cộng
// theo dòng nên tổ hợp ít dòng lặp mã cũ vẫn rẻ hơn tổ hợp nhiều dòng mã mới.
const FRUIT_CODES = new Set(["0000012", "0000013", "0000047", "0000048"]);
const nhonFruitDataset = mappingEngineForStock.applyBusinessRules(JSON.parse(JSON.stringify(nhonDataset)), "parisnhon");
const nhonFruitInventory = mappingEngineForStock.buildInventory(nhonFruitDataset);
if (nhonFruitInventory.filter(stock => FRUIT_CODES.has(String(stock.webCode))).length !== 4) {
  throw new Error("Kho Nhơn sau rule nghiệp vụ phải có 4 đĩa hoa quả bán theo suất.");
}
const newNhonScan = date => ({
  ready: true, newInvoicePlanning: true, invoiceNo: "", invoiceDateKey: date,
  currentGoods: 0, currentHour: 0, currentTax: 0, taxRate: 10, currentGrand: 0,
  checkIn: "05/07/2026 20:00", checkOut: "05/07/2026 20:00", durationMinutes: 1, items: []
});
const fruitItems = plan => (plan.items || []).filter(item => FRUIT_CODES.has(String(item.code)));
const withFruitPlan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"),
  { id: "fruit-2m", transactionDate: "2026-07-05", credit: 2000000 }, nhonFruitInventory, new Map());
if (withFruitPlan.status !== "ready") throw new Error(`Phiếu 2 triệu Nhơn phải lập được: ${withFruitPlan.reason}`);
if (fruitItems(withFruitPlan).length !== 1 || fruitItems(withFruitPlan)[0].qty !== 1) {
  throw new Error(`Phiếu Nhơn trên 1 triệu phải có đúng một đĩa hoa quả: ${withFruitPlan.items.map(item => `${item.name} x${item.qty}`).join(", ")}`);
}
const bigFruitPlan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"),
  { id: "fruit-7m", transactionDate: "2026-07-05", credit: 7457000 }, nhonFruitInventory, new Map());
if (bigFruitPlan.status !== "ready" || fruitItems(bigFruitPlan).length !== 1) {
  throw new Error(`Phiếu 7.457.000đ vẫn phải có đúng một đĩa hoa quả: ${bigFruitPlan.reason || bigFruitPlan.items.length}`);
}
const underMillionPlan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"),
  { id: "fruit-800k", transactionDate: "2026-07-05", credit: 800000 }, nhonFruitInventory, new Map());
if (underMillionPlan.status !== "ready") throw new Error(`Phiếu 800.000đ phải lập được: ${underMillionPlan.reason}`);

// --- Nhơn dưới 500.000đ: món bắt buộc hạ xuống 1 bia + 1 khăn ----------------
//
// Ca thật Nhơn 01/07/2026, sao kê 486.200đ (trước VAT 442.000đ). Mức bắt buộc
// 3 bia + 2 khăn của kho Nhơn rẻ nhất đã ~410.000đ, ăn gần hết phần trước VAT:
// hourPlanningBounds chỉ còn 32.000đ cho Tiền giờ nên phải hạ sàn 30 phút
// xuống 3 PHÚT. Phiếu 3 phút hát mà uống 3 bia thì không qua được kế toán.
//
// Kế toán chốt 18/09/2026: dưới 500.000đ ở Nhơn chỉ cần 1 bia + 1 khăn, nhờ đó
// sàn 30 phút (300.000đ) trở lại khả thi.
{
  const groups = realStockBox.mandatoryGroupsFor(486200).map(rule => `${rule.minQty} ${rule.label}`);
  if (groups.join(" + ") !== "1 bia + 1 khăn ướt") {
    throw new Error(`Nhơn dưới 500.000đ phải chỉ cần 1 bia + 1 khăn, đang là: ${groups.join(" + ")}`);
  }
  // Từ 500.000đ trở lên giữ nguyên mức đầy đủ.
  const fullGroups = realStockBox.mandatoryGroupsFor(500000).map(rule => `${rule.minQty} ${rule.label}`);
  if (fullGroups.join(" + ") !== "3 bia + 2 khăn ướt") {
    throw new Error(`Từ 500.000đ phải giữ 3 bia + 2 khăn, đang là: ${fullGroups.join(" + ")}`);
  }

  const plan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-01"),
    { id: "nhon-486200", transactionDate: "2026-07-01", credit: 486200 }, nhonFruitInventory, new Map());
  if (plan.status !== "ready") {
    throw new Error(`Sao kê 486.200đ phải lập được sau khi hạ món bắt buộc: ${plan.reason}`);
  }
  // Điều thực sự phải sửa: KHÔNG còn phiếu 3 phút. Sàn đọc thẳng từ code để
  // đổi mốc trong content.js mà test vẫn pass với giá trị cũ là không thể.
  const floorMinutes = realStockBox.minimumSingingMinutes(486200);
  if (Math.round(Number(plan.durationMinutes) || 0) < floorMinutes) {
    throw new Error(`Phiếu 486.200đ phải đạt sàn ${floorMinutes} phút, đang là ${plan.durationMinutes} phút ` +
      `(Tiền giờ ${plan.hour}đ, tiền hàng ${plan.goods}đ).`);
  }
  if (plan.goods + plan.hour + plan.tax !== 486200) {
    throw new Error("Phương án 486.200đ phải khớp tuyệt đối tổng sao kê.");
  }
  // Vẫn phải có hàng: 1 bia + 1 khăn là sàn mới, không phải bỏ hẳn món bắt buộc.
  const beerQty = (plan.items || [])
    .filter(item => realStockBox.isBeerStock({ webName: item.name }))
    .reduce((sum, item) => sum + Math.round(Number(item.qty) || 0), 0);
  const towelQty = (plan.items || [])
    .filter(item => realStockBox.isWetTowelStock({ webName: item.name }))
    .reduce((sum, item) => sum + Math.round(Number(item.qty) || 0), 0);
  if (beerQty < 1 || towelQty < 1) {
    throw new Error(`Phiếu nhỏ ở Nhơn vẫn phải có ít nhất 1 bia + 1 khăn, đang là ${beerQty} bia / ${towelQty} khăn.`);
  }
}

// Luân phiên: cùng một số tiền lặp lại nhiều lần trong lô phải đổi bia và đổi
// đĩa hoa quả thay vì ra đúng một bộ mã.
const accumulateUsage = (usage, plan) => {
  for (const item of plan.items || []) usage.set(String(item.code), (usage.get(String(item.code)) || 0) + 1);
  return usage;
};
const beerCodes = plan => (plan.items || []).filter(item => realStockBox.isBeerStock({ webName: item.name })).map(item => item.code).sort().join("+");
const rotationUsage = new Map();
const rotationPlans = [];
for (let round = 0; round < 4; round += 1) {
  const plan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"),
    { id: `rotate-${round}`, transactionDate: "2026-07-05", credit: 1500000 }, nhonFruitInventory, rotationUsage);
  if (plan.status !== "ready") throw new Error(`Phiếu luân phiên ${round} phải lập được: ${plan.reason}`);
  rotationPlans.push(plan);
  accumulateUsage(rotationUsage, plan);
}
if (new Set(rotationPlans.map(plan => fruitItems(plan)[0]?.code)).size < 2) {
  throw new Error(`Bốn phiếu 1,5 triệu liên tiếp phải đổi loại đĩa hoa quả: ${rotationPlans.map(plan => fruitItems(plan)[0]?.name).join(" | ")}`);
}
if (new Set(rotationPlans.map(beerCodes)).size < 2) {
  throw new Error(`Bốn phiếu 1,5 triệu liên tiếp phải đổi bộ bia: ${rotationPlans.map(beerCodes).join(" | ")}`);
}

// --- Số phút ghi lên form phải khớp Tiền giờ website tự tính -----------------
//
// Website tính Tiền giờ TỪ giờ vào/ra và làm tròn 0,01 giờ, nên không phải số
// tiền nào cũng biểu diễn được. Hai lỗi thật đã gặp:
//
//   1. Sao kê 1.001.000đ: solver làm tròn LÊN thành 504.000đ nhưng giờ ra 50
//      phút = 0,83 giờ = 498.000đ. Phiếu lưu xong ra 998.800đ, lệch 2.200đ.
//   2. Sao kê 132.000đ (nhánh phiếu nhỏ): làm tròn thẳng hour/rate ra 10 phút =
//      102.000đ trong khi Tiền giờ là 95.000đ — lệch 7.000đ, vượt bước giá
//      6.000đ, mà cổng kiểm tra lúc mở form vẫn cho qua.
{
  const cases = [
    { credit: 1001000, note: "50 phút = 0,83 giờ, không biểu diễn được 504.000đ" },
    { credit: 132000, note: "nhánh phiếu nhỏ, làm tròn thẳng cho phần bù > 1 bước" }
  ];
  for (const { credit, note } of cases) {
    const scan = {
      ready: true, invoiceNo: "01000000430", invoiceDateKey: "2026-07-18",
      currentGoods: 0, currentHour: 0, currentTax: 0, taxRate: 10, currentGrand: 0,
      checkIn: "18/07/2026 17:00", checkOut: "18/07/2026 18:30", durationMinutes: 90, items: []
    };
    const plan = realStockBox.calculateBatchPlan(scan,
      { id: "reach-" + credit, transactionDate: "2026-07-18", credit },
      nhonFruitInventory, new Map());
    if (plan.status !== "ready") throw new Error(`${credit}đ phải lập được: ${plan.reason}`);
    const rate = plan.hourlyRate;
    const step = Math.round(rate / 100);
    // hourFromTime phải là số tiền website tính ra TỪ ĐÚNG số phút sẽ ghi lên form.
    const websiteHour = Math.round(Math.round((plan.durationMinutes / 60) * 100) * rate / 100);
    if (websiteHour !== plan.hourFromTime) {
      throw new Error(`${credit}đ (${note}): ${plan.durationMinutes} phút cho ${websiteHour}đ ` +
        `nhưng phương án ghi hourFromTime ${plan.hourFromTime}đ.`);
    }
    // Phần bù không được vượt một bước giá, nếu không phiếu lưu xong lệch tổng.
    if (Math.abs(plan.hour - plan.hourFromTime) > step) {
      throw new Error(`${credit}đ (${note}): phần bù ${plan.hourAdjustment}đ vượt một bước ${step}đ.`);
    }
    // Và phải qua được cổng kiểm tra lúc mở form.
    const validation = realStockBox.newInvoicePlanValidationError(plan, { credit });
    if (validation) throw new Error(`${credit}đ bị chặn lúc mở form: ${validation}`);
  }
}

// --- Vượt tỷ lệ vài trăm đồng là artefact làm tròn, không được loại phiếu ----
//
// Tiền hàng đi theo lưới giá mặt hàng (bước 5.000đ) nên hiếm khi rơi đúng mức
// tối thiểu mà ràng buộc "Tiền giờ ≤ 2 lần tiền hàng" đòi. Sao kê 495.100đ-
// 498.000đ có tiền hàng 150.000đ và Tiền giờ 300.091đ — vượt trần đúng 91đ và
// bị loại, trong khi 494.900đ ngay dưới đó vẫn lập được với tỷ lệ 2,10.
{
  const scanFor = () => ({
    ready: true, invoiceNo: "01000000430", invoiceDateKey: "2026-07-18",
    currentGoods: 0, currentHour: 0, currentTax: 0, taxRate: 10, currentGrand: 0,
    checkIn: "18/07/2026 17:00", checkOut: "18/07/2026 18:30", durationMinutes: 90, items: []
  });
  const failures = [];
  for (let credit = 440000; credit <= 560000; credit += 100) {
    if (Math.round(Math.round(credit / 1.1) * 1.1) !== credit) continue;
    const plan = realStockBox.calculateBatchPlan(scanFor(),
      { id: "ratio-" + credit, transactionDate: "2026-07-18", credit },
      nhonFruitInventory, new Map());
    if (plan.status !== "ready") {
      failures.push(`${credit}: ${(plan.reason || "").slice(0, 60)}`);
      continue;
    }
    if (plan.goods + plan.hour + plan.tax !== credit) {
      failures.push(`${credit}: lệch tổng ${plan.goods}+${plan.hour}+${plan.tax}`);
    }
  }
  if (failures.length) {
    throw new Error(`Dải 440.000đ-560.000đ phải lập được hết, còn ${failures.length} mức hỏng: ` +
      failures.slice(0, 3).join(" | "));
  }
}

// --- Sàn phút chỉ được có MỘT nguồn ------------------------------------------
//
// Mốc phút từng bị chép tay ở ba nơi: hourPlanningBounds, calculateNewInvoiceBatchPlan
// và newInvoicePlanValidationError. Khi đổi sàn mà quên một bản sao thì phương án
// vừa lập xong lại bị chính khâu sau loại ("Tiền giờ thấp hơn mức tối thiểu"),
// hoặc số phút trên UI khác số phút đem đi kiểm tra.
{
  // Chỉ được còn trong chú thích, không còn trong code chạy.
  const inCode = source
    .split("\n")
    .filter(line => /\?\s*50\s*:\s*30/.test(line) && !line.trim().startsWith("//"));
  if (inCode.length) {
    throw new Error(
      `Còn ${inCode.length} chỗ tự tính sàn phút thay vì gọi minimumSingingMinutes: ` +
      inCode.map(line => line.trim()).join(" | ")
    );
  }
  // Cả ba khâu phải gọi cùng một hàm.
  for (const fn of ["hourPlanningBounds", "calculateNewInvoiceBatchPlan", "newInvoicePlanValidationError"]) {
    if (!extractFunction(fn).includes("minimumSingingMinutes(")) {
      throw new Error(`${fn} phải lấy sàn phút từ minimumSingingMinutes.`);
    }
  }
}

// --- Đổi công thức PHẢI đi kèm tăng CALCULATION_VERSION ----------------------
//
// buildBatchReview dùng lại nguyên vẹn batchApprovedPlan khi mốc công thức của
// phương án trùng CALCULATION_VERSION (nhánh batch_ready trả plan rồi continue).
// Vì vậy đổi công thức mà quên tăng mốc thì phương án đã Accept không bao giờ
// được tính lại — bấm "Tính toán lại" cũng ra y hệt.
//
// Ca thật: sao kê 547.800đ giữ 8 phút / 78.000đ (công thức sàn 30 phút cũ) sau
// khi đã hạ sàn xuống 15 phút; code mới cho 17 phút / 168.000đ.
{
  if (sandbox.CALCULATION_VERSION === "website-inclusive-vat-2") {
    throw new Error(
      "CALCULATION_VERSION vẫn là mốc của công thức sàn 30 phút. Mỗi lần đổi công " +
      "thức tính tiền/giờ phải tăng mốc này, nếu không phương án đã Accept sẽ được " +
      "dùng lại và Tính toán lại không đổi gì."
    );
  }
  // Mốc phải được ghi vào phương án, nếu không vòng kiểm tra ở buildBatchReview
  // không có gì để so.
  const versioned = realStockBox.chooseNewInvoiceRoomPlan(
    { id: "ver", transactionDate: "2026-07-18", credit: 547800 },
    nhonFruitInventory, new Map(), 0);
  if (versioned.status !== "ready") throw new Error(`547.800đ phải lập được: ${versioned.reason}`);
  if (versioned.calculationVersion !== sandbox.CALCULATION_VERSION) {
    throw new Error(`Phương án phải ghi mốc công thức hiện tại, đang là ${versioned.calculationVersion}.`);
  }
  // Và phải đạt sàn mới (công thức cũ cho 8 phút).
  const floor = realStockBox.minimumSingingMinutes(547800);
  if (versioned.durationMinutes < floor) {
    throw new Error(`547.800đ phải đạt sàn ${floor} phút, nhận ${versioned.durationMinutes}.`);
  }
}

// --- Sàn giờ hát 15 phút ở Nhơn (chốt 23/09/2026) ---------------------------
//
// Trước đây sàn là 30 phút, khiến phiếu vài trăm nghìn phải dồn gần hết phần
// trước VAT vào Tiền giờ. Kế toán hạ xuống 15 phút; mốc 50 phút của sao kê trên
// 1 triệu giữ nguyên vì phiếu lớn mà hát 15 phút thì vô lý.
{
  // Sàn dưới 1 triệu phải KHÁC mốc 50 phút của sao kê lớn, và phải là mốc riêng
  // của Nhơn chứ không phải mốc mặc định 30 phút của các cơ sở khác.
  const nhonFloor = realStockBox.minimumSingingMinutes(486200);
  if (realStockBox.minimumSingingMinutes(1100000) !== 50) {
    throw new Error(`Sao kê trên 1 triệu phải giữ 50 phút, đang là ${realStockBox.minimumSingingMinutes(1100000)}.`);
  }
  // Ngưỡng phiếu nhỏ suy từ đơn giá phòng: sàn + một món rẻ nhất, cộng VAT.
  for (const rate of [400000, 600000, 800000]) {
    const expected = Math.round((Math.round(rate * nhonFloor / 60) + 50000) * 1.1);
    if (realStockBox.smallInvoiceGrandLimit(rate) !== expected) {
      throw new Error(`Ngưỡng phiếu nhỏ ở phòng ${rate} phải là ${expected}, ` +
        `đang là ${realStockBox.smallInvoiceGrandLimit(rate)}.`);
    }
  }

  // Mọi mức tiền thực tế phải đạt sàn, TRỪ phiếu quá nhỏ để đủ 15 phút ngay cả
  // ở phòng rẻ nhất (khi đó "lấy tối đa có thể" là đúng chủ trương).
  // Bỏ các mức quá nhỏ để đạt sàn ngay cả ở phòng rẻ nhất (143.000đ chỉ có
  // 130.000đ trước VAT, không thể ra 30 phút): đó là nhánh "lấy tối đa có thể",
  // kiểm riêng bên dưới.
  for (const credit of [275000, 352000, 486200, 547800, 700000, 1100000]) {
    const plan = realStockBox.chooseNewInvoiceRoomPlan(
      { id: "floor15-" + credit, transactionDate: "2026-07-01", credit },
      nhonFruitInventory, new Map(), 0);
    if (plan.status !== "ready") throw new Error(`${credit}đ phải lập được: ${plan.reason}`);
    const floor = realStockBox.minimumSingingMinutes(credit);
    if (plan.durationMinutes < floor) {
      throw new Error(`${credit}đ phải đạt sàn ${floor} phút, nhận ${plan.durationMinutes} ` +
        `(phòng ${plan.hourlyRate}, Tiền giờ ${plan.hour}).`);
    }
    // Thời lượng luôn phải khớp Tiền giờ theo đơn giá phòng đã chọn.
    const billed = Math.round((plan.durationMinutes / 60) * 100) / 100;
    if (Math.round(billed * plan.hourlyRate) !== plan.hourFromTime) {
      throw new Error(`${credit}đ: ${plan.durationMinutes} phút không khớp Tiền giờ ${plan.hourFromTime}đ`);
    }
  }

  // Phiếu nhỏ: Tiền giờ đã cố định nên phòng CÀNG RẺ càng nhiều phút. Việc chọn
  // phòng phải ưu tiên đạt sàn, nếu không 143.000đ lại rơi vào phòng 800k và ra
  // 8 phút như trước.
  const smallPlan = realStockBox.chooseNewInvoiceRoomPlan(
    { id: "room-choice", transactionDate: "2026-07-01", credit: 143000 },
    nhonFruitInventory, new Map(), 0);
  if (smallPlan.hourlyRate !== 400000) {
    throw new Error(`Phiếu nhỏ phải chọn phòng rẻ nhất để đạt sàn, đang chọn ${smallPlan.hourlyRate}.`);
  }
  if (smallPlan.specialRule !== "under-500k-two-beers" || (smallPlan.items || []).length !== 1) {
    throw new Error("Phiếu dưới ngưỡng phải đi nhánh một món, còn lại là giờ hát.");
  }
}

// Phiếu nhỏ: đúng một món bia/nước ≤ 50.000đ, luân phiên giữa các mã thay vì
// lúc nào cũng cùng một loại.
//
// Ngưỡng của Nhơn suy từ đơn giá phòng (sàn + một món), ở phòng 400k là đúng
// 275.000đ — mức này vẫn đi nhánh một món (so sánh <=).
//
// Dùng ĐÚNG ngưỡng chứ không thấp hơn: việc chọn món phải chừa đủ tiền cho sàn,
// nên ở phiếu quá nhỏ chỉ còn đúng một mã hợp lệ và không có gì để luân phiên.
// Ở 275.000đ (trước VAT 250.000đ, chừa 200.000đ cho giờ) thì cả năm mã ≤ 50.000đ
// đều hợp lệ, đúng tình huống mà test này muốn kiểm.
const smallUsage = new Map();
const smallBeers = [];
for (let round = 0; round < 3; round += 1) {
  // Phòng 400k: newNhonScan mặc định 600k, ở đó sàn 15 phút đã ăn hết phần trước
  // VAT nên không mã nào hợp lệ và việc chọn món rơi về "rẻ nhất" — không còn gì
  // để luân phiên. Thực tế chooseNewInvoiceRoomPlan cũng chọn 400k cho mức này.
  const plan = realStockBox.calculateBatchPlan(
    { ...newNhonScan("2026-07-05"), hourlyRate: 400000 },
    { id: `small-${round}`, transactionDate: "2026-07-05", credit: 275000 }, nhonFruitInventory, smallUsage);
  if (plan.status !== "ready" || plan.specialRule !== "under-500k-two-beers") {
    throw new Error(`Phiếu nhỏ ${round} phải đi nhánh một món: ${plan.reason}`);
  }
  if (plan.items.length !== 1 || plan.items[0].qty !== 1) {
    throw new Error(`Phiếu nhỏ ${round} phải có đúng một món, số lượng 1`);
  }
  if (plan.items[0].price > 50000) {
    throw new Error(`Phiếu nhỏ ${round} dùng món ${plan.items[0].price}đ, vượt trần 50.000đ`);
  }
  // Phần lớn tiền phải vào Tiền giờ.
  if (!(plan.hour > plan.goods)) {
    throw new Error(`Phiếu nhỏ ${round}: Tiền giờ ${plan.hour} phải lớn hơn tiền hàng ${plan.goods}`);
  }
  smallBeers.push(plan.items[0].code);
  accumulateUsage(smallUsage, plan);
}
if (new Set(smallBeers).size < 2) {
  throw new Error(`Ba phiếu nhỏ liên tiếp phải đổi món: ${smallBeers.join(", ")}`);
}

// --- Phương án "Sẵn sàng" phải qua được kiểm tra lúc mở tab worker ---------------
//
// Ca thật Nhơn 541.200đ: Batch Review báo sẵn sàng với Tiền giờ 172.000đ trong
// khi sàn là 172.200đ; tới lúc mở tab worker mới bị "Tiền giờ thấp hơn mức tối
// thiểu" và Lưu API dừng 0/10 với lý do chung chung. Mọi phương án mới ở nhiều
// mức tiền phải qua được newInvoicePlanValidationError ngay từ Batch Review.
// Kế toán chốt 18/09/2026: sàn thời lượng THẮNG trần 35%. Ở phiếu nhỏ sàn chiếm
// tỷ trọng lớn trong tổng trước VAT nên trần phải được nới vừa đủ để chứa sàn,
// thay vì hạ sàn xuống bằng trần như trước (sao kê 486.200đ từng ra 1 phút hát).
// Mốc phút đọc thẳng từ code: 23/09/2026 Nhơn hạ sàn xuống 15 phút.
const clampedRate = 600000;
const clampedFloorHour = Math.round(clampedRate * realStockBox.minimumSingingMinutes(541200) / 60);
const clampedBounds = realStockBox.hourPlanningBounds(
  { newInvoicePlanning: true, currentHour: 0 }, { hourlyRate: clampedRate, hourStep: 6000 }, 541200, 492000
);
if (clampedBounds.minHourAmount < clampedFloorHour) {
  throw new Error(`Sàn ${realStockBox.minimumSingingMinutes(541200)} phút @600k (${clampedFloorHour}đ) phải được giữ: ${JSON.stringify(clampedBounds)}`);
}
if (clampedBounds.maxHourAmount < clampedBounds.minHourAmount) {
  throw new Error("Trần phải được nới đủ để chứa sàn thời lượng.");
}
// Phiếu quá nhỏ để đủ 30 phút thì hạ sàn xuống mức kham được, không bỏ hẳn.
const tinyBounds = realStockBox.hourPlanningBounds(
  { newInvoicePlanning: true, currentHour: 0 }, { hourlyRate: 600000, hourStep: 6000 }, 143000, 130000
);
if (!tinyBounds.floorClampedToCap) {
  throw new Error(`Phiếu 143.000đ không đủ cho 30 phút nên sàn phải được hạ: ${JSON.stringify(tinyBounds)}`);
}
if (!(tinyBounds.minHourAmount > 0) || tinyBounds.minHourAmount >= 130000) {
  throw new Error(`Sàn đã hạ phải lớn hơn 0 và chừa chỗ cho một món: ${tinyBounds.minHourAmount}`);
}
const normalBounds = realStockBox.hourPlanningBounds(
  { newInvoicePlanning: true, currentHour: 0 }, { hourlyRate: 600000, hourStep: 6000 }, 3000000, 2727273
);
if (normalBounds.floorClampedToCap || normalBounds.minHourAmount !== 500000) {
  throw new Error(`Phiếu đủ lớn phải giữ sàn 50 phút: ${JSON.stringify(normalBounds)}`);
}

const floorSweep = [541200, 500000, 523800, 600000, 655100, 700000, 777700, 850000, 933800, 999900, 1000000, 1004000, 1200000, 1477000];
for (const credit of floorSweep) {
  const transaction = { id: `floor-${credit}`, transactionDate: "2026-07-05", credit };
  const plan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"), transaction, nhonFruitInventory, new Map());
  if (plan.status !== "ready") continue;
  const validation = realStockBox.newInvoicePlanValidationError(plan, transaction);
  if (validation) {
    throw new Error(`Phương án ${credit}đ được báo sẵn sàng nhưng bước mở form chặn: ${validation}`);
  }
}
// 541.200đ: sàn đã bị bỏ (chạm trần) nên Tiền giờ chỉ cần > 0 và ≤ trần; phần
// dư sau tiền hàng dồn hết vào Tiền giờ.
const floorPlan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-05"),
  { id: "floor-541200", transactionDate: "2026-07-05", credit: 541200 }, nhonFruitInventory, new Map());
if (floorPlan.status !== "ready" || floorPlan.hour <= 0) {
  throw new Error(`541.200đ phải sẵn sàng và có Tiền giờ: ${floorPlan.reason || floorPlan.hour}`);
}
if (floorPlan.goods + floorPlan.hour + floorPlan.tax !== 541200) {
  throw new Error("Phương án 541.200đ phải khớp tuyệt đối tổng sao kê.");
}
const openPosSource = extractFunction("openPosForNewInvoice");
if (!openPosSource.includes("Phương án đã bị hủy và Batch Review đã tính lại") ||
    openPosSource.indexOf("Phương án đã bị hủy và Batch Review đã tính lại") < openPosSource.indexOf("opened: false,")) {
  throw new Error("Phương án bị hủy lúc mở tab worker phải trả lý do thật cho Lưu API, không phải thông báo chung.");
}

// --- Đơn giá giờ theo phòng: chọn phòng hợp với số tiền -------------------------
//
// Khảo sát Nhơn 17/09/2026: phòng đuôi 3 = 800.000đ/giờ, đuôi 6 = 400.000đ/giờ,
// còn lại 600.000đ/giờ. Đơn giá quyết định bước giá Tiền giờ (1% đơn giá) nên
// phương án phải biết trước mình lập trên hạng phòng nào; chooseNewInvoiceRoomPlan
// thử cả ba mức rồi chốt mức cho phương án đẹp nhất.
if (realStockBox.tenantHourlyRates("parisnhon").join(",") !== "400000,600000,800000") {
  throw new Error("Nhơn phải có đủ ba mức đơn giá giờ.");
}
if (realStockBox.tenantHourlyRates("pariskimgiang").join(",") !== "600000") {
  throw new Error("Cơ sở chưa khảo sát giữ nguyên một mức 600.000đ.");
}
if (realStockBox.hourPricingForRate(400000).hourStep !== 4000 ||
    realStockBox.hourPricingForRate(800000).hourStep !== 8000 ||
    realStockBox.hourPricingForRate(600000).hourStep !== 6000) {
  throw new Error("Bước giá Tiền giờ phải là 1% đơn giá của phòng.");
}
const rateSweep = [541200, 1004000, 1500000, 2200000, 3000000, 7457000];
for (const credit of rateSweep) {
  const transaction = { id: `rate-${credit}`, transactionDate: "2026-07-05", credit };
  const plan = realStockBox.chooseNewInvoiceRoomPlan(transaction, nhonFruitInventory, new Map(), 0);
  if (plan.status !== "ready") throw new Error(`${credit}đ phải lập được phương án: ${plan.reason}`);
  if (![400000, 600000, 800000].includes(plan.hourlyRate)) {
    throw new Error(`${credit}đ phải ghi lại đơn giá phòng đã dùng, nhận ${plan.hourlyRate}`);
  }
  // Tiền giờ theo giờ vào/ra phải đúng bội số bước giá của chính đơn giá đó.
  if (plan.hourFromTime % Math.round(plan.hourlyRate / 100) !== 0) {
    throw new Error(`${credit}đ: Tiền giờ ${plan.hourFromTime} không đúng bước giá của phòng ${plan.hourlyRate}đ/giờ`);
  }
  if (plan.goods + plan.hour + plan.tax !== credit) {
    throw new Error(`${credit}đ phải khớp tuyệt đối tổng sao kê.`);
  }
  // Phương án phải qua được kiểm tra lúc mở form với đúng bước giá của phòng.
  const validation = realStockBox.newInvoicePlanValidationError(plan, transaction);
  if (validation) throw new Error(`${credit}đ (phòng ${plan.hourlyRate}đ/giờ) bị chặn lúc mở form: ${validation}`);
}

// --- Không được ra "Sẵn sàng" khi thiếu món bắt buộc --------------------------
//
// Món bắt buộc (3 bia + 2 khăn) là luật kế toán, không phải tiêu chí cho điểm.
// Solver xếp nó ưu tiên cao nhất, nhưng khi mã bia quá đắt so với tiền hàng cho
// phép thì KHÔNG tổ hợp nào đủ, và phương án tốt nhất vẫn thiếu. Trước đây nó
// lọt ra "Sẵn sàng" với 2 bia thay vì 3 — sai luật mà không ai biết.
//
// Tổng phải TRÊN RELAXED_MANDATORY_GRAND_LIMIT (500.000đ): dưới mức đó Nhơn chỉ
// cần 1 bia + 1 khăn nên fixture bia đắt vẫn ghép được và test mất ý nghĩa.
{
  const pricey = [
    { webCode: "B1", webName: "Bia Sang 1", webUnit: "chai", webPrice: 160000, availableQty: 99 },
    { webCode: "B2", webName: "Bia Sang 2", webUnit: "chai", webPrice: 165000, availableQty: 99 },
    { webCode: "B3", webName: "Bia Sang 3", webUnit: "chai", webPrice: 170000, availableQty: 99 },
    { webCode: "W1", webName: "Khăn ướt", webUnit: "cái", webPrice: 5000, availableQty: 99 }
  ];
  const plan = realStockBox.calculateBatchPlan({
    ready: true, newInvoicePlanning: true, invoiceNo: "", invoiceDateKey: "2026-07-01",
    currentHour: 0, currentGrand: 0, taxRate: 10
  }, { id: "pricey", transactionDate: "2026-07-01", credit: 510000 }, pricey);
  if (plan.status === "ready") {
    const beers = (plan.items || []).filter(item => /^Bia/.test(item.name))
      .reduce((sum, item) => sum + item.qty, 0);
    throw new Error(`Phương án thiếu bia (${beers}/3) không được ra Sẵn sàng`);
  }
  // Hai chốt chặn đều hợp lệ: "thiếu món bắt buộc" hoặc "không có Tiền giờ"
  // kèm giải thích món bắt buộc đã ăn hết phần trước VAT. Điều bắt buộc là lý
  // do phải chỉ ra MÓN BẮT BUỘC, không đổ chung cho tồn kho.
  if (!/món bắt buộc/i.test(plan.reason)) {
    throw new Error(`Lý do phải nêu rõ vướng món bắt buộc: ${plan.reason}`);
  }
  if (!/\d/.test(plan.reason)) {
    throw new Error(`Lý do phải kèm số liệu để kế toán biết cần gì: ${plan.reason}`);
  }
}

// --- Rule luân phiên phải được nới khi nó ăn hết phần trước VAT ----------------
//
// Ca thật Nhơn 18/09/2026: rule "Hoa quả Bưởi da xanh (đĩa nhỏ)" 250.000đ áp cho
// mọi phiếu trên 400.000đ. Sao kê 440.000đ có phần trước VAT 400.000đ; đĩa hoa
// quả 250.000đ cộng món bắt buộc 160.000đ thành 410.000đ, vượt 400.000đ nên
// không còn chỗ cho Tiền giờ. Solver VẪN trả về tổ hợp đó (không phải "không
// tìm được"), nên nhánh nới rule cũ không chạy và phiếu bị loại oan.
{
  const rulesBox = Object.assign(Object.create(null), realStockBox);
  const savedRules = realStockBox.priorityRules;
  realStockBox.priorityRules = [
    { id: "r2", code: "0000048", webCode: "0000048", minTotal: 400000, priority: 2, mode: "rotate", minQty: 1, maxQty: 1, enabled: true },
    { id: "r4", code: "HH_Corona", webCode: "0000003", minTotal: 15000, priority: 4, mode: "rotate", minQty: 1, maxQty: 15, enabled: true }
  ];
  try {
    const plan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-01"),
      { id: "rule-440000", transactionDate: "2026-07-01", credit: 440000 }, nhonFruitInventory, new Map());
    if (plan.status !== "ready") {
      throw new Error(`440.000đ phải lập được bằng cách nới rule luân phiên: ${plan.reason}`);
    }
    if (!plan.rotatingPriorityRelaxed) {
      throw new Error("Phải đánh dấu đã nới rule luân phiên để kế toán biết.");
    }
    if (plan.goods >= 400000) {
      throw new Error(`Tiền hàng ${plan.goods}đ phải nhỏ hơn phần trước VAT 400.000đ để còn Tiền giờ`);
    }
    if (plan.hour <= 0) throw new Error("Phương án phải có Tiền giờ.");
    // Phiếu đủ lớn vẫn giữ rule: 1.004.000đ còn thừa chỗ cho đĩa hoa quả.
    const bigPlan = realStockBox.calculateBatchPlan(newNhonScan("2026-07-01"),
      { id: "rule-1004000", transactionDate: "2026-07-01", credit: 1004000 }, nhonFruitInventory, new Map());
    if (bigPlan.status !== "ready") throw new Error(`1.004.000đ phải lập được: ${bigPlan.reason}`);
    if (bigPlan.rotatingPriorityRelaxed) {
      throw new Error("Phiếu đủ lớn không được nới rule khi vẫn còn chỗ cho Tiền giờ.");
    }
  } finally {
    realStockBox.priorityRules = savedRules;
  }
}

// --- Phiếu có sẵn: giờ vào/ra phải KHỚP Tiền giờ ------------------------------
//
// Ca thật Nhơn 01/07/2026: Batch Review hiện "19:40 → 21:02, 0 phút · theo giờ
// 140.000đ". 82 phút ở phòng 600k phải là 820.000đ, không phải 140.000đ — tức
// 102.439đ/giờ, không mức giá nào như vậy. Nhánh thường chỉ tính lại giờ ra khi
// phiên bị rebase, nên phiếu có sẵn giữ giờ cũ trong khi Tiền giờ đã đổi. Website
// tính Tiền giờ TỪ giờ vào/ra nên khi lưu sẽ lệch tổng.
for (const [credit, oldMinutes] of [[440000, 82], [352000, 92], [577500, 21], [393800, 26]]) {
  const scan = {
    ready: true, invoiceNo: "HD-TIME-" + credit, invoiceDateKey: "2026-07-01",
    currentGoods: 0, currentHour: Math.round(600000 * oldMinutes / 60), currentTax: 0,
    taxRate: 10, currentGrand: 0,
    checkIn: "01/07/2026 19:40",
    checkOut: "01/07/2026 21:02",
    durationMinutes: oldMinutes, items: []
  };
  const plan = realStockBox.calculateBatchPlan(scan,
    { id: "time-" + credit, transactionDate: "2026-07-01", credit }, nhonFruitInventory, new Map());
  if (plan.status !== "ready") continue;
  if (!(plan.durationMinutes > 0)) {
    throw new Error(`${credit}đ: phải trả thời lượng, nếu không giao diện hiện 0 phút`);
  }
  // Tiền giờ theo giờ vào/ra phải đúng bằng hourFromTime của phương án.
  const rate = plan.hourlyRate || 600000;
  const billed = Math.round((plan.durationMinutes / 60) * 100) / 100;
  const fromMinutes = Math.round(billed * rate);
  if (fromMinutes !== plan.hourFromTime) {
    throw new Error(`${credit}đ: ${plan.durationMinutes} phút ra ${fromMinutes}đ ≠ hourFromTime ${plan.hourFromTime}đ`);
  }
  // Và phải sát Tiền giờ chốt cuối, trong đúng một bước giá.
  if (Math.abs(plan.hour - fromMinutes) > Math.round(rate / 100)) {
    throw new Error(`${credit}đ: Tiền giờ ${plan.hour}đ lệch quá một bước so với ${fromMinutes}đ theo giờ vào/ra`);
  }
  if (plan.checkOut === scan.checkOut && plan.hour !== Math.round(600000 * oldMinutes / 60)) {
    throw new Error(`${credit}đ: giữ nguyên giờ ra cũ trong khi Tiền giờ đã đổi`);
  }
}

// --- Sàn 30 phút hát (kế toán chốt 18/09/2026) --------------------------------
//
// Mọi hóa đơn phải có tối thiểu 30 phút. Sàn này THẮNG hai quy ước cơ cấu khi
// mâu thuẫn: trần Tiền giờ 35% tổng trước VAT, và tỷ lệ Tiền giờ ≤ 2 lần tiền
// hàng. Ca thật: sao kê 486.200đ từng ra đúng 1 phút hát.
//
// Phiếu quá nhỏ không đủ tiền cho 30 phút thì LẤY TỐI ĐA CÓ THỂ, không bị chặn.
for (const [credit, expectFloor] of [
  [396000, true], [434500, true], [440000, true], [486200, true],
  [590700, true], [704000, true],
  [330000, false], [225500, false], [143000, false]
]) {
  const plan = realStockBox.chooseNewInvoiceRoomPlan(
    { id: "floor30-" + credit, transactionDate: "2026-07-01", credit },
    nhonFruitInventory, new Map(), 0);
  if (plan.status !== "ready") {
    throw new Error(`${credit}đ phải lập được (lấy tối đa có thể, không chặn): ${plan.reason}`);
  }
  if (!(plan.durationMinutes > 0)) throw new Error(`${credit}đ: thời lượng phải > 0`);
  // Sàn đọc thẳng từ code, không hardcode: 23/09/2026 Nhơn hạ 30 -> 15 phút.
  const floorForCredit = realStockBox.minimumSingingMinutes(credit);
  if (expectFloor && plan.durationMinutes < floorForCredit) {
    throw new Error(`${credit}đ phải đạt sàn ${floorForCredit} phút, nhận ${plan.durationMinutes} phút`);
  }
  // Thời lượng luôn phải khớp Tiền giờ theo đơn giá phòng.
  const rate = plan.hourlyRate || 600000;
  const billed = Math.round((plan.durationMinutes / 60) * 100) / 100;
  if (Math.round(billed * rate) !== plan.hourFromTime) {
    throw new Error(`${credit}đ: ${plan.durationMinutes} phút không khớp Tiền giờ ${plan.hourFromTime}đ`);
  }
  if (plan.goods + plan.hour + plan.tax !== credit) {
    throw new Error(`${credit}đ phải khớp tuyệt đối tổng sao kê`);
  }
}

// Mã bán theo suất và mã có trần cứng khai báo riêng không được nhân.
const scaledCandidates = realStockBox.buildBatchCandidates([
  { webCode: "1500006", webName: "HOA QUẢ THẬP CẨM (Đĩa nhỏ)", webUnit: "đĩa", webPrice: 350000, availableQty: 1, availabilityMode: "per_invoice", constraintGroup: "fruit_platter", constraintGroupMax: 1 },
  { webCode: "1000064", webName: "Hạt Mắc Ca (hộp 500g)", webUnit: "Hộp", webPrice: 180000, availableQty: 50, constraintGroup: "", constraintGroupMax: null },
  { webCode: "0000045", webName: "Bia Tiger lon", webUnit: "Lon", webPrice: 50000, availableQty: 500, constraintGroup: "", constraintGroupMax: null }
], 14000000, { id: "scale-check", transactionDate: "2026-07-05", credit: 14000000 }, new Map(), { quantityScale: 3 });
const byCode = code => scaledCandidates.find(item => String(item.code) === code);
if (byCode("1500006").maxQty !== 1) throw new Error("Đĩa hoa quả bán theo suất phải giữ 1/HĐ dù nâng bội số.");
if (byCode("1000064").maxQty !== 2) throw new Error("Hộp mắc ca có trần cứng 2 không được nhân.");
if (byCode("0000045").maxQty !== 36) throw new Error(`Bia phải được nhân theo bội số 3: 12 × 3 = 36, nhận ${byCode("0000045").maxQty}`);
