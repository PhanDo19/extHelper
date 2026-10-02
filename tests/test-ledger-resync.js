// Đối soát lại phiếu ĐÃ xử lý từ website: phiếu bị sửa ngoài extension (chuyển
// phòng khỏi BÁN LẺ, đổi số lượng một dòng hàng) thì sổ đối soát và tồn kho
// phải theo phiếu thật, chỉ hoàn/trừ đúng phần chênh.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const SharedWarehouse = require("../shared-warehouse.js");

function extractFunction(source, name) {
  const text = source.replace(/\r\n/g, "\n");
  let start = text.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = text.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const end = text.indexOf("\n  }\n", start);
  return text.slice(start + 1, end + 4);
}

const HEINEKEN = "0000004";
const XUC_XICH = "0000041";
const KHAN = "0000014";
const FRUIT = "0000013";

function makeMapping() {
  return {
    mappings: [
      { stockCode: "HEINEKEN", webCode: HEINEKEN, webName: "Bia Heineken", status: "confirmed", availableQty: 10 },
      { stockCode: "XUCXICH", webCode: XUC_XICH, webName: "Xúc xích", status: "confirmed", availableQty: 5 },
      { stockCode: "KHAN", webCode: KHAN, webName: "Khăn ướt", status: "confirmed", availableQty: 40 },
      { stockCode: "HQ", webCode: FRUIT, webName: "Hoa quả", status: "confirmed", availableQty: 1, availabilityMode: "per_invoice" }
    ]
  };
}

const ledgerItems = [
  { code: HEINEKEN, name: "Bia Heineken", qty: 1, price: 60000 },
  { code: XUC_XICH, name: "Xúc xích", qty: 2, price: 50000 },
  { code: KHAN, name: "Khăn ướt", qty: 3, price: 5000 }
];

