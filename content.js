(function () {
  "use strict";

  const REQUEST = "invoice-target-mvp:request";
  const RESPONSE = "invoice-target-mvp:response";
  const embeddedDataset = globalThis.InvoiceInventoryData || { mappings: [] };
  const embeddedCatalog = globalThis.InvoiceWebCatalog || { source: "data.xlsx", items: [] };
  const extensionVersion = typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : "";
  let catalogDataset = embeddedCatalog;
  let webCatalog = embeddedCatalog.items || [];
  let mappingDataset = embeddedDataset;
  let inventory = [];
  let mappingSummary = {};
  let statementDataset = { source: "", transactions: [] };
  let verificationLedger = { entries: [] };
  let priorityRules = [];
  let prioritySelections = new Map();
  let lastPriorityTarget = null;
  let currentBankTransaction = null;
  let batchPlans = [];
  let pendingStockStateImport = null;
  let stockStateMeta = null;
  let pendingNewInvoice = null;
  let uiSession = null;
  let sequence = 0;
  let latestScan = null;

  function serializeBatchPlans(plans) {
    return structuredClone((plans || []).map(entry => {
      const copy = { ...entry, transactionId: String(entry.transactionId || entry.transaction?.id || "") };
      delete copy.transaction;
      return copy;
    }));
  }

  function reconcileBatchPlanStatus(entryStatus, transactionStatus) {
    return ["done", "planned", "batch_ready"].includes(transactionStatus)
      ? transactionStatus
      : entryStatus;
  }

  function hydrateBatchPlans(plans, transactions) {
    const byId = new Map((transactions || []).map(transaction => [String(transaction.id), transaction]));
    return structuredClone(plans || []).map(entry => {
      const transaction = byId.get(String(entry.transactionId || ""));
      return transaction
        ? {
            ...entry,
            status: reconcileBatchPlanStatus(entry.status, transaction.status),
            transaction
          }
        : null;
    }).filter(Boolean);
  }

  function syncBatchPlanTransaction(transaction) {
    const transactionId = String(transaction?.id || "");
    if (!transactionId) return false;
    const entry = batchPlans.find(item => String(item.transactionId) === transactionId);
    if (!entry) return false;
    entry.status = reconcileBatchPlanStatus(entry.status, transaction.status);
    entry.transaction = transaction;
    return true;
  }

  function pendingPlanFromApproved(plan, transaction, invoiceSnapshot) {
    return {
      ...structuredClone(plan || {}),
      invoiceNo: invoiceSnapshot?.invoiceNo || transaction?.invoiceNo || plan?.invoiceNo || "",
      invoiceDateKey: invoiceSnapshot?.invoiceDateKey || transaction?.transactionDate || plan?.invoiceDateKey || "",
      grand: Math.round(Number(plan?.targetGrand ?? plan?.grand ?? transaction?.credit) || 0),
      items: (plan?.items || []).map(item => ({
        ...structuredClone(item),
        code: String(item.code),
        qty: Math.round(Number(item.qty ?? item.newQty) || 0),
        price: Math.round(Number(item.price) || 0)
      })),
      createdAt: new Date().toISOString()
    };
  }

  async function saveBatchUiSession(overrides) {
    const panel = document.getElementById("it-panel");
    const limit = Number(document.getElementById("it-batch-limit")?.value) || Number(uiSession?.batchLimit) || 10;
    const fromDateInput = document.getElementById("it-batch-from-date");
    const toDateInput = document.getElementById("it-batch-to-date");
    const fromDate = fromDateInput ? fromDateInput.value : (uiSession?.batchFromDate || "");
    const toDate = toDateInput ? toDateInput.value : (uiSession?.batchToDate || "");
    uiSession = {
      schemaVersion: 1,
      mode: "batch",
      panelOpen: panel ? !panel.hidden : Boolean(uiSession?.panelOpen),
      batchLimit: Math.max(1, Math.min(50, limit)),
      batchFromDate: fromDate,
      batchToDate: toDate,
      batchPlans: serializeBatchPlans(batchPlans),
      pendingNewInvoice: pendingNewInvoice ? structuredClone(pendingNewInvoice) : null,
      updatedAt: new Date().toISOString(),
      ...(overrides || {})
    };
    await InvoiceMappingStore.saveUiSession(uiSession);
    return uiSession;
  }

  function isRendered(element) {
    if (!element || !element.getClientRects().length) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isSalesWorkspacePage() {
    const salesLink = Array.from(document.querySelectorAll("a"))
      .find(anchor => (anchor.innerText || "").trim() === "Bán hàng" && anchor.href);
    if (!salesLink) return false;
    const current = new URL(location.href);
    const sales = new URL(salesLink.href, location.href);
    return current.pathname === sales.pathname &&
      current.searchParams.get("ID") === sales.searchParams.get("ID") &&
      current.searchParams.get("MenuID") === sales.searchParams.get("MenuID");
  }

  function normalizeRoomText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isIdleRoomLabel(label, visibleText) {
    const roomName = normalizeRoomText(label);
    return Boolean(roomName) &&
      roomName.toLocaleUpperCase("vi-VN") !== "BÁN LẺ" &&
      normalizeRoomText(visibleText) === roomName;
  }

  async function autoOpenIdleRoomInvoiceForm() {
    if (!pendingNewInvoice || !isSalesWorkspacePage()) return { opened: false, roomName: "" };
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const saveButton = Array.from(document.querySelectorAll("button"))
        .find(button => (button.innerText || "").trim() === "Lưu HĐ" && isRendered(button));
      if (saveButton) return { opened: true, roomName: pendingNewInvoice.roomName || "" };
      const idleRoom = Array.from(document.querySelectorAll(".table.context"))
        .find(room => {
          const image = room.querySelector("img[alt]");
          return isRendered(room) && isRendered(image) &&
            isIdleRoomLabel(image?.getAttribute("alt"), room.innerText);
        });
      if (idleRoom) {
        const roomName = normalizeRoomText(idleRoom.querySelector("img[alt]")?.getAttribute("alt"));
        idleRoom.querySelector("img[alt]")?.click();
        for (let wait = 0; wait < 30; wait += 1) {
          await new Promise(resolve => setTimeout(resolve, 100));
          const openedSaveButton = Array.from(document.querySelectorAll("button"))
            .find(button => (button.innerText || "").trim() === "Lưu HĐ" && isRendered(button));
          if (openedSaveButton) return { opened: true, roomName };
        }
        return { opened: false, roomName };
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return { opened: false, roomName: "" };
  }

  async function applyPendingNewInvoicePlan(transaction) {
    const plan = pendingNewInvoice?.plan || transaction?.batchApprovedPlan;
    if (!transaction || !plan?.requiresNewInvoice || !Array.isArray(plan.items) || !plan.items.length) return false;
    if (pendingNewInvoice?.appliedAt) return false;
    currentBankTransaction = transaction;
    document.getElementById("it-target").value = formatMoney(plan.targetGrand || transaction.credit);
    setStatus("Đang áp dụng phương án đã Accept từ Batch Review vào phiếu mới…", "warn");
    if (plan.checkIn && plan.checkOut) {
      await request("applyInvoiceTimes", { checkIn: plan.checkIn, checkOut: plan.checkOut });
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const applied = await request("applyInvoicePlan", {
      items: plan.items.map(item => ({
        code: item.code,
        newQty: item.qty,
        maxQty: item.maxQty,
        price: item.price
      })),
      finalHourAmount: plan.hour,
      targetGrand: plan.targetGrand,
      targetGoods: plan.goods,
      checkIn: plan.checkIn || "",
      checkOut: plan.checkOut || ""
    });
    latestScan = await request("scan");
    const actualGrand = Math.round(Number(latestScan.currentGrand || applied.currentGrand || 0));
    if (actualGrand !== Math.round(Number(plan.targetGrand || 0))) {
      throw new Error(`Form mới đang có tổng ${formatMoney(actualGrand)}, chưa khớp ${formatMoney(plan.targetGrand)}.`);
    }
    transaction.status = "planned";
    transaction.invoiceNo = latestScan.invoiceNo || transaction.invoiceNo || "";
    transaction.pendingPlan = {
      ...structuredClone(plan),
      invoiceNo: transaction.invoiceNo,
      invoiceDateKey: transaction.transactionDate,
      createdAt: new Date().toISOString()
    };
    transaction.verifiedAt = "";
    transaction.ledgerId = "";
    await InvoiceMappingStore.saveStatement(statementDataset);
    syncBatchPlanTransaction(transaction);
    pendingNewInvoice.appliedAt = new Date().toISOString();
    pendingNewInvoice.invoiceNo = transaction.invoiceNo;
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
    renderBatchPlans();
    setStatus(
      `Đã thêm ${plan.items.length} mã từ phương án Batch Review vào phiếu mới, tổng ${formatMoney(actualGrand)}đ. ` +
      "Hãy kiểm tra ngày, giờ và mặt hàng rồi bấm Lưu HĐ; extension chưa tự lưu.",
      "ok"
    );
    return true;
  }

  async function restoreUiSession() {
    const stored = await InvoiceMappingStore.loadUiSession();
    if (!stored || stored.schemaVersion !== 1 || stored.mode !== "batch") return;
    const savedAt = Date.parse(stored.updatedAt || "");
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > 7 * 24 * 60 * 60 * 1000) {
      await InvoiceMappingStore.clearUiSession();
      return;
    }
    uiSession = stored;
    pendingNewInvoice = stored.pendingNewInvoice || null;
    batchPlans = hydrateBatchPlans(stored.batchPlans, statementDataset.transactions || []);
    showBatchReviewMode(true, Boolean(stored.panelOpen));
    const limitInput = document.getElementById("it-batch-limit");
    if (limitInput) limitInput.value = String(Math.max(1, Math.min(50, Number(stored.batchLimit) || 10)));
    const fromDateInput = document.getElementById("it-batch-from-date");
    const toDateInput = document.getElementById("it-batch-to-date");
    if (fromDateInput) fromDateInput.value = stored.batchFromDate || "";
    if (toDateInput) toDateInput.value = stored.batchToDate || "";
    if (pendingNewInvoice) {
      const transaction = (statementDataset.transactions || []).find(item => String(item.id) === String(pendingNewInvoice.transactionId));
      const date = transaction?.transactionDate || pendingNewInvoice.transactionDate || "";
      const credit = Number(transaction?.credit || pendingNewInvoice.credit || 0);
      setStatus(
        `Đang tiếp tục tạo phiếu cho ngày ${date}, tổng mục tiêu ${formatMoney(credit)}đ. ` +
        "Sau khi tự lưu phiếu trên website, quay lại tab danh sách và bấm Tạo Batch Review để dò lại.",
        "warn"
      );
      if (isSalesWorkspacePage() && !pendingNewInvoice.formAutoOpenedAt) {
        let pendingApplyError = "";
        const opened = await autoOpenIdleRoomInvoiceForm();
        if (opened.opened && opened.roomName) {
          pendingNewInvoice.roomName = opened.roomName;
          pendingNewInvoice.formAutoOpenedAt = new Date().toISOString();
          const roomNode = document.getElementById("it-pending-room");
          if (roomNode) roomNode.textContent = opened.roomName;
          await saveBatchUiSession({ panelOpen: true });
          if (transaction && pendingNewInvoice.plan?.requiresNewInvoice) {
            try {
              await applyPendingNewInvoicePlan(transaction);
            } catch (error) {
              pendingApplyError = error.message;
            }
          }
        }
        if (pendingNewInvoice.appliedAt) return;
        if (pendingApplyError) {
          setStatus(`Đã mở form nhưng chưa áp dụng được phương án Batch Review: ${pendingApplyError}`, "error");
          return;
        }
        setStatus(
          opened.opened
            ? `Đã mở form trên phòng rảnh ${opened.roomName || pendingNewInvoice.roomName || ""} cho ngày ${date}, tổng mục tiêu ${formatMoney(credit)}đ. Chưa lưu hóa đơn.`
            : "Không tìm thấy phòng rảnh để mở form. Extension không chọn BÁN LẺ hoặc phòng đang hoạt động.",
          opened.opened ? "ok" : "error"
        );
      } else if (isSalesWorkspacePage() && pendingNewInvoice.formAutoOpenedAt) {
        setStatus(
          `Phiên này đã mở form phòng ${pendingNewInvoice.roomName || "rảnh"} trước đó. ` +
          "Extension không tự mở lại sau khi bạn thoát hoặc tải lại trang.",
          "warn"
        );
      }
    } else {
      setStatus("Đã khôi phục phiên Batch Review trước khi chuyển trang.", "ok");
    }
  }

  function request(action, payload) {
    return new Promise((resolve, reject) => {
      const id = `it-${Date.now()}-${sequence += 1}`;
      const timeoutMs = ["replaceInvoiceItems", "applyInvoicePlan"].includes(action) ? 90000 : ["findInvoiceCandidates", "findIssuedInvoiceByAmount"].includes(action) ? 28000 : 5000;
      const timeout = setTimeout(() => reject(new Error("Trang không phản hồi.")), timeoutMs);
      const listener = event => {
        if (!event.detail || event.detail.id !== id) return;
        window.removeEventListener(RESPONSE, listener);
        clearTimeout(timeout);
        if (event.detail.ok) resolve(event.detail.result);
        else reject(new Error(event.detail.error || "Không rõ lỗi."));
      };
      window.addEventListener(RESPONSE, listener);
      window.dispatchEvent(new CustomEvent(REQUEST, { detail: { id, action, ...(payload || {}) } }));
    });
  }

  const formatMoney = value => new Intl.NumberFormat("vi-VN").format(Math.round(Number(value) || 0));
  const parseMoney = value => Number(String(value || "").replace(/[^0-9-]/g, "")) || 0;
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function refreshMappingState() {
    inventory = InvoiceMappingEngine.buildInventory(mappingDataset);
    mappingSummary = InvoiceMappingEngine.summarize(mappingDataset);
    const node = document.getElementById("it-stock-source");
    if (node) node.innerHTML = stockSummaryHtml();
    if (document.getElementById("it-stock-admin") && !document.getElementById("it-stock-admin").hidden) {
      renderStockAdmin();
    }
  }

  function stockSummaryHtml() {
    return `Nguồn kho: <b>${escapeHtml(mappingDataset.source || "KhoT5.xlsx")}</b><br>` +
      `${inventory.length} mã đủ điều kiện · ${mappingSummary.confirmed || 0} đã xác nhận · ` +
      `${mappingSummary.review || 0} cần duyệt · ${mappingSummary.unmatched || 0} chưa khớp<br>` +
      `Danh mục web: ${webCatalog.length} mã từ ${escapeHtml(catalogDataset.source || "data.xlsx")}`;
  }

  function panelHtml() {
    return `
      <button id="it-toggle" type="button" title="Lập phương án theo tồn kho">Σ</button>
      <section id="it-panel" hidden>
        <header><span id="it-resize-handle" title="Giữ và kéo để thay đổi kích thước">↖</span><strong>Khớp tổng tiền — stock-first${extensionVersion ? ` <small>v${escapeHtml(extensionVersion)}</small>` : ""}</strong><button id="it-close" type="button">×</button></header>
        <div id="it-status" class="it-status">Hãy mở một phiếu hóa đơn.</div>
        <div id="it-stock-source" class="it-stock-source">${stockSummaryHtml()}</div>
        <div class="it-actions">
          <button id="it-import-web" type="button">Nhập data.xlsx</button>
          <button id="it-import-statement" type="button">Nhập sao kê.xlsx</button>
          <button id="it-manage-stock" type="button">Quản lý tồn kho</button>
          <button id="it-manage-mapping" type="button">Duyệt ánh xạ</button>
          <button id="it-manage-statement" type="button">Giao dịch ngân hàng</button>
          <button id="it-manage-batch" type="button">Batch Review</button>
          <input id="it-web-file" type="file" accept=".xlsx" hidden>
          <input id="it-stock-file" type="file" accept=".xlsx" hidden>
          <input id="it-statement-file" type="file" accept=".xlsx" hidden>
          <input id="it-state-file" type="file" accept=".json,application/json" hidden>
        </div>
        <section id="it-stock-admin" hidden>
          <div class="it-stock-toolbar">
            <input id="it-stock-search" type="search" placeholder="Tìm mã hoặc tên hàng…">
            <select id="it-stock-filter">
              <option value="all">Tất cả mặt hàng</option>
              <option value="held">Đang giữ tồn</option>
              <option value="low">Sắp hết (≤ 3)</option>
              <option value="out">Đã hết</option>
              <option value="per_invoice">Theo định mức/HĐ</option>
            </select>
            <div class="it-stock-actions">
              <button id="it-import-stock" type="button">Nhập KhoT5.xlsx</button>
              <button id="it-import-state" type="button">Nhập trạng thái tồn</button>
              <button id="it-export-state" type="button">Xuất trạng thái tồn</button>
            </div>
          </div>
          <div id="it-stock-kpis" class="it-stock-kpis"></div>
          <div class="it-table-wrap"><table class="it-stock-table">
            <thead><tr><th>Mã web</th><th>Mặt hàng</th><th>ĐVT</th><th>Giá</th><th>Tồn ghi nhận</th><th>Đang giữ</th><th>Có thể phân bổ</th><th>Nguồn kho</th></tr></thead>
            <tbody id="it-stock-body"></tbody>
          </table></div>
        </section>
        <section id="it-state-preview" class="it-state-preview" hidden></section>
        <div id="it-bank-selection" class="it-bank-selection it-calc-only" hidden></div>
        <section id="it-priority-rules" class="it-priority-rules it-calc-only">
          <div class="it-priority-header"><b>Mặt hàng ưu tiên</b><button id="it-manage-priority" type="button">Quản lý rule</button></div>
          <div id="it-priority-options"></div>
          <div id="it-priority-admin" hidden></div>
        </section>
        <label class="it-confirm"><input id="it-stock-confirm" type="checkbox"> Tôi xác nhận dữ liệu tồn kho còn hiệu lực.</label>
        <label>Tổng tiền mục tiêu <input id="it-target" inputmode="numeric" placeholder="Ví dụ: 2.500.000"></label>
        <div class="it-options">
          <label>Trần số lượng/mã <input id="it-max-qty" type="number" min="1" max="99999" value="20"></label>
          <label>Sai số cho phép <input id="it-tolerance" inputmode="numeric" value="0"></label>
        </div>
        <div class="it-actions">
          <button id="it-scan" type="button">Đọc lại phiếu</button>
          <button id="it-solve" type="button" class="primary">Tính phương án</button>
        </div>
        <div id="it-mapping-admin" hidden></div>
        <div id="it-statement-admin" hidden></div>
        <div id="it-batch-review" hidden></div>
        <div id="it-summary"></div>
        <div id="it-result"></div>
        <p class="it-warning">Toàn bộ hàng cũ được coi là cần thay thế. Chưa tự xóa/thêm dòng và không tự bấm Lưu HĐ, Hủy HĐ hoặc Phát hành.</p>
      </section>`;
  }

  function mount() {
    if (document.getElementById("invoice-target-mvp")) return;
    const root = document.createElement("div");
    root.id = "invoice-target-mvp";
    root.innerHTML = panelHtml();
    document.documentElement.appendChild(root);
    root.querySelector("#it-stock-confirm").closest("label").classList.add("it-calc-only");
    root.querySelector("#it-target").closest("label").classList.add("it-calc-only");
    root.querySelector(".it-options").classList.add("it-calc-only");
    root.querySelector("#it-scan").closest(".it-actions").classList.add("it-calc-only");
    root.querySelector("#it-summary").classList.add("it-calc-only");
    root.querySelector("#it-result").classList.add("it-calc-only");
    root.querySelector(".it-warning").classList.add("it-calc-only");
    enablePanelResize(root.querySelector("#it-panel"), root.querySelector("#it-resize-handle"));
    root.querySelector("#it-toggle").addEventListener("click", () => {
      root.querySelector("#it-panel").hidden = false;
      if (root.querySelector("#it-panel").classList.contains("batch-mode")) {
        saveBatchUiSession({ panelOpen: true }).catch(error => console.error("Không lưu được phiên Batch Review", error));
      } else if (root.querySelector("#it-panel").classList.contains("stock-mode")) {
        renderStockAdmin();
      } else {
        scanInvoice();
      }
    });
    root.querySelector("#it-close").addEventListener("click", () => {
      root.querySelector("#it-panel").hidden = true;
      if (root.querySelector("#it-panel").classList.contains("batch-mode")) {
        saveBatchUiSession({ panelOpen: false }).catch(error => console.error("Không lưu được phiên Batch Review", error));
      }
    });
    root.querySelector("#it-scan").addEventListener("click", scanInvoice);
    root.querySelector("#it-solve").addEventListener("click", solveInvoice);
    root.querySelector("#it-import-stock").addEventListener("click", () => root.querySelector("#it-stock-file").click());
    root.querySelector("#it-import-web").addEventListener("click", () => root.querySelector("#it-web-file").click());
    root.querySelector("#it-web-file").addEventListener("change", importWebFile);
    root.querySelector("#it-stock-file").addEventListener("change", importStockFile);
    root.querySelector("#it-import-statement").addEventListener("click", () => root.querySelector("#it-statement-file").click());
    root.querySelector("#it-statement-file").addEventListener("change", importStatementFile);
    root.querySelector("#it-import-state").addEventListener("click", () => root.querySelector("#it-state-file").click());
    root.querySelector("#it-state-file").addEventListener("change", previewStockStateFile);
    root.querySelector("#it-export-state").addEventListener("click", exportStockState);
    root.querySelector("#it-manage-stock").addEventListener("click", toggleStockAdmin);
    root.querySelector("#it-stock-search").addEventListener("input", renderStockRows);
    root.querySelector("#it-stock-filter").addEventListener("change", renderStockRows);
    root.querySelector("#it-manage-batch").addEventListener("click", toggleBatchReview);
    root.querySelector("#it-manage-mapping").addEventListener("click", toggleMappingAdmin);
    root.querySelector("#it-manage-statement").addEventListener("click", toggleStatementAdmin);
    root.querySelector("#it-manage-priority").addEventListener("click", togglePriorityAdmin);
    root.querySelector("#it-target").addEventListener("blur", event => {
      const amount = parseMoney(event.target.value);
      event.target.value = amount ? formatMoney(amount) : "";
      renderPriorityRules(true);
    });
    renderPriorityRules(true);
  }

  function setStatus(message, kind) {
    const node = document.getElementById("it-status");
    if (!node) return;
    node.textContent = message;
    node.className = `it-status ${kind || ""}`;
  }

  function priorityInventory(rule) {
    return inventory.find(item => String(item.webCode) === String(rule.webCode));
  }

  function renderPriorityRules(applyDefault) {
    const node = document.getElementById("it-priority-options");
    if (!node) return;
    const target = parseMoney(document.getElementById("it-target")?.value);
    if (applyDefault && target !== lastPriorityTarget) {
      lastPriorityTarget = target;
      prioritySelections = new Map(priorityRules.map(rule => [String(rule.id), false]));
      const eligible = priorityRules
        .filter(rule => rule.enabled !== false && target > Number(rule.minTotal || 0) && priorityInventory(rule));
      eligible
        .filter(rule => rule.mode === "required")
        .forEach(rule => prioritySelections.set(String(rule.id), true));
      const preferred = eligible
        .filter(rule => rule.mode !== "required")
        .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))[0];
      if (preferred) prioritySelections.set(String(preferred.id), true);
    }
    const visible = priorityRules.filter(rule => rule.enabled !== false && target > Number(rule.minTotal || 0))
      .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999));
    node.innerHTML = visible.length ? visible.map(rule => {
      const product = priorityInventory(rule);
      const checked = prioritySelections.get(String(rule.id)) === true;
      return `<label class="it-priority-chip" title="${escapeHtml(product?.webName || "Chưa có trong kho đủ điều kiện")}">
        <input type="checkbox" data-rule-id="${escapeHtml(rule.id)}" ${checked ? "checked" : ""} ${product ? "" : "disabled"}>
        <span>${escapeHtml(rule.code || rule.webCode)}</span><small>${rule.mode === "required" ? "BB" : `#${Number(rule.priority || 0)}`} · ${Number(rule.minQty || 1)}–${Number(rule.maxQty || rule.minQty || 1)}</small></label>`;
    }).join("") : '<small>Chưa có rule nào đạt ngưỡng tổng tiền.</small>';
    node.querySelectorAll('input[type="checkbox"][data-rule-id]').forEach(input => input.addEventListener("change", () => {
      prioritySelections.set(String(input.dataset.ruleId), input.checked);
    }));
  }

  function togglePriorityAdmin() {
    const node = document.getElementById("it-priority-admin");
    node.hidden = !node.hidden;
    if (!node.hidden) renderPriorityAdmin();
  }

  function renderPriorityAdmin() {
    const node = document.getElementById("it-priority-admin");
    if (!node) return;
    const rows = [...priorityRules].sort((a, b) => Number(a.priority) - Number(b.priority));
    node.innerHTML = `<datalist id="it-rule-web-options">${webCatalog.map(item => `<option value="${escapeHtml(webSearchValue(item))}"></option>`).join("")}</datalist>
      <div class="it-table-wrap"><table><thead><tr><th>Mã hiện</th><th>Sản phẩm web</th><th>Tổng lớn hơn</th><th>Loại</th><th>SL min</th><th>SL max</th><th>Ưu tiên</th><th>Dùng</th><th></th></tr></thead>
      <tbody>${rows.map(rule => `<tr data-rule-id="${escapeHtml(rule.id)}"><td><input class="it-rule-code" value="${escapeHtml(rule.code)}"></td>
        <td><input class="it-rule-web it-web-search" list="it-rule-web-options" value="${escapeHtml(ruleWebSearchValue(rule.webCode))}" placeholder="Gõ mã, tên hoặc giá…"></td><td><input class="it-rule-min" inputmode="numeric" value="${formatMoney(rule.minTotal)}"></td>
        <td><select class="it-rule-mode"><option value="rotate" ${rule.mode === "required" ? "" : "selected"}>Luân phiên</option><option value="required" ${rule.mode === "required" ? "selected" : ""}>Bắt buộc</option></select></td>
        <td><input class="it-rule-min-qty" type="number" min="1" value="${Number(rule.minQty || 1)}"></td>
        <td><input class="it-rule-max-qty" type="number" min="1" value="${Number(rule.maxQty || rule.minQty || 1)}"></td>
        <td><input class="it-rule-order" type="number" min="1" value="${Number(rule.priority || 1)}"></td><td><input class="it-rule-enabled" type="checkbox" ${rule.enabled !== false ? "checked" : ""}></td>
        <td><button class="it-rule-save" type="button">Lưu</button><button class="it-rule-delete" type="button">Xóa</button></td></tr>`).join("")}</tbody></table></div>
      <div class="it-rule-add"><input id="it-new-rule-code" placeholder="Mã hiện, VD: TCTO"><input id="it-new-rule-web" class="it-web-search" list="it-rule-web-options" placeholder="Tìm theo mã, tên hoặc giá sản phẩm…">
        <input id="it-new-rule-min" inputmode="numeric" placeholder="Tổng lớn hơn">
        <select id="it-new-rule-mode"><option value="rotate">Luân phiên</option><option value="required">Bắt buộc</option></select>
        <input id="it-new-rule-min-qty" type="number" min="1" value="1" title="Số lượng tối thiểu">
        <input id="it-new-rule-max-qty" type="number" min="1" value="1" title="Số lượng tối đa">
        <input id="it-new-rule-order" type="number" min="1" placeholder="Ưu tiên"><button id="it-add-rule" type="button">Thêm rule</button></div>`;
    node.querySelectorAll(".it-rule-save").forEach(button => button.addEventListener("click", savePriorityRuleRow));
    node.querySelectorAll(".it-rule-delete").forEach(button => button.addEventListener("click", deletePriorityRuleRow));
    node.querySelector("#it-add-rule").addEventListener("click", addPriorityRule);
    node.querySelector("#it-new-rule-web").addEventListener("change", suggestPriorityDisplayCode);
  }

  function ruleWebSearchValue(webCode) {
    const item = webCatalog.find(product => String(product.webCode) === String(webCode));
    return item ? webSearchValue(item) : String(webCode || "");
  }

  function selectedPriorityWebCode(value) {
    return String(value || "").split("|")[0].trim();
  }

  function suggestPriorityDisplayCode(event) {
    const codeInput = document.getElementById("it-new-rule-code");
    if (!codeInput || codeInput.value.trim()) return;
    const webCode = selectedPriorityWebCode(event.target.value);
    const stock = inventory.find(item => String(item.webCode) === webCode);
    codeInput.value = stock?.stockCodes?.[0] || webCode;
  }

  async function savePriorityRuleRow(event) {
    const row = event.target.closest("tr");
    const rule = priorityRules.find(item => String(item.id) === String(row.dataset.ruleId));
    if (!rule) return;
    const code = row.querySelector(".it-rule-code").value.trim();
    const webCode = selectedPriorityWebCode(row.querySelector(".it-rule-web").value);
    const web = webCatalog.find(item => String(item.webCode) === webCode);
    if (!code || !web) return setStatus("Hãy chọn một sản phẩm web trong danh sách tìm kiếm.", "error");
    rule.code = code;
    rule.webCode = webCode;
    rule.minTotal = Math.max(0, parseMoney(row.querySelector(".it-rule-min").value));
    rule.mode = row.querySelector(".it-rule-mode").value === "required" ? "required" : "rotate";
    rule.minQty = Math.max(1, Math.floor(Number(row.querySelector(".it-rule-min-qty").value) || 1));
    rule.maxQty = Math.max(rule.minQty, Math.floor(Number(row.querySelector(".it-rule-max-qty").value) || rule.minQty));
    rule.priority = Math.max(1, Number(row.querySelector(".it-rule-order").value) || 1);
    rule.enabled = row.querySelector(".it-rule-enabled").checked;
    await InvoiceMappingStore.savePriorityRules(priorityRules);
    lastPriorityTarget = null;
    renderPriorityRules(true);
    renderPriorityAdmin();
  }

  async function deletePriorityRuleRow(event) {
    const id = String(event.target.closest("tr").dataset.ruleId);
    priorityRules = priorityRules.filter(rule => String(rule.id) !== id);
    prioritySelections.delete(id);
    await InvoiceMappingStore.savePriorityRules(priorityRules);
    lastPriorityTarget = null;
    renderPriorityRules(true);
    renderPriorityAdmin();
  }

  async function addPriorityRule() {
    const code = document.getElementById("it-new-rule-code").value.trim();
    const webCode = selectedPriorityWebCode(document.getElementById("it-new-rule-web").value);
    const minTotal = Math.max(0, parseMoney(document.getElementById("it-new-rule-min").value));
    const mode = document.getElementById("it-new-rule-mode").value === "required" ? "required" : "rotate";
    const minQty = Math.max(1, Math.floor(Number(document.getElementById("it-new-rule-min-qty").value) || 1));
    const maxQty = Math.max(minQty, Math.floor(Number(document.getElementById("it-new-rule-max-qty").value) || minQty));
    const priority = Math.max(1, Number(document.getElementById("it-new-rule-order").value) || priorityRules.length + 1);
    const web = webCatalog.find(item => String(item.webCode) === webCode);
    if (!code || !web) return setStatus("Hãy chọn một sản phẩm web trong danh sách tìm kiếm.", "error");
    priorityRules.push({ id: `rule-${Date.now()}`, code, webCode, minTotal, mode, minQty, maxQty, priority, enabled: true });
    await InvoiceMappingStore.savePriorityRules(priorityRules);
    lastPriorityTarget = null;
    renderPriorityRules(true);
    renderPriorityAdmin();
  }

  async function enablePanelResize(panel, handle) {
    const key = "invoiceTargetPanelSize";
    try {
      const saved = await chrome.storage.local.get(key);
      const size = saved[key];
      if (size?.width && size?.height) {
        panel.style.width = `${Math.min(size.width, window.innerWidth - 28)}px`;
        panel.style.height = `${Math.min(size.height, window.innerHeight - 34)}px`;
        panel.style.maxHeight = "none";
      }
    } catch (_) { /* Dùng kích thước mặc định nếu chưa lưu được. */ }

    handle.addEventListener("dblclick", async () => {
      panel.style.removeProperty("width");
      panel.style.removeProperty("height");
      panel.style.removeProperty("max-height");
      await chrome.storage.local.remove(key);
    });

    handle.addEventListener("pointerdown", event => {
      event.preventDefault();
      const rect = panel.getBoundingClientRect();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;
      handle.setPointerCapture(event.pointerId);
      panel.classList.add("is-resizing");
      document.documentElement.style.userSelect = "none";

      const onMove = moveEvent => {
        const maxWidth = Math.max(360, window.innerWidth - 28);
        const maxHeight = Math.max(320, window.innerHeight - 34);
        const minWidth = Math.min(430, maxWidth);
        const minHeight = Math.min(360, maxHeight);
        const width = Math.max(minWidth, Math.min(maxWidth, startWidth + startX - moveEvent.clientX));
        const height = Math.max(minHeight, Math.min(maxHeight, startHeight + startY - moveEvent.clientY));
        panel.style.width = `${Math.round(width)}px`;
        panel.style.height = `${Math.round(height)}px`;
        panel.style.maxHeight = "none";
      };

      const onUp = async () => {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        panel.classList.remove("is-resizing");
        document.documentElement.style.removeProperty("user-select");
        const finalRect = panel.getBoundingClientRect();
        await chrome.storage.local.set({ [key]: { width: Math.round(finalRect.width), height: Math.round(finalRect.height) } });
      };

      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    });
  }

  function localTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    const part = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
  }

  async function downloadJson(payload, filename) {
    const response = await chrome.runtime.sendMessage({
      type: "invoiceTarget.downloadStockState",
      filename,
      content: JSON.stringify(payload, null, 2)
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome không tạo được file tải xuống.");
    return response.downloadId;
  }

  async function exportStockState() {
    try {
      const payload = InvoiceStockState.build({
        mappingDataset,
        parentExportId: Number(stockStateMeta?.schemaVersion) === InvoiceStockState.SCHEMA_VERSION
          ? stockStateMeta.currentExportId
          : null,
        extensionVersion
      });
      await downloadJson(payload, `TonKho_ParisKimGiang_${localTimestamp(payload.exportedAt)}.json`);
      stockStateMeta = {
        schemaVersion: payload.schemaVersion,
        currentExportId: payload.exportId,
        parentExportId: payload.parentExportId,
        exportedAt: payload.exportedAt,
        inventoryFingerprint: payload.inventoryFingerprint
      };
      await InvoiceMappingStore.saveStockStateMeta(stockStateMeta);
      setStatus(
        `Đã xuất trạng thái tồn kho: ${payload.summary.stockItemCount} mã, ` +
        `${formatMoney(payload.summary.availableUnitCount)} đơn vị khả dụng. File không chứa sao kê, rule hay danh mục web.`,
        "ok"
      );
    } catch (error) {
      setStatus(`Không xuất được trạng thái tồn: ${error.message}`, "error");
    }
  }

  async function previewStockStateFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const comparison = InvoiceStockState.compare(mappingDataset, payload, stockStateMeta);
      pendingStockStateImport = { fileName: file.name, payload, comparison };
      renderStockStatePreview();
      setStatus(
        comparison.validation.valid
          ? `Đã đọc ${file.name}. Hãy kiểm tra chênh lệch rồi xác nhận nhập.`
          : `File ${file.name} không hợp lệ; chưa có dữ liệu nào bị thay đổi.`,
        comparison.validation.valid ? "warn" : "error"
      );
    } catch (error) {
      pendingStockStateImport = null;
      document.getElementById("it-state-preview").hidden = true;
      setStatus(`Không đọc được file trạng thái tồn: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  }

  function renderStockStatePreview() {
    const node = document.getElementById("it-state-preview");
    const pending = pendingStockStateImport;
    if (!node || !pending) return;
    const { payload, comparison } = pending;
    const { validation, counts, currentSummary, incomingSummary } = comparison;
    const messages = [...validation.errors, ...validation.warnings];
    const needsRiskConfirm = validation.warnings.length > 0;
    const rows = comparison.changes.slice(0, 12);
    node.hidden = false;
    node.innerHTML = `<div class="it-state-preview-head">
        <div><b>Xem trước: ${escapeHtml(pending.fileName)}</b><br>
          <small>Xuất lúc ${escapeHtml(new Date(payload.exportedAt).toLocaleString("vi-VN"))} · mã ${escapeHtml(payload.exportId)}</small>
        </div>
        <button id="it-state-cancel" type="button">Đóng</button>
      </div>
      ${messages.length ? `<div class="it-state-messages ${validation.errors.length ? "error" : "warn"}">${messages.map(message => `<div>• ${escapeHtml(message)}</div>`).join("")}</div>` : ""}
      <div class="it-state-cards">
        <div><small>Mã tồn</small><b>${currentSummary.stockItemCount} → ${incomingSummary.stockItemCount}</b></div>
        <div><small>Đơn vị khả dụng</small><b>${formatMoney(currentSummary.availableUnitCount)} → ${formatMoney(incomingSummary.availableUnitCount)}</b></div>
        <div><small>Mã mới / thiếu</small><b>+${counts.added} · −${counts.removed}</b></div>
        <div><small>Biến động</small><b>↓${counts.decreased} · ↑${counts.increased}</b></div>
      </div>
      ${rows.length ? `<div class="it-table-wrap"><table><thead><tr><th>Mã kho</th><th>Hiện tại</th><th>File nhập</th><th>Chênh lệch</th></tr></thead>
        <tbody>${rows.map(row => `<tr><td>${escapeHtml(row.stockCode)}</td><td>${row.before == null ? "—" : formatMoney(row.before)}</td>
          <td>${row.after == null ? "—" : formatMoney(row.after)}</td><td>${row.delta > 0 ? "+" : ""}${formatMoney(row.delta)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Không có thay đổi số lượng tồn.</p>"}
      ${comparison.changes.length > rows.length ? `<small>Còn ${comparison.changes.length - rows.length} mã thay đổi khác.</small>` : ""}
      ${needsRiskConfirm && validation.valid ? `<label class="it-confirm"><input id="it-state-risk-confirm" type="checkbox"> Tôi đã kiểm tra cảnh báo và vẫn muốn dùng file này.</label>` : ""}
      <div class="it-actions"><button id="it-state-apply" type="button" class="primary" ${validation.valid && !needsRiskConfirm ? "" : "disabled"}>Xác nhận nhập trạng thái</button></div>`;
    node.querySelector("#it-state-cancel").addEventListener("click", cancelStockStateImport);
    node.querySelector("#it-state-risk-confirm")?.addEventListener("change", event => {
      node.querySelector("#it-state-apply").disabled = !event.target.checked;
    });
    node.querySelector("#it-state-apply").addEventListener("click", applyStockStateImport);
  }

  function cancelStockStateImport() {
    pendingStockStateImport = null;
    const node = document.getElementById("it-state-preview");
    if (node) node.hidden = true;
  }

  async function applyStockStateImport() {
    const pending = pendingStockStateImport;
    if (!pending?.comparison?.validation?.valid) return;
    const button = document.getElementById("it-state-apply");
    if (button) button.disabled = true;
    try {
      const nextMappingDataset = InvoiceStockState.applyToMapping(mappingDataset, pending.payload);
      const backup = InvoiceStockState.build({
        mappingDataset,
        extensionVersion,
        exportedAt: new Date().toISOString()
      });
      const importedAt = new Date().toISOString();
      await InvoiceMappingStore.importStockState(nextMappingDataset, {
        currentExportId: pending.payload.exportId,
        parentExportId: pending.payload.parentExportId || null,
        exportedAt: pending.payload.exportedAt,
        importedAt,
        sourceFile: pending.fileName,
        inventoryFingerprint: pending.payload.inventoryFingerprint
      }, backup);
      stockStateMeta = {
        schemaVersion: pending.payload.schemaVersion,
        currentExportId: pending.payload.exportId,
        parentExportId: pending.payload.parentExportId || null,
        exportedAt: pending.payload.exportedAt,
        importedAt,
        sourceFile: pending.fileName,
        inventoryFingerprint: pending.payload.inventoryFingerprint
      };
      mappingDataset = nextMappingDataset;
      refreshMappingState();
      renderPriorityRules(true);
      if (!document.getElementById("it-mapping-admin").hidden) renderMappingAdmin();
      cancelStockStateImport();
      setStatus(
        `Đã nhập số lượng tồn từ ${pending.fileName}; bản tồn trước khi nhập đã được sao lưu. ` +
        `Danh mục web, ánh xạ, sao kê, rule và sổ đối soát được giữ nguyên.`,
        "ok"
      );
    } catch (error) {
      if (button) button.disabled = false;
      setStatus(`Không áp dụng được trạng thái tồn: ${error.message}`, "error");
    }
  }

  async function importStockFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setStatus("Đang đọc file kho…", "warn");
      const stockRows = await InvoiceXlsxReader.parseStockWorkbook(file);
      mappingDataset = InvoiceMappingEngine.applyBusinessRules({
        source: file.name,
        generatedAt: new Date().toISOString(),
        mappings: InvoiceMappingEngine.mergeStockSnapshot(stockRows, webCatalog, mappingDataset.mappings)
      });
      await InvoiceMappingStore.save(mappingDataset);
      refreshMappingState();
      renderMappingAdmin();
      document.getElementById("it-mapping-admin").hidden = false;
      setMappingMode(true);
      setStatus(`Đã nhập ${stockRows.length} dòng kho. Hãy duyệt các ánh xạ chưa xác nhận.`, "ok");
    } catch (error) {
      setStatus(`Không đọc được file kho: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  }

  async function importWebFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setStatus("Đang đọc danh mục web…", "warn");
      const items = await InvoiceXlsxReader.parseWebCatalogWorkbook(file);
      catalogDataset = { source: file.name, generatedAt: new Date().toISOString(), items };
      webCatalog = items;
      const report = InvoiceMappingEngine.reconcileCatalog(mappingDataset, webCatalog);
      await Promise.all([
        InvoiceMappingStore.saveCatalog(catalogDataset),
        InvoiceMappingStore.save(mappingDataset)
      ]);
      refreshMappingState();
      if (!document.getElementById("it-mapping-admin").hidden) renderMappingAdmin();
      setStatus(`Đã nhập ${items.length} mã web; cập nhật ${report.updated} ánh xạ, ${report.missing} mã cần duyệt lại.`, report.missing ? "warn" : "ok");
    } catch (error) {
      setStatus(`Không đọc được data.xlsx: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  }

  async function importStatementFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setStatus("Đang đọc sao kê ngân hàng…", "warn");
      const parsed = await InvoiceXlsxReader.parseBankStatementWorkbook(file);
      const previous = new Map((statementDataset.transactions || []).map(item => [String(item.id), item]));
      const transactions = parsed.map(item => {
        const old = previous.get(String(item.id));
        return old ? {
          ...item,
          status: old.status,
          invoiceNo: old.invoiceNo || "",
          linkedAt: old.linkedAt || "",
          pendingPlan: old.pendingPlan || null,
          batchApprovedPlan: old.batchApprovedPlan || null,
          batchApprovedAt: old.batchApprovedAt || "",
          verifiedAt: old.verifiedAt || "",
          ledgerId: old.ledgerId || ""
        } : item;
      });
      statementDataset = { source: file.name, importedAt: new Date().toISOString(), transactions };
      await InvoiceMappingStore.saveStatement(statementDataset);
      renderStatementAdmin();
      setStatementMode(true);
      const pending = transactions.filter(item => item.status === "pending").length;
      const review = transactions.filter(item => item.status === "review").length;
      setStatus(`Đã nhập ${transactions.length} giao dịch Credit: ${pending} chờ xử lý, ${review} cần kiểm tra.`, "ok");
    } catch (error) {
      setStatus(`Không đọc được sao kê: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
  }

  function stockReservationByCode() {
    const reservations = new Map();
    for (const transaction of statementDataset.transactions || []) {
      if (!["batch_ready", "planned"].includes(transaction.status)) continue;
      const plan = transaction.pendingPlan || transaction.batchApprovedPlan;
      for (const item of plan?.items || []) {
        const code = String(item.code || "");
        if (!code) continue;
        reservations.set(code, (reservations.get(code) || 0) + Math.max(0, Math.round(Number(item.qty) || 0)));
      }
    }
    return reservations;
  }

  function stockViewRows() {
    const reservations = stockReservationByCode();
    return inventory.map(item => {
      const recordedQty = Math.max(0, Math.floor(Number(item.availableQty) || 0));
      const heldQty = item.availabilityMode === "per_invoice"
        ? 0
        : Math.min(recordedQty, Math.max(0, reservations.get(String(item.webCode)) || 0));
      return {
        ...item,
        recordedQty,
        heldQty,
        allocatableQty: item.availabilityMode === "per_invoice"
          ? recordedQty
          : Math.max(0, recordedQty - heldQty)
      };
    });
  }

  function renderStockAdmin() {
    const rows = stockViewRows();
    const heldCodes = rows.filter(item => item.heldQty > 0).length;
    const lowCodes = rows.filter(item => item.availabilityMode !== "per_invoice" && item.allocatableQty > 0 && item.allocatableQty <= 3).length;
    const outCodes = rows.filter(item => item.availabilityMode !== "per_invoice" && item.allocatableQty <= 0).length;
    const kpis = document.getElementById("it-stock-kpis");
    if (kpis) {
      kpis.innerHTML = `<div><small>Mã đủ điều kiện</small><strong>${rows.length}</strong></div>
        <div><small>Đang giữ</small><strong>${heldCodes}</strong></div>
        <div class="${lowCodes ? "warn" : ""}"><small>Sắp hết</small><strong>${lowCodes}</strong></div>
        <div class="${outCodes ? "error" : ""}"><small>Đã hết</small><strong>${outCodes}</strong></div>`;
    }
    renderStockRows();
  }

  function renderStockRows() {
    const body = document.getElementById("it-stock-body");
    if (!body) return;
    const query = InvoiceMappingEngine.normalizeText(document.getElementById("it-stock-search")?.value || "");
    const filter = document.getElementById("it-stock-filter")?.value || "all";
    const rows = stockViewRows().filter(item => {
      const searchable = InvoiceMappingEngine.normalizeText(
        `${item.webCode} ${item.webName} ${(item.stockCodes || []).join(" ")}`
      );
      if (query && !searchable.includes(query)) return false;
      if (filter === "held") return item.heldQty > 0;
      if (filter === "low") return item.availabilityMode !== "per_invoice" && item.allocatableQty > 0 && item.allocatableQty <= 3;
      if (filter === "out") return item.availabilityMode !== "per_invoice" && item.allocatableQty <= 0;
      if (filter === "per_invoice") return item.availabilityMode === "per_invoice";
      return true;
    });
    body.innerHTML = rows.map(item => `<tr class="${item.allocatableQty <= 0 && item.availabilityMode !== "per_invoice" ? "out" : item.allocatableQty <= 3 && item.availabilityMode !== "per_invoice" ? "low" : ""}">
      <td><b>${escapeHtml(item.webCode)}</b></td>
      <td title="${escapeHtml(item.webName)}">${escapeHtml(item.webName)}</td>
      <td>${escapeHtml(item.webUnit || "")}</td>
      <td class="it-money">${formatMoney(item.webPrice)}</td>
      <td class="it-qty">${item.availabilityMode === "per_invoice" ? `${item.recordedQty}/HĐ` : formatMoney(item.recordedQty)}</td>
      <td class="it-qty held">${formatMoney(item.heldQty)}</td>
      <td class="it-qty allocatable">${item.availabilityMode === "per_invoice" ? `${item.allocatableQty}/HĐ` : formatMoney(item.allocatableQty)}</td>
      <td title="${escapeHtml((item.stockCodes || []).join(", "))}">${escapeHtml((item.stockCodes || []).join(", "))}</td>
    </tr>`).join("") || '<tr><td colspan="8">Không có mặt hàng phù hợp bộ lọc.</td></tr>';
  }

  function toggleStockAdmin() {
    const node = document.getElementById("it-stock-admin");
    setStockMode(node.hidden);
  }

  function setStockMode(enabled) {
    const panel = document.getElementById("it-panel");
    const node = document.getElementById("it-stock-admin");
    if (!panel || !node) return;
    node.hidden = !enabled;
    panel.classList.toggle("stock-mode", enabled);
    panel.classList.remove("mapping-mode", "statement-mode", "batch-mode", "review-mode");
    document.getElementById("it-mapping-admin").hidden = true;
    document.getElementById("it-statement-admin").hidden = true;
    document.getElementById("it-batch-review").hidden = true;
    document.getElementById("it-manage-stock").textContent = enabled ? "Quay lại tính toán" : "Quản lý tồn kho";
    document.getElementById("it-manage-mapping").textContent = "Duyệt ánh xạ";
    document.getElementById("it-manage-statement").textContent = "Giao dịch ngân hàng";
    document.getElementById("it-manage-batch").textContent = "Batch Review";
    if (enabled) renderStockAdmin();
  }

  function toggleMappingAdmin() {
    const node = document.getElementById("it-mapping-admin");
    node.hidden = !node.hidden;
    setMappingMode(!node.hidden);
    if (!node.hidden) renderMappingAdmin();
  }

  function setMappingMode(enabled) {
    const panel = document.getElementById("it-panel");
    const button = document.getElementById("it-manage-mapping");
    if (!panel) return;
    panel.classList.toggle("mapping-mode", enabled);
    panel.classList.remove("review-mode");
    panel.classList.remove("batch-mode");
    panel.classList.remove("statement-mode");
    panel.classList.remove("stock-mode");
    document.getElementById("it-stock-admin").hidden = true;
    document.getElementById("it-statement-admin").hidden = true;
    document.getElementById("it-batch-review").hidden = true;
    if (button) button.textContent = enabled ? "Quay lại tính toán" : "Duyệt ánh xạ";
    document.getElementById("it-manage-statement").textContent = "Giao dịch ngân hàng";
    document.getElementById("it-manage-batch").textContent = "Batch Review";
    document.getElementById("it-manage-stock").textContent = "Quản lý tồn kho";
  }

  function toggleStatementAdmin() {
    const node = document.getElementById("it-statement-admin");
    setStatementMode(node.hidden);
  }

  function setStatementMode(enabled) {
    const panel = document.getElementById("it-panel");
    const node = document.getElementById("it-statement-admin");
    const button = document.getElementById("it-manage-statement");
    if (!panel || !node) return;
    node.hidden = !enabled;
    panel.classList.toggle("statement-mode", enabled);
    panel.classList.remove("review-mode");
    panel.classList.remove("batch-mode");
    panel.classList.remove("mapping-mode");
    panel.classList.remove("stock-mode");
    document.getElementById("it-stock-admin").hidden = true;
    document.getElementById("it-mapping-admin").hidden = true;
    document.getElementById("it-batch-review").hidden = true;
    if (button) button.textContent = enabled ? "Quay lại tính toán" : "Giao dịch ngân hàng";
    document.getElementById("it-manage-mapping").textContent = "Duyệt ánh xạ";
    document.getElementById("it-manage-batch").textContent = "Batch Review";
    document.getElementById("it-manage-stock").textContent = "Quản lý tồn kho";
    if (enabled) renderStatementAdmin();
  }

  function toggleBatchReview() {
    const node = document.getElementById("it-batch-review");
    const enabled = node.hidden;
    showBatchReviewMode(enabled);
    if (enabled) {
      saveBatchUiSession({ panelOpen: true }).catch(error => console.error("Không lưu được phiên Batch Review", error));
    } else {
      uiSession = null;
      pendingNewInvoice = null;
      InvoiceMappingStore.clearUiSession().catch(error => console.error("Không xóa được phiên Batch Review", error));
    }
  }

  function showBatchReviewMode(enabled, openPanel) {
    const node = document.getElementById("it-batch-review");
    const panel = document.getElementById("it-panel");
    if (!node || !panel) return;
    node.hidden = !enabled;
    panel?.classList.toggle("batch-mode", enabled);
    panel?.classList.remove("mapping-mode", "statement-mode", "review-mode", "stock-mode");
    document.getElementById("it-stock-admin").hidden = true;
    document.getElementById("it-mapping-admin").hidden = true;
    document.getElementById("it-statement-admin").hidden = true;
    document.getElementById("it-manage-mapping").textContent = "Duyệt ánh xạ";
    document.getElementById("it-manage-statement").textContent = "Giao dịch ngân hàng";
    document.getElementById("it-manage-batch").textContent = enabled ? "Quay lại tính toán" : "Batch Review";
    document.getElementById("it-manage-stock").textContent = "Quản lý tồn kho";
    if (enabled) renderBatchReview();
    if (openPanel != null) panel.hidden = !openPanel;
  }

  function pendingNewInvoiceContextHtml() {
    if (!pendingNewInvoice) return "";
    const transaction = (statementDataset.transactions || [])
      .find(item => String(item.id) === String(pendingNewInvoice.transactionId));
    const date = transaction?.transactionDate || pendingNewInvoice.transactionDate || "—";
    const credit = Number(transaction?.credit || pendingNewInvoice.credit || 0);
    const description = transaction?.description || pendingNewInvoice.description || "Không có diễn giải";
    return `<div id="it-pending-new-invoice" class="it-bank-selection">
      <b>Đang chuẩn bị phiếu mới</b><br>
      Ngày hóa đơn: <b>${escapeHtml(date)}</b> · Tổng mục tiêu: <b>${formatMoney(credit)} đ</b><br>
      <span>${escapeHtml(description)}</span><br>
      Phòng: <b id="it-pending-room">${escapeHtml(pendingNewInvoice.roomName || "đang chọn phòng rảnh…")}</b><br>
      <small>Batch Review và tab danh sách gốc vẫn được giữ nguyên. Tab mới chỉ chọn phòng không hoạt động; hãy kiểm tra rồi lưu bằng nút Lưu HĐ của website.</small>
    </div>`;
  }

  function renderBatchReview() {
    const node = document.getElementById("it-batch-review");
    if (!node) return;
    const openCount = (statementDataset.transactions || []).filter(item =>
      ["pending", "review", "planned", "batch_ready"].includes(item.status)
    ).length;
    const doneCount = (statementDataset.transactions || []).filter(item => item.status === "done").length;
    const batchFromDate = uiSession?.batchFromDate || "";
    const batchToDate = uiSession?.batchToDate || "";
    const batchLimit = Math.max(1, Math.min(50, Number(uiSession?.batchLimit) || 10));
    node.innerHTML = `<div class="it-batch-toolbar">
      <div><b>Batch Review</b><br><small>${openCount} giao dịch chưa hoàn tất · ${doneCount} đã xử lý. Hệ thống chỉ lập kế hoạch, chưa sửa hoặc lưu hóa đơn.</small></div>
      <label>Từ ngày<input id="it-batch-from-date" type="date" value="${escapeHtml(batchFromDate)}"></label>
      <label>Đến ngày<input id="it-batch-to-date" type="date" value="${escapeHtml(batchToDate)}"></label>
      <label>Số giao dịch tối đa<input id="it-batch-limit" type="number" min="1" max="50" value="${batchLimit}"></label>
      <button id="it-build-batch" type="button" class="primary">Tạo Batch Review</button>
    </div>
    ${pendingNewInvoiceContextHtml()}
    <div id="it-batch-summary"></div>
    <div id="it-batch-table"></div>`;
    node.querySelector("#it-build-batch")?.addEventListener("click", buildBatchReview);
    if (batchPlans.length) renderBatchPlans();
  }

  function renderStatementAdmin() {
    const node = document.getElementById("it-statement-admin");
    if (!node) return;
    const statementTransactions = statementDataset.transactions || [];
    const statementTotal = statementTransactions.reduce((sum, item) => sum + Number(item.credit || 0), 0);
    node.innerHTML = `<div class="it-statement-toolbar"><b>Sao kê: ${escapeHtml(statementDataset.source || "chưa nhập")}</b>
      <div class="it-statement-total"><small>Tổng tiền sao kê</small><strong>${formatMoney(statementTotal)} đ</strong><span id="it-statement-visible-total"></span></div>
      <select id="it-statement-filter"><option value="open">Chưa xử lý</option><option value="all">Tất cả</option><option value="pending">Chờ xử lý</option><option value="review">Cần kiểm tra</option><option value="done">Đã xử lý</option></select></div>
      <div class="it-table-wrap"><table><thead><tr><th>Ngày GD</th><th>Diễn giải</th><th>Credit</th><th>Trạng thái</th><th></th></tr></thead><tbody id="it-statement-body"></tbody></table></div>`;
    node.querySelector("#it-statement-filter").addEventListener("change", renderStatementRows);
    renderStatementRows();
  }

  function renderStatementRows() {
    const body = document.getElementById("it-statement-body");
    const filter = document.getElementById("it-statement-filter")?.value || "open";
    const rows = (statementDataset.transactions || []).filter(item =>
      filter === "all" || item.status === filter || (filter === "open" && ["pending", "review", "planned", "batch_ready"].includes(item.status))
    );
    const visibleTotal = rows.reduce((sum, item) => sum + Number(item.credit || 0), 0);
    const visibleSummary = document.getElementById("it-statement-visible-total");
    if (visibleSummary) visibleSummary.textContent = `Đang hiển thị: ${formatMoney(visibleTotal)} đ · ${rows.length} giao dịch`;
    const statusLabels = {
      pending: "Chờ xử lý",
      review: "Cần kiểm tra",
      batch_ready: "Đã Accept",
      planned: "Chờ đối soát",
      done: "Đã xử lý",
      skipped: "Bỏ qua",
      already_issued: "Đã có HĐ khớp",
      needs_new_invoice: "Cần tạo phiếu"
    };
    body.innerHTML = rows.map(item => `<tr data-transaction-id="${escapeHtml(item.id)}">
      <td><b>${escapeHtml(item.transactionDate)}</b><br><small>${escapeHtml(item.requestedAt)}</small></td>
      <td>${escapeHtml(item.description)}${item.reference ? `<br><small>${escapeHtml(item.reference)}</small>` : ""}</td>
      <td class="it-money">${formatMoney(item.credit)}</td><td><span class="it-bank-status ${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span></td>
      <td><button class="it-use-transaction" type="button">Chọn</button><button class="it-skip-transaction" type="button">Bỏ qua</button></td></tr>`).join("") || '<tr><td colspan="5">Không có giao dịch phù hợp.</td></tr>';
    body.querySelectorAll(".it-use-transaction").forEach(button => button.addEventListener("click", useBankTransaction));
    body.querySelectorAll(".it-skip-transaction").forEach(button => button.addEventListener("click", skipBankTransaction));
  }

  async function useBankTransaction(event) {
    const id = event.target.closest("tr").dataset.transactionId;
    currentBankTransaction = statementDataset.transactions.find(item => String(item.id) === id) || null;
    if (!currentBankTransaction) return;
    document.getElementById("it-target").value = formatMoney(currentBankTransaction.credit);
    renderPriorityRules(true);
    const selected = document.getElementById("it-bank-selection");
    selected.hidden = false;
    selected.innerHTML = `<b>Giao dịch đang chọn</b><br>Ngày hóa đơn bắt buộc: <b>${escapeHtml(currentBankTransaction.transactionDate)}</b> · Tổng tiền: <b>${formatMoney(currentBankTransaction.credit)}</b><br>${escapeHtml(currentBankTransaction.description)}<div class="it-candidate-status">Đang tìm phiếu cùng ngày…</div>`;
    setStatementMode(false);
    setStatus("Đang lọc danh sách phiếu theo ngày giao dịch ngân hàng…", "warn");
    try {
      const usedInvoiceNos = (statementDataset.transactions || [])
        .filter(item => item !== currentBankTransaction && item.invoiceNo)
        .map(item => item.invoiceNo);
      const found = await request("findInvoiceCandidates", {
        dateKey: currentBankTransaction.transactionDate,
        usedInvoiceNos
      });
      renderInvoiceCandidates(found.candidates || []);
      const available = (found.candidates || []).filter(item => item.available);
      const linkedCandidate = currentBankTransaction.invoiceNo
        ? available.find(item => String(item.invoiceNo) === String(currentBankTransaction.invoiceNo))
        : null;
      const automaticCandidate = linkedCandidate || (available.length === 1 ? available[0] : null);
      if (automaticCandidate) {
        setStatus(`${linkedCandidate ? "Đã gắn" : "Chỉ có một"} phiếu ${automaticCandidate.invoiceNo}; đang tự mở…`, "warn");
        await new Promise(resolve => setTimeout(resolve, 300));
        await openInvoiceForTransaction(automaticCandidate);
      }
      else setStatus(available.length ? `Tìm thấy ${available.length} phiếu chưa dùng cùng ngày. Hãy chọn một phiếu.` : "Không còn phiếu chưa dùng trong ngày này.", available.length ? "ok" : "error");
    } catch (error) {
      selected.querySelector(".it-candidate-status").textContent = error.message;
      setStatus(error.message, "error");
    }
  }

  function renderInvoiceCandidates(candidates) {
    const selected = document.getElementById("it-bank-selection");
    const available = candidates.filter(item => item.available);
    const used = candidates.filter(item => !item.available);
    const candidateHtml = available.map(item => `<button type="button" class="it-invoice-candidate" data-uid="${escapeHtml(item.uid)}" data-invoice-no="${escapeHtml(item.invoiceNo)}">
      <b>${escapeHtml(item.invoiceNo)}</b><span>${formatMoney(item.grandTotal)}</span></button>`).join("");
    selected.querySelector(".it-candidate-status").innerHTML = available.length
      ? `<div class="it-candidate-title">Phiếu chưa dùng cùng ngày (${available.length})</div><div class="it-candidate-list">${candidateHtml}</div>${used.length ? `<small>${used.length} phiếu đã gắn với giao dịch khác được loại khỏi danh sách.</small>` : ""}`
      : `<div>Không tìm thấy phiếu chưa dùng cùng ngày.</div>${used.length ? `<small>${used.length} phiếu đã được gắn với giao dịch khác.</small>` : ""}`;
    selected.querySelectorAll(".it-invoice-candidate").forEach(button => button.addEventListener("click", () => {
      const item = candidates.find(candidate => candidate.uid === button.dataset.uid && candidate.invoiceNo === button.dataset.invoiceNo);
      if (item) openInvoiceForTransaction(item);
    }));
  }

  async function openInvoiceForTransaction(candidate) {
    if (!currentBankTransaction || !candidate?.available) return;
    try {
      await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo: candidate.invoiceNo });
      const openedScan = await waitForOpenedInvoice(candidate.invoiceNo);
      currentBankTransaction.invoiceNo = candidate.invoiceNo;
      currentBankTransaction.linkedAt = new Date().toISOString();
      await InvoiceMappingStore.saveStatement(statementDataset);
      latestScan = openedScan;
      const selected = document.getElementById("it-bank-selection");
      const status = selected.querySelector(".it-candidate-status");
      if (status) status.innerHTML = `Đã mở và đọc phiếu <b>${escapeHtml(candidate.invoiceNo)}</b>.`;
      await scanInvoice();
      renderPostSaveVerificationControl();
      setStatus(`Đã gắn giao dịch với phiếu ${candidate.invoiceNo}. Có thể tính phương án.`, "ok");
    } catch (error) {
      currentBankTransaction.invoiceNo = "";
      currentBankTransaction.linkedAt = "";
      await InvoiceMappingStore.saveStatement(statementDataset);
      setStatus(error.message, "error");
      const status = document.querySelector("#it-bank-selection .it-candidate-status");
      if (status) status.innerHTML = `${escapeHtml(error.message)}<br>Hãy bấm lại vào phiếu để thử mở.`;
    }
  }

  async function waitForOpenedInvoice(expectedInvoiceNo) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const snapshot = await request("scan");
      if (snapshot?.ready) return snapshot;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Website chưa mở được chi tiết phiếu ${expectedInvoiceNo}.`);
  }

  function renderPostSaveVerificationControl() {
    const selected = document.getElementById("it-bank-selection");
    selected?.querySelector("#it-post-save-verification")?.remove();
    if (!selected || !currentBankTransaction) return;
    if (currentBankTransaction.status === "done") {
      selected.insertAdjacentHTML("beforeend", `<div id="it-post-save-verification" class="it-verify-box"><b>Đã đối soát và ghi sổ tồn kho.</b><br><small>${escapeHtml(currentBankTransaction.verifiedAt || "")}</small></div>`);
      return;
    }
    if (currentBankTransaction.status !== "planned" || !currentBankTransaction.pendingPlan) return;
    selected.insertAdjacentHTML("beforeend", `<div id="it-post-save-verification" class="it-verify-box">
      <b>Phương án đang chờ xác minh sau lưu</b><br>
      <small>Hãy Lưu HĐ, mở lại đúng phiếu rồi bấm nút dưới đây.</small><br>
      <button id="it-verify-saved-invoice" type="button" class="primary">Đối soát sau lưu</button>
    </div>`);
    selected.querySelector("#it-verify-saved-invoice")?.addEventListener("click", verifySavedInvoice);
  }

  function verifySnapshotAgainstPlan(snapshot, plan) {
    const errors = [];
    if (!snapshot?.ready) errors.push("Phiếu chưa sẵn sàng.");
    if (String(snapshot?.invoiceNo || "") !== String(plan.invoiceNo || "")) errors.push("Sai số phiếu.");
    if (snapshot?.invoiceDateKey !== plan.invoiceDateKey) errors.push("Sai ngày phiếu.");
    if (Math.round(Number(snapshot?.currentGoods)) !== Math.round(Number(plan.goods))) errors.push("Sai tiền hàng.");
    if (Math.round(Number(snapshot?.currentHour)) !== Math.round(Number(plan.hour))) errors.push("Sai tiền giờ.");
    if (Math.round(Number(snapshot?.currentTax)) !== Math.round(Number(plan.tax))) errors.push("Sai tiền VAT.");
    if (Math.round(Number(snapshot?.taxRate)) !== Math.round(Number(plan.taxRate))) errors.push("Sai thuế suất.");
    if (Math.round(Number(snapshot?.currentGrand)) !== Math.round(Number(plan.grand))) errors.push("Sai tổng cộng.");
    const expected = new Map((plan.items || []).map(item => [String(item.code), item]));
    const actual = new Map((snapshot?.items || []).map(item => [String(item.code), item]));
    if (expected.size !== actual.size) errors.push("Sai số dòng hàng.");
    for (const [code, item] of expected) {
      const saved = actual.get(code);
      if (!saved || Math.round(Number(saved.qty)) !== Math.round(Number(item.qty)) ||
          Math.round(Number(saved.price)) !== Math.round(Number(item.price))) {
        errors.push(`Sai mặt hàng ${code}.`);
      }
    }
    return errors;
  }

  function deductVerifiedStock(dataset, planItems) {
    const next = structuredClone(dataset);
    for (const item of planItems || []) {
      const quantity = Math.max(0, Math.round(Number(item.qty) || 0));
      if (!quantity) continue;
      const rows = (next.mappings || []).filter(row =>
        row.status === "confirmed" && String(row.webCode) === String(item.code)
      );
      if (rows.some(row => row.availabilityMode === "per_invoice")) continue;
      const stockRows = rows.filter(row => row.availabilityMode !== "per_invoice");
      const available = stockRows.reduce((sum, row) => sum + Math.max(0, Math.floor(Number(row.availableQty) || 0)), 0);
      if (available < quantity) throw new Error(`Tồn kho ${item.code} chỉ còn ${available}, không thể ghi sổ ${quantity}.`);
      let remaining = quantity;
      for (const row of stockRows) {
        const rowAvailable = Math.max(0, Math.floor(Number(row.availableQty) || 0));
        const used = Math.min(rowAvailable, remaining);
        row.availableQty = rowAvailable - used;
        remaining -= used;
        if (!remaining) break;
      }
    }
    return next;
  }

  function restoreVerifiedStock(dataset, planItems) {
    const next = structuredClone(dataset);
    for (const item of planItems || []) {
      const quantity = Math.max(0, Math.round(Number(item.qty) || 0));
      if (!quantity) continue;
      const allRows = (next.mappings || []).filter(row =>
        row.status === "confirmed" &&
        String(row.webCode) === String(item.code)
      );
      if (allRows.some(row => row.availabilityMode === "per_invoice")) continue;
      const rows = allRows.filter(row => row.availabilityMode !== "per_invoice");
      if (!rows.length) {
        throw new Error(`Không còn ánh xạ kho cho mã ${item.code}; chưa thể hoàn số lượng cũ.`);
      }
      // Older ledger entries only store totals by web code, not the original
      // allocation between duplicate stock codes. Returning to the first
      // confirmed mapping preserves the correct aggregate stock. Every new
      // verification records the latest plan for future reconciliation.
      rows[0].availableQty = Math.max(0, Math.floor(Number(rows[0].availableQty) || 0)) + quantity;
    }
    return next;
  }

  async function verifySavedInvoice() {
    if (!currentBankTransaction?.pendingPlan) return setStatus("Không có phương án chờ đối soát.", "error");
    const button = document.getElementById("it-verify-saved-invoice");
    try {
      if (button) button.disabled = true;
      setStatus("Đang đọc lại phiếu đã lưu và đối soát…", "warn");
      const snapshot = await request("scan");
      const plan = currentBankTransaction.pendingPlan;
      const errors = verifySnapshotAgainstPlan(snapshot, plan);
      if (errors.length) throw new Error(errors.join(" "));
      const transactionId = String(currentBankTransaction.id);
      const existing = (verificationLedger.entries || []).find(entry => String(entry.transactionId) === transactionId);
      const restoredMapping = existing
        ? restoreVerifiedStock(mappingDataset, existing.items)
        : mappingDataset;
      const nextMapping = deductVerifiedStock(restoredMapping, plan.items);
      const ledgerEntry = {
        id: existing?.id || `ledger-${transactionId}`,
        transactionId,
        invoiceNo: plan.invoiceNo,
        verifiedAt: new Date().toISOString(),
        grand: plan.grand,
        items: structuredClone(plan.items),
        revision: Math.max(1, Math.floor(Number(existing?.revision) || 1) + (existing ? 1 : 0))
      };
      const nextLedger = {
        entries: existing
          ? (verificationLedger.entries || []).map(entry =>
            String(entry.transactionId) === transactionId ? ledgerEntry : entry)
          : [...(verificationLedger.entries || []), ledgerEntry]
      };
      const nextStatement = structuredClone(statementDataset);
      const nextTransaction = (nextStatement.transactions || []).find(item => String(item.id) === transactionId);
      if (!nextTransaction) throw new Error("Không tìm thấy giao dịch trong sao kê để ghi nhận.");
      nextTransaction.status = "done";
      nextTransaction.verifiedAt = ledgerEntry.verifiedAt;
      nextTransaction.ledgerId = ledgerEntry.id;
      nextTransaction.pendingPlan = null;
      await InvoiceMappingStore.commitVerifiedInvoice(nextMapping, nextStatement, nextLedger);
      mappingDataset = nextMapping;
      statementDataset = nextStatement;
      verificationLedger = nextLedger;
      currentBankTransaction = nextTransaction;
      const batchChanged = syncBatchPlanTransaction(nextTransaction);
      refreshMappingState();
      renderPostSaveVerificationControl();
      renderStatementRows();
      if (batchChanged) {
        renderBatchPlans();
        saveBatchUiSession({ panelOpen: !document.getElementById("it-panel")?.hidden })
          .catch(error => console.error("Không lưu được trạng thái Batch Review sau đối soát", error));
      }
      setStatus(existing
        ? `Đã tái đối soát phiếu ${plan.invoiceNo}: hoàn phương án cũ và ghi sổ phương án mới.`
        : `Đã đối soát phiếu ${plan.invoiceNo}, đánh dấu sao kê đã xử lý và ghi sổ tồn kho.`, "ok");
    } catch (error) {
      setStatus(`Đối soát thất bại: ${error.message} Chưa thay đổi tồn kho hoặc trạng thái sao kê.`, "error");
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function skipBankTransaction(event) {
    const id = event.target.closest("tr").dataset.transactionId;
    const item = statementDataset.transactions.find(transaction => String(transaction.id) === id);
    if (!item) return;
    item.status = "ignored";
    await InvoiceMappingStore.saveStatement(statementDataset);
    renderStatementRows();
  }

  function optionHtml(item, selectedCode) {
    return `<option value="${escapeHtml(item.webCode)}" ${String(item.webCode) === String(selectedCode) ? "selected" : ""}>` +
      `${escapeHtml(item.webCode)} — ${escapeHtml(item.webName)} — ${formatMoney(item.webPrice)}</option>`;
  }

  function webSearchValue(item) {
    return `${item.webCode} | ${item.webName} | ${formatMoney(item.webPrice)}đ`;
  }

  function renderMappingAdmin() {
    const node = document.getElementById("it-mapping-admin");
    if (!node) return;
    node.innerHTML = `<div class="it-mapping-toolbar"><b>Ánh xạ kho → web</b>
      <select id="it-mapping-filter"><option value="pending">Cần xử lý</option><option value="all">Tất cả</option><option value="confirmed">Đã xác nhận</option></select>
      <button id="it-export-mapping" type="button">Xuất JSON</button></div>
      <datalist id="it-web-options">${webCatalog.map(item => `<option value="${escapeHtml(webSearchValue(item))}"></option>`).join("")}</datalist>
      <div class="it-table-wrap"><table><thead><tr><th>Kho</th><th>Tồn</th><th>Sản phẩm web</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody id="it-mapping-body"></tbody></table></div>`;
    node.querySelector("#it-mapping-filter").addEventListener("change", renderMappingRows);
    node.querySelector("#it-export-mapping").addEventListener("click", exportMapping);
    renderMappingRows();
  }

  function renderMappingRows() {
    const body = document.getElementById("it-mapping-body");
    const filter = document.getElementById("it-mapping-filter")?.value || "pending";
    const rows = (mappingDataset.mappings || []).filter(row =>
      filter === "all" || row.status === filter || (filter === "pending" && !["confirmed", "disabled"].includes(row.status))
    );
    body.innerHTML = rows.map(row => {
      const currentWeb = webCatalog.find(item => String(item.webCode) === String(row.webCode));
      return `<tr data-stock-code="${escapeHtml(row.stockCode)}"><td><b>${escapeHtml(row.stockCode)}</b><br>${escapeHtml(row.stockName)}</td>
        <td>${row.availableQty}</td><td><input class="it-web-search" list="it-web-options" value="${escapeHtml(currentWeb ? webSearchValue(currentWeb) : "")}" placeholder="Gõ mã, tên hoặc giá sản phẩm…"></td>
        <td>${escapeHtml(row.status)}<br>${Number(row.confidence || 0).toFixed(1)}</td>
        <td><button class="it-confirm-map" type="button">Xác nhận</button><button class="it-disable-map" type="button">Bỏ</button></td></tr>`;
    }).join("") || '<tr><td colspan="5">Không có dòng cần xử lý.</td></tr>';
    body.querySelectorAll(".it-confirm-map").forEach(button => button.addEventListener("click", confirmMapping));
    body.querySelectorAll(".it-disable-map").forEach(button => button.addEventListener("click", disableMapping));
  }

  async function confirmMapping(event) {
    const tr = event.target.closest("tr");
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === tr.dataset.stockCode);
    const selectedValue = tr.querySelector(".it-web-search").value;
    const selectedCode = selectedValue.split("|")[0].trim();
    const web = webCatalog.find(item => String(item.webCode) === selectedCode);
    if (!row || !web) return setStatus("Hãy chọn một sản phẩm web trước khi xác nhận.", "error");
    Object.assign(row, web, { status: "confirmed", confirmedAt: new Date().toISOString() });
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    renderMappingRows();
    setStatus(`Đã xác nhận ${row.stockCode} → ${web.webCode}.`, "ok");
  }

  async function disableMapping(event) {
    const stockCode = event.target.closest("tr").dataset.stockCode;
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === stockCode);
    if (!row) return;
    row.status = "disabled";
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    renderMappingRows();
  }

  function exportMapping() {
    const blob = new Blob([JSON.stringify(mappingDataset, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `invoice-mapping-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function scanInvoice() {
    try {
      latestScan = await request("scan");
      document.getElementById("it-result").innerHTML = "";
      if (!latestScan.ready) {
        setStatus(latestScan.reason || "Chưa mở phiếu.", "error");
        document.getElementById("it-summary").innerHTML = "";
        return;
      }
      setStatus(`Đã đọc ${latestScan.items.length} dòng cũ; các dòng này không phải nguồn tồn.`, "ok");
      document.getElementById("it-target").value = formatMoney(latestScan.currentGrand);
      if (currentBankTransaction) document.getElementById("it-target").value = formatMoney(currentBankTransaction.credit);
      renderPriorityRules(true);
      document.getElementById("it-summary").innerHTML = `<dl><dt>Số phiếu</dt><dd>${escapeHtml(latestScan.invoiceNo || "—")}</dd>
        <dt>Tiền hàng</dt><dd>${formatMoney(latestScan.currentGoods)}</dd><dt>Tiền giờ</dt><dd>${formatMoney(latestScan.currentHour)}</dd>
        <dt>Thuế</dt><dd>${latestScan.taxRate}%</dd><dt>Tổng hiện tại</dt><dd>${formatMoney(latestScan.currentGrand)}</dd></dl>`;
    } catch (error) { setStatus(error.message, "error"); }
  }

  function preferredLineCount(goodsTarget) {
    return Math.max(3, Math.min(6, Math.round(Number(goodsTarget || 0) / 350000) + 1));
  }

  function candidateFromStock(stock, minQty, selectionPenalty, ruleMaxQty) {
    const stockQty = Math.max(0, Math.floor(Number(stock.availableQty) || 0));
    const invoiceLimit = InvoiceTargetSolver.recommendInvoiceLimit(stock);
    const configuredMax = Number.isFinite(Number(ruleMaxQty)) && Number(ruleMaxQty) > 0
      ? Math.floor(Number(ruleMaxQty))
      : Number.POSITIVE_INFINITY;
    return {
      code: stock.webCode,
      name: stock.webName,
      unit: stock.webUnit,
      price: Number(stock.webPrice),
      qty: 0,
      stockQty,
      invoiceLimit,
      maxQty: Math.min(stockQty, invoiceLimit, configuredMax),
      stockCodes: stock.stockCodes,
      minQty: Number(minQty || 0),
      selectionPenalty: Math.max(0, Number(selectionPenalty) || 0),
      constraintGroup: stock.constraintGroup,
      constraintGroupMax: stock.constraintGroupMax
    };
  }

  function buildCandidates() {
    const selectedRules = priorityRules.filter(rule => prioritySelections.get(String(rule.id)) === true);
    return inventory.map(stock => {
      const rules = selectedRules.filter(rule => String(rule.webCode) === String(stock.webCode));
      const minQty = rules.reduce((maximum, rule) => Math.max(maximum, Number(rule.minQty || 1)), 0);
      const maxQty = rules.length
        ? rules.reduce((minimum, rule) => Math.min(minimum, Number(rule.maxQty || rule.minQty || 1)), Number.POSITIVE_INFINITY)
        : undefined;
      return candidateFromStock(stock, minQty, 0, maxQty);
    }).sort((a, b) => Number(b.minQty || 0) - Number(a.minQty || 0));
  }

  function stableDiversityRank(seed, code) {
    const text = `${String(seed || "")}|${String(code || "")}`;
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function addPlanProductUsage(productUsage, items) {
    for (const item of items || []) {
      if (Number(item.qty ?? item.newQty) <= 0) continue;
      const code = String(item.code || "");
      if (!code) continue;
      productUsage.set(code, (productUsage.get(code) || 0) + 1);
    }
    return productUsage;
  }

  function buildBatchCandidates(inventoryState, target, transaction, productUsage) {
    const eligibleRules = priorityRules
      .filter(rule => rule.enabled !== false && target > Number(rule.minTotal || 0) &&
        inventoryState.some(item => String(item.webCode) === String(rule.webCode) && Number(item.availableQty) > 0));
    const requiredRules = eligibleRules.filter(rule => rule.mode === "required");
    const rotatingRule = eligibleRules
      .filter(rule => rule.mode !== "required")
      .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))[0];
    const activeRules = rotatingRule ? [...requiredRules, rotatingRule] : requiredRules;
    const seed = `${transaction?.id || ""}|${transaction?.transactionDate || ""}|${transaction?.credit || target}|${transaction?.recalculationNonce || 0}`;
    const rejectedCodes = new Set((transaction?.lastRejectedBatchPlan?.items || [])
      .map(item => String(item.code || ""))
      .filter(Boolean));
    return inventoryState.map(stock => {
      const code = String(stock.webCode);
      const priorUseCount = Number(productUsage?.get(code) || 0);
      const rotation = stableDiversityRank(seed, code) % 20;
      const rules = activeRules.filter(rule => String(rule.webCode) === code);
      const minQty = rules.reduce((maximum, rule) => Math.max(maximum, Number(rule.minQty || 1)), 0);
      const maxQty = rules.length
        ? rules.reduce((minimum, rule) => Math.min(minimum, Number(rule.maxQty || rule.minQty || 1)), Number.POSITIVE_INFINITY)
        : undefined;
      return candidateFromStock(
        stock,
        minQty,
        priorUseCount * 30 + rotation + (rejectedCodes.has(code) ? 200 : 0),
        maxQty
      );
    }).sort((a, b) =>
      Number(b.minQty || 0) - Number(a.minQty || 0) ||
      Number(a.selectionPenalty || 0) - Number(b.selectionPenalty || 0) ||
      String(a.code).localeCompare(String(b.code))
    );
  }

  function calculateBatchPlan(scan, transaction, inventoryState, productUsage) {
    if (!scan?.ready) return { status: "error", reason: "Không đọc được chi tiết phiếu." };
    if (scan.invoiceDateKey !== transaction.transactionDate) return { status: "error", reason: "Ngày phiếu không khớp sao kê." };
    const targetGrand = Math.round(Number(transaction.credit) || 0);
    const unavailableRequired = priorityRules.find(rule =>
      rule.enabled !== false &&
      rule.mode === "required" &&
      targetGrand > Number(rule.minTotal || 0) &&
      !inventoryState.some(item =>
        String(item.webCode) === String(rule.webCode) &&
        Number(item.availableQty) >= Number(rule.minQty || 1)
      )
    );
    if (unavailableRequired) {
      return {
        status: "error",
        reason: `Rule bắt buộc ${unavailableRequired.code || unavailableRequired.webCode} cần ${Number(unavailableRequired.minQty || 1)} nhưng tồn kho không đủ.`
      };
    }
    const targets = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, scan.currentHour, scan.taxRate);
    const hourPricing = scan.newInvoicePlanning
      ? { hourlyRate: 600000, hourStep: 6000 }
      : inferHourPricing(scan);
    const candidates = buildBatchCandidates(inventoryState, targetGrand, transaction, productUsage);
    const solution = InvoiceTargetSolver.solveQuantities(candidates, targets.goodsTarget, {
      maxQty: 20,
      tolerance: 0,
      preTaxTarget: targets.preTaxTarget,
      currentHour: scan.currentHour,
      hourStep: hourPricing.hourStep,
      preferredLineCount: Math.max(3, Math.min(6, Math.round(Number(targets.goodsTarget || 0) / 350000) + 1)),
      maxActiveLines: 6
    });
    if (!solution.items) return { status: "error", reason: solution.reason || "Không tìm được phương án." };
    const selected = solution.items.filter(item => item.newQty > 0);
    const reconciledHour = InvoiceTargetSolver.reconcileHourAmount(
      solution.actual,
      targets.preTaxTarget,
      solution.hourActual
    );
    const { hourFromTime, finalHourAmount, hourAdjustment } = reconciledHour;
    // Website time is rounded to 0.01 hour, but accounting requires the
    // invoice to match the bank amount exactly without using a discount.
    // Keep the checkout suggestion based on the rounded time and absorb the
    // remaining few dong directly into the hour amount.
    const predictedGrand = solution.actual + finalHourAmount + targets.vatTarget;
    const difference = predictedGrand - targetGrand;
    if (!selected.length) {
      return { status: "error", reason: "Không tìm được mặt hàng phù hợp để lập phương án; chưa được tạo hóa đơn chỉ có Tiền giờ." };
    }
    if (difference !== 0) {
      return { status: "error", reason: `Phương án chưa khớp tuyệt đối; lệch ${formatMoney(difference)}.` };
    }
    return {
      status: "ready",
      invoiceNo: scan.invoiceNo,
      invoiceDateKey: scan.invoiceDateKey,
      targetGrand,
      currentGrand: scan.currentGrand,
      goods: solution.actual,
      hour: finalHourAmount,
      hourFromTime,
      hourAdjustment,
      tax: targets.vatTarget,
      taxRate: 10,
      difference,
      proposedCheckOut: recommendCheckOut(scan, hourFromTime, hourPricing.hourlyRate),
      items: selected.map(item => ({
        code: String(item.code),
        name: item.name,
        qty: Math.round(Number(item.newQty)),
        price: Math.round(Number(item.price)),
        maxQty: Math.floor(Number(item.maxQty)),
        stockQty: Math.floor(Number(item.stockQty)),
        invoiceLimit: Math.floor(Number(item.invoiceLimit))
      }))
    };
  }

  function newInvoicePlanningScan(transactionDate) {
    const match = String(transactionDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const checkIn = match ? `${match[3]}/${match[2]}/${match[1]} 15:00` : "";
    return {
      ready: true,
      newInvoicePlanning: true,
      invoiceNo: "",
      invoiceDateKey: String(transactionDate || ""),
      currentGoods: 0,
      currentHour: 0,
      currentTax: 0,
      taxRate: 10,
      currentGrand: 0,
      checkIn,
      checkOut: checkIn,
      durationMinutes: 1,
      items: []
    };
  }

  function calculateNewInvoiceBatchPlan(transaction, inventoryState, productUsage) {
    const planningScan = newInvoicePlanningScan(transaction.transactionDate);
    const plan = calculateBatchPlan(planningScan, transaction, inventoryState, productUsage);
    if (plan.status !== "ready") return plan;
    const checkInDate = parseUiDateTime(planningScan.checkIn);
    const estimatedMinutes = Math.max(1, Math.round((Number(plan.hourFromTime || 0) / 600000) * 60));
    const checkOutDate = checkInDate ? new Date(checkInDate.getTime() + estimatedMinutes * 60000) : null;
    return {
      ...plan,
      requiresNewInvoice: true,
      checkIn: planningScan.checkIn,
      checkOut: formatUiDateTime(checkOutDate),
      proposedCheckOut: formatUiDateTime(checkOutDate)
    };
  }

  function reserveBatchStock(inventoryState, items) {
    const next = structuredClone(inventoryState);
    for (const item of items || []) {
      const stock = next.find(row => String(row.webCode) === String(item.code));
      if (!stock || stock.availabilityMode === "per_invoice") continue;
      stock.availableQty = Math.max(0, Math.floor(Number(stock.availableQty)) - Math.round(Number(item.qty)));
    }
    return next;
  }

  function reserveOutstandingBatchStock(inventoryState, transactions, excludedTransactionIds) {
    const excluded = new Set((excludedTransactionIds || []).map(String));
    let next = structuredClone(inventoryState);
    for (const transaction of transactions || []) {
      if (excluded.has(String(transaction.id)) ||
          !["batch_ready", "planned"].includes(transaction.status)) continue;
      const plan = transaction.pendingPlan || transaction.batchApprovedPlan;
      if (Array.isArray(plan?.items)) next = reserveBatchStock(next, plan.items);
    }
    return next;
  }

  function selectClosestInvoiceCandidate(candidates, targetAmount) {
    const target = Number(targetAmount) || 0;
    const distance = candidate => {
      const total = Number(candidate?.grandTotal);
      return Number.isFinite(total) ? Math.abs(total - target) : Number.POSITIVE_INFINITY;
    };
    return [...(candidates || [])].sort((left, right) =>
      distance(left) - distance(right) ||
      String(left?.invoiceNo || "").localeCompare(String(right?.invoiceNo || ""), "vi", {
        numeric: true,
        sensitivity: "base"
      })
    )[0] || null;
  }

  function selectBatchReviewTransactions(transactions, options) {
    const fromDate = String(options?.fromDate || "");
    const toDate = String(options?.toDate || "");
    const limit = Math.max(1, Math.min(50, Number(options?.limit) || 10));
    const allowedStatuses = new Set(["pending", "review", "planned", "batch_ready", "done"]);
    return (transactions || []).filter(item => {
      if (!allowedStatuses.has(item.status)) return false;
      const transactionDate = String(item.transactionDate || "");
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      return true;
    }).slice(0, limit);
  }

  async function buildBatchReview() {
    const button = document.getElementById("it-build-batch");
    const summary = document.getElementById("it-batch-summary");
    try {
      if (button) button.disabled = true;
      const current = await request("scan");
      if (current?.ready) throw new Error("Hãy bấm Thoát để đóng phiếu đang mở trước khi tạo Batch Review.");
      const limit = Math.max(1, Math.min(50, Number(document.getElementById("it-batch-limit")?.value) || 10));
      const fromDate = document.getElementById("it-batch-from-date")?.value || "";
      const toDate = document.getElementById("it-batch-to-date")?.value || "";
      if (fromDate && toDate && fromDate > toDate) throw new Error("Từ ngày không được lớn hơn Đến ngày.");
      const transactions = selectBatchReviewTransactions(statementDataset.transactions, { fromDate, toDate, limit });
      if (!transactions.length) throw new Error("Không có giao dịch nào trong khoảng ngày đã chọn.");
      batchPlans = [];
      const table = document.getElementById("it-batch-table");
      if (table) table.innerHTML = "";
      const selectedTransactionIds = transactions.map(item => String(item.id));
      // Reservations are global, not limited to the date range or row limit
      // currently shown in Batch Review. Reserve accepted/planned rows outside
      // this selection first; selected rows are reserved while iterating below.
      let workingInventory = reserveOutstandingBatchStock(
        inventory,
        statementDataset.transactions,
        selectedTransactionIds
      );
      const productUsage = new Map();
      const usedInvoiceNos = new Set((statementDataset.transactions || [])
        .filter(item => ["done", "planned", "batch_ready"].includes(item.status) && item.invoiceNo)
        .map(item => String(item.invoiceNo)));
      for (let index = 0; index < transactions.length; index += 1) {
        const transaction = transactions[index];
        if (summary) summary.textContent = `Đang tính ${index + 1}/${transactions.length}: ${transaction.transactionDate} · ${formatMoney(transaction.credit)}`;
        if (transaction.status === "done") {
          addPlanProductUsage(productUsage, transaction.batchApprovedPlan?.items);
          batchPlans.push({
            transactionId: String(transaction.id),
            status: "done",
            transaction,
            plan: transaction.batchApprovedPlan || {
              invoiceNo: transaction.invoiceNo || "",
              targetGrand: Number(transaction.credit || 0)
            },
            reason: transaction.reconciledNote || (transaction.verifiedAt
              ? `Đã đối soát lúc ${transaction.verifiedAt}.`
              : "Giao dịch đã được đánh dấu xử lý.")
          });
          continue;
        }
        if (transaction.status === "planned" && transaction.pendingPlan) {
          batchPlans.push({ transactionId: String(transaction.id), status: "planned", transaction, plan: transaction.pendingPlan });
          addPlanProductUsage(productUsage, transaction.pendingPlan.items);
          workingInventory = reserveBatchStock(workingInventory, transaction.pendingPlan.items);
          usedInvoiceNos.add(String(transaction.invoiceNo || transaction.pendingPlan.invoiceNo));
          continue;
        }
        if (transaction.status === "batch_ready" && transaction.batchApprovedPlan) {
          batchPlans.push({ transactionId: String(transaction.id), status: "batch_ready", transaction, plan: transaction.batchApprovedPlan });
          addPlanProductUsage(productUsage, transaction.batchApprovedPlan.items);
          workingInventory = reserveBatchStock(workingInventory, transaction.batchApprovedPlan.items);
          usedInvoiceNos.add(String(transaction.invoiceNo || transaction.batchApprovedPlan.invoiceNo));
          continue;
        }
        const found = await request("findInvoiceCandidates", {
          dateKey: transaction.transactionDate,
          usedInvoiceNos: [...usedInvoiceNos].filter(invoiceNo => invoiceNo !== String(transaction.invoiceNo || ""))
        });
        const available = (found.candidates || []).filter(item => item.available);
        const linkedCandidate = transaction.invoiceNo
          ? available.find(item => String(item.invoiceNo) === String(transaction.invoiceNo))
          : null;
        const candidate = linkedCandidate || selectClosestInvoiceCandidate(available, transaction.credit);
        const automaticallySelected = !linkedCandidate && available.length > 1 && candidate;
        const automaticSelectionReason = automaticallySelected
          ? `Tự chọn ${candidate.invoiceNo} gần tiền sao kê nhất trong ${available.length} phiếu cùng ngày ` +
            `(chênh ${formatMoney(Math.abs(Number(candidate.grandTotal || 0) - Number(transaction.credit || 0)))}đ).`
          : "";
        if (!candidate) {
          // Không còn phiếu chưa xuất: dò trong các phiếu ĐÃ xuất xem giao dịch đã được lập HĐ khớp tiền chưa.
          let issued = null;
          try {
            issued = await request("findIssuedInvoiceByAmount", {
              dateKey: transaction.transactionDate,
              amount: transaction.credit
            });
          } catch (error) {
            batchPlans.push({
              transactionId: String(transaction.id),
              status: "lookup_error",
              transaction,
              reason: `Không dò được hóa đơn đã xuất: ${error.message} Hãy thử lại; chưa được tạo phiếu mới.`
            });
            continue;
          }
          const issuedMatches = (issued.matches || []).filter(row => !usedInvoiceNos.has(String(row.invoiceNo)));
          if (issuedMatches.length) {
            batchPlans.push({
              transactionId: String(transaction.id),
              status: "already_issued",
              transaction,
              candidates: issuedMatches,
              plan: {
                invoiceNo: issuedMatches.length === 1 ? issuedMatches[0].invoiceNo : "",
                grand: transaction.credit
              },
              reason: issuedMatches.length === 1
                ? `Đã có HĐ ${issuedMatches[0].invoiceNo} khớp ${formatMoney(transaction.credit)}đ. Kiểm tra rồi xác nhận.`
                : `Có ${issuedMatches.length} HĐ đã xuất khớp số tiền; chọn đúng phiếu rồi xác nhận.`
            });
          } else {
            const plan = calculateNewInvoiceBatchPlan(transaction, workingInventory, productUsage);
            batchPlans.push({
              transactionId: String(transaction.id),
              status: plan.status === "ready" ? "ready" : "needs_new_invoice",
              transaction,
              plan,
              candidates: available,
              reason: plan.status === "ready"
                ? "Đã tính sẵn phương án từ tồn kho cho phiếu mới. Accept để giữ phương án rồi mở tab Bán hàng."
                : `Cần tạo phiếu mới nhưng chưa tính được phương án: ${plan.reason || "không rõ lỗi"}.`
            });
            if (plan.status === "ready") {
              workingInventory = reserveBatchStock(workingInventory, plan.items);
              addPlanProductUsage(productUsage, plan.items);
            }
          }
          continue;
        }
        let opened = false;
        try {
          usedInvoiceNos.add(String(candidate.invoiceNo));
          await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo: candidate.invoiceNo });
          opened = true;
          const scan = await waitForOpenedInvoice(candidate.invoiceNo);
          const plan = calculateBatchPlan(scan, transaction, workingInventory, productUsage);
          batchPlans.push({
            transactionId: String(transaction.id),
            status: plan.status,
            transaction,
            plan,
            candidates: available,
            reason: plan.reason || automaticSelectionReason
          });
          if (plan.status === "ready") {
            workingInventory = reserveBatchStock(workingInventory, plan.items);
            addPlanProductUsage(productUsage, plan.items);
          }
        } catch (error) {
          batchPlans.push({
            transactionId: String(transaction.id),
            status: "error",
            transaction,
            reason: `Không đọc được phiếu ${candidate.invoiceNo}: ${error.message}`
          });
        } finally {
          if (opened) {
            try { await request("closeInvoiceDetail"); } catch (_) {}
            await new Promise(resolve => setTimeout(resolve, 450));
          }
        }
      }
      if (pendingNewInvoice) {
        const pendingEntry = batchPlans.find(entry => String(entry.transactionId) === String(pendingNewInvoice.transactionId));
        if (pendingEntry && pendingEntry.status !== "needs_new_invoice" && pendingEntry.status !== "lookup_error") {
          pendingNewInvoice = null;
          document.getElementById("it-pending-new-invoice")?.remove();
        }
      }
      renderBatchPlans();
      await saveBatchUiSession({ panelOpen: true });
      setStatus("Đã tạo Batch Review. Chưa có hóa đơn nào bị sửa hoặc lưu.", "ok");
    } catch (error) {
      if (summary) summary.textContent = error.message;
      setStatus(error.message, "error");
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  function renderBatchPlans() {
    const summary = document.getElementById("it-batch-summary");
    const table = document.getElementById("it-batch-table");
    if (!summary || !table) return;
    const ready = batchPlans.filter(item => item.status === "ready");
    const planned = batchPlans.filter(item => ["planned", "batch_ready"].includes(item.status));
    const alreadyIssued = batchPlans.filter(item => item.status === "already_issued");
    const needNew = batchPlans.filter(item => item.status === "needs_new_invoice");
    const done = batchPlans.filter(item => item.status === "done");
    const issues = batchPlans.length - ready.length - planned.length - alreadyIssued.length - needNew.length - done.length;
    const readyTotal = ready.reduce((sum, item) => sum + Number(item.plan.targetGrand || 0), 0);
    summary.innerHTML = `<div class="it-batch-kpis">
      <div><small>Tổng giao dịch</small><strong>${batchPlans.length}</strong></div>
      <div class="ok"><small>Sẵn sàng duyệt</small><strong>${ready.length}</strong></div>
      <div><small>Đã có phương án</small><strong>${planned.length}</strong></div>
      <div class="ok"><small>Đã có HĐ khớp</small><strong>${alreadyIssued.length + done.length}</strong></div>
      <div><small>Cần tạo phiếu</small><strong>${needNew.length}</strong></div>
      <div class="${issues ? "error" : "ok"}"><small>Cần xử lý</small><strong>${issues}</strong></div>
      <div><small>Tổng sẵn sàng</small><strong>${formatMoney(readyTotal)}</strong></div>
    </div>`;
    const rows = batchPlans.map((entry, index) => {
      const plan = entry.plan || {};
      const statusLabel = {
        ready: "Sẵn sàng",
        planned: "Chờ lưu/đối soát",
        batch_ready: "Đã Accept",
        needs_choice: "Cần chọn phiếu",
        already_issued: "Đã có HĐ khớp",
        needs_new_invoice: "Cần tạo phiếu",
        lookup_error: "Lỗi dò hóa đơn",
        done: "Đã xử lý",
        error: "Lỗi"
      }[entry.status] || entry.status;
      const itemDetails = (plan.items || []).map(item =>
        `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name || "")}</td><td>${item.qty}</td><td>${formatMoney(item.price)}</td><td>${item.stockQty ?? item.maxQty ?? "—"}</td><td>${item.maxQty ?? "—"}</td></tr>`
      ).join("");
      return `<tr class="it-batch-row ${escapeHtml(entry.status)}">
        <td><input class="it-batch-select" type="checkbox" data-index="${index}" ${entry.status === "ready" ? "checked" : "disabled"}></td>
        <td class="it-batch-transaction"><b>${escapeHtml(entry.transaction.transactionDate)}</b><small title="${escapeHtml(entry.transaction.description || "")}">${escapeHtml(entry.transaction.description || "")}</small></td>
        <td>${escapeHtml(plan.invoiceNo || entry.transaction.invoiceNo || "—")}</td>
        <td class="it-money">${formatMoney(entry.transaction.credit)}</td>
        <td class="it-money">${plan.goods == null ? "—" : formatMoney(plan.goods)}</td>
        <td class="it-money">${plan.hour == null ? "—" : formatMoney(plan.hour)}</td>
        <td class="it-money">${plan.tax == null ? "—" : formatMoney(plan.tax)}</td>
        <td><span class="it-batch-status ${escapeHtml(entry.status)}">${statusLabel}</span>
          ${entry.reason ? `<br><small>${escapeHtml(entry.reason)}</small>` : ""}
          ${entry.status === "needs_choice" && (entry.candidates || []).length ? `<br><select class="it-unissued-choice" data-index="${index}">
            <option value="">— Chọn phiếu chưa xuất —</option>
            ${(entry.candidates || []).map(candidate => `<option value="${escapeHtml(candidate.invoiceNo)}">${escapeHtml(candidate.invoiceNo)} · ${formatMoney(candidate.grandTotal)}</option>`).join("")}
          </select>` : ""}
          ${entry.status === "already_issued" && (entry.candidates || []).length > 1 ? `<br><select class="it-issued-choice" data-index="${index}">
            <option value="">— Chọn HĐ đã xuất —</option>
            ${(entry.candidates || []).map(candidate => `<option value="${escapeHtml(candidate.invoiceNo)}" ${String(candidate.invoiceNo) === String(entry.plan?.invoiceNo || "") ? "selected" : ""}>${escapeHtml(candidate.invoiceNo)} · ${formatMoney(candidate.grandTotal)}</option>`).join("")}
          </select>` : ""}
          ${entry.status === "already_issued" && entry.plan?.invoiceNo ? `<br><button class="it-confirm-issued" type="button" data-index="${index}">Xác nhận đã có HĐ ${escapeHtml(entry.plan.invoiceNo)}</button>` : ""}
          ${entry.status === "needs_new_invoice" ? `<br><button class="it-open-pos" type="button" data-index="${index}">Mở tab Bán hàng mới để tạo phiếu</button>` : ""}
          ${entry.status === "batch_ready" && plan.requiresNewInvoice ? `<br><button class="it-open-pos" type="button" data-index="${index}">Mở tab Bán hàng mới để tạo phiếu từ phương án đã Accept</button>` : ""}
          ${["batch_ready", "planned"].includes(entry.status) && !plan.requiresNewInvoice
            ? `<br><button class="it-apply-accepted" type="button" data-index="${index}">${entry.status === "planned" ? "Mở và áp dụng lại phương án" : "Mở và áp dụng phương án"}</button>`
            : ""}
          ${["batch_ready", "planned"].includes(entry.status)
            ? `<br><button class="it-recalculate-accepted" type="button" data-index="${index}" title="${entry.status === "planned" ? "Bỏ dữ liệu đang chờ lưu trên form, hoàn reservation và tính phương án khác" : "Bỏ phương án hiện tại, hoàn reservation tồn kho và tính một tổ hợp khác"}">Tính toán lại</button>`
            : ""}
          ${entry.status === "planned" && !plan.requiresNewInvoice
            ? `<br><button class="it-verify-batch" type="button" data-index="${index}">Đối soát sau lưu</button>`
            : ""}
          ${entry.status === "lookup_error" ? `<br><button class="it-retry-batch" type="button">Thử dò lại</button>` : ""}
        </td>
        <td>${itemDetails ? `<details><summary>${plan.items.length} mã</summary><table><thead><tr><th>Mã</th><th>Tên</th><th>SL</th><th>Giá</th><th>Tồn trước</th><th>Giới hạn/HĐ</th></tr></thead><tbody>${itemDetails}</tbody></table></details>` : "—"}</td>
      </tr>`;
    }).join("");
    table.innerHTML = `<div class="it-batch-actions">
      <label><input id="it-batch-select-all" type="checkbox" checked> Chọn tất cả phương án sẵn sàng</label>
      <button id="it-approve-batch" type="button" class="primary" ${ready.length ? "" : "disabled"}>Accept các phương án đã chọn</button>
    </div>
    <div class="it-table-wrap"><table class="it-batch-table"><thead><tr><th></th><th>Giao dịch</th><th>Phiếu</th><th>Sao kê</th><th>Tiền hàng</th><th>Tiền giờ</th><th>VAT</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    table.querySelector("#it-batch-select-all")?.addEventListener("change", event => {
      table.querySelectorAll(".it-batch-select:not(:disabled)").forEach(input => { input.checked = event.target.checked; });
    });
    table.querySelector("#it-approve-batch")?.addEventListener("click", approveBatchPlans);
    table.querySelectorAll(".it-unissued-choice").forEach(select => select.addEventListener("change", chooseUnissuedInvoice));
    table.querySelectorAll(".it-issued-choice").forEach(select => select.addEventListener("change", chooseIssuedInvoice));
    table.querySelectorAll(".it-confirm-issued").forEach(button => button.addEventListener("click", confirmAlreadyIssued));
    table.querySelectorAll(".it-open-pos").forEach(button => button.addEventListener("click", openPosForNewInvoice));
    table.querySelectorAll(".it-apply-accepted").forEach(button => button.addEventListener("click", applyAcceptedBatchPlan));
    table.querySelectorAll(".it-recalculate-accepted").forEach(button => button.addEventListener("click", recalculateAcceptedBatchPlan));
    table.querySelectorAll(".it-verify-batch").forEach(button => button.addEventListener("click", verifyBatchSavedInvoice));
    table.querySelectorAll(".it-retry-batch").forEach(button => button.addEventListener("click", buildBatchReview));
  }

  async function verifyBatchSavedInvoice(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    const entry = batchPlans[index];
    const transaction = (statementDataset.transactions || []).find(item =>
      String(item.id) === String(entry?.transactionId || "")
    );
    const plan = transaction?.pendingPlan || entry?.plan;
    if (!entry || entry.status !== "planned" || !transaction || !plan?.invoiceNo) {
      return setStatus("Không có phiếu đang chờ đối soát ở dòng này.", "error");
    }
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang mở lại phiếu…";
      }
      currentBankTransaction = transaction;
      setStatus(`Đang mở lại ${plan.invoiceNo} từ website để đối soát sau lưu…`, "warn");

      // Do not trust the form that happens to be open: reopen the invoice
      // from the list so reconciliation only commits data already persisted
      // by the website's own Lưu HĐ action.
      const usedInvoiceNos = (statementDataset.transactions || [])
        .filter(item => String(item.id) !== String(transaction.id) && item.invoiceNo)
        .map(item => String(item.invoiceNo));
      const found = await request("findInvoiceCandidates", {
        dateKey: transaction.transactionDate,
        usedInvoiceNos
      });
      const candidate = (found.candidates || []).find(item =>
        String(item.invoiceNo) === String(plan.invoiceNo) && item.available
      );
      if (!candidate) {
        throw new Error(`Không tìm thấy phiếu chưa xuất ${plan.invoiceNo} để đọc lại từ website.`);
      }
      await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo: plan.invoiceNo });
      const reopened = await waitForOpenedInvoice(plan.invoiceNo);
      if (String(reopened.invoiceNo || "") !== String(plan.invoiceNo)) {
        throw new Error(`Website mở nhầm phiếu ${reopened.invoiceNo || "không xác định"}; chưa đối soát.`);
      }
      const errors = verifySnapshotAgainstPlan(reopened, plan);
      if (errors.length) throw new Error(errors.join(" "));

      if (button?.isConnected) button.textContent = "Đang ghi sổ tồn…";
      await verifySavedInvoice();
      if (currentBankTransaction?.status === "done") {
        if (button?.isConnected) button.textContent = "Đang trở về danh sách…";
        const closed = await request("closeInvoiceDetail");
        if (!closed?.closed) {
          setStatus(
            `Đã đối soát phiếu ${plan.invoiceNo}, nhưng website chưa đóng được form. Hãy bấm Thoát để trở về danh sách phiếu.`,
            "warn"
          );
        }
      }
    } catch (error) {
      setStatus(`Đối soát từ Batch Review thất bại: ${error.message} Chưa thay đổi tồn kho hoặc sao kê.`, "error");
    } finally {
      if (button?.isConnected && currentBankTransaction?.status !== "done") {
        button.disabled = false;
        button.textContent = "Đối soát sau lưu";
      }
    }
  }

  async function chooseUnissuedInvoice(event) {
    const index = Number(event.target.dataset.index);
    const entry = batchPlans[index];
    const invoiceNo = String(event.target.value || "");
    if (!entry || entry.status !== "needs_choice" || !invoiceNo) return;
    const candidate = (entry.candidates || []).find(item => String(item.invoiceNo) === invoiceNo);
    if (!candidate) return setStatus("Phiếu vừa chọn không còn trong danh sách ứng viên.", "error");
    const transaction = (statementDataset.transactions || []).find(item => String(item.id) === entry.transactionId);
    if (!transaction) return;
    transaction.invoiceNo = invoiceNo;
    transaction.linkedAt = new Date().toISOString();
    await InvoiceMappingStore.saveStatement(statementDataset);
    setStatus(`Đã chọn ${invoiceNo}. Đang tính lại Batch Review để giữ tồn kho đúng thứ tự…`, "warn");
    await buildBatchReview();
  }

  async function chooseIssuedInvoice(event) {
    const index = Number(event.target.dataset.index);
    const entry = batchPlans[index];
    const invoiceNo = String(event.target.value || "");
    if (!entry || entry.status !== "already_issued") return;
    const candidate = (entry.candidates || []).find(item => String(item.invoiceNo) === invoiceNo);
    entry.plan = {
      ...(entry.plan || {}),
      invoiceNo: candidate ? invoiceNo : ""
    };
    renderBatchPlans();
    await saveBatchUiSession({ panelOpen: true });
  }

  async function approveBatchPlans() {
    const selectedIndexes = Array.from(document.querySelectorAll(".it-batch-select:checked"))
      .map(input => Number(input.dataset.index));
    if (!selectedIndexes.length) return setStatus("Hãy chọn ít nhất một phương án sẵn sàng.", "error");
    for (const index of selectedIndexes) {
      const entry = batchPlans[index];
      if (!entry || entry.status !== "ready") continue;
      const transaction = (statementDataset.transactions || []).find(item => String(item.id) === entry.transactionId);
      if (!transaction) continue;
      transaction.invoiceNo = entry.plan.invoiceNo;
      transaction.status = "batch_ready";
      transaction.batchApprovedPlan = structuredClone(entry.plan);
      transaction.batchApprovedAt = new Date().toISOString();
      delete transaction.lastRejectedBatchPlan;
      entry.status = "batch_ready";
      entry.transaction = transaction;
    }
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true });
    renderBatchPlans();
    renderStatementAdmin();
    setStatus(`Đã Accept ${selectedIndexes.length} phương án vào hàng đợi. Chưa sửa hoặc lưu hóa đơn.`, "ok");
  }

  async function recalculateAcceptedBatchPlan(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    const entry = batchPlans[index];
    const transaction = (statementDataset.transactions || []).find(item =>
      String(item.id) === String(entry?.transactionId || "")
    );
    const activePlan = transaction?.pendingPlan || transaction?.batchApprovedPlan || entry?.plan;
    if (!entry || !["batch_ready", "planned"].includes(entry.status) || !activePlan?.items?.length) {
      return setStatus("Chỉ có thể tính lại phương án đã Accept hoặc đang chờ lưu/đối soát.", "error");
    }
    if (button) {
      button.disabled = true;
      button.textContent = "Đang tính lại…";
    }
    try {
      if (entry.status === "planned") {
        const scan = await request("scan");
        if (scan?.ready) {
          const expectedInvoiceNo = String(activePlan.invoiceNo || transaction.invoiceNo || "");
          if (expectedInvoiceNo && String(scan.invoiceNo || "") !== expectedInvoiceNo) {
            throw new Error(`Đang mở phiếu ${scan.invoiceNo || "khác"}, không phải ${expectedInvoiceNo}. Hãy đóng phiếu đang mở rồi thử lại.`);
          }
          await request("closeInvoiceDetail");
          await new Promise(resolve => setTimeout(resolve, 450));
        }
      }
      transaction.lastRejectedBatchPlan = structuredClone(activePlan);
      transaction.recalculationNonce = Math.max(0, Number(transaction.recalculationNonce) || 0) + 1;
      transaction.status = "pending";
      transaction.verifiedAt = "";
      transaction.ledgerId = "";
      delete transaction.batchApprovedPlan;
      delete transaction.batchApprovedAt;
      delete transaction.pendingPlan;
      if (pendingNewInvoice && String(pendingNewInvoice.transactionId) === String(transaction.id)) {
        pendingNewInvoice = null;
        document.getElementById("it-pending-new-invoice")?.remove();
      }
      await InvoiceMappingStore.saveStatement(statementDataset);
      await saveBatchUiSession({ panelOpen: true });
      setStatus("Đã hoàn reservation của phương án cũ. Đang tìm một tổ hợp mặt hàng khác…", "warn");
      await buildBatchReview();
    } catch (error) {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Tính toán lại";
      }
      setStatus(error.message, "error");
    }
  }

  async function applyAcceptedBatchPlan(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    const entry = batchPlans[index];
    const transaction = entry?.transaction;
    const plan = entry?.plan || transaction?.pendingPlan || transaction?.batchApprovedPlan;
    if (!entry || !["batch_ready", "planned"].includes(entry.status) || !transaction || !plan || plan.requiresNewInvoice) {
      return setStatus("Phương án này không thể áp dụng trực tiếp vào phiếu đã có.", "error");
    }
    const invoiceNo = String(plan.invoiceNo || transaction.invoiceNo || "");
    if (!invoiceNo || !Array.isArray(plan.items) || !plan.items.length) {
      return setStatus("Phương án đã Accept thiếu số phiếu hoặc danh sách hàng.", "error");
    }
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang mở phiếu…";
      }
      currentBankTransaction = transaction;
      setStatus(`Đang mở ${invoiceNo} và áp dụng đúng phương án đã Accept…`, "warn");
      const usedInvoiceNos = (statementDataset.transactions || [])
        .filter(item => String(item.id) !== String(transaction.id) && item.invoiceNo)
        .map(item => String(item.invoiceNo));
      const found = await request("findInvoiceCandidates", {
        dateKey: transaction.transactionDate,
        usedInvoiceNos
      });
      const candidate = (found.candidates || []).find(item =>
        String(item.invoiceNo) === invoiceNo && item.available
      );
      if (!candidate) {
        throw new Error(`Không tìm thấy phiếu chưa xuất ${invoiceNo} trong ngày ${transaction.transactionDate}.`);
      }
      await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo });
      const openedScan = await waitForOpenedInvoice(invoiceNo);
      if (openedScan.invoiceDateKey !== transaction.transactionDate) {
        throw new Error(`Ngày phiếu ${openedScan.invoiceDateKey || "không xác định"} không khớp ${transaction.transactionDate}.`);
      }
      if (button?.isConnected) button.textContent = "Đang áp dụng…";
      const applied = await request("applyInvoicePlan", {
        items: plan.items.map(item => ({
          code: item.code,
          newQty: item.qty,
          maxQty: item.maxQty,
          price: item.price
        })),
        finalHourAmount: plan.hour,
        targetGrand: plan.targetGrand ?? plan.grand ?? transaction.credit,
        targetGoods: plan.goods,
        checkIn: openedScan.checkIn || "",
        checkOut: openedScan.checkOut || ""
      });
      latestScan = {
        ...openedScan,
        ...applied,
        invoiceNo: openedScan.invoiceNo,
        invoiceDateKey: openedScan.invoiceDateKey
      };
      const pendingPlan = pendingPlanFromApproved(plan, transaction, latestScan);
      const verificationErrors = verifySnapshotAgainstPlan(latestScan, pendingPlan);
      if (verificationErrors.length) {
        throw new Error(`Form chưa khớp phương án: ${verificationErrors.join(" ")}`);
      }
      transaction.invoiceNo = invoiceNo;
      transaction.status = "planned";
      transaction.pendingPlan = pendingPlan;
      transaction.verifiedAt = "";
      transaction.ledgerId = "";
      entry.status = "planned";
      entry.plan = pendingPlan;
      entry.transaction = transaction;
      await InvoiceMappingStore.saveStatement(statementDataset);
      await saveBatchUiSession({ panelOpen: false });
      renderBatchPlans();
      renderStatementAdmin();
      renderPostSaveVerificationControl();
      setStatus(
        `Đã áp dụng ${plan.items.length} mã vào ${invoiceNo}, tổng ${formatMoney(pendingPlan.grand)}đ. ` +
        "Hãy kiểm tra form rồi chỉ bấm Lưu HĐ; tồn kho chưa bị trừ.",
        "ok"
      );
      const panel = document.getElementById("it-panel");
      if (panel) panel.hidden = true;
    } catch (error) {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Thử mở và áp dụng lại";
      }
      setStatus(`${error.message} Không bấm Lưu HĐ nếu form chưa khớp.`, "error");
    }
  }

  async function confirmAlreadyIssued(event) {
    const index = Number(event.target.dataset.index);
    const entry = batchPlans[index];
    if (!entry || entry.status !== "already_issued") return;
    const invoiceNo = entry.plan?.invoiceNo;
    if (!invoiceNo) return setStatus("Không xác định được số phiếu để gắn. Nếu có nhiều HĐ khớp, hãy chọn thủ công.", "error");
    const transaction = (statementDataset.transactions || []).find(item => String(item.id) === entry.transactionId);
    if (!transaction) return;
    const alreadyLinked = (statementDataset.transactions || []).find(item =>
      String(item.id) !== String(transaction.id) &&
      String(item.invoiceNo || "") === String(invoiceNo) &&
      ["done", "planned", "batch_ready"].includes(item.status)
    );
    if (alreadyLinked) {
      return setStatus(`HĐ ${invoiceNo} đã được gắn với một giao dịch khác. Hãy chạy lại Batch Review.`, "error");
    }
    transaction.invoiceNo = invoiceNo;
    transaction.status = "done";
    transaction.reconciledAt = new Date().toISOString();
    transaction.reconciledNote = `Đã có HĐ ${invoiceNo} khớp ${formatMoney(transaction.credit)}đ (xác nhận thủ công).`;
    entry.status = "done";
    entry.transaction = transaction;
    await InvoiceMappingStore.saveStatement(statementDataset);
    if (pendingNewInvoice && String(pendingNewInvoice.transactionId) === String(transaction.id)) {
      pendingNewInvoice = null;
      document.getElementById("it-pending-new-invoice")?.remove();
    }
    await saveBatchUiSession({ panelOpen: true });
    renderBatchPlans();
    renderStatementRows();
    setStatus(`Đã gắn giao dịch với HĐ ${invoiceNo} và đánh dấu đã xử lý.`, "ok");
  }

  async function openPosForNewInvoice(event) {
    const index = Number(event.target.dataset.index);
    const entry = batchPlans[index];
    if (!entry) return;
    const t = entry.transaction;
    const salesAnchor = Array.from(document.querySelectorAll("a"))
      .find(anchor => (anchor.innerText || "").trim() === "Bán hàng" && anchor.href);
    const salesUrl = salesAnchor?.href || location.href;
    const newTab = window.open("about:blank", "_blank");
    if (!newTab) {
      return setStatus("Chrome đã chặn tab mới. Hãy cho phép pop-up cho website rồi thử lại.", "error");
    }
    pendingNewInvoice = {
      transactionId: String(entry.transactionId),
      transactionDate: t.transactionDate,
      credit: Number(t.credit || 0),
      description: t.description || "",
      plan: structuredClone(entry.plan || t.batchApprovedPlan || null),
      requestedAt: new Date().toISOString()
    };
    setStatus(
      `Đang mở tab Bán hàng mới để tạo phiếu ngày ${t.transactionDate}, tổng mục tiêu ${formatMoney(t.credit)}đ. ` +
      "Tab danh sách và phiên Batch Review hiện tại vẫn được giữ nguyên.",
      "warn"
    );
    try {
      await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
      try { newTab.opener = null; } catch (_) {}
      newTab.location.replace(salesUrl);
      setStatus(
        `Đã mở tab mới cho giao dịch ${t.transactionDate} · ${formatMoney(t.credit)}đ. ` +
        "Thông tin giao dịch sẽ tự hiện lại trong extension ở tab mới.",
        "ok"
      );
    } catch (error) {
      try { newTab.close(); } catch (_) {}
      setStatus(`Không lưu được phiên trước khi mở tab mới: ${error.message}`, "error");
    }
  }

  function parseUiDateTime(value) {
    const match = String(value || "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})/);
    return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5])) : null;
  }

  function formatUiDateTime(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
    const part = number => String(number).padStart(2, "0");
    return `${part(value.getDate())}/${part(value.getMonth() + 1)}/${value.getFullYear()} ${part(value.getHours())}:${part(value.getMinutes())}`;
  }

  function inferHourPricing(scan) {
    const duration = Number(scan.durationMinutes || 0);
    const currentHour = Number(scan.currentHour || 0);
    const billedHours = Math.round((duration / 60) * 100) / 100;
    if (duration <= 0 || currentHour <= 0 || billedHours <= 0) return { hourlyRate: 0, hourStep: 0 };
    const hourlyRate = Math.max(1000, Math.round((currentHour / billedHours) / 1000) * 1000);
    return { hourlyRate, hourStep: Math.round(hourlyRate / 100) };
  }

  function recommendCheckOut(scan, hourTarget, hourlyRate) {
    const checkIn = parseUiDateTime(scan.checkIn);
    const currentDuration = Number(scan.durationMinutes || 0);
    if (!checkIn || currentDuration <= 0 || hourlyRate <= 0 || hourTarget < 0) return "";
    const estimatedMinutes = Math.max(0, Math.round((hourTarget / hourlyRate) * 60));
    const maxMinutes = Math.max(1440, estimatedMinutes + 180);
    let best = null;
    for (let minutes = 0; minutes <= maxMinutes; minutes += 1) {
      const billedHours = Math.round((minutes / 60) * 100) / 100;
      const amount = Math.round(billedHours * hourlyRate);
      const difference = Math.abs(amount - hourTarget);
      const distance = Math.abs(minutes - currentDuration);
      if (!best || difference < best.difference || (difference === best.difference && distance < best.distance)) best = { minutes, difference, distance };
    }
    return formatUiDateTime(new Date(checkIn.getTime() + best.minutes * 60000));
  }

  async function solveInvoice() {
    if (!document.getElementById("it-stock-confirm").checked) return setStatus("Hãy xác nhận dữ liệu tồn kho còn hiệu lực.", "error");
    if (!latestScan?.ready) await scanInvoice();
    if (!latestScan?.ready) return;
    if (currentBankTransaction) {
      if (!latestScan.invoiceDateKey) return setStatus("Không đọc được ngày trên phiếu; chưa thể xác nhận khớp ngày sao kê.", "error");
      if (latestScan.invoiceDateKey !== currentBankTransaction.transactionDate) {
        return setStatus(`Ngày phiếu ${latestScan.invoiceDateKey} không khớp ngày ngân hàng ${currentBankTransaction.transactionDate}.`, "error");
      }
    }
    if (!inventory.length) return setStatus("Không có ánh xạ đã xác nhận nào còn tồn.", "error");
    const targetGrand = parseMoney(document.getElementById("it-target").value);
    if (targetGrand <= 0) return setStatus("Hãy nhập tổng tiền mục tiêu hợp lệ.", "error");
    const maxQty = Math.max(1, Number(document.getElementById("it-max-qty").value) || 20);
    const tolerance = Math.max(0, parseMoney(document.getElementById("it-tolerance").value));
    const targets = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, latestScan.currentHour, latestScan.taxRate);
    const goodsTarget = targets.goodsTarget;
    const hourPricing = inferHourPricing(latestScan);
    const candidates = buildCandidates();
    const requiredMinimum = candidates.reduce((sum, item) => sum + Number(item.minQty || 0) * Number(item.price || 0), 0);
    if (requiredMinimum > targets.preTaxTarget + tolerance) {
      return setStatus(`Các mặt hàng đang tích cần tối thiểu ${formatMoney(requiredMinimum)}, vượt tổng trước VAT ${formatMoney(targets.preTaxTarget)}.`, "error");
    }
    const solution = InvoiceTargetSolver.solveQuantities(candidates, goodsTarget, {
      maxQty, tolerance, preTaxTarget: targets.preTaxTarget,
      currentHour: latestScan.currentHour, hourStep: hourPricing.hourStep,
      preferredLineCount: preferredLineCount(goodsTarget),
      maxActiveLines: 6
    });
    if (!solution.items) return setStatus(solution.reason || "Không tìm được phương án.", "error");
    const selected = solution.items.filter(item => item.newQty > 0);
    const { hourFromTime, finalHourAmount, hourAdjustment } = InvoiceTargetSolver.reconcileHourAmount(
      solution.actual,
      targets.preTaxTarget,
      solution.hourActual
    );
    if (finalHourAmount < 0) return setStatus("Tiền hàng phương án vượt tổng trước VAT; không thể bù bằng tiền giờ.", "error");
    const hourDifference = finalHourAmount - Number(latestScan.currentHour || 0);
    const predictedGrand = solution.actual + finalHourAmount + targets.vatTarget;
    const proposedCheckOut = recommendCheckOut(latestScan, hourFromTime, hourPricing.hourlyRate);
    const totalDifference = predictedGrand - targetGrand;
    const dateMatched = !currentBankTransaction || latestScan.invoiceDateKey === currentBankTransaction.transactionDate;
    const stockSufficient = selected.every(item => Number(item.newQty) <= Number(item.maxQty));
    const canAccept = totalDifference === 0 && dateMatched && stockSufficient && selected.length > 0;
    const removeRows = latestScan.items.map(item => `<tr class="changed"><td>XÓA</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td>
      <td>${item.qty}</td><td>→</td><td>0</td><td>—</td><td>—</td><td>${formatMoney(item.price)}</td></tr>`).join("");
    const addRows = selected.map(item => `<tr class="changed"><td>THÊM</td><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td>
      <td>0</td><td>→</td><td>${item.newQty}</td><td>${item.stockQty}</td><td>${item.invoiceLimit}</td><td>${formatMoney(item.price)}</td></tr>`).join("");
    document.getElementById("it-panel")?.classList.add("review-mode");
    document.getElementById("it-result").innerHTML = `<section class="it-review-card">
      <div class="it-review-title"><div><small>DUYỆT PHƯƠNG ÁN</small><h3>${escapeHtml(latestScan.invoiceNo || "Phiếu đang mở")}</h3></div>
        <span class="it-review-badge ${canAccept ? "ok" : "error"}">${canAccept ? "SẴN SÀNG ACCEPT" : "CHƯA ĐỦ ĐIỀU KIỆN"}</span></div>
      <div class="it-review-kpis">
        <div><small>Sao kê</small><strong>${formatMoney(targetGrand)}</strong></div>
        <div><small>Hiện tại</small><strong>${formatMoney(latestScan.currentGrand)}</strong></div>
        <div><small>Dự kiến</small><strong>${formatMoney(predictedGrand)}</strong></div>
        <div class="${totalDifference === 0 ? "ok" : "error"}"><small>Chênh lệch</small><strong>${totalDifference > 0 ? "+" : ""}${formatMoney(totalDifference)}</strong></div>
      </div>
      <div class="it-review-grid">
        <div class="it-review-breakdown">
          <div class="head"><span>Khoản mục</span><span>Hiện tại</span><span>Đề xuất</span></div>
          <div><span>Tiền hàng</span><span>${formatMoney(latestScan.currentGoods)}</span><b>${formatMoney(solution.actual)}</b></div>
          <div><span>Tiền giờ</span><span>${formatMoney(latestScan.currentHour)}</span><b>${formatMoney(finalHourAmount)}</b></div>
          ${hourAdjustment ? `<div><span>Bù chênh vào giờ</span><span>${formatMoney(hourFromTime)}</span><b>${hourAdjustment > 0 ? "+" : ""}${formatMoney(hourAdjustment)}</b></div>` : ""}
          <div><span>VAT 10%</span><span>${formatMoney(latestScan.currentTax)}</span><b>${formatMoney(targets.vatTarget)}</b></div>
          <div class="total"><span>Tổng cộng</span><span>${formatMoney(latestScan.currentGrand)}</span><b>${formatMoney(predictedGrand)}</b></div>
        </div>
        <div class="it-review-checks">
          <div class="${dateMatched ? "pass" : "fail"}">${dateMatched ? "✓" : "×"} Ngày phiếu khớp sao kê</div>
          <div class="${stockSufficient ? "pass" : "fail"}">${stockSufficient ? "✓" : "×"} Không vượt tồn kho</div>
          <div class="${totalDifference === 0 ? "pass" : "fail"}">${totalDifference === 0 ? "✓" : "×"} Tổng khớp tuyệt đối</div>
          <div class="pass">✓ Không sử dụng giảm giá</div>
          <div class="${selected.length ? "pass" : "fail"}">${selected.length ? "✓" : "×"} Có ${selected.length} mã hàng đề xuất</div>
        </div>
      </div>
      <div class="it-review-meta">
        <span>Trước VAT: <b>${formatMoney(targets.preTaxTarget)}</b></span>
        <span>Giờ: <b>${escapeHtml(latestScan.checkIn || "—")} → ${escapeHtml(proposedCheckOut || latestScan.checkOut || "—")}</b></span>
        ${hourPricing.hourlyRate ? `<span>Đơn giá giờ: <b>${formatMoney(hourPricing.hourlyRate)}/giờ</b></span>` : ""}
      </div>
      <div class="it-review-accept">
        <label><input id="it-review-confirm" type="checkbox" ${canAccept ? "" : "disabled"}> Tôi đã kiểm tra tổng tiền, hàng hóa, tồn kho và ngày phiếu.</label>
        <button id="it-apply-plan" type="button" class="primary" disabled>Accept — áp dụng vào phiếu</button>
        <span id="it-apply-plan-status" aria-live="polite"></span>
      </div>
    </section>
      <div class="it-add-warning">Sẽ thay ${latestScan.items.length} dòng cũ bằng ${selected.length} mã đã xác nhận từ kho.</div>
      <div class="it-table-wrap"><table><thead><tr><th>Loại</th><th>Mã web</th><th>Tên</th><th>Cũ</th><th></th><th>Mới</th><th>Tồn kho</th><th>Trần/phiếu</th><th>Giá web</th></tr></thead>
      <tbody>${removeRows + addRows}</tbody></table></div>`;
    const reviewConfirm = document.getElementById("it-review-confirm");
    const applyPlanButton = document.getElementById("it-apply-plan");
    reviewConfirm?.addEventListener("change", () => {
      if (applyPlanButton) applyPlanButton.disabled = !canAccept || !reviewConfirm.checked;
    });
    if (proposedCheckOut) {
      document.getElementById("it-apply-checkout")?.addEventListener("click", async () => {
        try {
          setStatus("Đang cập nhật giờ ra để website tính lại tiền giờ…", "warn");
          await request("applyCheckOut", { value: proposedCheckOut });
          await new Promise(resolve => setTimeout(resolve, 700));
          await request("applyHourAmount", { value: finalHourAmount });
          await new Promise(resolve => setTimeout(resolve, 500));
          await scanInvoice();
          setStatus("Đã cập nhật giờ ra và ghi phần chênh trực tiếp vào Tiền giờ. Không sử dụng giảm giá. Hãy kiểm tra tổng trước khi lưu.", "ok");
        } catch (error) { setStatus(error.message, "error"); }
      });
    }
    document.getElementById("it-apply-plan")?.addEventListener("click", async () => {
      const button = document.getElementById("it-apply-plan");
      const confirmation = document.getElementById("it-review-confirm");
      const progress = document.getElementById("it-apply-plan-status");
      const showProgress = text => { if (progress) progress.textContent = text; };
      let completed = false;
      if (!canAccept || !confirmation?.checked) return setStatus("Hãy kiểm tra và tích xác nhận trước khi Accept.", "error");
      try {
        button.disabled = true;
        button.textContent = "Đang áp dụng…";
        showProgress("Bước 1/3: đang thay danh sách hàng…");
        setStatus("Đang thay danh sách hàng trên model hóa đơn của website…", "warn");
        const applied = await request("applyInvoicePlan", {
          items: selected.map(item => ({
            code: item.code, newQty: item.newQty, maxQty: item.maxQty, price: item.price
          })),
          finalHourAmount,
          targetGrand,
          targetGoods: solution.actual,
          checkIn: latestScan?.checkIn || "",
          checkOut: latestScan?.checkOut || ""
        });
        showProgress("Bước 2/3: đang cập nhật giờ ra…");
        const normalizedCurrentCheckOut = String(latestScan?.checkOut || "").trim();
        const shouldApplyCheckOut = false && proposedCheckOut &&
          String(proposedCheckOut).trim() !== normalizedCurrentCheckOut;
        if (shouldApplyCheckOut) {
          await request("applyCheckOut", { value: proposedCheckOut });
          await new Promise(resolve => setTimeout(resolve, 700));
        }
        showProgress("Bước 3/3: đang kiểm tra tổng tiền…");
        await new Promise(resolve => setTimeout(resolve, 500));
        latestScan = { ...latestScan, ...applied };
        const actualGrand = Number(applied?.currentGrand || 0);
        if (currentBankTransaction && actualGrand === targetGrand) {
          currentBankTransaction.status = "planned";
          currentBankTransaction.pendingPlan = {
            invoiceNo: latestScan.invoiceNo || currentBankTransaction.invoiceNo || "",
            invoiceDateKey: latestScan.invoiceDateKey || currentBankTransaction.transactionDate || "",
            goods: solution.actual,
            hour: finalHourAmount,
            tax: targets.vatTarget,
            taxRate: 10,
            grand: targetGrand,
            items: selected.map(item => ({
              code: String(item.code),
              qty: Math.round(Number(item.newQty)),
              price: Math.round(Number(item.price))
            })),
            createdAt: new Date().toISOString()
          };
          currentBankTransaction.verifiedAt = "";
          currentBankTransaction.ledgerId = "";
          await InvoiceMappingStore.saveStatement(statementDataset);
          renderPostSaveVerificationControl();
        }
        setStatus(actualGrand === targetGrand
          ? "Đã cập nhật hàng, số lượng, giờ và tổng tiền. Hãy kiểm tra rồi bấm Lưu HĐ."
          : `Đã cập nhật form nhưng tổng hiện tại ${formatMoney(actualGrand)} chưa khớp ${formatMoney(targetGrand)}; chưa được bấm Lưu HĐ.`,
          actualGrand === targetGrand ? "ok" : "error");
        showProgress(actualGrand === targetGrand ? "Hoàn tất — hãy kiểm tra rồi bấm Lưu HĐ." : `Tổng chưa khớp: ${formatMoney(actualGrand)}.`);
        completed = actualGrand === targetGrand;
      } catch (error) {
        showProgress(`Lỗi: ${error.message}`);
        setStatus(`${error.message} Hãy đóng phiếu mà không lưu nếu form đang dở.`, "error");
      } finally {
        button.disabled = completed || !confirmation?.checked;
        button.textContent = completed ? "Đã Accept và áp dụng" : "Accept — thử áp dụng lại";
      }
    });
    setStatus(predictedGrand === targetGrand ? "Đã khớp tổng bằng cách bù phần lệch tiền hàng vào tiền giờ." : "Đã tìm phương án gần nhất trong giới hạn tồn.", predictedGrand === targetGrand ? "ok" : "warn");
  }

  async function init() {
    catalogDataset = await InvoiceMappingStore.loadCatalog(embeddedCatalog);
    webCatalog = catalogDataset.items || [];
    mappingDataset = InvoiceMappingEngine.applyBusinessRules(await InvoiceMappingStore.load(embeddedDataset));
    statementDataset = await InvoiceMappingStore.loadStatement();
    verificationLedger = await InvoiceMappingStore.loadLedger();
    stockStateMeta = await InvoiceMappingStore.loadStockStateMeta();
    priorityRules = await InvoiceMappingStore.loadPriorityRules();
    InvoiceMappingEngine.reconcileCatalog(mappingDataset, webCatalog);
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    mount();
    await restoreUiSession();
  }

  init().catch(error => console.error("Invoice Target MVP init failed", error));
})();
