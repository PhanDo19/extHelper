"use strict";

// Hộp cát dùng chung cho test chuyển cơ sở và tự động phát hành: nạp HÀM THẬT
// của content.js (setStatus, lệnh chuyển, tự đăng nhập, tự động phát hành) vào
// một vm, còn storage/website/danh sách hóa đơn là giả. Không phải file test.

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
  if (start < 0) throw new Error(`Không tìm thấy hằng ${name}`);
  return source.slice(start, source.indexOf(";\n", start) + 1);
};

const ORIGIN = "http://banhang.thuanvietsoft.com";
const E_INVOICE_QUERY = "?Modal=0&ID=9bc781f5-d316-4eba-94d8-26c4c2321faf&MenuID=2af9b881-2fff-41cb-b014-fe662ee351c2";
const pageUrl = tenant => `${ORIGIN}/${tenant}/Form${E_INVOICE_QUERY}`;
const KG_URL = pageUrl("pariskimgiang");
const LD_URL = pageUrl("parislinhdam");
const NHON_URL = pageUrl("parisnhon");

// Trang đăng nhập thật của website (đọc 05/10/2026, /parislinhdam/Login?Url=…):
// form POST tới /<cơ sở>/Login, UserName điền sẵn "Admin", Password trống, nút
// #btnDangnhap; #loginByUserPass ẩn khi bật chế độ đăng nhập bằng mã số; ô
// VerifyCode nằm trong <li class="user hidden"> trừ khi website đòi mã xác thực.
function loginPageElements({ action = "/parislinhdam/Login", userName = "Admin", touchMode = false,
  verifyVisible = false, error = "" } = {}) {
  const clicks = [];
  return {
    clicks,
    form: { getAttribute: name => (name === "action" ? action : null) },
    byId: {
      loginByUserPass: { display: touchMode ? "none" : "block" },
      VerifyCode: { closest: selector => (selector === ".hidden" && !verifyVisible ? {} : null) },
      UserName: { value: userName },
      lblstatus: { textContent: `\n    ${error}\n    ` },
      btnDangnhap: { click: () => clicks.push(Date.now()) }
    }
  };
}

// Danh sách mặc định (không theo ngày) cho test chuyển cơ sở: chỉ A, A2 thuộc
// giao dịch sao kê, khớp giao dịch và chưa phát hành.
const DEFAULT_LIST = [
  { id: "A", invoiceNo: "HD-A" },
  { id: "A2", invoiceNo: "HD-A2" },
  { id: "B", invoiceNo: "HD-B", issued: true },
  { id: "C", invoiceNo: "HD-C-ngoai-giao-dich" },
  { id: "D", invoiceNo: "HD-D", mismatch: true },
  { id: "E", invoiceNo: "HD-E", cancelled: true }
];

