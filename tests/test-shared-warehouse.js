const assert = require("assert");
const path = require("path");
const Warehouse = require(path.join(__dirname, "..", "shared-warehouse.js"));

const current = Warehouse.normalize({
  initialized: true,
  source: "Kho tháng 5.xlsx",
  items: [
    { stockCode: "A", stockName: "Hàng A", availableQty: 10, salePrice: 10000 },
    { stockCode: "B", stockName: "Hàng B", availableQty: 5, salePrice: 20000 }
  ]
});

const snapshot = Warehouse.previewImport(current, [
  { stockCode: "A", stockName: "Hàng A mới", availableQty: 7, salePrice: 10000 },
  { stockCode: "C", stockName: "Hàng C", availableQty: 3, salePrice: 30000 }
], "snapshot", { source: "Kiểm kê tháng 6.xlsx", at: "2026-08-11T00:00:00.000Z" });

assert.equal(snapshot.counts.added, 1);
assert.equal(snapshot.counts.decreased, 1);
assert.equal(snapshot.counts.missing, 1, "Mã B thiếu trong kiểm kê phải được cảnh báo");
assert.equal(snapshot.nextItems.find(item => item.stockCode === "B").availableQty, 5,
  "Mã thiếu không được tự xóa hoặc đưa về 0");
assert.equal(snapshot.nextItems.find(item => item.stockCode === "B").missingFromLastSnapshot, true);

const afterSnapshot = Warehouse.applyImport(current, snapshot, "parislinhdam");
assert.equal(afterSnapshot.initialized, true);
assert.equal(afterSnapshot.items.find(item => item.stockCode === "A").availableQty, 7);
assert.equal(afterSnapshot.ledger.at(-1).tenant, "parislinhdam");

const inbound = Warehouse.previewImport(afterSnapshot, [
  { stockCode: "A", stockName: "Hàng A", availableQty: 4, salePrice: 10000 },
  { stockCode: "D", stockName: "Hàng D", availableQty: 2, salePrice: 50000 }
], "add", { source: "Nhập thêm.xlsx" });
assert.equal(inbound.counts.missing, 0);
assert.equal(inbound.nextItems.find(item => item.stockCode === "A").availableQty, 11,
  "Nhập bổ sung phải cộng vào số hiện có");

const mapping = {
  mappings: [
    { stockCode: "A", availableQty: 999, status: "confirmed", webCode: "100" },
    { stockCode: "TCTO", availableQty: 0, availabilityMode: "per_invoice", perInvoiceMax: 1 }
  ]
};
const overlaid = Warehouse.overlayMappings(mapping, afterSnapshot);
assert.equal(overlaid.mappings[0].availableQty, 7, "Mapping cơ sở phải đọc số lượng từ kho chung");
assert.equal(overlaid.mappings[1].availableQty, 0, "Định mức/HĐ không bị kho chung ghi đè");

const deductedMapping = structuredClone(overlaid);
deductedMapping.mappings[0].availableQty = 5;
const afterInvoice = Warehouse.reconcileMappingDelta(afterSnapshot, overlaid, deductedMapping, {
  tenant: "pariskimgiang",
  invoiceNo: "HD001",
  transactionId: "tx-1"
});
assert.equal(afterInvoice.items.find(item => item.stockCode === "A").availableQty, 5);
assert.equal(afterInvoice.ledger.at(-1).type, "invoice");
assert.equal(afterInvoice.ledger.at(-1).tenant, "pariskimgiang");

console.log("Shared physical warehouse: OK");
