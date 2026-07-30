const assert = require("assert");

const values = {};
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        return { [key]: values[key] };
      },
      async set(entries) {
        Object.assign(values, entries);
      },
      async remove(key) {
        delete values[key];
      }
    }
  }
};

require("./mapping-store.js");

(async () => {
  const session = {
    schemaVersion: 1,
    mode: "batch",
    panelOpen: true,
    batchLimit: 3,
    batchPlans: [{ transactionId: "tx-1", status: "needs_new_invoice" }],
    pendingNewInvoice: { transactionId: "tx-1", transactionDate: "2026-06-30", credit: 2500000 },
    updatedAt: new Date().toISOString()
  };

  await globalThis.InvoiceMappingStore.saveUiSession(session);
  assert.deepStrictEqual(await globalThis.InvoiceMappingStore.loadUiSession(), session);

  await globalThis.InvoiceMappingStore.clearUiSession();
  assert.strictEqual(await globalThis.InvoiceMappingStore.loadUiSession(), null);

  const importedMapping = { mappings: [{ stockCode: "A", availableQty: 3 }] };
  const backup = { exportId: "backup-1" };
  const meta = { currentExportId: "export-1", exportedAt: "2026-07-29T10:00:00.000Z" };
  await globalThis.InvoiceMappingStore.importStockState(importedMapping, meta, backup);
  assert.deepStrictEqual(await globalThis.InvoiceMappingStore.load({}), importedMapping);
  assert.deepStrictEqual(await globalThis.InvoiceMappingStore.loadStockStateMeta(), meta);
  assert.deepStrictEqual(await globalThis.InvoiceMappingStore.loadStockStateBackup(), backup);

  console.log("UI session storage: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
