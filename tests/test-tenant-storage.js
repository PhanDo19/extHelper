// Mapping, sao ke va template API tach theo chi nhanh; kho vat ly dung chung.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "mapping-store.js"), "utf8");

function makeStore(pathname, store = {}) {
  const sandbox = {
    structuredClone,
    location: { pathname },
    chrome: {
      storage: {
        local: {
          async get(key) {
            const keys = Array.isArray(key) ? key : [key];
            const result = {};
            for (const item of keys) if (item in store) result[item] = store[item];
            return result;
          },
          async set(items) { Object.assign(store, items); },
          async remove(key) {
            for (const item of Array.isArray(key) ? key : [key]) delete store[item];
          }
        }
      }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { api: sandbox.InvoiceMappingStore, store };
}

const kimGiang = makeStore("/pariskimgiang/Form");
const linhDam = makeStore("/parislinhdam/Form");
const parisNhon = makeStore("/parisnhon/Form");

assert.equal(kimGiang.api.currentTenant(), "pariskimgiang");
assert.equal(linhDam.api.currentTenant(), "parislinhdam");

(async () => {
  // --- Sao ke: phai tach rieng ---
  await kimGiang.api.saveStatement({ source: "saoKeKG.xlsx", transactions: [{ id: "kg-1" }] });
  await linhDam.api.saveStatement({ source: "saoKeLD.xlsx", transactions: [{ id: "ld-1" }, { id: "ld-2" }] });

  const kgStatement = await kimGiang.api.loadStatement();
  const ldStatement = await linhDam.api.loadStatement();
  assert.equal(kgStatement.source, "saoKeKG.xlsx");
  assert.equal(ldStatement.source, "saoKeLD.xlsx");
  assert.equal(kgStatement.transactions.length, 1, "Sao ke hai chi nhanh khong duoc tron");
  assert.equal(ldStatement.transactions.length, 2);

  // Chi nhanh mac dinh giu nguyen ten key cu -> du lieu dang lam do khong mat.
  assert.ok("invoiceTargetBankStatement" in kimGiang.store,
    "pariskimgiang phai dung key cu de tuong thich du lieu san co");
  assert.ok("invoiceTargetBankStatement__parislinhdam" in linhDam.store,
    "parislinhdam phai dung key rieng");

  // --- Phien UI: tach, vi batchPlans tro toi transactionId cua sao ke ---
  await kimGiang.api.saveUiSession({ batchPlans: [{ transactionId: "kg-1" }] });
  await linhDam.api.saveUiSession({ batchPlans: [{ transactionId: "ld-1" }] });
  assert.equal((await kimGiang.api.loadUiSession()).batchPlans[0].transactionId, "kg-1");
  assert.equal((await linhDam.api.loadUiSession()).batchPlans[0].transactionId, "ld-1");

  // Xoa phien cua mot ben khong duoc dung toi ben kia. Dung sandbox rieng vi
  // phan kiem tra danh sach key ben duoi can phien parislinhdam con ton tai.
  const clearProbe = makeStore("/parislinhdam/Form");
  await clearProbe.api.saveUiSession({ batchPlans: [{ transactionId: "ld-1" }] });
  await clearProbe.api.clearUiSession();
  assert.equal(await clearProbe.api.loadUiSession(), null);
  assert.ok(await kimGiang.api.loadUiSession(), "Xoa phien parislinhdam khong duoc xoa phien pariskimgiang");

  // --- So hoa don da phat hanh: tach ---
  await kimGiang.api.saveIssuedInvoices({ entries: [{ invoiceNo: "KG-001" }] });
  await linhDam.api.saveIssuedInvoices({ entries: [{ invoiceNo: "LD-001" }, { invoiceNo: "LD-002" }] });
  assert.equal((await kimGiang.api.loadIssuedInvoices()).entries.length, 1);
  assert.equal((await linhDam.api.loadIssuedInvoices()).entries.length, 2);

  // --- So doi chieu: tach ---
  await kimGiang.api.commitVerifiedInvoice({ items: [] }, { transactions: [] }, { entries: [{ id: "kg-led" }] });
  await linhDam.api.commitVerifiedInvoice({ items: [] }, { transactions: [] }, { entries: [{ id: "ld-led" }] });
  assert.equal((await kimGiang.api.loadLedger()).entries[0].id, "kg-led");
  assert.equal((await linhDam.api.loadLedger()).entries[0].id, "ld-led");

  // --- Ma web: phai TACH, vi 47/145 mat hang trung ten nhung khac ma ---
  await linhDam.api.saveCatalog({ items: [{ webCode: "1000030", webName: "Bánh khoai tây chiên 60g" }] });
  await linhDam.api.savePriorityRules([{ id: "rule-a", webCode: "1000049" }]);
  await linhDam.api.saveApiTemplate({ version: 1 });
  await linhDam.api.save({ mappings: [{ stockCode: "BANHKHOAI", webCode: "1000030", stockQty: 10, availableQty: 10 }] });

  for (const perTenant of [
    "invoiceTargetWebCatalog",
    "invoiceTargetPriorityRules",
    "invoiceTargetMappingDataset"
  ]) {
    assert.ok(`${perTenant}__parislinhdam` in linhDam.store,
      `${perTenant} phai tach theo chi nhanh (ma web hai ben khac nhau)`);
    assert.ok(!(perTenant in linhDam.store),
      `${perTenant} khong duoc ghi vao key dung chung`);
  }

  // Template API phai tach: request co duong dan/ID phien cua tung co so.
  assert.ok("invoiceTargetApiTemplate__parislinhdam" in linhDam.store, "Template API Linh Dam phai tach rieng");

  // Danh muc mac dinh do content.js chon theo chi nhanh roi truyen vao, nen
  // loadCatalog phai tra dung fallback duoc dua vao, khong tu doi sang bo khac.
  const freshLinhDam = makeStore("/parislinhdam/Form");
  const ldFallback = { source: "jsondataLD.json", items: [{ webCode: "1000030" }] };
  const loaded = await freshLinhDam.api.loadCatalog(ldFallback);
  assert.deepEqual(loaded.items, ldFallback.items, "Phai dung danh muc cua chinh chi nhanh do");
  const freshRules = await freshLinhDam.api.loadPriorityRules();
  assert.deepEqual(freshRules, [], "Quy tac uu tien mac dinh chi ap dung cho chi nhanh mac dinh");
  const kgRules = await makeStore("/pariskimgiang/Form").api.loadPriorityRules();
  assert.equal(kgRules.length, 2, "Chi nhanh mac dinh van giu quy tac san co");

  // --- Mapping tách theo cơ sở, kho vật lý dùng chung ---
  const multiTenantStorage = {};
  const kgStock = makeStore("/pariskimgiang/Form", multiTenantStorage);
  const ldStock = makeStore("/parislinhdam/Form", multiTenantStorage);
  await kgStock.api.save({ mappings: [{ stockCode: "BANHSNACK", webCode: "1000047", stockQty: 100, availableQty: 100 }] });
  await ldStock.api.save({ mappings: [{ stockCode: "BANHSNACK", webCode: "1000052", stockQty: 999, availableQty: 999 }] });
  assert.equal((await kgStock.api.load({ mappings: [] })).mappings[0].availableQty, 100);
  assert.equal((await ldStock.api.load({ mappings: [] })).mappings[0].availableQty, 999);

  await kgStock.api.saveSharedWarehouse({ initialized: true, items: [{ stockCode: "BANHSNACK", availableQty: 100 }] });
  assert.equal((await ldStock.api.loadSharedWarehouse({ items: [] })).items[0].availableQty, 100,
    "Linh Dam phai doc cung kho vat ly da cap nhat o Kim Giang");
  await ldStock.api.saveSharedWarehouse({ initialized: true, items: [{ stockCode: "BANHSNACK", availableQty: 60 }] });
  assert.equal((await kgStock.api.loadSharedWarehouse({ items: [] })).items[0].availableQty, 60,
    "Kim Giang phai thay so ton da tru tu Linh Dam");

  await parisNhon.api.saveSharedWarehouse({ initialized: true, items: [{ stockCode: "NHON-001", availableQty: 999 }] });
  assert.equal((await parisNhon.api.loadSharedWarehouse({ items: [] })).items[0].availableQty, 999,
    "Paris Nhon phai doc kho rieng");
  assert.equal((await kgStock.api.loadSharedWarehouse({ items: [] })).items[0].availableQty, 60,
    "Kho rieng Paris Nhon khong duoc ghi de kho chung Kim Giang/Linh Dam");

  await kgStock.api.commitVerifiedInvoice(
    { mappings: [{ stockCode: "BANHSNACK", webCode: "1000047", availableQty: 55 }] },
    { transactions: [] },
    { entries: [] },
    { initialized: true, items: [{ stockCode: "BANHSNACK", availableQty: 55 }] }
  );
  assert.equal((await ldStock.api.loadSharedWarehouse({ items: [] })).items[0].availableQty, 55,
    "Ghi so doi soat phai cap nhat kho chung trong cung lan storage.set");

  await kgStock.api.saveStockStateMeta({ currentExportId: "kg-stock" });
  await ldStock.api.saveStockStateMeta({ currentExportId: "ld-stock" });
  assert.equal((await kgStock.api.loadStockStateMeta()).currentExportId, "kg-stock");
  assert.equal((await ldStock.api.loadStockStateMeta()).currentExportId, "ld-stock");

  console.log("tach hoan toan du lieu theo chi nhanh: OK");
})().catch(error => { console.error(error); process.exit(1); });
