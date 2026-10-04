"use strict";

// Bước thanh toán (DoSave mode=2) của phiếu mới có thể đã được server ghi mà
// phản hồi rớt trên đường về ("Failed to fetch"). Ca thật Paris Nhơn 04/10/2026:
// phiếu 01000000781 đã đóng bill đủ 491.700 nhưng extension nhận lỗi, chặn giao
// dịch và dừng cả lô Batch API. Nay đọc lại phiếu: đã thanh toán đúng phương án
// thì ghi nhận như lưu thành công; không thì vẫn chặn, không bao giờ tạo phiếu thứ hai.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8").replace(/\r\n/g, "\n");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8").replace(/\r\n/g, "\n");

function extract(source, name) {
  const match = new RegExp(`\\n  (async )?function ${name}\\(`).exec(source);
  assert(match, `Không tìm thấy ${name}`);
  const start = match.index + 1;
  let depth = 0;
  for (let index = source.indexOf(") {", start) + 2; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không cắt được ${name}`);
}

function extractConst(source, name) {
  const start = source.indexOf(`  const ${name} =`);
  assert(start >= 0, `Không tìm thấy hằng ${name}`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
}

(async () => {
  // --- Bridge: tiêu chí "đã thanh toán đúng phương án" ---------------------------
  const bridge = {};
  vm.createContext(bridge);
  vm.runInContext(
    ["formAmount", "normalizedVietnameseText", "freshPaymentProblems"].map(name => extract(bridgeSource, name)).join("\n") +
    "\nthis.problems = freshPaymentProblems;",
    bridge
  );
  // Maps thật của 01000000781 đọc từ website (giá trị chuỗi như server trả).
  const paid781 = {
    NAME: "01000000781", DIENGIAI: "Xuat ban hang", DATHANHTOAN: "30", TONGCONG: 491700.00,
    TIENTHANHTOAN: "491700.00", TIENMAT: "491700.00", KHACHDUA: "491700.00",
    TIENHANG: 235000.00, TIENGIO: 212000.00, TIENTHUE: 44700.00, SOHD: ""
  };
  const plan781 = { targetGrand: 491700, targetGoods: 235000, targetHour: 212000, targetTax: 44700 };
  assert.deepStrictEqual(Array.from(bridge.problems(paid781, plan781, "01000000781")), [],
    "Phiếu đã đóng bill đúng phương án phải được nhận là đã thanh toán");
  // Phiếu website tự lập ghi diễn giải có dấu.
  assert.strictEqual(bridge.problems({ ...paid781, DIENGIAI: "Xuất bán hàng" }, plan781, "01000000781").length, 0);
  // Phiên mới lưu (mode=0) chưa thanh toán: diễn giải rỗng, chưa có cờ, chưa có tiền thanh toán.
  const session = { ...paid781, DIENGIAI: "", DATHANHTOAN: "0", TIENTHANHTOAN: "0", TIENMAT: "0", KHACHDUA: "0" };
  const sessionProblems = bridge.problems(session, plan781, "01000000781").join("; ");
  assert.match(sessionProblems, /cờ đã thanh toán/);
  assert.match(sessionProblems, /diễn giải/);
  assert.match(sessionProblems, /tiền thanh toán 0/);
  // Một dấu hiệu lệch là đủ để không kết luận.
  assert.match(bridge.problems({ ...paid781, TIENGIO: 200000 }, plan781, "01000000781").join(), /tiền giờ 200000 khác 212000/);
  assert.match(bridge.problems(paid781, plan781, "01000000782").join(), /số phiếu 01000000781/);
  assert.match(bridge.problems({ ...paid781, SOHD: "125" }, plan781, "01000000781").join(), /đã có số hóa đơn/);
  assert(bridge.problems(paid781, {}, "01000000781").length > 0, "Thiếu phương án thì không kết luận");

  // Mất phản hồi ở bước thanh toán: đọc lại, KHÔNG gửi lại payload thanh toán.
  const twoStep = extract(bridgeSource, "postFreshInvoiceTwoStep");
  const catchBlock = twoStep.slice(twoStep.indexOf("payment = await postDoSavePayload(paymentPayload);"));
  assert.match(catchBlock, /if \(!isNetworkFetchError\(error\)\) throw error;/);
  assert.match(catchBlock, /await confirmFreshInvoicePayment\(\{/);
  assert.strictEqual((twoStep.match(/postDoSavePayload\(paymentPayload\)/g) || []).length, 1,
    "Payload thanh toán chỉ được gửi đúng một lần");
  assert.match(bridgeSource, /detail\.action === "confirmFreshInvoicePayment"/);

  // --- Content: gắn lại giao dịch đã bị chặn từ lần chạy trước --------------------
  const realError = "Da tao phien 01000000781 (ID 6e517bb5-58ae-48dd-bcd4-eea97d6a445e) nhung buoc thanh toan loi: Failed to fetch";
  function makeContent(check) {
    const calls = { request: [], recorded: [] };
    const box = {
      calls,
      formatMoney: value => String(value),
      setStatus: () => {},
      request: async (action, payload) => {
        calls.request.push({ action, payload });
        if (check instanceof Error) throw check;
        return check;
      },
      recordFreshInvoiceSaved: async args => { calls.recorded.push(args); return { transaction: args.transaction, apiSaved: args.apiSaved }; }
    };
    vm.createContext(box);
    vm.runInContext(
      extractConst(contentSource, "LOST_FRESH_PAYMENT_PATTERN") + "\n" +
      ["newInvoiceAttemptBlockReason", "lostFreshPaymentSession", "recoverLostFreshPayment"].map(name => extract(contentSource, name)).join("\n") +
      "\nthis.lost = lostFreshPaymentSession; this.recover = recoverLostFreshPayment;",
      box
    );
    return box;
  }
  const blocked = {
    id: "t-0806", transactionDate: "2026-08-06", credit: 491700,
    newInvoiceCreateStartedAt: "2026-10-04T11:14:55.529Z", newInvoiceCreateError: realError
  };
  const plan = { targetGrand: 491700, goods: 235000, hour: 212000, tax: 44700, items: [] };

  const parse = makeContent(null);
  assert.deepStrictEqual({ ...parse.lost(blocked) },
    { invoiceNo: "01000000781", recordId: "6e517bb5-58ae-48dd-bcd4-eea97d6a445e" });
  assert.strictEqual(parse.lost({ ...blocked, newInvoiceCreateStartedAt: "" }), null);
  assert.strictEqual(parse.lost({ ...blocked, newInvoiceCreateError: "Website tu choi DoSave (HTTP 500)." }), null);

  // Đọc lại thấy đã thanh toán: ghi nhận như lưu thành công, dùng phòng thật của phiếu.
  const ok = makeContent({ confirmed: true, saved: true, invoiceNo: "01000000781", savedRecordId: "6e517bb5-58ae-48dd-bcd4-eea97d6a445e", roomId: "r31", roomName: "VIP 31" });
  await ok.recover(blocked, plan);
  assert.strictEqual(ok.calls.request.length, 1);
  assert.strictEqual(ok.calls.request[0].action, "confirmFreshInvoicePayment");
  assert.deepStrictEqual({ ...ok.calls.request[0].payload.expected },
    { targetGrand: 491700, targetGoods: 235000, targetHour: 212000, targetTax: 44700, invoiceDateKey: "2026-08-06" });
  assert.strictEqual(ok.calls.recorded.length, 1);
  assert.strictEqual(ok.calls.recorded[0].recovered, true);
  assert.strictEqual(ok.calls.recorded[0].room.name, "VIP 31");
  assert(!ok.calls.request.some(call => call.action === "createAndPayFreshInvoiceViaApi"), "Không được tạo phiếu thứ hai");

  // Đọc lại chưa thấy đã thanh toán (hoặc đọc lỗi): vẫn chặn, nêu rõ lý do, không ghi gì.
  const notPaid = makeContent({ confirmed: false, reason: "chưa có cờ đã thanh toán (0)" });
  await assert.rejects(notPaid.recover(blocked, plan), /Không tạo lại để tránh trùng phiếu[\s\S]*Đã đọc lại 01000000781[\s\S]*chưa có cờ đã thanh toán/);
  assert.strictEqual(notPaid.calls.recorded.length, 0);
  const readFails = makeContent(new Error("Mất kết nối tới website"));
  await assert.rejects(readFails.recover(blocked, plan), /Mất kết nối tới website/);
  assert.strictEqual(readFails.calls.recorded.length, 0);

  // Bị chặn vì lỗi khác (không phải mất phản hồi ở bước thanh toán): giữ chặn như cũ, không gọi gì.
  const other = makeContent(null);
  await assert.rejects(other.recover({ ...blocked, newInvoiceCreateError: "Website tu choi DoSave (HTTP 500)." }, plan),
    /Không tạo lại để tránh trùng phiếu/);
  assert.strictEqual(other.calls.request.length, 0);

  // Luồng batch: bị chặn thì đi đường gắn lại, không chọn phòng/tạo phiếu.
  const direct = extract(contentSource, "saveNewBatchEntryDirect");
  assert.match(direct, /newInvoiceAttemptBlockReason\(transaction\)\s*\?\s*await recoverLostFreshPayment\(transaction, plan\)\s*:\s*await submitNewInvoiceOnIdleRoom\(transaction, plan\)/);
  assert(direct.indexOf("recoverLostFreshPayment") < direct.indexOf("verifyBatchSavedInvoice("),
    "Phiếu gắn lại vẫn phải qua đối soát sau lưu trước khi trừ kho");

  console.log("Mất phản hồi ở bước thanh toán phiếu mới: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
