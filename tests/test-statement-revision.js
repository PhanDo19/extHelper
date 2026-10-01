// Khóa ghi sao kê giữa các tab: mỗi lần ghi tăng revision, ghi dựa trên bản cũ
// thì bị từ chối thay vì âm thầm đè thay đổi của tab khác.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "mapping-store.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

// Web Locks giả: tuần tự hóa theo tên khóa, dùng chung giữa mọi "tab".
function makeLocks() {
  const tails = new Map();
  const calls = [];
  return {
    calls,
    request(name, callback) {
      calls.push(name);
      const previous = tails.get(name) || Promise.resolve();
      const run = previous.then(() => callback());
      tails.set(name, run.catch(() => {}));
      return run;
    }
  };
}

// Mỗi tab là một sandbox riêng nhưng dùng CHUNG storage và Web Locks, như các
// tab cùng origin trong trình duyệt. get/set có độ trễ để đọc/ghi xen kẽ thật.
function makeTab(pathname, store, locks) {
  const sandbox = {
    structuredClone,
    location: { pathname },
    navigator: locks ? { locks } : {},
    chrome: {
      storage: {
        local: {
          async get(key) {
            await tick();
            const result = {};
            for (const item of Array.isArray(key) ? key : [key]) {
              if (item in store) result[item] = structuredClone(store[item]);
            }
            return result;
          },
          async set(items) {
            await tick();
            Object.assign(store, structuredClone(items));
          },
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
  return sandbox.InvoiceMappingStore;
}

const KEY = "invoiceTargetBankStatement";

(async () => {
  const store = {};
  const locks = makeLocks();
  const tabA = makeTab("/pariskimgiang/BanHang", store, locks);
  const tabB = makeTab("/pariskimgiang/BanHang", store, locks);

  // 1. Dữ liệu cũ chưa có revision vẫn đọc/ghi được, và bắt đầu đánh số.
  store[KEY] = { source: "cu.xlsx", transactions: [{ id: "t1", status: "pending" }] };
  const legacy = await tabA.loadStatement();
  await tabA.saveStatement(legacy);
  assert.strictEqual(store[KEY].revision, 1, "Bản cũ ghi lần đầu thành revision 1");
  assert.strictEqual(legacy.revision, 1, "Bản trong bộ nhớ phải tăng theo");
  assert(locks.calls.includes(`invoice-target:${KEY}`), "Phải ghi trong Web Lock theo khóa sao kê");

  // 2. Hai tab cùng đọc một bản; tab A ghi trước, tab B ghi sau bị từ chối.
  const inA = await tabA.loadStatement();
  const inB = await tabB.loadStatement();
  inA.transactions[0].status = "planned";
  await tabA.saveStatement(inA);
  inB.transactions[0].note = "tab B";
  await assert.rejects(tabB.saveStatement(inB), error => error.code === tabB.STATEMENT_CONFLICT,
    "Ghi dựa trên bản cũ phải bị từ chối");
  assert.strictEqual(store[KEY].transactions[0].status, "planned", "Thay đổi của tab A không bị đè");
  assert.strictEqual(store[KEY].transactions[0].note, undefined);
  assert.strictEqual(inB.revision, 1, "Lần ghi bị từ chối không được tăng revision trong bộ nhớ");

  // 3. mutateStatement sửa trên bản MỚI NHẤT: giữ thay đổi của tab A.
  const merged = await tabB.mutateStatement(statement => {
    statement.transactions[0].workerError = "Không có phòng trống";
  });
  assert.strictEqual(merged.transactions[0].status, "planned", "Giữ thay đổi của tab A");
  assert.strictEqual(merged.transactions[0].workerError, "Không có phòng trống");
  assert.strictEqual(store[KEY].revision, 3);
  // Nhận bản trả về làm bản hiện hành thì ghi tiếp bình thường.
  merged.transactions[0].note = "sau khi hợp nhất";
  await tabB.saveStatement(merged);
  assert.strictEqual(store[KEY].revision, 4);

  // 4. mutator ném lỗi thì không ghi gì.
  await assert.rejects(tabA.mutateStatement(() => { throw new Error("đã bị chặn"); }), /đã bị chặn/);
  assert.strictEqual(store[KEY].revision, 4, "Mutator lỗi không được ghi");

  // 5. Hai tab ghi ĐỒNG THỜI trên cùng một bản: đúng một tab thắng.
  const raceA = await tabA.loadStatement();
  const raceB = await tabB.loadStatement();
  raceA.transactions[0].race = "A";
  raceB.transactions[0].race = "B";
  const results = await Promise.allSettled([tabA.saveStatement(raceA), tabB.saveStatement(raceB)]);
  assert.strictEqual(results.filter(item => item.status === "fulfilled").length, 1, "Chỉ một tab được ghi");
  assert.strictEqual(results.filter(item => item.reason?.code === "statement-conflict").length, 1,
    "Tab còn lại nhận lỗi xung đột");
  assert.strictEqual(store[KEY].revision, 5);

  // 6. Ghi sổ đối soát bằng sao kê cũ: từ chối CẢ lần ghi (tồn, sổ, kho).
  store.invoiceTargetMappingDataset = { mappings: [{ stockCode: "BIA", availableQty: 10 }] };
  store.invoiceTargetVerificationLedger = { entries: [] };
  const stale = structuredClone(raceA);
  stale.revision = 1;
  await assert.rejects(
    tabA.commitVerifiedInvoice(
      { mappings: [{ stockCode: "BIA", availableQty: 7 }] }, stale, { entries: [{ id: "l1" }] }, null
    ),
    error => error.code === "statement-conflict"
  );
  assert.strictEqual(store.invoiceTargetMappingDataset.mappings[0].availableQty, 10, "Tồn không bị trừ nửa vời");
  assert.strictEqual(store.invoiceTargetVerificationLedger.entries.length, 0, "Sổ đối soát không bị ghi");

  // Ghi sổ bằng bản mới nhất thì thành công và tăng revision trong bộ nhớ.
  const fresh = await tabA.loadStatement();
  await tabA.commitVerifiedInvoice(
    { mappings: [{ stockCode: "BIA", availableQty: 7 }] }, fresh, { entries: [{ id: "l1" }] }, null
  );
  assert.strictEqual(store.invoiceTargetMappingDataset.mappings[0].availableQty, 7);
  assert.strictEqual(fresh.revision, 6);
  assert.strictEqual(store[KEY].revision, 6);

  // 7. Không có Web Locks (trang http) vẫn kiểm tra revision.
  const noLockStore = { [KEY]: { transactions: [], revision: 2 } };
  const noLockTab = makeTab("/pariskimgiang/BanHang", noLockStore, null);
  await assert.rejects(noLockTab.saveStatement({ transactions: [], revision: 1 }),
    error => error.code === "statement-conflict");

  // 8. Hai chỗ nhập file thay cả sao kê phải mang theo revision hiện có.
  const importsWithRevision = contentSource.match(/revision: statementDataset\.revision/g) || [];
  assert.strictEqual(importsWithRevision.length, 2, "Nhập sao kê và nhập danh sách số tiền phải giữ revision");

  console.log("Khóa ghi sao kê giữa các tab: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