function makeBox({ scans, confirmResult = true, summaries = {} }) {
  const commits = [];
  const statuses = [];
  const summaryCalls = [];
  const box = {
    summaryCalls,
    structuredClone,
    Promise,
    setTimeout: callback => { callback(); return 0; },
    console: { warn: () => {}, error: () => {} },
    commits,
    statuses,
    pageTenantSlug: "parisnhon",
    InvoiceSharedWarehouse: SharedWarehouse,
    formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
    assertRuntimeContext: () => {},
    ensureInvoiceListScreen: async () => true,
    refreshMappingState: () => {},
    renderStatementRows: () => {},
    setStatus: (message, kind) => statuses.push({ message, kind }),
    window: { confirm: () => confirmResult },
    document: { getElementById: id => ({ "it-restock-from": { value: "2026-07-01" }, "it-restock-to": { value: "2026-07-01" } })[id] || null },
    request: async (action, payload) => {
      if (action === "findInvoiceCandidates") {
        const found = scans[payload.invoiceNo];
        return { candidates: found ? [{ uid: `uid-${payload.invoiceNo}`, invoiceNo: payload.invoiceNo, dateKey: payload.dateKey, available: true }] : [] };
      }
      if (action === "openInvoiceCandidate" || action === "closeInvoiceDetail") return { closed: true };
      if (action === "readInvoiceSummary") {
        summaryCalls.push(payload.id);
        const summary = summaries[payload.id];
        if (summary instanceof Error) throw summary;
        return summary;
      }
      throw new Error(`Hành động không mong đợi: ${action}`);
    },
    waitForOpenedInvoice: async invoiceNo => scans[invoiceNo],
    InvoiceMappingStore: {
      loadSharedWarehouse: async fallback => structuredClone(fallback),
      commitVerifiedInvoice: async (mapping, statement, ledger, warehouse) => {
        commits.push({ mapping, statement, ledger, warehouse });
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(
    "var statementDataset; var verificationLedger; var mappingDataset; var sharedWarehouse; var ledgerFreshness = new Map();\n" +
    // Tra sổ theo số phiếu (bản rút gọn của ledgerEntryIndex/ledgerItemsForInvoiceNo).
    "function ledgerEntryIndex() { return new Map((verificationLedger.entries || []).map(entry => [String(entry.invoiceNo), entry])); }\n" +
    "function ledgerItemsForInvoiceNo(invoiceNo) { const entry = ledgerEntryIndex().get(String(invoiceNo)); return entry ? entry.items.map(item => ({ ...item })) : null; }\n" +
    [
      "uiDateKey", "parseUiDateTime", "ledgerEntriesInDateRange", "deductVerifiedStock", "restoreVerifiedStock",
      "ledgerItemChanges", "describeLedgerChange", "buildLedgerResync", "commitLedgerResync", "readInvoiceFromServer",
      "resyncVerifiedRange", "ledgerGoodsTotal", "checkLedgerFreshness", "resyncLedgerFromWebItems"
    ].map(name => extractFunction(contentSource, name)).join("\n") +
    "\nthis.ledgerItemChanges = ledgerItemChanges;" +
    "\nthis.run = options => resyncVerifiedRange(options || { fromDate: '2026-07-01', toDate: '2026-07-01' });" +
    "\nthis.checkLedgerFreshness = checkLedgerFreshness; this.resyncLedgerFromWebItems = resyncLedgerFromWebItems;" +
    "\nthis.ledgerFreshness = ledgerFreshness;" +
    "\nthis.setState = (statement, ledger, mapping) => { statementDataset = statement; verificationLedger = ledger; mappingDataset = mapping; sharedWarehouse = { initialized: false }; };" +
    "\nthis.getState = () => ({ statementDataset, verificationLedger, mappingDataset });",
    box
  );
  return box;
}

function transaction(id, invoiceNo, extra = {}) {
  return {
    id, invoiceNo, status: "done", transactionDate: "2026-07-01", credit: 447700, ledgerId: `ledger-${id}`,
    batchApprovedPlan: { invoiceNo, goods: 175000, hour: 232000, tax: 40700, items: structuredClone(ledgerItems) },
    ...extra
  };
}

function ledgerEntry(id, invoiceNo) {
  return { id: `ledger-${id}`, transactionId: id, invoiceNo, grand: 447700, items: structuredClone(ledgerItems), revision: 1, verifiedAt: "2026-07-01T13:00:00.000Z" };
}

function scan(invoiceNo, items, extra = {}) {
  return {
    ready: true, invoiceNo, roomName: "VIP 26", roomId: "room-vip-26", currentGrand: 447700,
    currentGoods: items.reduce((sum, item) => sum + item.qty * item.price, 0), currentHour: 172000,
    checkIn: "01/07/2026 19:15", checkOut: "01/07/2026 19:41", items, ...extra
  };
}

(async () => {
  // --- So sánh dòng hàng -----------------------------------------------------
  const probe = makeBox({ scans: {} });
  // Mảng tạo trong sandbox vm khác realm nên so qua JSON.
  assert.strictEqual(probe.ledgerItemChanges(ledgerItems, structuredClone(ledgerItems)).length, 0, "Khớp sổ thì không có chênh");
  const changes = probe.ledgerItemChanges(ledgerItems, [
    { code: HEINEKEN, name: "Bia Heineken", qty: 2, price: 60000 },
    { code: XUC_XICH, name: "Xúc xích", qty: 1, price: 50000 },
    { code: XUC_XICH, name: "Xúc xích", qty: 1, price: 50000 },
    { code: KHAN, name: "Khăn ướt", qty: 3, price: 6000 }
  ]);
  assert.strictEqual(
    JSON.stringify(changes.map(change => [change.code, change.beforeQty, change.afterQty, change.beforePrice, change.afterPrice])),
    JSON.stringify([[HEINEKEN, 1, 2, 60000, 60000], [KHAN, 3, 3, 5000, 6000]]),
    "Cộng dồn mã nằm ở nhiều dòng; đổi giá cũng là chênh"
  );

  // --- Luồng đầy đủ ----------------------------------------------------------
  const editedItems = [
    { code: HEINEKEN, name: "Bia Heineken", qty: 2, price: 60000, unit: "chai" },
    { code: XUC_XICH, name: "Xúc xích", qty: 2, price: 50000, unit: "gói" },
    { code: KHAN, name: "Khăn ướt", qty: 3, price: 5000, unit: "Cái" }
  ];
  const box = makeBox({
    scans: {
      "01000000269": scan("01000000269", editedItems),
      "01000000270": scan("01000000270", structuredClone(ledgerItems)),
      "01000000272": scan("01000000272", structuredClone(ledgerItems), { currentGrand: 500000 })
      // 01000000271 không còn trong danh sách Chưa xuất hóa đơn.
    }
  });
  const statement = {
    revision: 7,
    transactions: [
      transaction("t269", "01000000269", { newInvoiceRoomName: "BAN LE", newInvoiceCheckIn: "01/07/2026 19:15", newInvoiceCheckOut: "01/07/2026 19:45" }),
      transaction("t270", "01000000270"),
      transaction("t271", "01000000271"),
      transaction("t272", "01000000272"),
      transaction("t-other-day", "01000000300", { transactionDate: "2026-07-02" })
    ]
  };
  const ledger = {
    entries: [
      ledgerEntry("t269", "01000000269"), ledgerEntry("t270", "01000000270"), ledgerEntry("t271", "01000000271"),
      ledgerEntry("t272", "01000000272"), ledgerEntry("t-other-day", "01000000300")
    ]
  };
  box.setState(statement, ledger, makeMapping());
  await box.run();
  assert.strictEqual(box.commits.length, 1, "Ghi đúng một lần cho cả lô");
  const committed = box.commits[0];
  const qtyOf = code => committed.mapping.mappings.find(row => row.webCode === code).availableQty;
  assert.strictEqual(qtyOf(HEINEKEN), 9, "Heineken 1 → 2: tồn giảm thêm đúng 1");
  assert.strictEqual(qtyOf(XUC_XICH), 5, "Mã không đổi thì tồn không đổi");
  assert.strictEqual(qtyOf(KHAN), 40);

  const entry269 = committed.ledger.entries.find(entry => entry.transactionId === "t269");
  assert.strictEqual(entry269.items.find(item => item.code === HEINEKEN).qty, 2, "Sổ đối soát theo phiếu thật");
  assert.strictEqual(entry269.revision, 2);
  assert.match(entry269.resyncNote, /Bia Heineken: 1 → 2/);
  const untouched = committed.ledger.entries.find(entry => entry.transactionId === "t270");
  assert.strictEqual(untouched.revision, 1, "Phiếu khớp sổ không bị đụng");
  assert.strictEqual(committed.ledger.entries.find(entry => entry.transactionId === "t272").items[0].qty, 1,
    "Phiếu lệch TỔNG TIỀN không được tự sửa");

  const tx269 = committed.statement.transactions.find(item => item.id === "t269");
  assert.strictEqual(tx269.newInvoiceRoomName, "VIP 26", "Lịch phòng phải theo phòng mới sau khi chuyển");
  assert.strictEqual(tx269.newInvoiceCheckOut, "01/07/2026 19:41");
  assert.strictEqual(tx269.batchApprovedPlan.items.find(item => item.code === HEINEKEN).qty, 2);
  assert.strictEqual(tx269.batchApprovedPlan.hour, 172000);
  assert.strictEqual(committed.statement.revision, 7, "Ghi dựa trên đúng revision đang có (để khóa ghi kiểm tra)");

  const finalStatus = box.statuses[box.statuses.length - 1];
  assert.strictEqual(finalStatus.kind, "warn", "Có phiếu lệch tổng thì kết thúc ở mức cảnh báo");
  assert.match(finalStatus.message, /01000000269/);
  assert.match(finalStatus.message, /TỔNG TIỀN khác sổ[\s\S]*01000000272/);
  assert.match(finalStatus.message, /01000000271/, "Phải nêu phiếu không còn trong danh sách chưa xuất");
  assert(!/01000000300/.test(finalStatus.message), "Chỉ xét đúng khoảng ngày đã chọn");

  // Người dùng bấm Hủy: không ghi gì.
  const cancelled = makeBox({ scans: { "01000000269": scan("01000000269", editedItems) }, confirmResult: false });
  cancelled.setState({ transactions: [transaction("t269", "01000000269")] }, { entries: [ledgerEntry("t269", "01000000269")] }, makeMapping());
  await cancelled.run();
  assert.strictEqual(cancelled.commits.length, 0, "Hủy thì không ghi");

  // Tồn không đủ cho phần tăng thêm: dừng, không ghi nửa vời.
  const short = makeBox({ scans: { "01000000269": scan("01000000269", [
    { code: HEINEKEN, name: "Bia Heineken", qty: 20, price: 60000 },
    { code: XUC_XICH, name: "Xúc xích", qty: 2, price: 50000 },
    { code: KHAN, name: "Khăn ướt", qty: 3, price: 5000 }
  ], { currentGrand: 447700 }) } });
  short.setState({ transactions: [transaction("t269", "01000000269")] }, { entries: [ledgerEntry("t269", "01000000269")] }, makeMapping());
  await short.run();
  assert.strictEqual(short.commits.length, 0);
  assert.match(short.statuses[short.statuses.length - 1].message, /Tồn kho 0000004 chỉ còn 11/);

  // --- Kiểm tra nhanh sổ với web (chỉ đọc, không mở phiếu) --------------------
  // Sổ: 1 Heineken × 60.000 + 2 xúc xích × 50.000 + 3 khăn × 5.000 = 175.000đ.
  const fresh = makeBox({
    scans: {},
    summaries: {
      "id-269": { invoiceNo: "01000000269", goods: 235000, hour: 172000 },
      "id-270": { invoiceNo: "01000000270", goods: 175000, hour: 232000 },
      "id-271": new Error("Phiên đăng nhập đã hết")
    }
  });
  fresh.setState(
    { transactions: [transaction("t269", "01000000269"), transaction("t270", "01000000270"), transaction("t271", "01000000271")] },
    { entries: [ledgerEntry("t269", "01000000269"), ledgerEntry("t270", "01000000270"), ledgerEntry("t271", "01000000271")] },
    makeMapping()
  );
  const staleRows = await fresh.checkLedgerFreshness([
    { id: "id-269", invoiceNo: "01000000269" },
    { id: "id-270", invoiceNo: "01000000270" },
    { id: "id-271", invoiceNo: "01000000271" },
    { id: "id-issued", invoiceNo: "01000000269", issued: true },
    { id: "id-no-ledger", invoiceNo: "01000000888" }
  ]);
  assert.strictEqual(staleRows.length, 1);
  assert.strictEqual(staleRows[0].invoiceNo, "01000000269", "Tiền hàng web khác sổ thì sổ đã cũ");
  assert.strictEqual(fresh.ledgerFreshness.get("id-270").stale, false);
  assert.match(fresh.ledgerFreshness.get("id-271").error, /Phiên đăng nhập/, "Lỗi đọc ghi theo từng dòng, không chặn cả lô");
  assert.strictEqual(fresh.summaryCalls.join(","), "id-269,id-270,id-271",
    "Chỉ đọc phiếu chưa phát hành có trong sổ");

  // --- Phát hành xong phiếu lệch: cập nhật sổ/tồn bằng mặt hàng vừa đọc từ web ---
  const updated = await fresh.resyncLedgerFromWebItems("01000000269", editedItems, fresh.ledgerFreshness.get("id-269"));
  assert.match(updated, /Bia Heineken: 1 → 2/);
  assert.strictEqual(fresh.commits.length, 1);
  const afterIssue = fresh.commits[0];
  assert.strictEqual(afterIssue.mapping.mappings.find(row => row.webCode === HEINEKEN).availableQty, 9);
  const plan269 = afterIssue.statement.transactions.find(item => item.id === "t269").batchApprovedPlan;
  assert.strictEqual(plan269.goods, 235000, "Tiền hàng theo web");
  assert.strictEqual(plan269.hour, 172000, "Tiền giờ theo web");
  const plan270Before = afterIssue.statement.transactions.find(item => item.id === "t270").batchApprovedPlan;
  assert.strictEqual(plan270Before.goods, 175000, "Giao dịch khác không bị đụng");
  // Không có chênh thì không ghi gì.
  assert.strictEqual(await fresh.resyncLedgerFromWebItems("01000000270", structuredClone(ledgerItems), null), "");
  assert.strictEqual(fresh.commits.length, 1);
  // Thiếu tiền giờ (nguồn không có) thì giữ số cũ, không ghi đè bằng 0.
  const noHour = makeBox({ scans: {} });
  noHour.setState({ transactions: [transaction("t1", "01000000001")] }, { entries: [ledgerEntry("t1", "01000000001")] }, makeMapping());
  await noHour.resyncLedgerFromWebItems("01000000001", editedItems, null);
  assert.strictEqual(noHour.commits[0].statement.transactions[0].batchApprovedPlan.hour, 232000);

  console.log("Đối soát lại phiếu đã xử lý từ website: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
