"use strict";

// Phát hành xong một cơ sở (Kim Giang/Linh Đàm dùng chung dải số) thì tự chuyển
// sang cơ sở kế tiếp và mở sẵn màn Phát hành với ĐÚNG ngày vừa làm — trước đây
// người dùng phải tự gõ URL cơ sở kia rồi chọn lại ngày (yêu cầu 05/10/2026).
// Không bao giờ tự phát hành ở cơ sở đích.

const assert = require("assert");
const { makeBox, fn, Coordination, KG_URL, LD_URL } = require("./issue-sandbox.js");

(async () => {
  // Màn Hóa đơn điện tử của cơ sở đích: cùng Form ID/MenuID ở mọi cơ sở.
  const probe = makeBox();
  assert.strictEqual(probe.pageUrl("parislinhdam"), LD_URL);

  // 1. Lô sạch ở Kim Giang → lưu lệnh chuyển, đếm ngược rồi tự chuyển sang Linh Đàm.
  const clean = makeBox();
  await clean.prompt({ tenant: "parislinhdam", dateKey: "2026-08-02" },
    { message: "Đã phát hành 9/9 hóa đơn.", kind: "ok", autoRedirect: true, extra: [] });
  assert.deepStrictEqual({ ...clean.storage.handoff, createdAt: "" }, {
    fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-02", targetUrl: LD_URL, createdAt: ""
  });
  assert.match(clean.text(), /Đã phát hành 9\/9 hóa đơn\. Tự chuyển sang Paris Linh Đàm để phát hành ngày 02\/08\/2026 sau 8 giây/);
  assert.deepStrictEqual(clean.actions(), ["handoff", "handoff-stay"]);
  let ticks = 0;
  while (clean.runTimer()) ticks += 1;
  assert.strictEqual(ticks, 8, "Đếm ngược đủ 8 giây");
  assert.deepStrictEqual(clean.assigned, [LD_URL], "Hết giờ thì chuyển đúng một lần sang Linh Đàm");

  // 2. Bấm "Ở lại": không chuyển, vẫn còn nút chuyển + xuất file; lệnh chuyển vẫn
  // giữ để tự sang sau đó vẫn mở đúng ngày.
  const stay = makeBox();
  await stay.prompt({ tenant: "parislinhdam", dateKey: "2026-08-02" },
    { message: "Đã phát hành 9/9 hóa đơn.", kind: "ok", autoRedirect: true,
      extra: [{ label: "Xuất file hạch toán", action: "issued-export" }] });
  stay.runTimer();
  stay.stay();
  while (stay.runTimer()) { /* hết hẹn giờ */ }
  assert.deepStrictEqual(stay.assigned, [], "Ở lại thì không được chuyển trang");
  assert.match(stay.text(), /Đã ở lại trang này\. Tiếp theo: Paris Linh Đàm để phát hành ngày 02\/08\/2026/);
  assert.deepStrictEqual(stay.actions(), ["handoff", "issued-export"]);
  assert.strictEqual(stay.storage.handoff.targetTenant, "parislinhdam");
  await stay.follow();
  assert.deepStrictEqual(stay.assigned, [LD_URL], "Bấm Chuyển sang thì đi ngay");

  // 3. Có thông báo khác trong lúc đếm ngược (người dùng thao tác, lỗi) → hủy chuyển.
  const interrupted = makeBox();
  await interrupted.prompt({ tenant: "parislinhdam", dateKey: "2026-08-02" },
    { message: "Đã phát hành 9/9 hóa đơn.", kind: "ok", autoRedirect: true, extra: [] });
  interrupted.setStatus("Đang tải danh sách hóa đơn điện tử…", "warn");
  assert.strictEqual(interrupted.hasTimer(), false);
  while (interrupted.runTimer()) { /* hết hẹn giờ */ }
  assert.deepStrictEqual(interrupted.assigned, []);

  // 4. Lô có lỗi/cảnh báo → không tự chuyển, chỉ có nút.
  const failed = makeBox();
  await failed.prompt({ tenant: "parislinhdam", dateKey: "2026-08-01" },
    { message: "Đã phát hành 8/9 hóa đơn. 1 hóa đơn lỗi, xem chi tiết bên dưới.", kind: "error", autoRedirect: false, extra: [] });
  assert.strictEqual(failed.hasTimer(), false);
  assert.match(failed.text(), /1 hóa đơn lỗi[\s\S]*Tiếp theo: Paris Linh Đàm để phát hành ngày 01\/08\/2026/);
  assert.deepStrictEqual(failed.actions(), ["handoff"]);

  // 5. Cùng cơ sở, ngày kế: không chuyển trang, chỉ mời tải ngày đó.
  const sameTenant = makeBox();
  await sameTenant.prompt({ tenant: "pariskimgiang", dateKey: "2026-08-03" },
    { message: "Đã phát hành 2/2 hóa đơn.", kind: "ok", autoRedirect: true, extra: [] });
  assert.strictEqual(sameTenant.storage.handoff, null, "Không ghi lệnh chuyển cơ sở");
  assert.strictEqual(sameTenant.hasTimer(), false);
  assert.match(sameTenant.text(), /Tiếp theo: ngày 03\/08\/2026 ở cơ sở này/);
  await sameTenant.follow();
  assert.deepStrictEqual(sameTenant.opened, ["2026-08-03"]);
  assert.deepStrictEqual(sameTenant.assigned, []);
  assert.deepStrictEqual(sameTenant.selection(), ["A", "A2"], "Ngày kế ở cơ sở này cũng tích sẵn");
  assert.match(sameTenant.text(), /Đã tải 6 hóa đơn; 4 hóa đơn chưa phát hành\. Đã tích sẵn 2 hóa đơn của giao dịch sao kê/);

  // 6. Ở Linh Đàm sau khi chuyển: mở Phát hành đúng ngày, xóa lệnh, không tự phát hành.
  const record = { fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-02",
    targetUrl: LD_URL, createdAt: new Date().toISOString() };
  const arrived = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record }, cookie: "shop=parislinhdam" });
  await arrived.resume();
  assert.deepStrictEqual(arrived.opened, ["2026-08-02"], "Mở Phát hành với đúng ngày cơ sở trước vừa làm");
  assert.strictEqual(arrived.storage.handoff, null, "Lệnh chuyển chỉ dùng một lần");
  assert.strictEqual(arrived.panel.hidden, false);
  assert.match(arrived.text(), /Tiếp tục sau Paris Kim Giang: đã mở Phát hành ngày 02\/08\/2026\. Đã tải 6 hóa đơn[\s\S]*Đã tích sẵn 2 hóa đơn của giao dịch sao kê[\s\S]*extension không tự phát hành/);
  assert.deepStrictEqual(arrived.assigned, []);
  // Tích sẵn đúng tập "Chọn tất cả": thuộc giao dịch sao kê, khớp giao dịch, chưa
  // phát hành/hủy. Lựa chọn cũ (C ngoài giao dịch) bị thay, không cộng dồn.
  assert.deepStrictEqual(arrived.selection(), ["A", "A2"],
    "Không tích phiếu đã phát hành (B), ngoài giao dịch (C), lệch sao kê (D), đã hủy (E)");
  assert(arrived.rendered >= 1, "Vẽ lại bảng để thấy ô đã tích và nút Phát hành N hóa đơn");

  // Ngày đó không còn gì của giao dịch sao kê để phát hành: không tích gì, nói rõ.
  const nothingLeft = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record }, cookie: "shop=parislinhdam",
    listRows: [{ id: "A", invoiceNo: "HD-A", issued: true }, { id: "C", invoiceNo: "HD-C-ngoai-giao-dich" }] });
  await nothingLeft.resume();
  assert.deepStrictEqual(nothingLeft.selection(), []);
  assert.match(nothingLeft.text(), /Không có hóa đơn nào của giao dịch sao kê chờ phát hành ngày này/);

  // 7. Trang đăng nhập: tài khoản đã điền sẵn, không cần mật khẩu → bấm hộ
  // "Đăng nhập" đúng một lần; không điền gì vào form.
  const LOGIN_URL = "http://banhang.thuanvietsoft.com/parislinhdam/Login?Url=%2fparislinhdam%2fForm%3fModal%3d0";
  const autoLogin = makeBox({ tenant: "parislinhdam", href: LOGIN_URL, stored: { ...record }, login: {} });
  await autoLogin.resume();
  assert.strictEqual(autoLogin.loginPage.clicks.length, 1, "Bấm hộ nút Đăng nhập");
  assert(autoLogin.storage.handoff.loginAttemptAt, "Đánh dấu đã bấm để không bấm lặp");
  assert.strictEqual(autoLogin.storage.handoff.targetTenant, "parislinhdam", "Lệnh phải sống qua bước đăng nhập");
  assert.strictEqual(autoLogin.loginPage.byId.UserName.value, "Admin", "Không đụng vào ô Tài khoản");
  assert.match(autoLogin.text(), /Đang tự đăng nhập Paris Linh Đàm để phát hành tiếp ngày 02\/08\/2026/);
  assert.deepStrictEqual(autoLogin.opened, []);

  // Quay lại trang đăng nhập sau lần bấm đó = không vào được: không bấm nữa.
  const retry = makeBox({ tenant: "parislinhdam", href: LOGIN_URL, stored: { ...autoLogin.storage.handoff }, login: {} });
  await retry.resume();
  assert.strictEqual(retry.loginPage.clicks.length, 0, "Không bấm Đăng nhập lặp lại");
  assert.strictEqual(retry.panel.hidden, false, "Mở panel để người dùng thấy lý do");
  assert.match(retry.text(), /lần trước chưa vào được\. Đăng nhập Paris Linh Đàm để phát hành tiếp ngày 02\/08\/2026 \(sau Paris Kim Giang\)/);

  // Form khác thường thì để người dùng tự đăng nhập.
  for (const [login, reason] of [
    [{ touchMode: true }, /chế độ đăng nhập bằng mã số/],
    [{ verifyVisible: true }, /đòi mã xác thực/],
    [{ userName: "" }, /ô Tài khoản chưa được điền sẵn/],
    [{ error: "Tài khoản hoặc mật khẩu không đúng" }, /website báo: Tài khoản hoặc mật khẩu không đúng/],
    [{ action: "/pariskimgiang/Login" }, /không thấy form đăng nhập của cơ sở này/]
  ]) {
    const odd = makeBox({ tenant: "parislinhdam", href: LOGIN_URL, stored: { ...record }, login });
    await odd.resume();
    assert.strictEqual(odd.loginPage.clicks.length, 0, `Không bấm khi ${reason}`);
    assert.match(odd.text(), new RegExp(`Không tự đăng nhập: [^.]*${reason.source}`));
    assert.strictEqual(odd.storage.handoff.loginAttemptAt, undefined);
  }

  // Không có lệnh chuyển dành cho cơ sở này thì không bao giờ tự đăng nhập.
  const noHandoff = makeBox({ tenant: "parislinhdam", href: LOGIN_URL, stored: null, login: {} });
  await noHandoff.resume();
  const otherTarget = makeBox({ tenant: "pariskimgiang", href: LOGIN_URL.replace(/parislinhdam/g, "pariskimgiang"),
    stored: { ...record }, login: { action: "/pariskimgiang/Login" } });
  await otherTarget.resume();
  assert.strictEqual(noHandoff.loginPage.clicks.length + otherTarget.loginPage.clicks.length, 0);

  // Cookie còn của cơ sở cũ (chưa ở trang đăng nhập): chờ, giữ nguyên lệnh.
  const staleCookie = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record }, cookie: "shop=pariskimgiang" });
  await staleCookie.resume();
  assert.deepStrictEqual(staleCookie.opened, []);
  assert.strictEqual(staleCookie.storage.handoff.targetTenant, "parislinhdam");
  assert.match(staleCookie.text(), /Đăng nhập Paris Linh Đàm để phát hành tiếp ngày 02\/08\/2026 \(sau Paris Kim Giang\)/);

  // Đăng nhập xong website quay về đúng màn trong `Url`: mở Phát hành, xóa lệnh.
  const afterLogin = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...autoLogin.storage.handoff },
    cookie: "shop=parislinhdam" });
  await afterLogin.resume();
  assert.deepStrictEqual(afterLogin.opened, ["2026-08-02"]);
  assert.strictEqual(afterLogin.storage.handoff, null);

  // 8. Đăng nhập xong website đưa về trang chủ: mở lại màn Hóa đơn điện tử một lần.
  const home = "http://banhang.thuanvietsoft.com/parislinhdam/Home";
  const landed = makeBox({ tenant: "parislinhdam", href: home, stored: { ...record } });
  await landed.resume();
  assert.deepStrictEqual(landed.assigned, [LD_URL]);
  assert(landed.storage.handoff.landingRedirectAt, "Đánh dấu đã chuyển một lần để không lặp");
  const stillLost = makeBox({ tenant: "parislinhdam", href: home, stored: { ...landed.storage.handoff } });
  await stillLost.resume();
  assert.deepStrictEqual(stillLost.assigned, [], "Vẫn lạc thì không chuyển lặp, mở Phát hành ngay tại chỗ");
  assert.deepStrictEqual(stillLost.opened, ["2026-08-02"]);

  // 9. Bỏ qua lệnh không dành cho cơ sở này, quá hạn, hoặc ngày đó cơ sở này đã xong.
  const other = makeBox({ tenant: "pariskimgiang", stored: { ...record } });
  await other.resume();
  assert.strictEqual(other.storage.handoff.targetTenant, "parislinhdam", "Cơ sở khác không được xóa lệnh");
  assert.deepStrictEqual(other.opened, []);
  const old = makeBox({ tenant: "parislinhdam", href: LD_URL,
    stored: { ...record, createdAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() } });
  await old.resume();
  assert.strictEqual(old.storage.handoff, null);
  assert.deepStrictEqual(old.opened, []);
  const doneAlready = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record },
    coordination: Coordination.markCursor(Coordination.empty(), "parislinhdam", "2026-08-02", { status: "done", count: 3 }) });
  await doneAlready.resume();
  assert.strictEqual(doneAlready.storage.handoff, null);
  assert.deepStrictEqual(doneAlready.opened, []);

  // --- Đấu nối --------------------------------------------------------------
  const init = fn("init");
  assert(init.indexOf("await restoreUiSession();") < init.indexOf("await resumeIssueHandoff()"),
    "Đọc lệnh chuyển sau khi khôi phục phiên");
  assert.match(fn("resumeIssueHandoff"), /if \(batchAutoResumeStarted \|\| pendingNewInvoice\) return false;/,
    "Không giành màn hình của lô Batch đang tự chạy tiếp hoặc tab tạo phiếu");
  const issue = fn("issueSelectedEInvoices");
  assert(!/location\.(assign|href\s*=)/.test(issue), "Phát hành không tự rời trang ngoài lệnh chuyển");
  assert.match(issue, /saveIssueHandoff\(null\)/, "Hết việc thì xóa lệnh chuyển cũ");
  assert.match(fn("openAccountingDashboardAction"), /action === "handoff"\) followIssueHandoff\(\)/);
  assert.match(fn("openAccountingDashboardAction"), /action === "handoff-stay"\) stayAfterIssue\(\)/);

  console.log("Tự chuyển cơ sở sau khi phát hành và nhớ ngày phát hành: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
