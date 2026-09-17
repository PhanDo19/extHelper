// Hoàn kho theo khoảng ngày sao kê để chạy lại một lô đã đối soát sai.
//
// Nguồn sự thật là SỔ ĐỐI SOÁT: mỗi lần ghi sổ lưu đúng mặt hàng và số lượng đã
// trừ, nên hoàn kho là cộng ngược lại đúng những dòng đó. Không được suy từ
// phương án hiện tại vì phương án có thể đã bị tính lại và khác thứ đã trừ.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const InvoiceSharedWarehouse = require(path.join(__dirname, "..", "shared-warehouse.js"));

function extractFunction(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0, paramsEnd = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    if (source[i] === "(") parenDepth += 1;
    if (source[i] === ")") parenDepth -= 1;
    if (parenDepth === 0) { paramsEnd = i; break; }
  }
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

function makeBox({ mappings, transactions, ledgerEntries, warehouseItems }) {
  const committed = {};
  const box = {
    structuredClone,
    InvoiceSharedWarehouse,
    pageTenantSlug: "parisnhon",
    mappingDataset: { mappings },
    statementDataset: { transactions },
    verificationLedger: { entries: ledgerEntries },
    sharedWarehouse: InvoiceSharedWarehouse.normalize({
      kind: InvoiceSharedWarehouse.KIND,
      schemaVersion: InvoiceSharedWarehouse.SCHEMA_VERSION,
      initialized: true,
      source: "test",
      updatedAt: "2026-09-01T00:00:00.000Z",
      items: warehouseItems || [],
      ledger: []
    }),
    InvoiceMappingStore: {
      async loadSharedWarehouse() { return box.sharedWarehouse; },
      async commitVerifiedInvoice(dataset, statement, ledger, warehouse) {
        Object.assign(committed, { dataset, statement, ledger, warehouse });
        return { dataset, statement, ledger, warehouse };
      }
    },
    committed
  };
  vm.createContext(box);
  vm.runInContext(
    [
      "ledgerEntriesInDateRange", "summarizeRestockPreview",
      "restoreVerifiedStock", "restockLedgerEntries"
    ].map(extractFunction).join(";\n") +
    ";\nthis.ledgerEntriesInDateRange = ledgerEntriesInDateRange;" +
    "this.summarizeRestockPreview = summarizeRestockPreview;" +
    "this.restockLedgerEntries = restockLedgerEntries;",
    box
  );
  return box;
}

const baseMappings = () => [
  { stockCode: "HH_Tiger", status: "confirmed", webCode: "0000045", webName: "Bia Tiger lon", availableQty: 100 },
  { stockCode: "HH_Khan", status: "confirmed", webCode: "0000014", webName: "Khăn ướt", availableQty: 500 },
  // Đĩa hoa quả bán theo suất: không trừ tồn nên cũng không được hoàn.
  { stockCode: "HQ_THAPCAM", status: "confirmed", webCode: "0000013", webName: "Hoa quả thập cẩm", availableQty: 0, availabilityMode: "per_invoice", perInvoiceMax: 1 }
];
const baseTransactions = () => [
  { id: "t1", transactionDate: "2026-07-01", credit: 541200, status: "done", invoiceNo: "01000000260", verifiedAt: "2026-09-16T10:00:00.000Z", ledgerId: "ledger-t1", apiSavedRecordId: "rec-1", newInvoiceRoomName: "VIP 21" },
  { id: "t2", transactionDate: "2026-07-05", credit: 1004000, status: "done", invoiceNo: "01000000261", verifiedAt: "2026-09-16T11:00:00.000Z", ledgerId: "ledger-t2" },
  { id: "t3", transactionDate: "2026-08-02", credit: 700000, status: "done", invoiceNo: "01000000299", verifiedAt: "2026-09-16T12:00:00.000Z", ledgerId: "ledger-t3" },
  { id: "t4", transactionDate: "2026-07-03", credit: 393800, status: "pending" }
];
const baseLedger = () => [
  { id: "ledger-t1", transactionId: "t1", invoiceNo: "01000000260", verifiedAt: "2026-09-16T10:00:00.000Z", grand: 541200, items: [
    { code: "0000045", name: "Bia Tiger lon", qty: 3, price: 50000 },
    { code: "0000014", name: "Khăn ướt", qty: 4, price: 5000 }
  ] },
  { id: "ledger-t2", transactionId: "t2", invoiceNo: "01000000261", verifiedAt: "2026-09-16T11:00:00.000Z", grand: 1004000, items: [
    { code: "0000045", name: "Bia Tiger lon", qty: 4, price: 50000 },
    { code: "0000013", name: "Hoa quả thập cẩm", qty: 1, price: 450000 }
  ] },
  { id: "ledger-t3", transactionId: "t3", invoiceNo: "01000000299", verifiedAt: "2026-09-16T12:00:00.000Z", grand: 700000, items: [
    { code: "0000045", name: "Bia Tiger lon", qty: 2, price: 50000 }
  ] }
];
const baseWarehouse = () => [
  { stockCode: "HH_Tiger", stockName: "Bia Tiger lon", availableQty: 100 },
  { stockCode: "HH_Khan", stockName: "Khăn ướt", availableQty: 500 }
];

