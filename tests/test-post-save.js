const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

if (!source.includes("async function verifySavedInvoice(verifiedSnapshot)") ||
    !source.includes("verifiedSnapshot?.ready") ||
    !source.includes("verifySavedInvoice(reopened)")) {
  throw new Error("Batch reconciliation must preserve the reopened invoice list date through stock commit.");
}

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

const context = { structuredClone, pageTenantSlug: "parislinhdam" };
vm.createContext(context);
// formatMoney khai báo dạng arrow const nên không dùng extractFunction được.
function extractConst(name) {
  const match = source.match(new RegExp(`const ${name} = [^;]+;`));
  if (!match) throw new Error(`Missing const ${name}`);
  return match[0];
}

vm.runInContext(`const pageTenantSlug = this.pageTenantSlug;
${extractConst("formatMoney")}
${extractFunction("parseUiDateTime")}
${extractFunction("uiDateKey")}
${extractFunction("invoiceBusinessDateKeys")}
${extractFunction("invoiceMatchesTransactionDate")}
${extractFunction("isLinhDamFreshApiInvoice")}
${extractFunction("matchesExpectedInvoiceDate")}
${extractFunction("pendingPlanFromApproved")}
${extractFunction("verifySnapshotAgainstPlan")}
${extractFunction("deductVerifiedStock")}
${extractFunction("restoreVerifiedStock")}
${extractFunction("reconcileBatchPlanStatus")}
this.verifySnapshotAgainstPlan = verifySnapshotAgainstPlan;
this.pendingPlanFromApproved = pendingPlanFromApproved;
this.deductVerifiedStock = deductVerifiedStock;
this.restoreVerifiedStock = restoreVerifiedStock;
this.reconcileBatchPlanStatus = reconcileBatchPlanStatus;`, context);

const plan = {
  invoiceNo: "HD1",
  invoiceDateKey: "2026-06-30",
  goods: 1555000,
  hour: 605909,
  tax: 216091,
  taxRate: 10,
  grand: 2377000,
  checkIn: "30/06/2026 14:00",
  checkOut: "30/06/2026 15:00",
  items: [
    { code: "1500007", qty: 1, price: 450000 },
    { code: "1000045", qty: 17, price: 65000 }
  ]
};

const scan = {
  ready: true,
  invoiceNo: "HD1",
  invoiceDateKey: "2026-06-30",
  currentGoods: 1555000,
  currentHour: 605909,
  currentTax: 216091,
  taxRate: 10,
  currentGrand: 2377000,
  checkIn: "30/06/2026 14:00",
  checkOut: "30/06/2026 15:00",
  items: [
    { code: "1500007", qty: 1, price: 450000 },
    { code: "1000045", qty: 17, price: 65000 }
  ]
};

if (context.verifySnapshotAgainstPlan(scan, plan).length) throw new Error("Valid saved invoice rejected");
if (!context.verifySnapshotAgainstPlan({ ...scan, currentGrand: 1 }, plan).length) throw new Error("Invalid total accepted");

// Linh Đàm ghi phiếu API mới vào ngày tạo của server trong danh sách, nhưng
// chi tiết phiếu vẫn giữ đúng ngày nghiệp vụ/giờ vào-ra của sao kê. Chỉ ca tạo
// mới đã được API xác nhận mới được dùng ngày chi tiết để đối soát.
const linhDamFreshPlan = {
  ...plan,
  requiresNewInvoice: true,
  apiSavedRecordId: "saved-record-id"
};
const linhDamFreshScan = {
  ...scan,
  listDateKey: "2026-08-13",
  invoiceDateKey: "2026-06-30"
};
if (context.verifySnapshotAgainstPlan(linhDamFreshScan, linhDamFreshPlan).length) {
  throw new Error("Fresh Linh Dam API invoice was rejected because of the server list date.");
}
if (!context.verifySnapshotAgainstPlan(linhDamFreshScan, { ...linhDamFreshPlan, apiSavedRecordId: "" })
    .includes("Sai ngày phiếu.")) {
  throw new Error("The Linh Dam date exception leaked outside confirmed fresh API invoices.");
}

const overnightPlan = { ...plan, invoiceDateKey: "2026-06-01" };
const overnightScan = {
  ...scan,
  invoiceDateKey: "2026-05-31",
  checkIn: "31/05/2026 22:48",
  checkOut: "01/06/2026 00:30"
};
if (context.verifySnapshotAgainstPlan(overnightScan, overnightPlan).includes("Sai ngày phiếu.")) {
  throw new Error("Overnight invoice ending on the statement date was rejected");
}

const backdatedUsageScan = {
  ...scan,
  listDateKey: "2026-06-01",
  invoiceDateKey: "2026-04-24",
  checkIn: "24/04/2026 18:30",
  checkOut: "24/04/2026 19:15"
};
const backdatedUsagePlan = {
  ...plan,
  invoiceDateKey: "2026-06-01",
  checkIn: "24/04/2026 18:30",
  checkOut: "24/04/2026 19:15"
};
if (context.verifySnapshotAgainstPlan(backdatedUsageScan, backdatedUsagePlan).length) {
  throw new Error("Invoice list date must remain authoritative for a backdated room session.");
}
if (!context.verifySnapshotAgainstPlan({ ...backdatedUsageScan, checkOut: "24/04/2026 19:16" }, backdatedUsagePlan)
    .some(error => error.includes("Sai giờ ra"))) {
  throw new Error("A changed backdated checkout time was not detected.");
}
const persistedBackdatedPlan = context.pendingPlanFromApproved(
  { ...plan, checkIn: "", checkOut: "" },
  { transactionDate: "2026-06-01" },
  backdatedUsageScan
);
if (persistedBackdatedPlan.invoiceDateKey !== "2026-06-01" ||
    persistedBackdatedPlan.checkIn !== "24/04/2026 18:30" ||
    persistedBackdatedPlan.checkOut !== "24/04/2026 19:15") {
  throw new Error("Approved plan did not preserve independent invoice and room-session dates.");
}

