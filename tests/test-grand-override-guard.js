"use strict";

// Mức "Lập ở …" (acceptedGrandOverride) chỉ để bù phần website làm tròn VAT — mọi
// ca thật đều lệch đúng -1đ (42/46 giao dịch Linh Đàm T7). Ca lỗi thật Linh Đàm
// (phát hiện 05/10/2026): mức của dòng trên bị gán sang dòng dưới khi bấm lại nút
// "Lập ở" trong lúc bảng đang tính lại (dòng đó tạm rút khỏi batchPlans, các dòng
// sau dồn lên một chỗ, nút cũ vẫn mang chỉ số cũ):
//   01/07 dòng 5 (1.700.000 → 1.699.999) → dòng 6 (4.155.000) → dòng 7 (2.233.000)
//   04/07 dòng 32 (3.735.000 → 3.734.999) → dòng 33 (2.883.000)
//   16/07 dòng 124 (3.163.000 → 3.162.999) → dòng 125 (2.152.000)
// Bốn phiếu bị lưu và đối soát ở tổng sai, trừ kho theo phương án sai.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");
function fn(name) {
  let start = source.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = source.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  return source.slice(start + 1, source.indexOf("\n  }\n", start) + 4);
}
const constant = name => {
  const start = source.indexOf(`  const ${name} =`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
};

(async () => {
  // --- Mức "Lập ở" hợp lệ chỉ khi sát sao kê ------------------------------------
  const box = { formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)) };
  vm.createContext(box);
  vm.runInContext([constant("GRAND_OVERRIDE_MAX_DIFF"), fn("grandOverrideFor"), fn("hasInvalidGrandOverride"), fn("planGrandMismatchError"),
    "this.overrideFor = grandOverrideFor; this.invalid = hasInvalidGrandOverride; this.mismatch = planGrandMismatchError;"].join("\n"), box);

  const legit = { credit: 1700000, acceptedGrandOverride: 1699999 };
  const shifted = { credit: 4155000, acceptedGrandOverride: 1699999 };
  const shiftedUp = { credit: 2152000, acceptedGrandOverride: 3162999 };
  assert.strictEqual(box.overrideFor(legit), 1699999, "Lệch -1đ do làm tròn VAT: dùng");
  assert.strictEqual(box.invalid(legit), false);
  assert.strictEqual(box.overrideFor(shifted), 0, "Mức bị gán nhầm: không bao giờ dùng để lập phương án");
  assert.strictEqual(box.invalid(shifted), true);
  assert.strictEqual(box.invalid(shiftedUp), true);
  assert.strictEqual(box.overrideFor({ credit: 1700000 }), 0);
  assert.strictEqual(box.invalid({ credit: 1700000 }), false);

  // Lưu API chặn phương án có tổng lệch sao kê quá mức làm tròn VAT.
  assert.match(box.mismatch({ invoiceNo: "HD0126070016", grand: 1699999 }, shifted),
    /HD0126070016 lập ở 1\.699\.999đ nhưng sao kê là 4\.155\.000đ \(lệch -2\.455\.001đ[\s\S]*không lưu/);
  assert.match(box.mismatch({ targetGrand: 3162999 }, shiftedUp), /lệch \+1\.010\.999đ/);
  assert.strictEqual(box.mismatch({ grand: 1699999 }, legit), "", "Lệch -1đ hợp lệ thì lưu bình thường");
  assert.strictEqual(box.mismatch({ grand: 4155000 }, { credit: 4155000 }), "");

  // --- Nút trên dòng Batch Review tìm giao dịch theo mã, không theo vị trí -------
  const indexBox = { batchPlans: [] };
  vm.createContext(indexBox);
  vm.runInContext(`${fn("batchIndexFromButton")}\nthis.indexOf = batchIndexFromButton;\nthis.set = value => { batchPlans = value; };\nvar batchPlans = [];`, indexBox);
  const rows = ["t5", "t6", "t7", "t8"].map(id => ({ transactionId: id }));
  indexBox.set(rows);
  const staleButtonOfRow5 = { dataset: { index: "0", transactionId: "t5" } };
  assert.strictEqual(indexBox.indexOf(staleButtonOfRow5), 0);
  // Đang tính lại riêng t5: t5 tạm bị rút, t6 dồn lên vị trí 0.
  indexBox.set(rows.filter(entry => entry.transactionId !== "t5"));
  assert.strictEqual(indexBox.indexOf(staleButtonOfRow5), -1, "Bấm lại nút cũ lúc này không được rơi sang t6");
  // Tính xong, t5 về chỗ cũ.
  indexBox.set(rows);
  assert.strictEqual(indexBox.indexOf(staleButtonOfRow5), 0);
  // Nút không mang mã (proxy nội bộ) vẫn dùng chỉ số như cũ.
  assert.strictEqual(indexBox.indexOf({ dataset: { index: "2" } }), 2);

  // Mọi nút/ô chọn của dòng Batch Review đều mang mã giao dịch.
  const render = fn("renderBatchPlans");
  const indexAttrs = (render.match(/data-index="\$\{index\}"/g) || []).length;
  const idAttrs = (render.match(/data-index="\$\{index\}" data-transaction-id=/g) || []).length;
  assert(indexAttrs >= 12 && indexAttrs === idAttrs, `Nút nào có data-index cũng phải có data-transaction-id (${idAttrs}/${indexAttrs})`);
  assert(!/Number\((button\?|event\.target|input)\.dataset\.index\)/.test(source), "Không còn chỗ nào đọc thẳng data-index");

  // --- acceptRoundedGrand: chỉ nhận mức của chính giao dịch, khóa nút khi đang tính ---
  const statuses = [];
  const saved = [];
  const builds = [];
  const roundBox = {
    statuses, saved, builds,
    formatMoney: box.formatMoney,
    setStatus: (message, kind) => statuses.push({ message, kind }),
    InvoiceMappingStore: { saveStatement: async () => saved.push(true) },
    buildBatchReview: async options => builds.push(options),
    document: { querySelectorAll: () => [] }
  };
  vm.createContext(roundBox);
  vm.runInContext([
    "var statementDataset = { transactions: [] }; var batchPlans = [];",
    constant("GRAND_OVERRIDE_MAX_DIFF"),
    "function findStatementTransaction(id) { return statementDataset.transactions.find(item => String(item.id) === String(id)); }",
    fn("batchIndexFromButton"), fn("acceptRoundedGrand"),
    "this.accept = acceptRoundedGrand;",
    "this.setState = (transactions, plans) => { statementDataset = { transactions }; batchPlans = plans; };",
    "this.tx = id => findStatementTransaction(id);"
  ].join("\n"), roundBox);
  const txs = [
    { id: "t5", transactionDate: "2026-07-01", credit: 1700000 },
    { id: "t6", transactionDate: "2026-07-01", credit: 4155000 }
  ];
  const plans = [
    { transactionId: "t5", plan: { reachableAlternatives: [1699999, 1700001] } },
    { transactionId: "t6", plan: { reachableAlternatives: [] } }
  ];
  roundBox.setState(txs, plans);
  const click = (grand, transactionId, index) => roundBox.accept({ target: { closest: () => ({ dataset: { grand: String(grand), transactionId, index: String(index) } }) } });
  await click(1699999, "t5", 0);
  assert.strictEqual(roundBox.tx("t5").acceptedGrandOverride, 1699999, "Mức hợp lệ của chính giao dịch được nhận");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(builds)), [{ onlyTransactionId: "t5" }]);
  // Nút cũ của t5 nhưng t5 đang tạm vắng (đang tính lại): không đổi gì, không rơi sang t6.
  roundBox.setState(txs, [plans[1]]);
  await click(1699999, "t5", 0);
  assert.strictEqual(roundBox.tx("t6").acceptedGrandOverride, undefined, "Không được gán mức của t5 sang t6");
  assert.match(statuses[statuses.length - 1].message, /Không xác định được giao dịch/);
  // Mức không thuộc danh sách của giao dịch: từ chối.
  roundBox.setState(txs, plans);
  await click(1699999, "t6", 1);
  assert.strictEqual(roundBox.tx("t6").acceptedGrandOverride, undefined);
  assert.match(statuses[statuses.length - 1].message, /không thuộc các mức lập được của giao dịch 2026-07-01 · 4\.155\.000đ/);

  // --- Lập phương án và Lưu API dùng mức đã kiểm tra ------------------------------
  assert(!/transaction\.acceptedGrandOverride\)/.test(fn("buildBatchReview")), "Batch Review không đọc thẳng mức Lập ở");
  assert.match(fn("buildBatchReview"), /grandOverrideFor\(transaction\)/);
  assert.match(fn("newInvoicePlanValidationError"), /grandOverrideFor\(transaction\)/);
  const saveExisting = fn("saveBatchEntryViaApi");
  assert(saveExisting.indexOf("planGrandMismatchError(") < saveExisting.indexOf("openAcceptedInvoiceForApi("),
    "Chặn tổng lệch trước khi mở phiếu để lưu");
  assert.match(fn("saveNewBatchEntryDirect"), /planGrandMismatchError\(plan, transaction\)/);
  assert.match(fn("saveNewBatchEntryViaWorker"), /planGrandMismatchError\(/);

  // --- Sửa dữ liệu đã hỏng: hoàn kho riêng giao dịch, giữ liên kết phiếu -----------
  const restock = fn("restockLedgerEntries");
  assert.match(restock, /if \(!options\.keepInvoiceLink\) transaction\.invoiceNo = "";/);
  assert.match(restock, /if \(hasInvalidGrandOverride\(transaction\)\) \{\s*delete transaction\.acceptedGrandOverride;/);
  const restockOne = fn("restockOneTransaction");
  assert.match(restockOne, /hasInvalidGrandOverride\(transaction\)/);
  assert.match(restockOne, /restockLedgerEntries\(matches, \{ keepInvoiceLink: true \}\)/);
  assert.match(restockOne, /window\.confirm\(/, "Hoàn kho phải hỏi xác nhận");
  const statementRows = fn("renderStatementRows");
  assert.match(statementRows, /item\.status === "done" && invalidOverride \? '<button class="it-restock-transaction"/);
  assert.match(statementRows, /bị gán nhầm từ giao dịch khác/);

  console.log("Chặn mức Lập ở bị gán nhầm và sửa giao dịch đã lưu sai tổng: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
