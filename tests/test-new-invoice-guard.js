// Chống tạo trùng phiếu mới và báo lỗi tab worker về tab gốc.
//
// 1. Dấu "đang tạo phiếu" phải được GHI trước khi gửi API, và chặn mọi lần tạo
//    lại khi kết quả lần trước chưa chắc chắn.
// 2. Lỗi xảy ra trước khi request rời trình duyệt thì được gỡ dấu để thử lại.
// 3. API thành công thì kết quả phải được ghi trước bước ghi/tải log.
// 4. Tab gốc dừng ngay khi worker báo lỗi, không chờ hết 90 giây.
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

function extractConst(source, name) {
  const match = new RegExp(`const ${name} = [^;]+;`).exec(source);
  if (!match) throw new Error(`Không tìm thấy hằng ${name}`);
  return match[0];
}

// ---------------------------------------------------------------------------
// Bridge: phân biệt lỗi "chưa gửi" với lỗi sau khi đã gửi.
// ---------------------------------------------------------------------------
async function bridgeError(behaviour) {
  const box = {
    normalizeDateKey: value => value,
    postFreshInvoiceTwoStep: async (_expected, progress) => behaviour(progress)
  };
  vm.createContext(box);
  vm.runInContext(
    `${extractConst(bridgeSource, "NEW_INVOICE_NOT_SENT_TAG")}\n` +
    `${extractFunction(bridgeSource, "createAndPayFreshInvoiceViaApi")}\n` +
    "this.run = createAndPayFreshInvoiceViaApi;",
    box
  );
  try {
    await box.run({});
  } catch (error) {
    return error.message;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Content: applyPendingNewInvoicePlan với storage và bridge giả.
// ---------------------------------------------------------------------------
function makeContentBox(options) {
  const events = [];
  const stored = { value: structuredClone(options.stored) };
  const box = {
    events,
    stored,
    structuredClone,
    console: { error: () => {}, warn: () => {} },
    document: { getElementById: () => ({ value: "" }) },
    window: { setTimeout: () => 0 },
    chrome: { runtime: { sendMessage: () => {} } },
    pageTenantSlug: "parisnhon",
    formatMoney: value => String(value),
    setStatus: () => {},
    assertRuntimeContext: () => {},
    syncBatchPlanTransaction: () => {},
    renderBatchPlans: () => {},
    saveBatchUiSession: async () => { events.push("session"); },
    persistGeneratedInvoiceApiDebugLog: async entry => { events.push(`log:${entry.outcome}`); },
    request: async action => {
      events.push(`request:${action}`);
      if (action === "createAndPayFreshInvoiceViaApi") return options.createResult();
      return {};
    },
    InvoiceMappingStore: {
      loadStatement: async () => structuredClone(stored.value),
      saveStatement: async statement => {
        const tx = statement.transactions[0];
        events.push(`save:${tx.status}:${tx.newInvoiceCreateStartedAt ? "marked" : "clear"}`);
        stored.value = structuredClone(statement);
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(
    "var pendingNewInvoice = null; var statementDataset = null; var currentBankTransaction = null;\n" +
    `${extractConst(contentSource, "NEW_INVOICE_NOT_SENT_TAG")}\n` +
    `${extractFunction(contentSource, "newInvoiceAttemptBlockReason")}\n` +
    `${extractFunction(contentSource, "applyPendingNewInvoicePlan")}\n` +
    "this.apply = applyPendingNewInvoicePlan;\n" +
    "this.setState = (pending, statement) => { pendingNewInvoice = pending; statementDataset = statement; };\n" +
    "this.getStatement = () => statementDataset;",
    box
  );
  return box;
}

const plan = {
  requiresNewInvoice: true,
  items: [{ code: "BIA", qty: 3 }],
  targetGrand: 1100000,
  goods: 600000,
  hour: 400000,
  tax: 100000,
  checkIn: "01/07/2026 17:00",
  checkOut: "01/07/2026 17:40"
};
const baseTransaction = { id: "t1", transactionDate: "2026-07-01", credit: 1100000, status: "batch_ready" };

async function runApply(options) {
  const box = makeContentBox({ stored: { transactions: [structuredClone(options.memoryTx || baseTransaction)] }, ...options });
  if (options.storedTx) box.stored.value = { transactions: [structuredClone(options.storedTx)] };
  const statement = { transactions: [structuredClone(options.memoryTx || baseTransaction)] };
  box.setState({ transactionId: "t1", plan: structuredClone(plan) }, statement);
  let error = null;
  try {
    await box.apply(box.getStatement().transactions[0]);
  } catch (caught) {
    error = caught;
  }
  return { box, error, tx: box.getStatement().transactions[0] };
}

(async () => {
  // Bridge -----------------------------------------------------------------
  const notSent = await bridgeError(() => { throw new Error("Form moi thieu DBANID"); });
  assert.strictEqual(notSent, "[chua-gui-api] Form moi thieu DBANID",
    "Lỗi trước khi gửi request phải mang tiền tố chưa-gửi.");
  const sentNoSession = await bridgeError(progress => { progress.sessionSent = true; throw new Error("HTTP 500"); });
  assert.strictEqual(sentNoSession, "HTTP 500", "Lỗi sau khi đã gửi không được mang tiền tố chưa-gửi.");
  const partial = await bridgeError(progress => {
    progress.sessionSent = true;
    progress.sessionInvoiceNo = "01000000150";
    progress.sessionRecordId = "abc-id";
    throw new Error("thanh toan loi");
  });
  assert(/01000000150/.test(partial) && /abc-id/.test(partial) && !partial.startsWith("[chua-gui-api]"),
    "Lỗi ở bước thanh toán phải nêu số phiếu và ID phiên đã tạo dở.");

  // 1. Thành công: dấu được ghi TRƯỚC API; kết quả được ghi TRƯỚC log -------
  const success = await runApply({
    createResult: () => ({ saved: true, savedRecordId: "rec-1", invoiceNo: "01000000200" })
  });
  assert.strictEqual(success.error, null, success.error?.message);
  const events = success.box.events;
  const markIndex = events.indexOf("save:batch_ready:marked");
  const createIndex = events.indexOf("request:createAndPayFreshInvoiceViaApi");
  const plannedIndex = events.indexOf("save:planned:marked");
  const logIndex = events.indexOf("log:success");
  assert(markIndex >= 0 && markIndex < createIndex, `Phải ghi dấu trước khi gọi API: ${events.join(" > ")}`);
  assert(plannedIndex > createIndex && plannedIndex < logIndex,
    `Kết quả phải được ghi trước bước ghi log: ${events.join(" > ")}`);
  assert.strictEqual(success.tx.status, "planned");
  assert.strictEqual(success.tx.invoiceNo, "01000000200");

  // 2. Lỗi chưa gửi: gỡ dấu, được phép thử lại --------------------------------
  const unsent = await runApply({
    createResult: () => { throw new Error("[chua-gui-api] Form moi thieu DBANID"); }
  });
  assert(unsent.error && unsent.error.message === "Form moi thieu DBANID", unsent.error?.message);
  assert(!unsent.tx.newInvoiceCreateStartedAt, "Lỗi chưa gửi phải gỡ dấu đang tạo.");
  assert(!unsent.box.stored.value.transactions[0].newInvoiceCreateStartedAt, "Storage cũng phải được gỡ dấu.");

  // 3. Lỗi sau khi gửi: giữ dấu, ghi lỗi và chặn lần sau -----------------------
  const uncertain = await runApply({
    createResult: () => { throw new Error("Trang không phản hồi sau 30s (createAndPayFreshInvoiceViaApi)."); }
  });
  assert(uncertain.error, "Lỗi sau khi gửi phải được ném ra.");
  assert(uncertain.tx.newInvoiceCreateStartedAt, "Lỗi sau khi gửi phải giữ dấu đang tạo.");
  assert(/Trang không phản hồi/.test(uncertain.tx.newInvoiceCreateError));
  assert(/Không tạo lại/.test(uncertain.tx.blockedNote), "Giao dịch phải ghi rõ lý do bị chặn.");
  const storedAfterUncertain = uncertain.box.stored.value.transactions[0];
  assert(storedAfterUncertain.newInvoiceCreateStartedAt, "Dấu phải nằm trong storage, không chỉ trong bộ nhớ.");

  const retry = await runApply({
    memoryTx: storedAfterUncertain,
    createResult: () => { throw new Error("Không được gọi tới đây."); }
  });
  assert(retry.error && /Không tạo lại/.test(retry.error.message), "Lần chạy lại phải bị chặn.");
  assert(!retry.box.events.includes("request:createAndPayFreshInvoiceViaApi"), "Lần chạy lại không được gửi API.");

  // 4. Dấu chỉ có trong storage (tab khác ghi) vẫn phải chặn -----------------
  const fromStorage = await runApply({
    storedTx: { ...baseTransaction, newInvoiceCreateStartedAt: "2026-09-28T01:00:00.000Z" },
    createResult: () => { throw new Error("Không được gọi tới đây."); }
  });
  assert(fromStorage.error && /Không tạo lại/.test(fromStorage.error.message),
    "Dấu do tab khác ghi vào storage cũng phải chặn.");
  assert(!fromStorage.box.events.includes("request:createAndPayFreshInvoiceViaApi"));

  // 5. Tab gốc dừng ngay khi worker báo lỗi --------------------------------
  const workerBox = {
    Date,
    Promise,
    structuredClone,
    setTimeout: callback => { callback(); return 0; },
    formatMoney: value => String(value),
    openCalls: 0,
    storedStatement: null,
    batchPlans: [{ transactionId: "t1", status: "batch_ready", plan: { requiresNewInvoice: true } }],
    InvoiceMappingStore: {
      loadStatement: async () => structuredClone(workerBox.storedStatement)
    }
  };
  vm.createContext(workerBox);
  vm.runInContext(
    "var statementDataset = { transactions: [] };\n" +
    `${extractFunction(contentSource, "newInvoiceAttemptBlockReason")}\n` +
    `${extractFunction(contentSource, "saveNewBatchEntryViaWorker")}\n` +
    "function findStatementTransaction(id) { return statementDataset.transactions.find(item => String(item.id) === String(id)); }\n" +
    "async function openPosForNewInvoice() { this.openCalls += 1; return { opened: true, tabId: 7 }; }\n" +
    "this.run = saveNewBatchEntryViaWorker;\n" +
    "this.setStatement = value => { statementDataset = value; };",
    workerBox
  );
  workerBox.setStatement({ transactions: [{ ...baseTransaction }] });
  workerBox.storedStatement = {
    transactions: [{
      ...baseTransaction,
      newInvoiceWorkerError: { message: "Không tìm thấy phòng rảnh", at: "2999-01-01T00:00:00.000Z" }
    }]
  };
  const startedAt = Date.now();
  await assert.rejects(workerBox.run(0), /Không tìm thấy phòng rảnh/,
    "Tab gốc phải dừng với đúng lỗi worker đã báo.");
  assert(Date.now() - startedAt < 5000, "Không được chờ hết 90 giây khi worker đã báo lỗi.");

  // Lỗi cũ (ghi trước lần chạy này) bị bỏ qua; dấu chặn thì dừng trước khi mở tab.
  workerBox.openCalls = 0;
  workerBox.setStatement({ transactions: [{ ...baseTransaction, newInvoiceCreateStartedAt: "2026-09-28T01:00:00.000Z" }] });
  await assert.rejects(workerBox.run(0), /Không tạo lại/);
  assert.strictEqual(workerBox.openCalls, 0, "Giao dịch bị chặn không được mở tab worker.");

  console.log("Chống tạo trùng phiếu mới và báo lỗi worker: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