const dataset = {
  mappings: [
    { status: "confirmed", webCode: "1000045", availableQty: 10, availabilityMode: "stock" },
    { status: "confirmed", webCode: "1000045", availableQty: 65, availabilityMode: "stock" },
    { status: "confirmed", webCode: "1500007", availableQty: 1, availabilityMode: "per_invoice" }
  ]
};
const deducted = context.deductVerifiedStock(dataset, plan.items);
const stockLeft = deducted.mappings
  .filter(row => row.webCode === "1000045")
  .reduce((sum, row) => sum + row.availableQty, 0);
if (stockLeft !== 58) throw new Error(`Expected 58 remaining, got ${stockLeft}`);
if (deducted.mappings[2].availableQty !== 1) throw new Error("Per-invoice item was deducted");
if (dataset.mappings[0].availableQty !== 10) throw new Error("Original dataset mutated");

const restored = context.restoreVerifiedStock(deducted, plan.items);
const restoredStock = restored.mappings
  .filter(row => row.webCode === "1000045")
  .reduce((sum, row) => sum + row.availableQty, 0);
if (restoredStock !== 75) throw new Error(`Expected restored stock 75, got ${restoredStock}`);
if (restored.mappings[2].availableQty !== 1) throw new Error("Per-invoice item was restored into stock");

const revisedPlan = {
  ...plan,
  goods: 1460000,
  hour: 700909,
  items: [
    { code: "1500007", qty: 1, price: 400000 },
    { code: "1000045", qty: 5, price: 65000 }
  ]
};
const revised = context.deductVerifiedStock(restored, revisedPlan.items);
const revisedStock = revised.mappings
  .filter(row => row.webCode === "1000045")
  .reduce((sum, row) => sum + row.availableQty, 0);
if (revisedStock !== 70) throw new Error(`Expected revised stock 70, got ${revisedStock}`);

const idempotent = context.deductVerifiedStock(
  context.restoreVerifiedStock(revised, revisedPlan.items),
  revisedPlan.items
);
const idempotentStock = idempotent.mappings
  .filter(row => row.webCode === "1000045")
  .reduce((sum, row) => sum + row.availableQty, 0);
if (idempotentStock !== 70) throw new Error(`Repeated reconciliation changed stock to ${idempotentStock}`);

if (context.reconcileBatchPlanStatus("batch_ready", "done") !== "done") {
  throw new Error("Verified transaction did not update Batch Review to done");
}
if (context.reconcileBatchPlanStatus("ready", "batch_ready") !== "batch_ready") {
  throw new Error("Accepted transaction did not update Batch Review to batch_ready");
}
if (context.reconcileBatchPlanStatus("needs_new_invoice", "pending") !== "needs_new_invoice") {
  throw new Error("Non-final transaction status overwrote the Batch Review planning status");
}

// Phiếu mới được tạo từ sơ đồ phòng, còn bước đối soát sau lưu cần grid danh
// sách Bán hàng. Nếu không tự điều hướng thì findInvoiceCandidates ném "Hãy mở
// màn hình danh sách Bán hàng trước." và giao dịch kẹt ở Chờ lưu/đối soát dù
// hóa đơn đã lưu thành công.
const navBox = { setTimeout, console };
vm.createContext(navBox);
// extractFunction cắt từ "function <tên>(" nên mất tiền tố async; thêm lại.
vm.runInContext(`async ${extractFunction("ensureInvoiceListScreen")}
this.ensureInvoiceListScreen = ensureInvoiceListScreen;`, navBox);

async function checkInvoiceListNavigation() {
  // Trường hợp 1: đang ở sơ đồ phòng, có link "Bán hàng" -> phải bấm và chờ grid.
  let clicked = 0;
  let listPresent = false;
  navBox.request = async action => {
    if (action !== "hasInvoiceList") throw new Error(`Unexpected action ${action}`);
    return { present: listPresent };
  };
  navBox.document = {
    querySelectorAll: () => [{
      innerText: "Bán hàng",
      href: "http://example/list",
      click() { clicked += 1; listPresent = true; }
    }]
  };
  if (!(await navBox.ensureInvoiceListScreen(3000))) {
    throw new Error("Phải điều hướng được về màn hình danh sách Bán hàng.");
  }
  if (clicked !== 1) throw new Error(`Phải bấm đúng một lần vào link Bán hàng, đang là ${clicked}.`);

  // Trường hợp 2: đã ở sẵn danh sách -> không được điều hướng lại.
  clicked = 0;
  listPresent = true;
  if (!(await navBox.ensureInvoiceListScreen(3000))) {
    throw new Error("Đang ở sẵn danh sách thì phải trả về true ngay.");
  }
  if (clicked !== 0) throw new Error("Đã ở danh sách rồi thì không được bấm điều hướng lại.");

  // Trường hợp 3: không có link nào -> báo thất bại thay vì treo.
  clicked = 0;
  listPresent = false;
  navBox.document = { querySelectorAll: () => [] };
  if (await navBox.ensureInvoiceListScreen(1000)) {
    throw new Error("Không tìm thấy link Bán hàng thì phải trả về false.");
  }
}

checkInvoiceListNavigation().then(() => {
  console.log("post-save verification: OK");
}, error => {
  console.error(error);
  process.exit(1);
});
