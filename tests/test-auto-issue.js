"use strict";

// Tự động phát hành theo khoảng ngày (yêu cầu 05/10/2026): bấm một lần, extension
// tự đi từng ngày, luân phiên Linh Đàm → Kim Giang theo thứ tự phát hành, tự chuyển
// cơ sở và phát hành; DỪNG HẲN ngay khi có gì cần người đọc. Phát hành tay giữ nguyên.

const assert = require("assert");
const { makeBox, fn, Coordination, KG_URL, LD_URL, NHON_URL, ORIGIN } = require("./issue-sandbox.js");

const ROWS = {
  parislinhdam: {
    "2026-08-01": [{ id: "L1", invoiceNo: "HD-L1", dateKey: "2026-08-01", grandTotal: 100000 }],
    "2026-08-02": [{ id: "L2", invoiceNo: "HD-L2", dateKey: "2026-08-02", grandTotal: 200000 }]
  },
  pariskimgiang: {
    "2026-08-01": [{ id: "K1", invoiceNo: "HD-K1", dateKey: "2026-08-01", grandTotal: 300000 }]
  }
};
const TX = {
  parislinhdam: [
    { transactionDate: "2026-08-01", credit: 100000, status: "done" },
    { transactionDate: "2026-08-02", credit: 200000, status: "done" }
  ],
  pariskimgiang: [{ transactionDate: "2026-08-01", credit: 300000, status: "done" }]
};

function sharedStore() {
  let coordination = Coordination.recordStatement(Coordination.empty(), "parislinhdam", TX.parislinhdam);
  coordination = Coordination.recordStatement(coordination, "pariskimgiang", TX.pariskimgiang);
  return { handoff: null, autoJob: null, coordination };
}

function page(store, tenant, extra = {}) {
  const rows = extra.rows || ROWS[tenant] || {};
  return makeBox({
    tenant,
    href: extra.href || `${ORIGIN}/${tenant}/Form?Modal=0&ID=9bc781f5-d316-4eba-94d8-26c4c2321faf&MenuID=2af9b881-2fff-41cb-b014-fe662ee351c2`,
    storage: store,
    cookie: `shop=${tenant}`,
    fastTimers: extra.fastTimers !== false,
    listRows: day => rows[day] || [],
    linkedNos: Object.values(rows).flat().map(row => row.invoiceNo),
    transactions: extra.transactions || TX[tenant] || [],
    inputs: { "it-auto-issue-from": extra.from || "2026-08-01", "it-auto-issue-to": extra.to || "2026-08-02" },
    confirmAnswer: extra.confirmAnswer !== false,
    issue: extra.issue
  });
}

const issuedTotal = job => job.steps.reduce((sum, step) => sum + step.issued, 0);