// --- Lọc theo khoảng ngày -------------------------------------------------------
{
  const box = makeBox({ mappings: baseMappings(), transactions: baseTransactions(), ledgerEntries: baseLedger(), warehouseItems: baseWarehouse() });
  const july = box.ledgerEntriesInDateRange("2026-07-01", "2026-07-31");
  assert.deepStrictEqual(july.map(m => m.entry.transactionId), ["t1", "t2"], "Chỉ lấy giao dịch trong tháng 7");
  assert.strictEqual(box.ledgerEntriesInDateRange("2026-07-01", "2026-07-01").length, 1, "Khoảng một ngày");
  assert.strictEqual(box.ledgerEntriesInDateRange("2026-09-01", "2026-09-30").length, 0, "Ngoài khoảng thì không có gì");
  // Ngày lấy từ GIAO DỊCH sao kê, không phải ngày ghi sổ: cả ba bản ghi đều
  // verifiedAt tháng 9 nhưng giao dịch thuộc tháng 7 và 8.
  assert.strictEqual(box.ledgerEntriesInDateRange("2026-08-01", "2026-08-31").length, 1, "Tháng 8 có đúng một giao dịch");

  // Bản ghi mồ côi (giao dịch đã bị xóa) không có ngày nên bị bỏ qua.
  const orphan = makeBox({
    mappings: baseMappings(),
    transactions: [],
    ledgerEntries: baseLedger(),
    warehouseItems: baseWarehouse()
  });
  assert.strictEqual(orphan.ledgerEntriesInDateRange("2026-01-01", "2026-12-31").length, 0,
    "Bản ghi không còn giao dịch thì không hoàn kho tự động");
}

// --- Xem trước số lượng sẽ hoàn ---------------------------------------------------
{
  const box = makeBox({ mappings: baseMappings(), transactions: baseTransactions(), ledgerEntries: baseLedger(), warehouseItems: baseWarehouse() });
  const preview = box.summarizeRestockPreview(box.ledgerEntriesInDateRange("2026-07-01", "2026-07-31"));
  const byCode = new Map(preview.map(item => [item.code, item.qty]));
  assert.strictEqual(byCode.get("0000045"), 7, "Bia gộp từ hai phiếu: 3 + 4");
  assert.strictEqual(byCode.get("0000014"), 4, "Khăn ướt 4 cái");
  assert.ok(!byCode.has("0000013"), "Đĩa hoa quả bán theo suất không trừ tồn nên không hoàn");
}