// storage: { handoff, autoJob, coordination } — dùng chung giữa các "trang" (box)
// như chrome.storage.local thật.
function makeBox({
  tenant = "pariskimgiang", href = KG_URL, stored, storage, coordination, cookie = "", login = null,
  listRows = DEFAULT_LIST, linkedNos = ["HD-A", "HD-A2", "HD-B", "HD-D", "HD-E"], transactions = [],
  fastTimers = false, confirmAnswer = true, inputs = {}, issue = null
} = {}) {
  const timers = [];
  const assigned = [];
  const opened = [];
  const history = [];
  const issueCalls = [];
  const confirms = [];
  const shared = storage || { handoff: null, autoJob: null, coordination: Coordination.empty() };
  if (stored !== undefined) shared.handoff = stored;
  if (coordination) shared.coordination = coordination;
  const loginPage = login ? loginPageElements(login) : null;
  const statusNode = {
    className: "",
    children: [],
    classList: { contains: name => statusNode.className.split(/\s+/).includes(name) },
    get firstChild() { return statusNode.children[0] || null; },
    replaceChildren(...nodes) { statusNode.children = nodes; history.push(nodes[0]?.textContent || ""); },
    append(node) { statusNode.children.push(node); }
  };
  const inputNodes = Object.fromEntries(Object.entries(inputs).map(([id, value]) => [id, { value }]));
  const url = new URL(href);
  const box = {
    timers, assigned, opened, history, issueCalls, confirms, storage: shared, statusNode, loginPage,
    URL, URLSearchParams, console, JSON,
    location: {
      href, origin: url.origin, pathname: url.pathname, search: url.search,
      assign: target => assigned.push(target)
    },
    window: { confirm: message => { confirms.push(message); return confirmAnswer; } },
    getComputedStyle: element => ({ display: element.display || "block" }),
    document: {
      cookie,
      getElementById: id => (id === "it-status" ? statusNode : id === "it-panel" ? box.panel
        : inputNodes[id] || loginPage?.byId[id] || null),
      querySelector: selector => (loginPage && selector === 'input[type="password"]' ? {} : null),
      querySelectorAll: selector => (loginPage && selector === "form" ? [loginPage.form] : []),
      createTextNode: text => ({ textContent: text }),
      createElement: () => ({ dataset: {}, addEventListener() {}, textContent: "" })
    },
    panel: { hidden: true },
    setTimeout: fastTimers
      ? callback => { setImmediate(callback); return 0; }
      : (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; },
    InvoiceIssueCoordination: Coordination,
    InvoiceMappingStore: {
      loadIssueHandoff: async () => shared.handoff,
      saveIssueHandoff: async value => { shared.handoff = value; return value; },
      loadAutoIssueJob: async () => shared.autoJob,
      saveAutoIssueJob: async value => { shared.autoJob = value; return value; },
      loadIssueCoordination: async () => shared.coordination,
      saveIssueCoordination: async value => { shared.coordination = value; return value; }
    },
    formatMoney: value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0)),
    renderWorkflowDashboard: () => {},
    isInvalidRuntimeContext: () => false,
    openAccountingDashboardAction: () => {},
    syncTabsOffset: () => {},
    parseUiDateTime: () => null,
    listRowsFor: day => (typeof listRows === "function" ? listRows(day) : listRows),
    linkedNos,
    statementDataset: { transactions },
    // Phát hành giả: đánh dấu đã phát hành và ghi chốt "done" như khối finally thật.
    issueBehavior: issue || (() => ({ clean: true, kind: "ok" })),
    rendered: 0
  };
  vm.createContext(box);
  vm.runInContext([
    `const pageTenantSlug = ${JSON.stringify(tenant)};`,
    "const TENANT_LABELS = { parislinhdam: 'Paris Linh Đàm', pariskimgiang: 'Paris Kim Giang', parisnhon: 'Paris Nhơn' };",
    "const pageTenantLabel = TENANT_LABELS[pageTenantSlug];",
    "const RUNTIME_REFRESH_MESSAGE = 'reload';",
    constant("ISSUE_HANDOFF_REDIRECT_SECONDS"), constant("ISSUE_HANDOFF_TTL_MS"),
    constant("E_INVOICE_FORM_ID"), constant("E_INVOICE_PAGE_QUERY"),
    constant("AUTO_ISSUE_COUNTDOWN_SECONDS"), constant("AUTO_ISSUE_TTL_MS"), constant("AUTO_ISSUE_FINISHED_STATUSES"),
    "let issueHandoffPrompt = null; let issueHandoffTimer = null; let issueHandoffTicking = false;",
    "let batchAutoResumeStarted = false; let pendingNewInvoice = null; let issuingInProgress = false;",
    "let autoIssueStopRequested = false; let autoIssueTimer = null;",
    "let issueCoordination = InvoiceIssueCoordination.normalize(storage.coordination);",
    "let eInvoiceRows = []; let eInvoiceSelection = new Set(['C']);",
    "async function openEInvoiceAdmin(day) {",
    "  opened.push(day); eInvoiceRows = listRowsFor(day).map(row => ({ ...row }));",
    "  setStatus(`Đã tải ${eInvoiceRows.length} hóa đơn; ${eInvoiceRows.filter(row => !row.issued && !row.cancelled).length} hóa đơn chưa phát hành.`, 'ok');",
    "}",
    "function statementInvoiceNos() { return new Set(linkedNos); }",
    "function isStatementInvoice(row, linked) { return linked.has(row.invoiceNo); }",
    "function statementInvoiceMatch(row) { return { valid: !row.mismatch }; }",
    "function renderEInvoiceRows() { rendered += 1; }",
    "async function issueSelectedEInvoices(options) {",
    "  issueCalls.push({ options, selected: [...eInvoiceSelection].sort(), day: opened[opened.length - 1] });",
    "  const result = issueBehavior({ tenant: pageTenantSlug, day: opened[opened.length - 1] });",
    "  if (result.blocked) return result;",
    "  const targets = eInvoiceRows.filter(row => eInvoiceSelection.has(row.id));",
    "  targets.forEach(row => { row.issued = true; });",
    "  const day = opened[opened.length - 1];",
    "  if (InvoiceIssueCoordination.sharesInvoiceRange(pageTenantSlug)) {",
    "    issueCoordination = InvoiceIssueCoordination.markCursor(issueCoordination, pageTenantSlug, day, { status: 'done', count: targets.length });",
    "    storage.coordination = issueCoordination;",
    "  }",
    "  return { succeeded: targets.length, summary: `Đã phát hành ${targets.length}/${targets.length} hóa đơn.`, exportAction: null, ...result };",
    "}",
    fn("preselectStatementInvoices"),
    fn("activeShopFromCookie"), fn("uiDateKey"), fn("setStatus"),
    fn("viDay"), fn("eInvoicePageUrl"), fn("isEInvoicePage"), fn("isSamePageUrl"), fn("isLoginPage"),
    fn("issueHandoffTarget"), fn("handoffLoginProblem"), fn("submitHandoffLogin"),
    fn("promptIssueHandoff"), fn("scheduleIssueHandoffRedirect"), fn("cancelIssueHandoffRedirect"),
    fn("stayAfterIssue"), fn("followIssueHandoff"), fn("resumeIssueHandoff"), fn("announceAutoIssueJob"),
    ...["autoIssueAppliesHere", "loadActiveAutoIssueJob", "updateAutoIssueJob", "addDaysToDateKey",
      "ownStatementDays", "nextAutoIssueStep", "reloadIssueCoordination", "showPanel", "autoIssueCountdown",
      "startAutoIssue", "resumeAutoIssue", "goToAutoIssueStep", "autoIssueBlockers", "runAutoIssueStep",
      "markAutoIssueDayDone", "recordAutoIssueStep", "continueAutoIssue", "finishAutoIssue", "stopAutoIssue",
      "requestAutoIssueStop", "autoIssueProgressText", "renderAutoIssueControls"].map(fn),
    "this.selectionJson = () => JSON.stringify([...eInvoiceSelection].sort());",
    "this.setStatus = setStatus; this.prompt = promptIssueHandoff; this.stay = stayAfterIssue;",
    "this.follow = followIssueHandoff; this.resume = resumeIssueHandoff; this.pageUrl = eInvoicePageUrl;",
    "this.announce = announceAutoIssueJob; this.startAuto = startAutoIssue; this.resumeAuto = resumeAutoIssue;",
    "this.stopAuto = requestAutoIssueStop; this.runStep = runAutoIssueStep;",
    "this.hasTimer = () => Boolean(issueHandoffTimer);",
    "this.cursor = (tenant, day) => InvoiceIssueCoordination.cursorFor(storage.coordination, tenant, day);"
  ].join("\n"), box);
  box.text = () => statusNode.children.map(node => node.textContent).join(" | ");
  box.selection = () => JSON.parse(box.selectionJson());
  box.actions = () => statusNode.children.slice(1).map(node => node.dataset.action);
  box.runTimer = () => {
    const timer = timers.filter(item => !item.cleared && !item.ran).shift();
    if (!timer) return false;
    timer.ran = true;
    timer.callback();
    return true;
  };
  // Chờ chuỗi async (đếm ngược nhanh, phát hành giả, bước kế) chạy hết.
  box.settle = async () => {
    for (let index = 0; index < 400; index += 1) await new Promise(resolve => setImmediate(resolve));
  };
  return box;
}

module.exports = { makeBox, fn, source, Coordination, KG_URL, LD_URL, NHON_URL, ORIGIN };
