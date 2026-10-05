"use strict";

// Phát hành xong một cơ sở (Kim Giang/Linh Đàm dùng chung dải số) thì tự chuyển
// sang cơ sở kế tiếp và mở sẵn màn Phát hành với ĐÚNG ngày vừa làm — trước đây
// người dùng phải tự gõ URL cơ sở kia rồi chọn lại ngày (yêu cầu 05/10/2026).
// Không bao giờ tự phát hành ở cơ sở đích.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const Coordination = require("../issue-coordination.js");

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

const KG_URL = "http://banhang.thuanvietsoft.com/pariskimgiang/Form?Modal=0&ID=9bc781f5-d316-4eba-94d8-26c4c2321faf&MenuID=2af9b881-2fff-41cb-b014-fe662ee351c2";
const LD_URL = KG_URL.replace("/pariskimgiang/", "/parislinhdam/");

function makeBox({ tenant = "pariskimgiang", href = KG_URL, stored = null, coordination = Coordination.empty(), cookie = "", loginForm = false } = {}) {
  const timers = [];
  const statuses = [];
  const assigned = [];
  const opened = [];
  const storage = { handoff: stored };
  const statusNode = {
    className: "",
    children: [],
    classList: { contains: name => statusNode.className.split(/\s+/).includes(name) },
    get firstChild() { return statusNode.children[0] || null; },
    replaceChildren(...nodes) { statusNode.children = nodes; },
    append(node) { statusNode.children.push(node); }
  };
  const url = new URL(href);
  const box = {
    timers, statuses, assigned, opened, storage, statusNode,
    URL,
    console,
    location: { href, pathname: url.pathname, assign: target => assigned.push(target) },
    document: {
      cookie,
      getElementById: id => (id === "it-status" ? statusNode : id === "it-panel" ? box.panel : null),
      querySelector: selector => (loginForm && selector === 'input[type="password"]' ? {} : null),
      createTextNode: text => ({ textContent: text }),
      createElement: () => ({ dataset: {}, addEventListener() {}, textContent: "" })
    },
    panel: { hidden: true },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    InvoiceIssueCoordination: Coordination,
    InvoiceMappingStore: {
      loadIssueHandoff: async () => storage.handoff,
      saveIssueHandoff: async value => { storage.handoff = value; return value; }
    },
    renderWorkflowDashboard: () => {},
    isInvalidRuntimeContext: () => false,
    openAccountingDashboardAction: () => {},
    syncTabsOffset: () => {},
    parseUiDateTime: () => null,
    openEInvoiceAdmin: async day => {
      opened.push(day);
      box.setStatus("Đã tải 12 hóa đơn; 12 hóa đơn chưa phát hành.", "ok");
    }
  };
  vm.createContext(box);
  vm.runInContext([
    `const pageTenantSlug = ${JSON.stringify(tenant)};`,
    "const TENANT_LABELS = { parislinhdam: 'Paris Linh Đàm', pariskimgiang: 'Paris Kim Giang', parisnhon: 'Paris Nhơn' };",
    "const pageTenantLabel = TENANT_LABELS[pageTenantSlug];",
    "const RUNTIME_REFRESH_MESSAGE = 'reload';",
    constant("ISSUE_HANDOFF_REDIRECT_SECONDS"),
    constant("ISSUE_HANDOFF_TTL_MS"),
    "let issueHandoffPrompt = null; let issueHandoffTimer = null; let issueHandoffTicking = false;",
    "let batchAutoResumeStarted = false; let pendingNewInvoice = null; let issuingInProgress = false;",
    "let issueCoordination = this.coordination;",
    fn("activeShopFromCookie"), fn("uiDateKey"), fn("setStatus"),
    fn("viDay"), fn("tenantPageUrl"), fn("isSamePageUrl"), fn("isLoginPage"), fn("issueHandoffTarget"),
    fn("promptIssueHandoff"), fn("scheduleIssueHandoffRedirect"), fn("cancelIssueHandoffRedirect"),
    fn("stayAfterIssue"), fn("followIssueHandoff"), fn("resumeIssueHandoff"),
    "this.setStatus = setStatus; this.prompt = promptIssueHandoff; this.stay = stayAfterIssue;",
    "this.follow = followIssueHandoff; this.resume = resumeIssueHandoff; this.pageUrl = tenantPageUrl;",
    "this.hasTimer = () => Boolean(issueHandoffTimer);"
  ].join("\n"), Object.assign(box, { coordination }));
  box.text = () => statusNode.children.map(node => node.textContent).join(" | ");
  box.actions = () => statusNode.children.slice(1).map(node => node.dataset.action);
  box.runTimer = () => {
    const timer = timers.filter(item => !item.cleared && !item.ran).shift();
    if (!timer) return false;
    timer.ran = true;
    timer.callback();
    return true;
  };
  return box;
}

(async () => {
  // URL cùng màn Hóa đơn điện tử ở cơ sở khác: chỉ thay đoạn cơ sở.
  const probe = makeBox();
  assert.strictEqual(probe.pageUrl("parislinhdam", KG_URL + "#x"), LD_URL);

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

  // 6. Ở Linh Đàm sau khi chuyển: mở Phát hành đúng ngày, xóa lệnh, không tự phát hành.
  const record = { fromTenant: "pariskimgiang", targetTenant: "parislinhdam", dateKey: "2026-08-02",
    targetUrl: LD_URL, createdAt: new Date().toISOString() };
  const arrived = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record }, cookie: "shop=parislinhdam" });
  await arrived.resume();
  assert.deepStrictEqual(arrived.opened, ["2026-08-02"], "Mở Phát hành với đúng ngày cơ sở trước vừa làm");
  assert.strictEqual(arrived.storage.handoff, null, "Lệnh chuyển chỉ dùng một lần");
  assert.strictEqual(arrived.panel.hidden, false);
  assert.match(arrived.text(), /Tiếp tục sau Paris Kim Giang: đã mở Phát hành ngày 02\/08\/2026\. Đã tải 12 hóa đơn[\s\S]*extension không tự phát hành/);
  assert.deepStrictEqual(arrived.assigned, []);

  // 7. Trang đăng nhập (hoặc cookie còn của cơ sở cũ): chờ, giữ nguyên lệnh.
  for (const options of [{ loginForm: true, cookie: "" }, { cookie: "shop=pariskimgiang" }]) {
    const login = makeBox({ tenant: "parislinhdam", href: LD_URL, stored: { ...record }, ...options });
    await login.resume();
    assert.deepStrictEqual(login.opened, []);
    assert.strictEqual(login.storage.handoff.targetTenant, "parislinhdam", "Lệnh phải sống qua bước đăng nhập");
    assert.match(login.text(), /Đăng nhập Paris Linh Đàm để phát hành tiếp ngày 02\/08\/2026 \(sau Paris Kim Giang\)/);
  }

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
  assert.match(fn("resumeIssueHandoff"), /if \(batchAutoResumeStarted \|\| pendingNewInvoice\) return;/,
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