// --- Hoàn kho thật ------------------------------------------------------------------
async function main() {
  {
    const box = makeBox({ mappings: baseMappings(), transactions: baseTransactions(), ledgerEntries: baseLedger(), warehouseItems: baseWarehouse() });
    const matches = box.ledgerEntriesInDateRange("2026-07-01", "2026-07-31");
    const res = await box.restockLedgerEntries(matches);
    assert.strictEqual(res.restored, 2);
    // Mảng tạo trong sandbox vm khác prototype nên so bằng nội dung.
    assert.strictEqual(res.invoiceNos.join(","), "01000000260,01000000261");

    // Tồn kho cộng đúng số đã trừ.
    const mapping = box.committed.dataset.mappings;
    assert.strictEqual(mapping.find(r => r.stockCode === "HH_Tiger").availableQty, 107, "Bia 100 + 7");
    assert.strictEqual(mapping.find(r => r.stockCode === "HH_Khan").availableQty, 504, "Khăn 500 + 4");
    assert.strictEqual(mapping.find(r => r.stockCode === "HQ_THAPCAM").availableQty, 0, "Đĩa hoa quả không đổi");

    // Kho chung cũng phải được cộng, nếu không hai cơ sở lệch nhau.
    const warehouse = box.committed.warehouse.items;
    assert.strictEqual(warehouse.find(i => i.stockCode === "HH_Tiger").availableQty, 107, "Kho chung phải cộng theo");
    assert.strictEqual(warehouse.find(i => i.stockCode === "HH_Khan").availableQty, 504);
    assert.ok(box.committed.warehouse.ledger.length >= 1, "Kho chung phải ghi vết lần hoàn kho");

    // Giao dịch về Chưa xử lý, bỏ mọi liên kết phiếu để Batch Review lập lại.
    const statement = box.committed.statement.transactions;
    for (const id of ["t1", "t2"]) {
      const t = statement.find(item => item.id === id);
      assert.strictEqual(t.status, "pending", `${id} phải về Chưa xử lý`);
      assert.strictEqual(t.invoiceNo, "", `${id} phải bỏ số phiếu`);
      assert.strictEqual(t.verifiedAt, "");
      assert.strictEqual(t.ledgerId, "");
      assert.strictEqual(t.pendingPlan, null);
      assert.ok(!t.batchApprovedPlan, `${id} phải bỏ phương án đã Accept`);
      assert.ok(!t.newInvoiceRoomName, `${id} phải bỏ phòng đã giữ`);
      assert.ok(t.restockedAt, `${id} phải ghi mốc hoàn kho`);
      assert.ok(/website/i.test(t.restockedNote), `${id} phải nhắc phiếu còn trên website`);
    }
    // Giao dịch ngoài khoảng và giao dịch chưa xử lý không bị đụng.
    assert.strictEqual(statement.find(item => item.id === "t3").status, "done", "Tháng 8 giữ nguyên");
    assert.strictEqual(statement.find(item => item.id === "t3").invoiceNo, "01000000299");
    assert.strictEqual(statement.find(item => item.id === "t4").status, "pending");

    // Sổ đối soát chỉ xóa đúng bản ghi đã hoàn, để không hoàn kho hai lần.
    assert.deepStrictEqual(box.committed.ledger.entries.map(e => e.transactionId), ["t3"],
      "Chỉ còn bản ghi của giao dịch ngoài khoảng");

    // Hoàn lần hai trên dữ liệu đã cập nhật: không còn gì để hoàn.
    assert.strictEqual(box.ledgerEntriesInDateRange("2026-07-01", "2026-07-31").length, 0,
      "Đã hoàn rồi thì không hoàn lại được nữa");
  }

  // --- Không có gì để hoàn thì báo lỗi, không ghi storage ------------------------
  {
    const box = makeBox({ mappings: baseMappings(), transactions: baseTransactions(), ledgerEntries: baseLedger(), warehouseItems: baseWarehouse() });
    await assert.rejects(() => box.restockLedgerEntries([]), /Không có giao dịch đã đối soát nào/,
      "Danh sách rỗng phải báo lỗi rõ");
    assert.strictEqual(Object.keys(box.committed).length, 0, "Không được ghi storage khi không có gì để hoàn");
  }

  // --- Mã web đã bị gỡ ánh xạ: dừng hẳn, không ghi nửa vời ----------------------
  {
    const box = makeBox({
      mappings: [{ stockCode: "HH_Khan", status: "confirmed", webCode: "0000014", webName: "Khăn ướt", availableQty: 500 }],
      transactions: baseTransactions(),
      ledgerEntries: baseLedger(),
      warehouseItems: baseWarehouse()
    });
    const matches = box.ledgerEntriesInDateRange("2026-07-01", "2026-07-31");
    await assert.rejects(() => box.restockLedgerEntries(matches), /Không còn ánh xạ kho cho mã 0000045/,
      "Mất ánh xạ phải dừng và nêu rõ mã");
    assert.strictEqual(Object.keys(box.committed).length, 0, "Lỗi giữa chừng không được ghi storage");
    assert.strictEqual(box.statementDataset.transactions.find(t => t.id === "t1").status, "done",
      "Sao kê phải giữ nguyên khi hoàn kho thất bại");
  }

  console.log("restock verified range: OK");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
