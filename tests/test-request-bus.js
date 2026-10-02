// Kênh content -> bridge: mỗi lệnh phải nhận đúng câu trả lời của nó, kể cả khi
// payload có khóa `id` (ID phiếu). request() trải payload sau mã yêu cầu nên `id`
// của phiếu đè mã đó; trước 1.29.6 bridge trả lời theo `detail.id`, content không
// nhận ra và mọi lệnh issueEInvoice / readInvoiceSummary / readInvoiceItems /
// buyerFixInvoice đều chờ tới hết giờ dù bridge đã làm xong (chạy thật 02/10/2026).
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8").replace(/\r\n/g, "\n");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");

function topLevelFunction(source, name) {
  const start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}

// Bộ lắng nghe của bridge: từ window.addEventListener(REQUEST ...) tới hết khối.
const listenerStart = bridgeSource.indexOf("  window.addEventListener(REQUEST, async event => {");
const listenerSource = bridgeSource.slice(listenerStart, bridgeSource.indexOf("\n  });\n", listenerStart) + 6);
assert(listenerStart > 0 && listenerSource.includes("respond({"), "Không đọc được bộ lắng nghe của bridge");

const page = new EventTarget();
const handled = [];
const bridge = {
  window: page,
  CustomEvent,
  console: { error() {} },
  REQUEST: "invoice-target-mvp:request",
  RESPONSE: "invoice-target-mvp:response",
  // Handler giả: trả lại ID phiếu nó đọc được để kiểm tra handler vẫn nhận đúng.
  issueEInvoice: async detail => {
    handled.push(detail.id);
    await new Promise(resolve => setTimeout(resolve, detail.delay || 0));
    return { soHoaDon: `so-${detail.id}` };
  },
  readInvoiceSummary: async detail => ({ id: detail.id, invoiceNo: detail.invoiceNo }),
  buyerFixInvoice: async detail => {
    if (!detail.recordId) throw new Error("thiếu recordId");
    return { status: "fixed", recordId: detail.recordId };
  },
  scan: () => ({ rows: 3 }),
  setTimeout
};
vm.createContext(bridge);
vm.runInContext([topLevelFunction(bridgeSource, "plainClone"), topLevelFunction(bridgeSource, "respond"), listenerSource].join("\n"), bridge);

const content = {
  window: page,
  CustomEvent,
  setTimeout,
  clearTimeout,
  REQUEST: "invoice-target-mvp:request",
  RESPONSE: "invoice-target-mvp:response",
  ISSUE_TIMEOUT_FAST_MS: 300,
  ISSUE_TIMEOUT_UI_MS: 300
};
vm.createContext(content);
vm.runInContext([
  "let sequence = 0;",
  topLevelFunction(contentSource, "issueTimeoutMs"),
  topLevelFunction(contentSource, "request"),
  "this.request = request;"
].join("\n"), content);

(async () => {
  const ID_A = "aaaaaaaa-0000-0000-0000-000000000001";
  const ID_B = "bbbbbbbb-0000-0000-0000-000000000002";
  // Payload có id: trả lời phải về đúng lệnh, không hết giờ (hạn 300ms trong test).
  const issued = await content.request("issueEInvoice", { id: ID_A, invoiceNo: "HD1", knownItems: [{}] });
  assert.strictEqual(issued.soHoaDon, `so-${ID_A}`);
  assert.deepStrictEqual(handled, [ID_A], "Handler vẫn đọc ID phiếu từ detail.id như trước");

  // Hai lệnh chạy song song, lệnh đầu xong sau: mỗi lệnh nhận đúng kết quả của nó.
  const [slow, fast] = await Promise.all([
    content.request("issueEInvoice", { id: ID_A, delay: 50, knownItems: [{}] }),
    content.request("issueEInvoice", { id: ID_B, knownItems: [{}] })
  ]);
  assert.strictEqual(slow.soHoaDon, `so-${ID_A}`);
  assert.strictEqual(fast.soHoaDon, `so-${ID_B}`);

  const summary = await content.request("readInvoiceSummary", { id: ID_B, invoiceNo: "HD2" });
  assert.deepStrictEqual({ ...summary }, { id: ID_B, invoiceNo: "HD2" });
  assert.strictEqual((await content.request("buyerFixInvoice", { recordId: ID_A, invoiceNo: "HD3" })).recordId, ID_A);
  assert.deepStrictEqual({ ...await content.request("scan") }, { rows: 3 });

  // Lỗi trong bridge cũng về đúng lệnh (không thành hết giờ).
  await assert.rejects(content.request("buyerFixInvoice", { id: ID_A }), /thiếu recordId/);
  await assert.rejects(content.request("khongCo", { id: ID_A }), /không được hỗ trợ/);

  console.log("kênh content -> bridge trả lời đúng lệnh: OK");
})().catch(error => { console.error(error); process.exit(1); });