(async () => {
  // --- 1. Chạy trọn khoảng 01/08–02/08 qua hai cơ sở -------------------------
  {
    const store = sharedStore();
    // Bấm ở Kim Giang; theo thứ tự, bước đầu là Linh Đàm 01/08.
    const kg = page(store, "pariskimgiang");
    await kg.startAuto();
    await kg.settle();
    assert.strictEqual(kg.confirms.length, 1, "Một lần xác nhận cho cả khoảng ngày");
    assert.match(kg.confirms[0], /Tự động phát hành từ 01\/08\/2026 đến 02\/08\/2026\?/);
    assert.match(kg.confirms[0], /Paris Linh Đàm → Paris Kim Giang\. Bắt đầu: Paris Linh Đàm ngày 01\/08\/2026/);
    assert.match(kg.confirms[0], /không thể tự hủy/);
    assert.strictEqual(store.autoJob.status, "running");
    assert.strictEqual(store.autoJob.scope, "shared");
    assert.deepStrictEqual({ ...store.handoff, createdAt: "" },
      { fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-01", targetUrl: LD_URL, createdAt: "", auto: true });
    assert(kg.history.some(text => /Tự chuyển sang Paris Linh Đàm để phát hành ngày 01\/08\/2026 sau 5 giây/.test(text)),
      "Đếm ngược trước khi chuyển cơ sở");
    assert.deepStrictEqual(kg.assigned, [LD_URL]);
    assert.strictEqual(kg.issueCalls.length, 0, "Kim Giang chưa tới lượt");

    // Linh Đàm 01/08: tự phát hành rồi chuyển sang Kim Giang cùng ngày.
    const ld = page(store, "parislinhdam");
    assert.strictEqual(await ld.resume(), true);
    await ld.settle();
    assert.strictEqual(ld.issueCalls.length, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(ld.issueCalls[0])),
      { options: { auto: true }, selected: ["L1"], day: "2026-08-01" });
    assert(ld.history.some(text => /Tự phát hành 1 hóa đơn · 100\.000 đ — Paris Linh Đàm ngày 01\/08\/2026 sau 5 giây/.test(text)),
      "Đếm ngược trước khi phát hành, nêu số hóa đơn và tổng tiền");
    assert.deepStrictEqual(ld.assigned, [KG_URL]);
    assert.strictEqual(store.handoff.targetTenant, "pariskimgiang");
    assert.strictEqual(store.handoff.dateKey, "2026-08-01");

    // Kim Giang 01/08 → ngày kế từ đầu dãy: Linh Đàm 02/08.
    const kg2 = page(store, "pariskimgiang");
    await kg2.resume();
    await kg2.settle();
    assert.deepStrictEqual(kg2.issueCalls.map(call => [...call.selected]), [["K1"]]);
    assert.deepStrictEqual(kg2.assigned, [LD_URL]);
    assert.strictEqual(store.handoff.dateKey, "2026-08-02");

    // Linh Đàm 02/08 → hết khoảng: xong, mời xuất file hạch toán.
    const ld2 = page(store, "parislinhdam");
    await ld2.resume();
    await ld2.settle();
    assert.deepStrictEqual(ld2.issueCalls.map(call => [...call.selected]), [["L2"]]);
    assert.deepStrictEqual(ld2.assigned, [], "Hết việc thì không chuyển đi đâu nữa");
    assert.strictEqual(store.autoJob.status, "done");
    assert.strictEqual(issuedTotal(store.autoJob), 3);
    assert.strictEqual(store.handoff, null);
    assert.match(ld2.text(), /Tự động phát hành xong 01\/08\/2026 – 02\/08\/2026: đã phát hành 3 hóa đơn/);
    assert.deepStrictEqual(ld2.actions(), ["issued-export"]);
  }

  // --- 2. Các điều kiện DỪNG: không phát hành, không chuyển đi -----------------
  async function stopsAt(extra, reason, { issued = 0 } = {}) {
    const store = sharedStore();
    store.autoJob = {
      status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: []
    };
    store.handoff = { fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-01",
      targetUrl: LD_URL, createdAt: new Date().toISOString(), auto: true };
    const ld = page(store, "parislinhdam", extra);
    await ld.resume();
    await ld.settle();
    assert.strictEqual(store.autoJob.status, "stopped", `Phải dừng: ${reason}`);
    assert.match(store.autoJob.stopReason, reason);
    assert.match(ld.text(), new RegExp(`Đã dừng tự động phát hành — Paris Linh Đàm ngày 01/08/2026: [\\s\\S]*${reason.source}`));
    assert.deepStrictEqual(ld.actions(), ["auto-issue-resume"]);
    assert.deepStrictEqual(ld.assigned, [], "Dừng thì không chuyển cơ sở");
    assert.strictEqual(ld.issueCalls.length, issued);
    return { store, ld };
  }
  // Giao dịch sao kê ngày đó chưa lập phiếu xong: phát hành bây giờ sẽ làm đứt dải số.
  const unfinished = await stopsAt({ transactions: [...TX.parislinhdam,
    { transactionDate: "2026-08-01", credit: 450000, status: "pending" }] }, /còn 1 giao dịch sao kê chưa xử lý xong \(450\.000đ\)/);
  // Phiếu lệch giao dịch sao kê.
  await stopsAt({ rows: { "2026-08-01": [...ROWS.parislinhdam["2026-08-01"],
    { id: "X", invoiceNo: "HD-X", dateKey: "2026-08-01", mismatch: true }] } }, /1 phiếu lệch giao dịch sao kê \(HD-X\)/);
  // Lô cần người đọc (cảnh báo chéo cơ sở / phiếu ngoài giao dịch): không mở hộp thoại, dừng.
  await stopsAt({ issue: () => ({ blocked: "cần người kiểm tra trước khi phát hành: Chưa import sao kê Kim Giang" }) },
    /cần người kiểm tra trước khi phát hành: Chưa import sao kê Kim Giang/, { issued: 1 });
  // Lô có lỗi/cảnh báo: đã phát hành phần được, ghi lại, rồi dừng.
  const failed = await stopsAt({ issue: () => ({ clean: false, kind: "error", summary: "Đã phát hành 0/1 hóa đơn. 1 hóa đơn lỗi, xem chi tiết bên dưới." }) },
    /1 hóa đơn lỗi/, { issued: 1 });
  assert.strictEqual(failed.store.autoJob.steps.length, 1, "Ghi lại bước đã chạy kể cả khi dừng");
  // Trình duyệt đang đăng nhập cơ sở khác (cookie bị tab khác ghi đè).
  {
    const store = sharedStore();
    store.autoJob = { status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] };
    const ld = page(store, "parislinhdam");
    ld.document.cookie = "shop=pariskimgiang";
    await ld.runStep("2026-08-01");
    await ld.settle();
    assert.strictEqual(store.autoJob.status, "stopped");
    assert.match(store.autoJob.stopReason, /trình duyệt đang đăng nhập cơ sở "pariskimgiang"/);
    assert.strictEqual(ld.issueCalls.length, 0);
  }

  // --- 3. Chạy tiếp sau khi đã sửa: bắt đầu lại từ bước còn việc sớm nhất -------
  {
    const { store } = unfinished;
    const ld = page(store, "parislinhdam");
    await ld.resumeAuto();
    await ld.settle();
    assert.strictEqual(store.autoJob.status, "running");
    assert.deepStrictEqual(ld.issueCalls.map(call => call.day), ["2026-08-01"]);
    assert.deepStrictEqual(ld.assigned, [KG_URL], "Xong Linh Đàm 01/08 thì sang Kim Giang như bình thường");
  }

  // --- 4. Bấm Dừng trong lúc đếm ngược: không phát hành ------------------------
  {
    const store = sharedStore();
    store.autoJob = { status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] };
    const ld = page(store, "parislinhdam", { fastTimers: false });
    const running = ld.runStep("2026-08-01");
    await ld.settle();
    assert.match(ld.text(), /Tự phát hành 1 hóa đơn · 100\.000 đ — Paris Linh Đàm ngày 01\/08\/2026 sau 5 giây/);
    assert.deepStrictEqual(ld.actions(), ["auto-issue-stop"]);
    await ld.stopAuto();
    while (ld.runTimer()) await ld.settle();
    await running;
    assert.strictEqual(ld.issueCalls.length, 0, "Dừng lúc đếm ngược thì không phát hành");
    assert.strictEqual(store.autoJob.status, "stopped");
    assert.match(ld.text(), /Đã dừng tự động phát hành — theo yêu cầu\./);
  }

  // --- 5. Ngày không còn gì để phát hành: chốt xong rồi đi tiếp -----------------
  {
    const store = sharedStore();
    store.coordination = Coordination.markCursor(store.coordination, "parislinhdam", "2026-08-01", { status: "done", count: 1 });
    store.autoJob = { status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [] };
    const kg = page(store, "pariskimgiang", { rows: { "2026-08-01": [{ ...ROWS.pariskimgiang["2026-08-01"][0], issued: true, soHoaDon: "125" }] } });
    await kg.runStep("2026-08-01");
    await kg.settle();
    assert.strictEqual(kg.issueCalls.length, 0);
    assert.strictEqual(kg.cursor("pariskimgiang", "2026-08-01").status, "done", "Chốt xong để lần chạy lại không quay lại đây");
    assert.strictEqual(kg.cursor("pariskimgiang", "2026-08-01").lastSoHoaDon, "125");
    assert.deepStrictEqual(kg.assigned, [LD_URL]);
    assert.strictEqual(store.handoff.dateKey, "2026-08-02");
  }

  // --- 6. Paris Nhơn (dải số riêng): đi theo ngày sao kê của chính Nhơn ---------
  {
    const store = sharedStore();
    const before = JSON.stringify(store.coordination);
    const nhonRows = {
      "2026-08-01": [{ id: "N1", invoiceNo: "N-1", dateKey: "2026-08-01", grandTotal: 401500 }],
      "2026-08-03": [{ id: "N3", invoiceNo: "N-3", dateKey: "2026-08-03", grandTotal: 600000 }]
    };
    const nhon = page(store, "parisnhon", {
      rows: nhonRows, from: "2026-08-01", to: "2026-08-04",
      transactions: [
        { transactionDate: "2026-08-01", credit: 401500, status: "done" },
        { transactionDate: "2026-08-03", credit: 600000, status: "done" },
        { transactionDate: "2026-08-05", credit: 999000, status: "pending" }
      ]
    });
    await nhon.startAuto();
    await nhon.settle();
    assert.match(nhon.confirms[0], /Mỗi ngày theo thứ tự: Paris Nhơn\. Bắt đầu: Paris Nhơn ngày 01\/08\/2026/);
    assert.deepStrictEqual(nhon.issueCalls.map(call => call.day), ["2026-08-01", "2026-08-03"],
      "Chỉ các ngày có sao kê trong khoảng; 05/08 ngoài khoảng không đụng tới");
    assert.deepStrictEqual(nhon.assigned, [], "Nhơn không chuyển cơ sở");
    assert.strictEqual(store.autoJob.status, "done");
    assert.strictEqual(store.autoJob.scope, "parisnhon");
    assert.strictEqual(JSON.stringify(store.coordination), before, "Nhơn không ghi chốt dải số dùng chung");
    // Lượt của Nhơn không áp dụng ở Linh Đàm và ngược lại.
    store.autoJob = { ...store.autoJob, status: "running", current: { tenant: "parisnhon", dateKey: "2026-08-03" } };
    const ld = page(store, "parislinhdam");
    await ld.announce();
    assert.strictEqual(ld.text(), "");
  }

  // --- 7. Bắt đầu khi không ở màn Hóa đơn điện tử: mở đúng màn trước ------------
  {
    const store = sharedStore();
    const ld = page(store, "parislinhdam", { href: `${ORIGIN}/parislinhdam/Home` });
    await ld.startAuto();
    await ld.settle();
    assert.deepStrictEqual(ld.assigned, [LD_URL], "Phát hành phải chạy ở màn Hóa đơn điện tử");
    assert(!ld.history.some(text => /Tự chuyển sang/.test(text)), "Cùng cơ sở thì mở ngay, không đếm ngược chuyển cơ sở");
    assert.strictEqual(ld.issueCalls.length, 0);
    assert.strictEqual(store.handoff.auto, true);
  }

  // --- 8. Không còn gì trong khoảng / người dùng không xác nhận ---------------
  {
    const store = sharedStore();
    const nothing = page(store, "parislinhdam", { from: "2026-09-01", to: "2026-09-30" });
    await nothing.startAuto();
    assert.strictEqual(nothing.confirms.length, 0);
    assert.strictEqual(store.autoJob, null);
    assert.match(nothing.text(), /Từ 01\/09\/2026 đến 30\/09\/2026 không còn ngày nào cần phát hành/);
    const declined = page(store, "parislinhdam", { confirmAnswer: false });
    await declined.startAuto();
    assert.strictEqual(store.autoJob, null, "Không xác nhận thì không tạo lượt chạy");
    assert.deepStrictEqual(declined.assigned, []);
    assert.strictEqual(declined.issueCalls.length, 0);
    const reversed = page(store, "parislinhdam", { from: "2026-08-02", to: "2026-08-01" });
    await assert.rejects(reversed.startAuto(), /Từ ngày phải trước hoặc bằng Đến ngày/);
  }

  // --- 9. Lượt quá hạn / đã dừng: lệnh chuyển chỉ còn là mở đúng ngày ----------
  {
    const store = sharedStore();
    const old = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
    store.autoJob = { status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: old, updatedAt: old, steps: [] };
    store.handoff = { fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-01",
      targetUrl: LD_URL, createdAt: new Date().toISOString(), auto: true };
    const ld = page(store, "parislinhdam");
    await ld.resume();
    await ld.settle();
    assert.strictEqual(ld.issueCalls.length, 0, "Lượt quá 12 giờ không tự phát hành");
    assert.strictEqual(store.autoJob.status, "stopped");
    assert.deepStrictEqual(ld.opened, ["2026-08-01"], "Vẫn mở đúng ngày như luồng tay");
    assert.deepStrictEqual(ld.selection(), ["L1"]);
  }

  // --- 10. Trang tải lại giữa chừng (không có lệnh chuyển): chỉ mời chạy tiếp ---
  {
    const store = sharedStore();
    store.autoJob = { status: "running", scope: "shared", fromDate: "2026-08-01", toDate: "2026-08-02",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), steps: [],
      current: { tenant: "parislinhdam", dateKey: "2026-08-01" } };
    const ld = page(store, "parislinhdam");
    assert.strictEqual(await ld.resume(), false);
    await ld.announce();
    assert.match(ld.text(), /Tự động phát hành đang dở: Đang chạy 01\/08\/2026 – 02\/08\/2026 · đã phát hành 0 hóa đơn · đang ở Paris Linh Đàm ngày 01\/08\/2026/);
    assert.deepStrictEqual(ld.actions(), ["auto-issue-resume", "auto-issue-stop"]);
    assert.strictEqual(ld.issueCalls.length, 0, "Không tự chạy tiếp sau khi trang tải lại bất ngờ");
  }

  // --- Đấu nối ---------------------------------------------------------------
  const issue = fn("issueSelectedEInvoices");
  assert(issue.indexOf("if (auto && needsConfirm)") > 0 &&
    issue.indexOf("if (auto && needsConfirm)") < issue.indexOf("window.confirm("),
    "Tự động: lô cần người đọc thì dừng TRƯỚC hộp xác nhận, không bao giờ tự bấm qua");
  assert(issue.indexOf("if (auto) {") < issue.indexOf("await promptIssueHandoff("),
    "Tự động tự quyết bước kế, không dùng nhắc chuyển của luồng tay");
  assert.match(issue, /const clean = !failures\.length && !warnings\.length && !missingItems && !leftHere &&/);
  const run = fn("runAutoIssueStep");
  assert(run.indexOf("autoIssueBlockers(day)") < run.indexOf("issueSelectedEInvoices({ auto: true })"));
  assert(run.indexOf("autoIssueCountdown(") < run.indexOf("issueSelectedEInvoices({ auto: true })"),
    "Luôn đếm ngược (có nút Dừng) trước khi phát hành");
  // Phát hành tay giữ nguyên: nút cũ vẫn gọi issueSelectedEInvoices() không cờ auto.
  const { source } = require("./issue-sandbox.js");
  assert(source.includes('table.querySelector("#it-issue-einvoices")?.addEventListener("click", () => {\n      issueSelectedEInvoices().catch('));
  for (const id of ["it-auto-issue-from", "it-auto-issue-to", "it-auto-issue-start", "it-auto-issue-resume", "it-auto-issue-stop"]) {
    assert(source.includes(`id="${id}"`), `Thiếu ${id}`);
  }
  assert(NHON_URL.includes("/parisnhon/Form?"));

  console.log("Tự động phát hành theo khoảng ngày: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
