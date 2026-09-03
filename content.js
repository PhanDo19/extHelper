(function () {
  "use strict";

  const REQUEST = "invoice-target-mvp:request";
  const RESPONSE = "invoice-target-mvp:response";
  const SAVE_CAPTURED = "invoice-target-mvp:save-request-captured";
  const SAVE_BLOCKED = "invoice-target-mvp:save-blocked";
  const RUNTIME_WARNING = "invoice-target-mvp:runtime-warning";
  const DEFAULT_INVOICE_BUYER = "Kh\u00e1ch l\u1ebb - Kh\u00f4ng l\u1ea5y h\u00f3a \u0111\u01a1n";
  // Moi chi nhanh co bo ma web rieng nen du lieu mac dinh phai chon theo chi
  // nhanh dang mo, khong duoc dung chung bo cua pariskimgiang.
  const pageTenantSlug = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
  // Bảng đăng ký cơ sở. Trước đây mỗi thứ (nhãn, tên file, danh mục, ánh xạ)
  // được chọn bằng một nhánh if/else nhị phân riêng, nên thêm cơ sở thứ ba là
  // nó ÂM THẦM rơi vào nhánh else và mượn danh mục của Kim Giang — mã web hai
  // bên không trùng nhau nên phương án lập ra sẽ sai mã hàng, mà chỉ phát hiện
  // sau khi phiếu đã lưu. Gom về một chỗ để thêm cơ sở là thêm đúng một mục.
  //
  // catalogGlobal/mappingGlobal trỏ tới biến toàn cục do các file dữ liệu nạp
  // trước content.js đặt ra; thiếu file thì để rỗng và bắt người dùng nhập, chứ
  // tuyệt đối không mượn của cơ sở khác.
  const TENANT_REGISTRY = {
    pariskimgiang: {
      label: "Paris Kim Giang",
      fileLabel: "ParisKimGiang",
      catalogGlobal: "InvoiceWebCatalog",
      catalogSource: "data.xlsx",
      mappingGlobal: "InvoiceInventoryData"
    },
    parislinhdam: {
      label: "Paris Linh Đàm",
      fileLabel: "ParisLinhDam",
      catalogGlobal: "InvoiceWebCatalogParisLinhDam",
      catalogSource: "jsondataLD.json",
      mappingGlobal: "InvoiceMappingParisLinhDam"
    },
    parisnhon: {
      label: "Paris Nhơn",
      fileLabel: "ParisNhon",
      catalogGlobal: "InvoiceWebCatalogParisNhon",
      catalogSource: "mat_hang_web_NHOn.xlsx",
      mappingGlobal: "InvoiceMappingParisNhon"
    }
  };
  const TENANT_LABELS = Object.fromEntries(
    Object.entries(TENANT_REGISTRY).map(([slug, config]) => [slug, config.label])
  );
  const tenantConfig = TENANT_REGISTRY[pageTenantSlug] || null;
  const pageTenantLabel = tenantConfig?.label || pageTenantSlug;
  const pageTenantFileLabel = tenantConfig?.fileLabel || "";
  const embeddedDataset = tenantConfig
    ? (globalThis[tenantConfig.mappingGlobal] || { mappings: [] })
    : { mappings: [] };
  const embeddedCatalog = tenantConfig
    ? (globalThis[tenantConfig.catalogGlobal] || { source: tenantConfig.catalogSource, items: [] })
    : { source: "", items: [] };
  const extensionVersion = typeof chrome !== "undefined" && chrome.runtime?.getManifest
    ? chrome.runtime.getManifest().version
    : "";
  let catalogDataset = embeddedCatalog;
  let webCatalog = embeddedCatalog.items || [];
  let mappingDataset = embeddedDataset;
  let sharedWarehouse = InvoiceSharedWarehouse.empty();
  let pendingWarehouseImport = null;
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
  let apiTemplate = null;
  let issuedInvoiceBook = { entries: [] };
  // Điều phối phát hành giữa hai cơ sở: cờ thứ tự, bảng sao kê đối chiếu và
  // chốt tiến độ. Dùng chung cả hai tab nên không đi qua tenantKey.
  let issueCoordination = InvoiceIssueCoordination.empty();
  let eInvoiceRows = [];
  let eInvoiceSelection = new Set();
  let issuingInProgress = false;
  let statementSubtab = "statement";
  let showEInvoicesOutsideStatement = false;

  const RUNTIME_REFRESH_MESSAGE =
    "Extension vừa được cập nhật. Hãy nhấn F5 tải lại trang website, sau đó mở lại nút Σ.";

  function normalizeRuntimeError(error) {
    const message = String(error?.message || error || "");
    return /extension context invalidated|context invalidated/i.test(message)
      ? new Error(RUNTIME_REFRESH_MESSAGE)
      : new Error(message || "Chrome runtime không sẵn sàng.");
  }

  function isInvalidRuntimeContext(error) {
    return /extension context invalidated|context invalidated/i.test(String(error?.message || error || ""));
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) {
        reject(new Error(RUNTIME_REFRESH_MESSAGE));
        return;
      }
      try {
        chrome.runtime.sendMessage(message, response => {
          const error = chrome.runtime.lastError;
          if (error) reject(normalizeRuntimeError(error));
          else if (!response?.ok) reject(new Error(response?.error || "Background không thực hiện được yêu cầu."));
          else resolve(response);
        });
      } catch (error) {
        reject(normalizeRuntimeError(error));
      }
    });
  }

  // Khi unpacked extension được Reload, Chrome vô hiệu hóa content script cũ.
  // Giữ lỗi này khỏi trở thành unhandled rejection và hướng dẫn đúng thao tác
  // phục hồi. Trang vẫn cần F5 một lần để nạp content script mới.
  window.addEventListener("unhandledrejection", event => {
    if (!isInvalidRuntimeContext(event.reason)) return;
    event.preventDefault();
    setStatus(RUNTIME_REFRESH_MESSAGE, "error");
  });

  function apiCaptureSummary(template) {
    if (!template) return "API: chưa có mẫu Lưu HĐ";
    let path = "";
    try { path = new URL(template.url).pathname; } catch (_) { path = template.url || ""; }
    const state = template.analysis?.ready ? "sẵn sàng" : "cần kiểm tra";
    const paymentPath = template.paymentTemplate
      ? (() => { try { return new URL(template.paymentTemplate.url).pathname; } catch (_) { return "DoSave2"; } })()
      : "";
    return `API: ${template.method || "POST"} ${path}${paymentPath ? ` + ${paymentPath}` : ""} · HTTP ${template.status || 0} · ${state}`;
  }

  async function receiveSaveRequestCapture(event) {
    const captured = event.detail || {};
    if (!captured.url || !captured.method ||
        !["text", "urlencoded", "formdata"].includes(captured.bodyType)) return;
    apiTemplate = {
      schemaVersion: 1,
      transport: captured.transport || "",
      method: captured.method,
      url: captured.url,
      headers: captured.headers || {},
      bodyType: captured.bodyType,
      body: structuredClone(captured.body),
      status: Number(captured.status || 0),
      responseText: String(captured.responseText || "").slice(0, 8000),
      capturedAt: captured.capturedAt || new Date().toISOString(),
      paymentTemplate: captured.paymentTemplate ? structuredClone(captured.paymentTemplate) : undefined
    };
    apiTemplate.analysis = InvoiceApiTemplate.analyze(apiTemplate);
    await InvoiceMappingStore.saveApiTemplate(apiTemplate);
    const status = document.getElementById("it-api-capture-status");
    if (status) {
      status.textContent = apiCaptureSummary(apiTemplate);
      status.classList.toggle("ready", Boolean(apiTemplate.analysis?.ready));
    }
    setStatus(
      apiTemplate.analysis?.ready
        ? "Đã bắt và xác thực request Lưu HĐ: endpoint, chi tiết hàng và tiền mặt đều hợp lệ."
        : `Đã bắt request nhưng chưa đủ điều kiện Batch API: ${(apiTemplate.analysis?.reasons || []).join(", ")}.`,
      apiTemplate.analysis?.ready ? "ok" : "error"
    );
  }

  window.addEventListener(SAVE_CAPTURED, event => {
    receiveSaveRequestCapture(event).catch(error =>
      setStatus(`Không lưu được mẫu API: ${error.message}`, "error")
    );
  });

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

  // Luôn tra giao dịch theo id từ statementDataset hiện hành: sau mỗi lần ghi
  // sổ, dataset bị thay bằng bản clone mới nên mọi tham chiếu giữ từ trước đó
  // đều là dữ liệu cũ.
  function findStatementTransaction(transactionId) {
    const id = String(transactionId || "");
    if (!id) return null;
    return (statementDataset.transactions || []).find(item => String(item.id) === id) || null;
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
      // Ngày nghiệp vụ của phương án là ngày sao kê/danh sách phiếu. Với ca
      // qua đêm, invoiceDateKey đọc từ form có thể là ngày Giờ vào hôm trước.
      invoiceDateKey: transaction?.transactionDate || invoiceSnapshot?.invoiceDateKey || plan?.invoiceDateKey || "",
      // Ngày hóa đơn và khoảng thời gian sử dụng phòng là hai dữ liệu độc lập.
      // Ví dụ phiếu thuộc danh sách 01/06 có thể mang Giờ vào/Ra 24/04.
      // Luôn chốt giờ từ snapshot thật của website để payload API và bước
      // đối soát sau lưu không làm mất ca hát gốc.
      checkIn: invoiceSnapshot?.checkIn || plan?.checkIn || "",
      checkOut: invoiceSnapshot?.checkOut || plan?.checkOut || "",
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
      // Khoảng ngày của màn hình phát hành nằm ngoài phiên Batch Review nhưng
      // dùng chung một bản ghi, nên phải giữ lại khi Batch Review lưu phiên.
      eInvoiceFromDate: uiSession?.eInvoiceFromDate || "",
      eInvoiceToDate: uiSession?.eInvoiceToDate || "",
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

  // Website không cho hai phiếu cùng PHÒNG chồng giờ. Chỉ cần khoảng giờ rời
  // nhau là tái sử dụng được phòng, nên phải lưu cả giờ vào/ra đã dùng chứ
  // không chỉ tên phòng — số phòng có hạn (12) mà một ngày có thể nhiều phiếu hơn.
  function roomBookingsOnDate(dateKey, excludedTransactionId) {
    const day = String(dateKey || "");
    const excluded = String(excludedTransactionId || "");
    const bookings = new Map();
    for (const item of statementDataset.transactions || []) {
      if (String(item.id) === excluded) continue;
      if (String(item.transactionDate || "") !== day) continue;
      const room = normalizeRoomText(item.newInvoiceRoomName);
      if (!room) continue;
      const from = parseUiDateTime(item.newInvoiceCheckIn);
      const to = parseUiDateTime(item.newInvoiceCheckOut);
      if (!from || !to) continue;
      const key = room.toLocaleUpperCase("vi-VN");
      if (!bookings.has(key)) bookings.set(key, []);
      bookings.get(key).push({ from: from.getTime(), to: to.getTime() });
    }
    return bookings;
  }

  // Hai khoảng giờ chồng nhau khi khoảng này bắt đầu trước khi khoảng kia kết
  // thúc và ngược lại. Chạm mép (giờ ra = giờ vào phiếu sau) vẫn coi là chồng
  // để chừa biên an toàn cho website.
  function roomIsFreeForRange(bookings, roomName, checkIn, checkOut) {
    const key = normalizeRoomText(roomName).toLocaleUpperCase("vi-VN");
    const slots = bookings.get(key);
    if (!slots?.length) return true;
    const from = parseUiDateTime(checkIn);
    const to = parseUiDateTime(checkOut);
    if (!from || !to) return false;
    return !slots.some(slot => from.getTime() <= slot.to && slot.from <= to.getTime());
  }

  // Số phiếu mà các dòng KHÁC đang giữ. Một dòng chỉ ghi `transaction.invoiceNo`
  // sau khi lưu thành công, còn trước đó số phiếu Batch Review đã gán chỉ nằm ở
  // `plan.invoiceNo`. Nếu chỉ loại theo `transaction.id` thì số phiếu của chính
  // dòng đang xử lý — do một dòng khác đã lưu trước đó cũng trỏ tới — bị coi là
  // "đã dùng" và phiếu tự chặn chính nó với lỗi "Không tìm thấy phiếu chưa xuất".
  function rowInvoiceNos(item) {
    return [
      item?.invoiceNo,
      item?.pendingPlan?.invoiceNo,
      item?.batchApprovedPlan?.invoiceNo
    ].map(value => String(value || "")).filter(Boolean);
  }

  function otherRowsInvoiceNos(transaction, plan) {
    const ownNumbers = new Set([
      ...rowInvoiceNos(transaction),
      String(plan?.invoiceNo || "")
    ].filter(Boolean));
    const used = new Set();
    for (const item of statementDataset.transactions || []) {
      if (String(item.id) === String(transaction?.id)) continue;
      for (const invoiceNo of rowInvoiceNos(item)) used.add(invoiceNo);
    }
    // Số phiếu của chính dòng này không bao giờ được coi là đã bị dòng khác giữ.
    for (const invoiceNo of ownNumbers) used.delete(invoiceNo);
    return [...used];
  }

  function newInvoicePlanValidationError(plan, transaction) {
    if (!plan?.requiresNewInvoice) return "";
    if (plan.calculationVersion !== CALCULATION_VERSION) return "Phương án được tính bằng công thức cũ.";
    if (!Array.isArray(plan.items) || !plan.items.length) return "Phương án chưa có mặt hàng.";
    const grand = Math.round(Number(transaction?.credit || plan.targetGrand || 0));
    const goods = Math.round(Number(plan.goods || 0));
    const hour = Math.round(Number(plan.hour || 0));
    const hourFromTime = Math.round(Number(plan.hourFromTime || 0));
    const tax = Math.round(Number(plan.tax || 0));
    if (plan.specialRule === "under-500k-two-beers" &&
        (plan.items.length !== 1 || Math.round(Number(plan.items[0]?.qty) || 0) !== SMALL_INVOICE_BEER_QTY)) {
      return "Phương án dưới 500.000đ phải có đúng một mã bia với số lượng 2 chai.";
    }
    // Sàn phút danh nghĩa phải kẹp theo trần 35% tổng trước VAT giống lúc lập
    // phương án. Nếu giữ nguyên mốc 30/50 phút ở đây thì phương án hợp lệ vừa
    // tính xong (Tiền giờ đã bị kẹp về trần) lại bị chính hàm này loại ngay,
    // và giao dịch quay về trạng thái Lỗi dù solver đã khớp tuyệt đối.
    const preTaxForCap = Math.max(0, grand - Math.round(Number(plan.tax || 0)));
    const hourCap = preTaxForCap > 0
      ? Math.max(0, Math.floor(preTaxForCap * MAX_HOUR_PRETAX_RATIO))
      : 0;
    const nominalMinimumHour = grand > 1000000 ? 500000 : 300000;
    const minimumHour = plan.specialRule === "under-500k-two-beers"
      ? 0
      : (hourCap > 0 ? Math.min(nominalMinimumHour, hourCap) : nominalMinimumHour);
    if (hour <= 0 || hourFromTime <= 0 || hourFromTime % 6000 !== 0) {
      return "Giờ vào/ra chưa sinh được tiền giờ theo đúng bước 6.000đ của website.";
    }
    if (Math.abs(hour - hourFromTime) > 6000) {
      return "Phần bù trực tiếp vào tiền giờ vượt quá một bước 6.000đ.";
    }
    if (hour < minimumHour) return `Tiền giờ thấp hơn mức tối thiểu ${formatMoney(minimumHour)}đ.`;
    if (goods + hour + tax !== grand) return "Tiền hàng + tiền giờ + VAT chưa khớp sao kê.";
    return "";
  }

  // Phiếu mới được tạo từ sơ đồ phòng (màn hình Bán hàng), nhưng bước đối soát
  // sau lưu lại cần grid "danh sách Bán hàng" để mở lại phiếu từ server. Hai màn
  // hình này khác nhau: sau khi lưu xong, tab worker vẫn đứng ở sơ đồ phòng nên
  // findInvoiceCandidates ném "Hãy mở màn hình danh sách Bán hàng trước." và
  // giao dịch kẹt ở trạng thái Chờ lưu/đối soát dù hóa đơn đã lưu thành công.
  async function ensureInvoiceListScreen(timeout = 12000) {
    if (await request("hasInvoiceList").then(r => r?.present).catch(() => false)) return true;
    const listAnchor = Array.from(document.querySelectorAll("a"))
      .find(anchor => /^Bán hàng$/i.test((anchor.innerText || "").trim()) && anchor.href);
    if (!listAnchor) return false;
    listAnchor.click();
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      const present = await request("hasInvoiceList").then(r => r?.present).catch(() => false);
      if (present) return true;
    }
    return false;
  }

  async function autoOpenIdleRoomInvoiceForm() {
    if (!pendingNewInvoice || !isSalesWorkspacePage()) return { opened: false, roomName: "" };
    const bookings = roomBookingsOnDate(pendingNewInvoice.transactionDate, pendingNewInvoice.transactionId);
    const plannedCheckIn = pendingNewInvoice.plan?.checkIn || "";
    const plannedCheckOut = pendingNewInvoice.plan?.checkOut || "";
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const saveButton = Array.from(document.querySelectorAll("button"))
        .find(button => (button.innerText || "").trim() === "Lưu HĐ" && isRendered(button));
      if (saveButton) return { opened: true, roomName: pendingNewInvoice.roomName || "" };
      const idleRooms = Array.from(document.querySelectorAll(".table.context"))
        .filter(room => {
          const image = room.querySelector("img[alt]");
          return isRendered(room) && isRendered(image) &&
            isIdleRoomLabel(image?.getAttribute("alt"), room.innerText);
        });
      // Chọn phòng mà khoảng giờ của phương án không chồng với phiếu nào đã lập
      // trong ngày. Phòng tái sử dụng được miễn là giờ rời nhau.
      const idleRoom = idleRooms.find(room => {
        const name = normalizeRoomText(room.querySelector("img[alt]")?.getAttribute("alt"));
        if (!name) return false;
        if (!plannedCheckIn || !plannedCheckOut) return true;
        return roomIsFreeForRange(bookings, name, plannedCheckIn, plannedCheckOut);
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
    // Các bản cũ từng ghi appliedAt trước khi API thực sự thành công, khiến một
    // lần lưu lỗi bị kẹt vĩnh viễn. Chỉ savedAt mới được coi là hoàn tất.
    if (pendingNewInvoice?.savedAt) return false;
    if (pendingNewInvoice?.appliedAt && !pendingNewInvoice?.savedAt) {
      pendingNewInvoice.appliedAt = "";
    }
    currentBankTransaction = transaction;
    document.getElementById("it-target").value = formatMoney(plan.targetGrand || transaction.credit);
    setStatus("Dang tao phien va thanh toan phieu moi qua 2 request API chinh thuc...", "warn");
    const apiTargetGrand = Math.round(Number(plan.targetGrand || transaction.credit) || 0);
    const apiExpected = {
      items: plan.items,
      targetGrand: apiTargetGrand,
      targetGoods: plan.goods,
      targetHour: plan.hour,
      targetTax: plan.tax,
      invoiceDateKey: transaction.transactionDate,
      statementClientTime: transaction.requestedAt || "",
      checkIn: plan.checkIn,
      checkOut: plan.checkOut
    };
    // Always trace extension-generated DoSave calls. This is independent from
    // the manual "Bắt API" button and captures both success and failure.
    await request("armApiTrace");
    let apiSaved;
    try {
      apiSaved = await request("createAndPayFreshInvoiceViaApi", apiExpected);
      await persistGeneratedInvoiceApiDebugLog({
        expected: apiExpected,
        outcome: "success",
        result: apiSaved
      });
    } catch (error) {
      try {
        await persistGeneratedInvoiceApiDebugLog({
          expected: apiExpected,
          outcome: "error",
          error: error.message
        });
      } catch (logError) {
        console.error("[InvoiceTarget] Không thể xuất API debug log", logError);
      }
      throw error;
    }
    if (!apiSaved?.saved || !apiSaved?.savedRecordId || !apiSaved?.invoiceNo) {
      throw new Error("Website chua xac nhan du hai buoc tao phien va thanh toan.");
    }
    const apiCompletedAt = new Date().toISOString();
    transaction.invoiceNo = apiSaved.invoiceNo;
    transaction.status = "planned";
    transaction.pendingPlan = {
      ...structuredClone(plan),
      invoiceNo: apiSaved.invoiceNo,
      invoiceDateKey: transaction.transactionDate,
      grand: apiTargetGrand,
      apiSavedAt: apiCompletedAt,
      apiSavedRecordId: apiSaved.savedRecordId,
      createdAt: apiCompletedAt
    };
    transaction.apiSavedAt = apiCompletedAt;
    transaction.apiSavedRecordId = apiSaved.savedRecordId;
    transaction.verifiedAt = "";
    transaction.ledgerId = "";
    pendingNewInvoice.invoiceNo = apiSaved.invoiceNo;
    pendingNewInvoice.appliedAt = apiCompletedAt;
    pendingNewInvoice.savedAt = apiCompletedAt;
    pendingNewInvoice.savedRecordId = apiSaved.savedRecordId;
    await InvoiceMappingStore.saveStatement(statementDataset);
    syncBatchPlanTransaction(transaction);
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
    renderBatchPlans();

    // Worker tab only performs the official create/payment request. The
    // original Batch Review tab already has the invoice-list grid, so it will
    // read the saved invoice back from the server and only then commit stock.
    setStatus(
      `Da luu ${apiSaved.invoiceNo}. Dang chuyen ve tab Batch Review de doi soat; ton kho chua bi tru.`,
      "warn"
    );
    window.setTimeout(() => {
      chrome.runtime?.sendMessage?.({ type: "invoiceTarget.closeCurrentBatchWorkerTab" }, () => {
        void chrome.runtime?.lastError;
      });
    }, 500);
    return true;

    let apiClosed = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      apiClosed = await request("closeInvoiceDetail");
      if (apiClosed?.closed) break;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (!apiClosed?.closed) {
      setStatus(
        `API da tao va thanh toan ${apiSaved.invoiceNo}, nhung form hien tai chua dong de doc lai. ` +
        "Phieu dang Cho luu/doi soat va ton kho CHUA bi tru; khong chay lai API.",
        "warn"
      );
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 450));
    // Tab worker vừa tạo phiếu từ sơ đồ phòng nên chưa có grid danh sách. Phải
    // chuyển về màn hình danh sách Bán hàng thì bước đọc lại từ server bên dưới
    // mới chạy được.
    const listReady = await ensureInvoiceListScreen();
    if (!listReady) {
      setStatus(
        `Da luu ${apiSaved.invoiceNo} nhung chua mo duoc man hinh danh sach Ban hang de doc lai. ` +
        "Hay mo danh sach Ban hang roi bam Doi soat sau luu; khong chay lai API.",
        "warn"
      );
      return true;
    }
    const apiBatchIndex = batchPlans.findIndex(entry =>
      String(entry.transactionId) === String(transaction.id)
    );
    const apiVerification = apiBatchIndex >= 0
      ? await verifyBatchSavedInvoice({ target: { closest: () => batchButtonProxy(apiBatchIndex) } })
      : { verified: false, error: "batch-entry-not-found" };
    const verifiedTransaction = findStatementTransaction(transaction.id);
    if (apiVerification?.verified && verifiedTransaction?.status === "done") {
      pendingNewInvoice = null;
      await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: null });
      renderBatchPlans();
      renderStatementAdmin();
      setStatus(
        `Da luu, doc lai va doi soat ${apiSaved.invoiceNo}. ` +
        "Sao ke da chuyen Da xu ly va ton kho extension da duoc tru.",
        "ok"
      );
      // Worker tab has finished all persistent work. Close only after storage has been
      // committed, so the main Batch Review tab can observe status=done and continue.
      window.setTimeout(() => {
        chrome.runtime?.sendMessage?.({ type: "invoiceTarget.closeCurrentBatchWorkerTab" }, () => {
          void chrome.runtime?.lastError;
        });
      }, 700);
      return true;
    }
    setStatus(
      `Da luu ${apiSaved.invoiceNo} nhung chua doc lai khop tu server: ${apiVerification?.error || "khong ro loi"}. ` +
      "Trang thai van Cho luu/doi soat va ton kho CHUA bi tru; bam Doi soat sau luu, khong chay lai API.",
      "warn"
    );
    return true;

    setStatus("Đang áp dụng phương án đã Accept từ Batch Review vào phiếu mới…", "warn");
    // Phiếu mới: được phép đặt cả giờ vào (từ 17:00 trở đi) lẫn giờ ra.
    if (plan.checkIn && plan.checkOut) {
      await request("applyInvoiceTimes", {
        checkIn: plan.checkIn,
        checkOut: plan.checkOut,
        keepCheckIn: false
      });
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
      targetTax: plan.tax,
      checkIn: plan.checkIn || "",
      checkOut: plan.checkOut || ""
    });
    latestScan = await request("scan");
    const actualGrand = Math.round(Number(latestScan.currentGrand || applied.currentGrand || 0));
    const targetGrand = Math.round(Number(plan.targetGrand || 0));
    const needsApiOverride = actualGrand !== targetGrand;
    if (needsApiOverride && !apiTemplate?.analysis?.ready) {
      throw new Error(`Form mới đang có tổng ${formatMoney(actualGrand)}, chưa khớp ${formatMoney(targetGrand)}; chưa có mẫu API hợp lệ.`);
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
    pendingNewInvoice.invoiceNo = transaction.invoiceNo;
    pendingNewInvoice.formGrand = actualGrand;
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
    renderBatchPlans();
    setStatus(
      needsApiOverride
        ? `Website đang hiển thị ${formatMoney(actualGrand)}đ; đang lưu API với tổng chính xác ${formatMoney(targetGrand)}đ…`
        : `Đang lưu phiếu mới ${formatMoney(targetGrand)}đ qua API chính thức của website…`,
      "warn"
    );
    const saved = await request("saveCurrentInvoiceViaApi", {
      invoiceNo: transaction.invoiceNo || "",
      items: plan.items,
      targetGrand,
      targetGoods: plan.goods,
      targetHour: plan.hour,
      targetTax: plan.tax,
      invoiceDateKey: transaction.transactionDate,
      checkIn: plan.checkIn,
      checkOut: plan.checkOut,
      requiresFreshDraft: true
    });
    if (!saved?.saved) throw new Error("Website chưa xác nhận lưu phiếu mới qua API.");
    pendingNewInvoice.appliedAt = new Date().toISOString();
    pendingNewInvoice.savedAt = new Date().toISOString();
    pendingNewInvoice.savedRecordId = saved.savedRecordId || "";
    transaction.apiSavedAt = pendingNewInvoice.savedAt;
    transaction.apiSavedRecordId = pendingNewInvoice.savedRecordId;
    transaction.pendingPlan.apiSavedAt = pendingNewInvoice.savedAt;
    transaction.pendingPlan.apiSavedRecordId = pendingNewInvoice.savedRecordId;
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
    const closed = await request("closeInvoiceDetail");
    if (!closed?.closed) {
      throw new Error("API đã lưu phiếu mới nhưng form chưa đóng; hãy bấm Thoát rồi tạo lại Batch Review để đối soát.");
    }
    setStatus(
      `Đã lưu API phiếu mới ${formatMoney(targetGrand)}đ với ${plan.items.length} mã và đã đóng form. ` +
      "Hãy quay lại danh sách rồi Tạo Batch Review để đối soát và ghi tồn kho.",
      "ok"
    );
    return true;
  }

  async function resumeSavedPendingInvoice() {
    if (!pendingNewInvoice?.savedAt || !pendingNewInvoice?.invoiceNo) return false;
    const transaction = findStatementTransaction(pendingNewInvoice.transactionId);
    if (!transaction) return false;

    const plan = transaction.pendingPlan || pendingNewInvoice.plan;
    if (!plan) return false;
    transaction.invoiceNo = transaction.invoiceNo || pendingNewInvoice.invoiceNo;
    transaction.pendingPlan = {
      ...structuredClone(plan),
      invoiceNo: transaction.invoiceNo,
      invoiceDateKey: transaction.transactionDate,
      apiSavedAt: plan.apiSavedAt || pendingNewInvoice.savedAt,
      apiSavedRecordId: plan.apiSavedRecordId || pendingNewInvoice.savedRecordId || ""
    };
    transaction.status = "planned";

    const index = batchPlans.findIndex(entry =>
      String(entry.transactionId) === String(transaction.id)
    );
    if (index < 0) return false;
    batchPlans[index] = {
      ...batchPlans[index],
      status: "planned",
      transaction,
      plan: transaction.pendingPlan,
      message: `Đã lưu ${transaction.invoiceNo}; đang tự đối soát lại từ website.`
    };
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
    renderBatchPlans();
    setStatus(`Đã lưu ${transaction.invoiceNo}; đang tự dò lại trên danh sách và đối soát…`, "warn");

    const verification = await verifyBatchSavedInvoice({
      target: { closest: () => batchButtonProxy(index) }
    });
    const verifiedTransaction = findStatementTransaction(transaction.id);
    if (!verification?.verified || verifiedTransaction?.status !== "done") {
      const reason = verification?.error ? ` ${verification.error}` : "";
      setStatus(
        `Phiếu ${transaction.invoiceNo} đã lưu nhưng chưa tự đối soát được.${reason} ` +
        "Sao kê và tồn kho chưa bị thay đổi; không chạy lại API tạo phiếu.",
        "warn"
      );
      return false;
    }

    pendingNewInvoice = null;
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: null });
    renderBatchPlans();
    renderStatementAdmin();
    renderWorkflowDashboard();
    setStatus(
      `Đã tự đọc lại và đối soát ${transaction.invoiceNo}. Sao kê đã xử lý và tồn kho đã được ghi nhận.`,
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
      const pendingPlanError = newInvoicePlanValidationError(pendingNewInvoice.plan, transaction);
      if (pendingPlanError) {
        if (transaction) {
          transaction.status = "pending";
          transaction.pendingPlan = null;
          transaction.batchApprovedPlan = null;
          delete transaction.acceptedGrandOverride;
          delete transaction.acceptedGrandOverrideAt;
          transaction.blockedNote = `${pendingPlanError} Đã hủy phương án cũ và cần tính lại.`;
          transaction.blockedAt = new Date().toISOString();
          await InvoiceMappingStore.saveStatement(statementDataset);
        }
        pendingNewInvoice = null;
        batchPlans = [];
        await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: null, batchPlans: [] });
        if (isSalesWorkspacePage()) {
          try {
            const openForm = await request("scan");
            if (openForm?.ready) await request("closeInvoiceDetail");
          } catch (error) {
            console.warn("[InvoiceTarget stale new invoice cleanup]", error);
          }
        }
        renderBatchPlans();
        renderStatementRows();
        setStatus(`${pendingPlanError} Extension đã hủy phương án cũ; hãy bấm Tạo Batch Review để tính lại.`, "error");
        return;
      }
      const date = transaction?.transactionDate || pendingNewInvoice.transactionDate || "";
      const credit = Number(transaction?.credit || pendingNewInvoice.credit || 0);
      if (pendingNewInvoice.savedAt && pendingNewInvoice.invoiceNo && isSalesWorkspacePage()) {
        await resumeSavedPendingInvoice();
        return;
      }
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
          // Ghi phòng KÈM khoảng giờ vào sao kê: phiếu mới sau trong cùng ngày
          // chỉ cần tránh trùng khoảng giờ, vẫn dùng lại được phòng này.
          if (transaction) {
            transaction.newInvoiceRoomName = opened.roomName;
            transaction.newInvoiceCheckIn = pendingNewInvoice.plan?.checkIn || "";
            transaction.newInvoiceCheckOut = pendingNewInvoice.plan?.checkOut || "";
            await InvoiceMappingStore.saveStatement(statementDataset);
          }
          await saveBatchUiSession({ panelOpen: true });
          if (transaction && pendingNewInvoice.plan?.requiresNewInvoice) {
            try {
              await applyPendingNewInvoicePlan(transaction);
            } catch (error) {
              pendingApplyError = error.message;
            }
          }
        }
        if (pendingNewInvoice.savedAt) return;
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

  // Phát hành có hai đường chạy rất khác nhau về thời gian, nên không dùng chung
  // một hạn chờ:
  //   - Có sẵn mặt hàng (knownItems): bridge chỉ gọi kiemTraThongTin +
  //     phatHanhHoaDon, không đụng giao diện, không polling. 30s là rất rộng.
  //   - Không có: bridge phải mở phiếu trên danh sách Bán hàng, chờ lưới Kendo,
  //     đọc dòng hàng rồi đóng form. Chuỗi polling này có thể mất hàng chục giây
  //     nên vẫn cần 90s.
  // Hạn chờ chỉ là ngưỡng báo lỗi phía content script; nó KHÔNG hủy request đang
  // chạy trong bridge. Phiếu quá hạn vẫn có thể đã phát hành xong trên server,
  // và đúng tình huống đó được confirmIssuedAfterFailure đọc lại và ghi sổ.
  const ISSUE_TIMEOUT_FAST_MS = 30000;
  const ISSUE_TIMEOUT_UI_MS = 90000;

  function issueTimeoutMs(payload) {
    return payload?.knownItems?.length ? ISSUE_TIMEOUT_FAST_MS : ISSUE_TIMEOUT_UI_MS;
  }

  function request(action, payload) {
    return new Promise((resolve, reject) => {
      const id = `it-${Date.now()}-${sequence += 1}`;
      const timeoutMs = ["replaceInvoiceItems", "applyInvoicePlan"].includes(action) ? 90000
        : action === "issueEInvoice" ? issueTimeoutMs(payload)
        : action === "readInvoiceItems" ? 45000
        : ["findInvoiceCandidates", "findIssuedInvoiceByAmount", "fetchEInvoiceList", "createProductViaApi", "fetchLatestProductCatalog"].includes(action) ? 30000
        : 5000;
      const timeout = setTimeout(
        () => reject(new Error(`Trang không phản hồi sau ${Math.round(timeoutMs / 1000)}s (${action}).`)),
        timeoutMs
      );
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
    mappingDataset = InvoiceSharedWarehouse.overlayMappings(mappingDataset, sharedWarehouse);
    inventory = InvoiceMappingEngine.buildInventory(mappingDataset);
    mappingSummary = InvoiceMappingEngine.summarize(mappingDataset);
    const node = document.getElementById("it-stock-source");
    if (node) node.innerHTML = stockSummaryHtml();
    renderWorkflowDashboard();
    if (document.getElementById("it-stock-admin") && !document.getElementById("it-stock-admin").hidden) {
      renderStockAdmin();
    }
  }

  // Gộp 4 dòng bối cảnh thành một dòng chip: đây là thông tin tham chiếu, đọc
  // lướt để biết đang làm trên dữ liệu nào, không phải thứ cần đọc kỹ mỗi lần.
  // Chi tiết đầy đủ đưa vào tooltip của từng chip.
  function stockSummaryHtml() {
    const warehouseSource = sharedWarehouse.initialized ? sharedWarehouse.source : "chưa khởi tạo";
    const warehouseTime = sharedWarehouse.updatedAt
      ? new Date(sharedWarehouse.updatedAt).toLocaleString("vi-VN")
      : "chưa cập nhật";
    const pending = Number(mappingSummary.review || 0) + Number(mappingSummary.unmatched || 0);
    const chips = [
      {
        text: `<b>${escapeHtml(pageTenantLabel)}</b>`,
        title: "Cơ sở đang làm · Kho vật lý dùng chung Kim Giang + Linh Đàm"
      },
      {
        text: `Kho: <b>${escapeHtml(warehouseSource)}</b>`,
        title: `Nguồn kho: ${warehouseSource} · Cập nhật: ${warehouseTime}`
      },
      {
        text: `<b>${inventory.length}</b> mã kho`,
        title: `${inventory.length} mã đủ điều kiện đưa vào hóa đơn`
      },
      {
        // Chỉ nêu số còn phải xử lý; đã xác nhận là trạng thái bình thường.
        text: pending
          ? `<b class="warn">${pending}</b> mã chờ ánh xạ`
          : `<b>${mappingSummary.confirmed || 0}</b> mã đã ánh xạ`,
        title: `${mappingSummary.confirmed || 0} đã xác nhận · ${mappingSummary.review || 0} cần duyệt · ${mappingSummary.unmatched || 0} chưa khớp`
      },
      {
        text: `Web: <b>${webCatalog.length}</b> mã`,
        title: `Danh mục web: ${webCatalog.length} mã từ ${catalogDataset.source || "data.xlsx"}`
      }
    ];
    return chips
      .map(chip => `<span title="${escapeHtml(chip.title)}">${chip.text}</span>`)
      .join("");
  }

  // Giao dịch lớn phải được người rà bằng mắt trước khi vào luồng lập phiếu.
  // Sao kê trộn lẫn doanh thu với các khoản KHÔNG phải doanh thu — nạp tiền vào
  // tài khoản, lãi ngân hàng, chuyển nội bộ — và những khoản đó thường là số
  // lớn, tròn. Lập hóa đơn cho chúng là sai bản chất và không hoàn tác được.
  //
  // Ngưỡng 20 triệu chọn theo thực tế: giao dịch dịch vụ thường dưới mức này,
  // còn các khoản nạp tiền quan sát được đều vượt xa (60tr, 150tr).
  const MANUAL_REVIEW_CREDIT_THRESHOLD = 20000000;

  const OPEN_STATEMENT_STATUSES = new Set([
    "pending",
    "review",
    "planned",
    "batch_ready",
    "already_issued",
    "needs_new_invoice",
    "error"
  ]);

  function isOpenStatementTransaction(item) {
    return OPEN_STATEMENT_STATUSES.has(String(item?.status || "pending"));
  }

  function statementDateRange() {
    const dates = (statementDataset.transactions || [])
      .map(item => String(item.transactionDate || ""))
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort();
    return {
      fromDate: dates[0] || "",
      toDate: dates[dates.length - 1] || ""
    };
  }

  function accountingDashboardPeriod() {
    const fallback = statementDateRange();
    return {
      fromDate: document.getElementById("it-accounting-from")?.value || fallback.fromDate,
      toDate: document.getElementById("it-accounting-to")?.value || fallback.toDate
    };
  }

  function isInAccountingPeriod(item, period) {
    const date = String(item?.transactionDate || "");
    if (!date) return false;
    return (!period.fromDate || date >= period.fromDate) && (!period.toDate || date <= period.toDate);
  }

  function accountingIssueAction(item) {
    const status = String(item?.status || "pending");
    if (Number(mappingSummary.review || 0) + Number(mappingSummary.unmatched || 0) > 0) {
      return { action: "mapping", label: "Kiểm tra ánh xạ" };
    }
    if (["error", "needs_new_invoice", "batch_ready", "planned", "already_issued"].includes(status) || item?.blockedNote) {
      return { action: "batch", label: "Mở Batch Review" };
    }
    return { action: "statement", label: "Kiểm tra giao dịch" };
  }

  function accountingIssueText(item) {
    if (item?.blockedNote) return String(item.blockedNote);
    return {
      error: "Giao dịch đang lỗi và cần kiểm tra lại phương án.",
      review: "Giao dịch cần kế toán kiểm tra.",
      needs_new_invoice: "Chưa có phiếu phù hợp; cần tạo phiếu mới.",
      planned: "Phiếu đã áp dụng nhưng chưa đối soát thành công.",
      batch_ready: "Phương án đã Accept nhưng chưa được lưu.",
      already_issued: "Đã thấy hóa đơn khớp; cần xác nhận liên kết.",
      pending: "Giao dịch chưa được lập phương án."
    }[String(item?.status || "pending")] || "Giao dịch chưa hoàn tất.";
  }

  function accountingDashboardSnapshot() {
    const period = accountingDashboardPeriod();
    const transactions = (statementDataset.transactions || []).filter(item => isInAccountingPeriod(item, period));
    const open = transactions.filter(isOpenStatementTransaction);
    const done = transactions.filter(item => item.status === "done");
    const ignored = transactions.filter(item => ["ignored", "skipped"].includes(item.status));
    const waitingSave = transactions.filter(item => ["batch_ready", "planned"].includes(item.status));
    const issues = open.filter(item =>
      item.blockedNote || ["error", "review", "needs_new_invoice", "planned", "batch_ready", "already_issued"].includes(String(item.status))
    );
    const linkedInvoiceNos = new Set(done.map(item => String(item.invoiceNo || "")).filter(Boolean));
    const issuedInvoiceNos = new Set((issuedInvoiceBook.entries || [])
      .map(item => String(item.invoiceNo || ""))
      .filter(invoiceNo => linkedInvoiceNos.has(invoiceNo)));
    const unissued = done.filter(item => !issuedInvoiceNos.has(String(item.invoiceNo || "")));
    const total = rows => rows.reduce((sum, item) => sum + Number(item.credit || 0), 0);
    return {
      period,
      transactions,
      open,
      done,
      ignored,
      waitingSave,
      issues,
      issued: issuedInvoiceNos.size,
      issuedInvoiceNos,
      unissued,
      totalAmount: total(transactions),
      openAmount: total(open),
      doneAmount: total(done)
    };
  }

  function accountingCloseSnapshot() {
    const state = accountingDashboardSnapshot();
    const mappingPending = Number(mappingSummary.review || 0) + Number(mappingSummary.unmatched || 0);
    const checks = [
      {
        key: "catalog",
        ok: webCatalog.length > 0 && catalogDataset.source === "Website API",
        label: "Danh mục website",
        detail: webCatalog.length
          ? `${webCatalog.length} mã · ${catalogDataset.source || "chưa rõ nguồn"}`
          : "Chưa có danh mục mặt hàng",
        action: "stock"
      },
      {
        key: "stock",
        ok: sharedWarehouse.initialized && inventory.length > 0,
        label: "Tồn kho vật lý",
        detail: sharedWarehouse.initialized
          ? `${inventory.length} mã trong kho dùng chung`
          : "Chưa khởi tạo tồn kho dùng chung",
        action: "stock"
      },
      {
        key: "mapping",
        ok: mappingPending === 0,
        label: "Ánh xạ mặt hàng",
        detail: mappingPending ? `${mappingPending} mã còn cần duyệt` : "Không còn mã chờ xử lý",
        action: "mapping"
      },
      {
        key: "statement",
        ok: state.transactions.length > 0,
        label: "Sao kê trong kỳ",
        detail: state.transactions.length
          ? `${state.transactions.length} giao dịch · ${formatMoney(state.totalAmount)} đ`
          : "Không có giao dịch trong khoảng ngày đã chọn",
        action: "statement"
      },
      {
        key: "reconciliation",
        ok: state.open.length === 0,
        label: "Đối soát giao dịch",
        detail: state.open.length
          ? `${state.open.length} giao dịch chưa hoàn tất · ${formatMoney(state.openAmount)} đ`
          : `${state.done.length} giao dịch đã hoàn tất`,
        action: "batch"
      },
      {
        key: "issuance",
        ok: state.done.length === 0 || state.unissued.length === 0,
        label: "Hóa đơn điện tử",
        detail: state.unissued.length
          ? `${state.unissued.length} phiếu đã đối soát chưa có HĐĐT trong sổ extension`
          : `${state.issued}/${state.done.length} phiếu đã phát hành`,
        action: "einvoice"
      }
    ];
    return {
      ...state,
      checks,
      blockers: checks.filter(item => !item.ok),
      ready: checks.every(item => item.ok)
    };
  }

  // Kế toán chỉ cần biết "bây giờ làm gì". Extension đã tính đủ trạng thái ở
  // accountingCloseSnapshot(); hàm này chọn ra đúng một việc kế tiếp và nhãn nút
  // tương ứng, để màn hình chính không bắt người dùng tự đọc rồi tự so sánh.
  const NEXT_ACTION_LABELS = {
    catalog: { button: "Đồng bộ danh mục", hint: "Lấy danh mục mới nhất từ website." },
    stock: { button: "Cập nhật kho", hint: "Khởi tạo hoặc cập nhật tồn kho dùng chung." },
    mapping: { button: "Duyệt ánh xạ", hint: "Ghép nốt các mặt hàng còn chờ xác nhận." },
    statement: { button: "Nhập sao kê", hint: "Nhập file sao kê của kỳ đang chọn." },
    reconciliation: { button: "Lập hóa đơn", hint: "Tạo và duyệt phương án cho giao dịch còn lại." },
    issuance: { button: "Phát hành hóa đơn", hint: "Phát hành HĐĐT cho các phiếu đã đối soát." }
  };

  // snapshot: nhận lại kết quả accountingCloseSnapshot() của hàm gọi. Snapshot
  // duyệt toàn bộ giao dịch trong kỳ (sao kê một tháng có thể hàng trăm dòng) và
  // setStatus chạy trong vòng lặp lưu từng phiếu, nên không tính lại ở đây.
  function nextWorkflowAction(snapshot) {
    const state = snapshot || accountingCloseSnapshot();
    const blocker = state.blockers[0];
    if (!blocker) {
      return { done: true, state, title: "Kỳ này đã xử lý xong", detail: `${state.done.length} giao dịch đã đối soát · ${state.issued} hóa đơn đã phát hành.` };
    }
    const copy = NEXT_ACTION_LABELS[blocker.key] || { button: "Mở màn hình", hint: blocker.detail };
    return {
      done: false,
      state,
      blocker,
      // Chỉ đồng bộ danh mục là chạy được ngay tại chỗ; các việc khác cần mở màn hình.
      inline: blocker.key === "catalog",
      action: blocker.action,
      title: blocker.label,
      detail: blocker.detail,
      hint: copy.hint,
      button: copy.button,
      remaining: state.blockers.length
    };
  }

  function renderNextAction(snapshot) {
    const node = document.getElementById("it-next-action");
    if (!node) return;
    // Việc chạy tại chỗ (đồng bộ danh mục) tự gọi setStatus, mà setStatus lại vẽ
    // lại chính thanh này. Vẽ đè sẽ xóa nút đang khóa, làm mất nhãn "Đang đồng
    // bộ…" và cho bấm lại giữa chừng. Giữ nguyên cho tới khi việc chạy xong.
    if (node.querySelector("#it-next-action-go:disabled")) return;
    const next = nextWorkflowAction(snapshot);
    node.className = `it-next-action ${next.done ? "done" : ""}`;
    node.innerHTML = `<div class="it-next-copy">
        <span class="it-eyebrow">${next.done ? "HOÀN TẤT" : `VIỆC TIẾP THEO${next.remaining > 1 ? ` · CÒN ${next.remaining} MỤC` : ""}`}</span>
        <b>${escapeHtml(next.title)}</b>
        <small>${escapeHtml(next.done ? next.detail : next.hint)}</small>
      </div>
      ${next.done
        ? `<button id="it-next-action-go" type="button" data-action="export">Xuất Excel đối soát</button>`
        : `<button id="it-next-action-go" type="button" class="primary" data-action="${escapeHtml(next.action)}">${escapeHtml(next.button)}</button>`}`;
    const go = node.querySelector("#it-next-action-go");
    go?.addEventListener("click", () => {
      if (next.done) return exportAccountingReport();
      // Truyền đúng nút vừa bấm: syncLatestWebCatalog dùng currentTarget để khóa
      // nút và đổi nhãn "Đang đồng bộ…". Không truyền thì nó khóa nút ở thẻ bước
      // 1, còn nút này vẫn bấm lại được nhiều lần.
      if (next.inline) return syncLatestWebCatalog({ currentTarget: go });
      openAccountingDashboardAction({ target: go });
    });
  }

  function accountingStatusLabel(item) {
    return {
      pending: "Chờ xử lý",
      review: "Cần kiểm tra",
      planned: "Chờ lưu/đối soát",
      batch_ready: "Đã Accept",
      needs_new_invoice: "Cần tạo phiếu",
      already_issued: "Chờ liên kết HĐ",
      error: "Lỗi",
      done: "Đã đối soát",
      ignored: "Bỏ qua",
      skipped: "Bỏ qua"
    }[String(item?.status || "pending")] || String(item?.status || "Chưa rõ");
  }

  function renderAccountingCloseStatus(snapshot) {
    const node = document.getElementById("it-accounting-close-status");
    if (!node) return;
    const state = snapshot || accountingCloseSnapshot();
    node.className = `it-accounting-close-status ${state.ready ? "ready" : "blocked"}`;
    node.innerHTML = `<div class="it-accounting-close-head"><div><b>${state.ready ? "Sẵn sàng chốt kỳ" : `Chưa thể chốt kỳ · ${state.blockers.length} mục cần xử lý`}</b><span>${escapeHtml(state.period.fromDate || "…")} → ${escapeHtml(state.period.toDate || "…")} · ${escapeHtml(pageTenantLabel)}</span></div><span class="it-close-badge">${state.ready ? "ĐỦ ĐIỀU KIỆN" : "CẦN HOÀN TẤT"}</span></div>
      <div class="it-accounting-check-list">${state.checks.map(check => `<button type="button" data-action="${check.action}" class="${check.ok ? "ok" : "warn"}"><i>${check.ok ? "✓" : "!"}</i><span><b>${escapeHtml(check.label)}</b><small>${escapeHtml(check.detail)}</small></span></button>`).join("")}</div>`;
    node.querySelectorAll("button[data-action]").forEach(button => button.addEventListener("click", openAccountingDashboardAction));
  }

  function accountingReportSheets() {
    const state = accountingCloseSnapshot();
    const issuedByInvoiceNo = new Map((issuedInvoiceBook.entries || [])
      .map(entry => [String(entry.invoiceNo || ""), entry]));
    const periodLabel = `${state.period.fromDate || "…"} → ${state.period.toDate || "…"}`;
    const summaryRows = [
      ["Cơ sở", pageTenantLabel],
      ["Kỳ đối soát", periodLabel],
      ["Trạng thái chốt kỳ", state.ready ? "Sẵn sàng" : "Chưa sẵn sàng"],
      ["Tổng giao dịch", state.transactions.length],
      ["Tổng tiền sao kê", state.totalAmount],
      ["Đã đối soát", state.done.length],
      ["Tiền đã đối soát", state.doneAmount],
      ["Chưa hoàn tất", state.open.length],
      ["Tiền chưa hoàn tất", state.openAmount],
      ["Đã bỏ qua", state.ignored.length],
      ["HĐĐT đã phát hành", state.issued],
      ["Phiếu chưa phát hành HĐĐT", state.unissued.length],
      ["Kết luận", state.ready ? "Đủ điều kiện chốt kỳ" : `Còn ${state.blockers.length} nhóm dữ liệu cần xử lý`]
    ];
    const transactionRows = state.transactions.map(item => {
      const invoiceNo = String(item.invoiceNo || "");
      const issued = issuedByInvoiceNo.get(invoiceNo);
      return [
        item.transactionDate || "",
        item.requestedAt || "",
        item.reference || "",
        item.description || "",
        Number(item.credit || 0),
        accountingStatusLabel(item),
        invoiceNo,
        item.reconciledAt || "",
        issued ? "Đã phát hành" : (item.status === "done" ? "Chưa phát hành" : "—"),
        issued?.soHoaDon || "",
        issued?.soKyHieu || "",
        item.blockedNote || item.reconciledNote || ""
      ];
    });
    const issueRows = [
      ...state.blockers.map(item => ["Toàn hệ thống", item.label, item.detail, item.ok ? "Đạt" : "Cần xử lý"]),
      ...state.issues.map(item => [
        item.transactionDate || "",
        item.invoiceNo || item.reference || "Chưa có phiếu",
        accountingIssueText(item),
        accountingStatusLabel(item)
      ])
    ];
    return {
      state,
      sheets: [
        {
          name: "Tong quan",
          columns: [{ header: "Chỉ tiêu", width: 30 }, { header: "Giá trị", width: 34 }],
          rows: summaryRows
        },
        {
          name: "Giao dich",
          columns: [
            { header: "Ngày đối soát", width: 15 }, { header: "Ngày KH thực hiện", width: 22 },
            { header: "Số tham chiếu", width: 18 }, { header: "Diễn giải", width: 48 },
            { header: "Credit", width: 16 }, { header: "Trạng thái", width: 20 },
            { header: "Số phiếu", width: 18 }, { header: "Đối soát lúc", width: 24 },
            { header: "HĐĐT", width: 18 }, { header: "Số hóa đơn", width: 16 },
            { header: "Ký hiệu", width: 16 }, { header: "Ghi chú", width: 52 }
          ],
          rows: transactionRows
        },
        {
          name: "Ton dong",
          columns: [
            { header: "Ngày/Phạm vi", width: 18 }, { header: "Phiếu/Hạng mục", width: 28 },
            { header: "Nội dung cần xử lý", width: 68 }, { header: "Trạng thái", width: 20 }
          ],
          rows: issueRows
        }
      ]
    };
  }

  async function exportAccountingReport() {
    try {
      const report = accountingReportSheets();
      if (!report.state.transactions.length) {
        return setStatus("Không có giao dịch trong kỳ đã chọn để xuất báo cáo.", "error");
      }
      const bytes = InvoiceXlsxWriter.build(report.sheets);
      const exportedAt = new Date().toISOString();
      await downloadBase64(
        InvoiceXlsxWriter.toBase64(bytes),
        `DoiSoat_${pageTenantFileLabel}_${report.state.period.fromDate || "all"}_${report.state.period.toDate || "all"}_${localTimestamp(exportedAt)}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      setStatus(
        `Đã xuất báo cáo đối soát ${report.state.transactions.length} giao dịch. ` +
        (report.state.ready ? "Kỳ này đủ điều kiện chốt." : `Còn ${report.state.blockers.length} nhóm dữ liệu cần xử lý.`),
        report.state.ready ? "ok" : "warn"
      );
    } catch (error) {
      setStatus(`Không xuất được báo cáo đối soát: ${error.message}`, "error");
    }
  }

  function openAccountingDashboardAction(event) {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "stock") setStockMode(true);
    else if (action === "mapping") setMappingMode(true);
    else if (action === "statement") setStatementMode(true);
    else if (action === "batch") showBatchReviewMode(true, true);
    else if (action === "einvoice") openEInvoiceAdmin().catch(error => setStatus(error.message, "error"));
    // Xuất file hạch toán là việc cuối của quy trình. Cho gọi thẳng từ dòng trạng
    // thái vừa báo phát hành xong, không bắt kế toán sang tab Kho tìm nút.
    else if (action === "issued-export") exportIssuedInvoices().catch(error => setStatus(error.message, "error"));
    else if (action === "export") exportAccountingReport().catch(error => setStatus(error.message, "error"));
    // Rà giao dịch lớn: mở màn sao kê và lọc sẵn về đúng nhóm cần kiểm, thay vì
    // thả người dùng vào danh sách đầy đủ rồi bắt tự tìm.
    else if (action === "review-large") {
      setStatementMode(true);
      const filter = document.getElementById("it-statement-filter");
      if (filter) {
        filter.value = "review";
        renderStatementRows();
      }
    }
  }

  function refreshAccountingDashboard() {
    const fromInput = document.getElementById("it-accounting-from");
    const toInput = document.getElementById("it-accounting-to");
    if (fromInput?.value && toInput?.value && fromInput.value > toInput.value) {
      const previousFrom = fromInput.value;
      fromInput.value = toInput.value;
      toInput.value = previousFrom;
    }
    renderAccountingDashboard();
  }

  function renderAccountingDashboard() {
    const kpis = document.getElementById("it-accounting-kpis");
    const queue = document.getElementById("it-accounting-queue");
    if (!kpis || !queue) return;
    const range = statementDateRange();
    const fromInput = document.getElementById("it-accounting-from");
    const toInput = document.getElementById("it-accounting-to");
    if (fromInput && !fromInput.value) fromInput.value = range.fromDate;
    if (toInput && !toInput.value) toInput.value = range.toDate;
    const state = accountingDashboardSnapshot();
    kpis.innerHTML = `
      <div><small>Tổng sao kê</small><strong>${formatMoney(state.totalAmount)} đ</strong><span>${state.transactions.length} giao dịch trong kỳ</span></div>
      <div class="ok"><small>Đã đối soát</small><strong>${formatMoney(state.doneAmount)} đ</strong><span>${state.done.length} giao dịch</span></div>
      <div class="warn"><small>Chưa hoàn tất</small><strong>${formatMoney(state.openAmount)} đ</strong><span>${state.open.length} giao dịch</span></div>
      <div class="${state.issues.length ? "error" : "ok"}"><small>Cần xử lý</small><strong>${state.issues.length}</strong><span>${state.waitingSave.length} đang chờ lưu/đối soát</span></div>
      <div><small>HĐĐT đã phát hành</small><strong>${state.issued}/${state.done.length}</strong><span>${state.ignored.length} giao dịch đã bỏ qua</span></div>`;
    const globalIssues = [];
    if (!webCatalog.length || catalogDataset.source !== "Website API") {
      globalIssues.push({ text: "Danh mục website chưa được đồng bộ mới nhất.", action: "stock", label: "Chuẩn bị dữ liệu" });
    }
    if (!sharedWarehouse.initialized || !inventory.length) {
      globalIssues.push({ text: "Chưa có tồn kho vật lý khả dụng.", action: "stock", label: "Kiểm tra tồn kho" });
    }
    const mappingPending = Number(mappingSummary.review || 0) + Number(mappingSummary.unmatched || 0);
    if (mappingPending) {
      globalIssues.push({ text: `${mappingPending} mặt hàng chưa hoàn tất ánh xạ.`, action: "mapping", label: "Kiểm tra ánh xạ" });
    }
    const issueRows = state.issues.slice(0, 12).map(item => {
      const next = accountingIssueAction(item);
      return `<tr><td>${escapeHtml(item.transactionDate || "—")}</td><td><b>${escapeHtml(item.invoiceNo || "Chưa có phiếu")}</b><small title="${escapeHtml(item.description || "")}">${escapeHtml(item.description || "Không có diễn giải")}</small></td><td class="it-money">${formatMoney(item.credit)}</td><td>${escapeHtml(accountingIssueText(item))}</td><td><button type="button" data-action="${next.action}">${next.label}</button></td></tr>`;
    }).join("");
    const globalRows = globalIssues.map(item => `<tr class="it-accounting-global-issue"><td>Toàn hệ thống</td><td colspan="2">${escapeHtml(item.text)}</td><td>Cần hoàn tất trước khi xử lý hàng loạt.</td><td><button type="button" data-action="${item.action}">${item.label}</button></td></tr>`).join("");
    queue.innerHTML = globalRows || issueRows
      ? `<div class="it-accounting-queue-head"><div><b>Việc cần xử lý</b><span>${globalIssues.length + state.issues.length} mục cần chú ý trong kỳ</span></div>${state.issues.length > 12 ? `<small>Đang hiện 12/${state.issues.length} giao dịch</small>` : ""}</div><div class="it-table-wrap"><table class="it-accounting-table"><thead><tr><th>Ngày</th><th>Giao dịch/Phiếu</th><th>Số tiền</th><th>Nguyên nhân</th><th>Tiếp theo</th></tr></thead><tbody>${globalRows}${issueRows}</tbody></table></div>`
      : `<div class="it-accounting-empty"><b>Không có việc tồn đọng trong kỳ đã chọn</b><span>Các giao dịch đã được đối soát hoặc bỏ qua.</span></div>`;
    queue.querySelectorAll("button[data-action]").forEach(button => button.addEventListener("click", openAccountingDashboardAction));
    // Một snapshot dùng cho cả dải kiểm tra và thanh Việc tiếp theo.
    const closeState = accountingCloseSnapshot();
    renderAccountingCloseStatus(closeState);
    renderNextAction(closeState);
  }

  function workflowSnapshot() {
    const transactions = statementDataset.transactions || [];
    const pendingTransactions = transactions.filter(isOpenStatementTransaction).length;
    const doneTransactions = transactions.filter(item => item.status === "done").length;
    const ignoredTransactions = transactions.filter(item => ["ignored", "skipped"].includes(item.status)).length;
    const linkedInvoiceNos = statementInvoiceNos();
    const issuedTransactions = new Set((issuedInvoiceBook.entries || [])
      .map(item => String(item.invoiceNo || "").trim())
      .filter(invoiceNo => invoiceNo && linkedInvoiceNos.has(invoiceNo))).size;
    const mappingPending = Number(mappingSummary.review || 0) + Number(mappingSummary.unmatched || 0);
    return {
      catalogReady: webCatalog.length > 0,
      catalogSynced: catalogDataset.source === "Website API",
      stockReady: sharedWarehouse.initialized && inventory.length > 0,
      mappingPending,
      statementReady: transactions.length > 0,
      transactionCount: transactions.length,
      pendingTransactions,
      doneTransactions,
      ignoredTransactions,
      issuedTransactions,
      readyPlans: batchPlans.filter(item => ["ready", "accepted", "batch_ready"].includes(item.status)).length
    };
  }

  function setWorkflowStep(step, state, message) {
    const card = document.querySelector(`[data-workflow-step="${step}"]`);
    const status = document.getElementById(`it-step-${step}-status`);
    if (!card || !status) return;
    card.dataset.state = state;
    status.className = `it-step-status ${state}`;
    status.textContent = message;
  }

  function renderWorkflowDashboard() {
    const progress = document.getElementById("it-workflow-progress");
    if (!progress) return;
    const state = workflowSnapshot();
    const dataReady = state.catalogReady && state.catalogSynced && state.stockReady;
    const mappingReady = dataReady && state.mappingPending === 0;
    const statementReady = state.statementReady;
    const batchFinished = statementReady && state.pendingTransactions === 0;
    const issuanceFinished = batchFinished && state.doneTransactions > 0 && state.issuedTransactions >= state.doneTransactions;
    const completedSteps = [dataReady, mappingReady, statementReady, batchFinished, issuanceFinished]
      .filter(Boolean).length;
    progress.innerHTML = `<div><b>${completedSteps}/5 bước đã sẵn sàng</b><span>${completedSteps === 5 ? "Đã hoàn tất toàn bộ quy trình" : "Tiếp tục ở bước được đánh dấu cần xử lý"}</span></div><div class="it-progress-track"><i style="width:${completedSteps * 20}%"></i></div>`;
    setWorkflowStep("data", dataReady ? "done" : "attention",
      dataReady
        ? `${webCatalog.length} mã web mới nhất · ${inventory.length} mã kho có thể dùng`
        : !state.catalogReady ? "Chưa có danh mục hàng trên web"
          : !state.catalogSynced ? "Cần đồng bộ danh mục mới nhất từ website"
            : "Chưa có tồn kho có thể sử dụng");
    setWorkflowStep("mapping", mappingReady ? "done" : state.mappingPending ? "attention" : "waiting",
      mappingReady ? `${mappingSummary.confirmed || 0} mặt hàng đã đối chiếu` : `${state.mappingPending} mặt hàng cần kiểm tra`);
    setWorkflowStep("statement", statementReady ? "done" : "waiting",
      statementReady ? `${state.transactionCount} giao dịch · ${state.pendingTransactions} chưa hoàn tất` : "Chưa nhập file sao kê");
    setWorkflowStep("batch", batchFinished ? "done" : statementReady ? "ready" : "waiting",
      !statementReady ? "Hoàn tất bước 3 trước" : state.pendingTransactions ? `${state.pendingTransactions} giao dịch đang chờ xử lý` : `${state.doneTransactions} đã đối soát${state.ignoredTransactions ? ` · ${state.ignoredTransactions} đã bỏ qua` : ""}`);
    setWorkflowStep("einvoice", issuanceFinished ? "done" : state.doneTransactions ? "ready" : "waiting",
      !state.doneTransactions ? "Chưa có hóa đơn đã đối soát" : `${state.issuedTransactions}/${state.doneTransactions} hóa đơn đã phát hành qua extension`);
    renderAccountingDashboard();
  }

  function panelHtml() {
    return `
      <button id="it-toggle" type="button" title="Lập phương án theo tồn kho">Σ</button>
      <section id="it-panel" class="home-mode" hidden>
        <header>
          <span id="it-resize-handle" role="button" tabindex="0" aria-label="Thay đổi kích thước bảng. Giữ và kéo, hoặc bấm đúp để trả về mặc định." title="Giữ và kéo để thay đổi kích thước · Bấm đúp để trả về mặc định">↖</span>
          <div class="it-header-copy"><strong id="it-screen-title">Trợ lý xuất hóa đơn</strong><small id="it-screen-subtitle">${escapeHtml(pageTenantLabel)}${extensionVersion ? ` · v${escapeHtml(extensionVersion)}` : ""}</small></div>
          <button id="it-close" type="button" aria-label="Đóng">×</button>
        </header>
        <nav id="it-screen-tabs" class="it-screen-tabs" aria-label="Chuyển nhanh giữa các bước">
          <button id="it-home-back" type="button" data-screen="home">Quy trình</button>
          <button type="button" data-screen="stock"><i>1</i>Kho</button>
          <button type="button" data-screen="mapping"><i>2</i>Ánh xạ</button>
          <button type="button" data-screen="statement"><i>3</i>Sao kê</button>
          <button type="button" data-screen="batch"><i>4</i>Hóa đơn</button>
          <button type="button" data-screen="einvoice"><i>5</i>Phát hành</button>
        </nav>
        <p id="it-screen-help" class="it-screen-help" hidden></p>
        <div id="it-status" class="it-status">Chọn bước cần làm. Nên bắt đầu từ bước có màu vàng.</div>
        <section id="it-home-dashboard" class="it-home-dashboard">
          <div class="it-period-bar">
            <div class="it-period-copy"><span class="it-eyebrow">KỲ ĐANG XEM</span><b>${escapeHtml(pageTenantLabel)}</b></div>
            <div class="it-accounting-filters">
              <label>Cơ sở<select id="it-accounting-tenant" disabled><option>${escapeHtml(pageTenantLabel)}</option></select></label>
              <label>Từ ngày<input id="it-accounting-from" type="date"></label>
              <label>Đến ngày<input id="it-accounting-to" type="date"></label>
              <button id="it-accounting-refresh" type="button">Cập nhật</button>
            </div>
          </div>
          <div id="it-next-action" class="it-next-action"></div>
          <section class="it-accounting-dashboard">
            <div id="it-accounting-kpis" class="it-accounting-kpis"></div>
            <details id="it-accounting-details" class="it-accounting-details">
              <summary>Chi tiết chốt kỳ và việc tồn đọng</summary>
              <div class="it-accounting-close-actions">
                <div><b>Kiểm tra và chốt kỳ</b><span>Kiểm tra toàn bộ điều kiện trước khi bàn giao số liệu cho kế toán.</span></div>
                <button id="it-accounting-close-check" type="button">Kiểm tra sẵn sàng</button>
                <button id="it-accounting-export" type="button" class="primary">Xuất Excel đối soát</button>
              </div>
              <div id="it-accounting-close-status" class="it-accounting-close-status"></div>
              <div id="it-accounting-queue" class="it-accounting-queue"></div>
            </details>
          </section>
          <div id="it-workflow-progress" class="it-workflow-progress"></div>
          <details id="it-workflow-steps" class="it-workflow-steps">
            <summary>Xem chi tiết 5 bước</summary>
          <div class="it-workflow-list">
            <article class="it-workflow-card" data-workflow-step="data">
              <span class="it-step-number">1</span><div class="it-step-copy"><h3>Chuẩn bị dữ liệu</h3><p>Đồng bộ danh mục web của cơ sở và kiểm tra kho vật lý dùng chung.</p><span id="it-step-data-status" class="it-step-status"></span></div>
              <div class="it-step-actions"><button id="it-sync-web" type="button" class="primary">Đồng bộ từ website</button><button id="it-manage-stock" type="button">Kiểm tra tồn kho</button></div>
            </article>
            <article class="it-workflow-card" data-workflow-step="mapping">
              <span class="it-step-number">2</span><div class="it-step-copy"><h3>Đối chiếu mặt hàng</h3><p>Ghép mặt hàng trong file kho với đúng mã hàng trên website.</p><span id="it-step-mapping-status" class="it-step-status"></span></div>
              <div class="it-step-actions"><button id="it-manage-mapping" type="button" class="primary">Kiểm tra ánh xạ</button></div>
            </article>
            <article class="it-workflow-card" data-workflow-step="statement">
              <span class="it-step-number">3</span><div class="it-step-copy"><h3>Nhập sao kê ngân hàng</h3><p>Nhập file sao kê và kiểm tra các giao dịch chưa hoàn tất.</p><span id="it-step-statement-status" class="it-step-status"></span></div>
              <div class="it-step-actions"><button id="it-manage-statement" type="button" class="primary">Xem giao dịch</button></div>
            </article>
            <article class="it-workflow-card" data-workflow-step="batch">
              <span class="it-step-number">4</span><div class="it-step-copy"><h3>Lập và duyệt hóa đơn</h3><p>Tạo phương án hàng loạt, kiểm tra tổng tiền rồi mới lưu và đối soát.</p><span id="it-step-batch-status" class="it-step-status"></span></div>
              <div class="it-step-actions"><button id="it-manage-batch" type="button" class="primary">Mở xử lý hàng loạt</button></div>
            </article>
            <article class="it-workflow-card" data-workflow-step="einvoice">
              <span class="it-step-number">5</span><div class="it-step-copy"><h3>Phát hành hóa đơn</h3><p>Tải danh sách đã đối soát, kiểm tra rồi phát hành hóa đơn điện tử theo lô.</p><span id="it-step-einvoice-status" class="it-step-status"></span></div>
              <div class="it-step-actions"><button id="it-manage-einvoice" type="button" class="primary">Mở phát hành hóa đơn</button></div>
            </article>
          </div>
          </details>
          <div class="it-home-secondary">
            <button id="it-open-single" type="button">Điều chỉnh một phiếu đang mở</button>
            <details><summary>Công cụ dữ liệu nâng cao</summary><div class="it-advanced-actions">
              <button id="it-import-web" type="button">Cập nhật danh mục web (.xlsx)</button>
              <button id="it-import-statement" type="button">Nhập nhanh sao kê (.xlsx)</button>
            </div></details>
            <details class="it-help-box"><summary>Giải thích các thuật ngữ</summary><dl><dt>Tồn kho</dt><dd>Số lượng hàng còn có thể đưa vào hóa đơn.</dd><dt>Ánh xạ</dt><dd>Ghép một mặt hàng trong kho với đúng mặt hàng trên website.</dd><dt>Batch Review</dt><dd>Màn hình xem trước nhiều hóa đơn trước khi lưu.</dd><dt>Đối soát</dt><dd>Kiểm tra hóa đơn đã lưu khớp đúng số tiền sao kê.</dd></dl></details>
          </div>
        </section>
        <div id="it-stock-source" class="it-stock-source">${stockSummaryHtml()}</div>
        <div class="it-file-inputs">
          <input id="it-web-file" type="file" accept=".xlsx" hidden>
          <input id="it-stock-file" type="file" accept=".xlsx" hidden>
          <input id="it-mapping-file" type="file" accept=".json,application/json" hidden>
          <input id="it-statement-file" type="file" accept=".xlsx" hidden>
          <input id="it-state-file" type="file" accept=".json,application/json" hidden>
        </div>
        <section id="it-stock-admin" hidden>
          <div class="it-shared-stock-note">
            <div><span class="it-eyebrow">KHO VẬT LÝ DÙNG CHUNG</span><b>Kim Giang và Linh Đàm cùng trừ một số tồn</b>
              <small>Mã web và ánh xạ vẫn được quản lý riêng cho từng cơ sở.</small></div>
            <button id="it-open-stock-import" type="button" class="primary">Cập nhật kho chung</button>
          </div>
          <section id="it-warehouse-import" class="it-warehouse-import" hidden>
            <div class="it-import-title"><div><b>Cập nhật file kho</b><small>Chọn đúng mục đích của file trước khi nhập.</small></div><button id="it-cancel-warehouse-import" type="button">Đóng</button></div>
            <div class="it-import-modes">
              <label class="selected"><input type="radio" name="it-warehouse-mode" value="snapshot" checked><span><b>Kiểm kê thay thế</b><small>Dùng khi file là số tồn thực tế mới nhất. Số lượng trong file sẽ thay số cũ.</small></span></label>
              <label><input type="radio" name="it-warehouse-mode" value="add"><span><b>Nhập bổ sung</b><small>Dùng khi file chỉ là lô hàng mới nhập. Số lượng sẽ được cộng vào kho hiện có.</small></span></label>
            </div>
            <div class="it-import-file-row"><button id="it-choose-stock-file" type="button" class="primary">Chọn file Excel</button><span id="it-stock-file-name">Chưa chọn file</span></div>
            <div id="it-warehouse-preview" hidden></div>
          </section>
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
              <button id="it-import-stock" type="button">Cập nhật kho chung</button>
              <button id="it-import-state" type="button">Khôi phục bản sao</button>
              <button id="it-export-state" type="button">Sao lưu kho</button>
              <button id="it-export-issued" type="button" title="Xuất Excel mặt hàng đã phát hành hóa đơn để hạch toán">Xuất kho đã phát hành (Excel)</button>
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
        <p class="it-warning">Toàn bộ hàng cũ được coi là cần thay thế. Chưa tự xóa/thêm dòng và không tự bấm Lưu HĐ hoặc Hủy HĐ. Việc phát hành hóa đơn chỉ chạy ở màn hình <b>Phát hành hóa đơn</b> sau khi bạn xác nhận.</p>
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
      // Panel vừa hiện lại mới đo được chiều cao thật của menu tab.
      syncTabsOffset();
      if (root.querySelector("#it-panel").classList.contains("batch-mode")) {
        saveBatchUiSession({ panelOpen: true }).catch(error => console.error("Không lưu được phiên Batch Review", error));
      } else if (root.querySelector("#it-panel").classList.contains("stock-mode")) {
        renderStockAdmin();
      } else if (root.querySelector("#it-panel").classList.contains("single-mode")) {
        scanInvoice();
      } else {
        showHomeDashboard();
      }
    });
    const closePanel = () => {
      const panel = root.querySelector("#it-panel");
      if (panel.hidden) return;
      panel.hidden = true;
      if (panel.classList.contains("batch-mode")) {
        saveBatchUiSession({ panelOpen: false }).catch(error => console.error("Không lưu được phiên Batch Review", error));
      }
      // Trả tiêu điểm về nút mở để người dùng bàn phím không bị rơi ra đầu trang.
      root.querySelector("#it-toggle")?.focus();
    };
    root.querySelector("#it-close").addEventListener("click", closePanel);
    // Esc đóng bảng như mọi hộp thoại khác, nhưng không cướp phím khi người dùng
    // đang gõ trong ô nhập hoặc đang mở danh sách chọn của trang web.
    root.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const active = root.contains(document.activeElement) ? document.activeElement : null;
      if (active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA")) {
        active.blur();
        return;
      }
      closePanel();
    });
    root.querySelector("#it-scan").addEventListener("click", scanInvoice);
    root.querySelector("#it-solve").addEventListener("click", solveInvoice);
    root.querySelector("#it-import-stock").addEventListener("click", openWarehouseImport);
    root.querySelector("#it-open-stock-import").addEventListener("click", openWarehouseImport);
    root.querySelector("#it-cancel-warehouse-import").addEventListener("click", closeWarehouseImport);
    root.querySelector("#it-choose-stock-file").addEventListener("click", () => root.querySelector("#it-stock-file").click());
    root.querySelectorAll('input[name="it-warehouse-mode"]').forEach(input => input.addEventListener("change", () => {
      root.querySelectorAll(".it-import-modes label").forEach(label => label.classList.toggle("selected", label.contains(input)));
      pendingWarehouseImport = null;
      root.querySelector("#it-warehouse-preview").hidden = true;
      root.querySelector("#it-stock-file-name").textContent = "Chưa chọn file";
    }));
    root.querySelector("#it-sync-web").addEventListener("click", syncLatestWebCatalog);
    root.querySelector("#it-accounting-refresh").addEventListener("click", refreshAccountingDashboard);
    root.querySelector("#it-accounting-from").addEventListener("change", refreshAccountingDashboard);
    root.querySelector("#it-accounting-to").addEventListener("change", refreshAccountingDashboard);
    root.querySelector("#it-accounting-close-check").addEventListener("click", () => {
      renderAccountingCloseStatus();
      const close = accountingCloseSnapshot();
      setStatus(
        close.ready ? "Kỳ đang chọn đã đủ điều kiện chốt." : `Còn ${close.blockers.length} nhóm dữ liệu cần hoàn tất trước khi chốt kỳ.`,
        close.ready ? "ok" : "warn"
      );
    });
    root.querySelector("#it-accounting-export").addEventListener("click", exportAccountingReport);
    root.querySelector("#it-import-web").addEventListener("click", () => root.querySelector("#it-web-file").click());
    root.querySelector("#it-web-file").addEventListener("change", importWebFile);
    root.querySelector("#it-stock-file").addEventListener("change", importStockFile);
    root.querySelector("#it-mapping-file").addEventListener("change", importMappingFile);
    root.querySelector("#it-import-statement").addEventListener("click", () => root.querySelector("#it-statement-file").click());
    root.querySelector("#it-statement-file").addEventListener("change", importStatementFile);
    root.querySelector("#it-import-state").addEventListener("click", () => root.querySelector("#it-state-file").click());
    root.querySelector("#it-state-file").addEventListener("change", previewStockStateFile);
    root.querySelector("#it-export-state").addEventListener("click", exportStockState);
    root.querySelector("#it-export-issued").addEventListener("click", exportIssuedInvoices);
    root.querySelector("#it-manage-stock").addEventListener("click", toggleStockAdmin);
    root.querySelector("#it-stock-search").addEventListener("input", renderStockRows);
    root.querySelector("#it-stock-filter").addEventListener("change", renderStockRows);
    root.querySelector("#it-manage-batch").addEventListener("click", toggleBatchReview);
    root.querySelector("#it-manage-mapping").addEventListener("click", toggleMappingAdmin);
    root.querySelector("#it-manage-statement").addEventListener("click", toggleStatementAdmin);
    root.querySelector("#it-manage-einvoice").addEventListener("click", () => {
      openEInvoiceAdmin().catch(error => setStatus(error.message, "error"));
    });
    // Menu tab: chuyển thẳng giữa các bước, không phải quay về màn hình chính rồi
    // mới bấm tiếp. Dùng lại đúng các hàm mở màn hình đã có.
    root.querySelector("#it-screen-tabs").addEventListener("click", event => {
      const screen = event.target.closest("button[data-screen]")?.dataset.screen;
      if (!screen) return;
      if (screen === "home") return showHomeDashboard();
      if (screen === "stock") return setStockMode(true);
      if (screen === "mapping") return setMappingMode(true);
      if (screen === "statement") {
        statementSubtab = "statement";
        return setStatementMode(true);
      }
      if (screen === "batch") return showBatchReviewMode(true, true);
      if (screen === "einvoice") openEInvoiceAdmin().catch(error => setStatus(error.message, "error"));
    });
    root.querySelector("#it-open-single").addEventListener("click", () => {
      applyPanelScreen("single-mode");
      scanInvoice();
    });
    root.querySelector("#it-manage-priority").addEventListener("click", togglePriorityAdmin);
    root.querySelector("#it-target").addEventListener("blur", event => {
      const amount = parseMoney(event.target.value);
      event.target.value = amount ? formatMoney(amount) : "";
      renderPriorityRules(true);
    });
    renderPriorityRules(true);
    renderWorkflowDashboard();
  }

  // next (tùy chọn): { label, action } gắn nút đi thẳng tới bước kế tiếp ngay
  // trên dòng trạng thái, để kế toán không phải tự tìm đường sang màn hình sau.
  function setStatus(message, kind, next) {
    const node = document.getElementById("it-status");
    if (!node) return;
    node.className = `it-status ${kind || ""}`;
    // Dựng bằng DOM node: message có thể chứa số phiếu, diễn giải sao kê hoặc
    // thông báo lỗi lấy từ website, không được diễn giải như thẻ HTML.
    node.replaceChildren(document.createTextNode(message));
    if (next?.label && next?.action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "it-status-next";
      button.dataset.action = next.action;
      button.textContent = next.label;
      button.addEventListener("click", () => openAccountingDashboardAction({ target: button }));
      node.append(button);
    }
    renderWorkflowDashboard();
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

    // Panel hẹp lại thì menu tab xuống hai hàng; đo lại để mốc dính luôn đúng.
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => syncTabsOffset()).observe(panel);
    }
  }

  function localTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    const part = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}_${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
  }

  // File nhị phân (xlsx) phải đi qua base64 vì thông điệp tới background chỉ
  // chuyển được dữ liệu JSON thuần.
  async function downloadBase64(base64, filename, mimeType) {
    const response = await sendRuntimeMessage({
      type: "invoiceTarget.downloadBinary",
      filename,
      mimeType,
      base64
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome không tạo được file tải xuống.");
    return response.downloadId;
  }

  async function downloadJson(payload, filename) {
    const response = await sendRuntimeMessage({
      type: "invoiceTarget.downloadStockState",
      filename,
      content: JSON.stringify(payload, null, 2)
    });
    if (!response?.ok) throw new Error(response?.error || "Chrome không tạo được file tải xuống.");
    return response.downloadId;
  }

  async function exportStockState() {
    try {
      if (!sharedWarehouse.initialized) throw new Error("Kho dùng chung chưa được khởi tạo.");
      const exportedAt = new Date().toISOString();
      const payload = {
        kind: InvoiceSharedWarehouse.KIND,
        schemaVersion: InvoiceSharedWarehouse.SCHEMA_VERSION,
        exportedAt,
        extensionVersion,
        warehouse: InvoiceSharedWarehouse.normalize(sharedWarehouse)
      };
      await downloadJson(payload, `TonKho_DungChung_${localTimestamp(exportedAt)}.json`);
      const summary = InvoiceSharedWarehouse.summarize(sharedWarehouse.items);
      setStatus(
        `Đã sao lưu kho dùng chung: ${summary.codes} mã, ${formatMoney(summary.units)} đơn vị. ` +
        "File không chứa sao kê, rule hay mã web của từng cơ sở.",
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
      if (payload?.kind === InvoiceSharedWarehouse.KIND) {
        const incoming = InvoiceSharedWarehouse.normalize(payload.warehouse || payload);
        pendingWarehouseImport = {
          fileName: file.name,
          preview: InvoiceSharedWarehouse.previewImport(sharedWarehouse, incoming.items, "snapshot", {
            source: file.name,
            at: new Date().toISOString()
          })
        };
        openWarehouseImport();
        const snapshotMode = document.querySelector('input[name="it-warehouse-mode"][value="snapshot"]');
        if (snapshotMode) snapshotMode.checked = true;
        document.querySelectorAll(".it-import-modes label").forEach(label => label.classList.toggle("selected", label.contains(snapshotMode)));
        document.getElementById("it-stock-file-name").textContent = file.name;
        renderWarehouseImportPreview();
        setStatus(`Đã đọc bản sao ${file.name}. Hãy kiểm tra trước khi khôi phục kho dùng chung.`, "warn");
        return;
      }
      const comparison = InvoiceStockState.compare(mappingDataset, payload, stockStateMeta, pageTenantSlug);
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
      const nextMappingDataset = InvoiceStockState.applyToMapping(mappingDataset, pending.payload, pageTenantSlug);
      const backup = InvoiceStockState.build({
        mappingDataset,
        tenant: pageTenantSlug,
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
        inventoryFingerprint: pending.payload.inventoryFingerprint,
        tenant: pageTenantSlug
      }, backup);
      stockStateMeta = {
        schemaVersion: pending.payload.schemaVersion,
        currentExportId: pending.payload.exportId,
        parentExportId: pending.payload.parentExportId || null,
        exportedAt: pending.payload.exportedAt,
        importedAt,
        sourceFile: pending.fileName,
        inventoryFingerprint: pending.payload.inventoryFingerprint,
        tenant: pageTenantSlug
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

  function openWarehouseImport() {
    const node = document.getElementById("it-warehouse-import");
    if (!node) return;
    node.hidden = false;
    node.scrollIntoView({ block: "nearest" });
  }

  function closeWarehouseImport() {
    const node = document.getElementById("it-warehouse-import");
    if (node) node.hidden = true;
    pendingWarehouseImport = null;
    const preview = document.getElementById("it-warehouse-preview");
    if (preview) preview.hidden = true;
  }

  function warehouseRowsForMapping() {
    return (sharedWarehouse.items || []).map(item => ({
      stockCode: item.stockCode,
      stockName: item.stockName,
      stockUnit: item.stockUnit,
      stockQty: item.stockQty,
      conversion: item.conversion,
      availableQty: item.availableQty,
      salePrice: item.salePrice,
      stockMissing: item.missingFromLastSnapshot
    }));
  }

  function mergeWarehouseIntoCurrentMapping() {
    if (!sharedWarehouse.initialized) return;
    const previousRows = mappingDataset.mappings || [];
    const merged = InvoiceMappingEngine.mergeStockSnapshot(warehouseRowsForMapping(), webCatalog, previousRows);
    const sharedCodes = new Set((sharedWarehouse.items || []).map(item => String(item.stockCode)));
    const retained = previousRows.filter(row => !sharedCodes.has(String(row.stockCode))).map(row => ({
      ...row,
      availableQty: row.availabilityMode === "per_invoice" ? row.availableQty : 0,
      stockMissing: row.availabilityMode !== "per_invoice"
    }));
    mappingDataset = InvoiceMappingEngine.applyBusinessRules({
      ...mappingDataset,
      source: sharedWarehouse.source,
      tenant: pageTenantSlug,
      generatedAt: sharedWarehouse.updatedAt,
      mappings: [...merged, ...retained]
    });
    mappingDataset = InvoiceSharedWarehouse.overlayMappings(mappingDataset, sharedWarehouse);
  }

  function renderWarehouseImportPreview() {
    const node = document.getElementById("it-warehouse-preview");
    const pending = pendingWarehouseImport;
    if (!node || !pending) return;
    const { preview } = pending;
    const rows = preview.changes.filter(item => item.delta !== 0 || item.isNew).slice(0, 12);
    node.hidden = false;
    node.innerHTML = `<div class="it-import-preview-head"><div><b>Xem trước trước khi áp dụng</b><small>${preview.mode === "add" ? "Nhập bổ sung — cộng vào kho hiện tại" : "Kiểm kê thay thế — cập nhật theo số thực tế trong file"}</small></div></div>
      <div class="it-import-preview-kpis">
        <div><small>Mã trong file</small><b>${preview.counts.incoming}</b></div>
        <div class="ok"><small>Mã mới</small><b>+${preview.counts.added}</b></div>
        <div><small>Tăng / giảm</small><b>↑${preview.counts.increased} · ↓${preview.counts.decreased}</b></div>
        <div class="${preview.counts.missing ? "warn" : ""}"><small>Không có trong file</small><b>${preview.counts.missing}</b></div>
        <div><small>Tổng đơn vị</small><b>${formatMoney(preview.beforeSummary.units)} → ${formatMoney(preview.afterSummary.units)}</b></div>
        <div><small>Giá trị theo giá bán</small><b>${formatMoney(preview.beforeSummary.value)} → ${formatMoney(preview.afterSummary.value)}</b></div>
      </div>
      ${preview.counts.missing ? `<div class="it-import-warning"><b>${preview.counts.missing} mã cũ không có trong file.</b> Extension giữ nguyên số lượng và đánh dấu để kiểm tra, không tự đưa về 0.</div>` : ""}
      ${rows.length ? `<div class="it-table-wrap"><table><thead><tr><th>Mã kho</th><th>Tên hàng</th><th>Trước</th><th>Sau</th><th>Chênh lệch</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${escapeHtml(row.stockCode)}</b></td><td>${escapeHtml(row.stockName)}</td><td>${formatMoney(row.before)}</td><td>${formatMoney(row.after)}</td><td>${row.delta > 0 ? "+" : ""}${formatMoney(row.delta)}</td></tr>`).join("")}</tbody></table></div>` : "<p>Không có thay đổi số lượng.</p>"}
      <label class="it-confirm"><input id="it-confirm-warehouse-import" type="checkbox"> Tôi đã kiểm tra đúng loại file và số lượng trước/sau.</label>
      <div class="it-actions"><button id="it-apply-warehouse-import" type="button" class="primary" disabled>Áp dụng vào kho dùng chung</button></div>`;
    const confirm = node.querySelector("#it-confirm-warehouse-import");
    const apply = node.querySelector("#it-apply-warehouse-import");
    confirm.addEventListener("change", () => { apply.disabled = !confirm.checked; });
    apply.addEventListener("click", applyWarehouseImport);
  }

  async function applyWarehouseImport() {
    if (!pendingWarehouseImport) return;
    const importFileName = pendingWarehouseImport.fileName;
    const button = document.getElementById("it-apply-warehouse-import");
    if (button) button.disabled = true;
    try {
      sharedWarehouse = InvoiceSharedWarehouse.applyImport(
        sharedWarehouse,
        pendingWarehouseImport.preview,
        pageTenantSlug
      );
      mergeWarehouseIntoCurrentMapping();
      await Promise.all([
        InvoiceMappingStore.saveSharedWarehouse(sharedWarehouse),
        InvoiceMappingStore.save(mappingDataset)
      ]);
      const newCount = pendingWarehouseImport.preview.counts.added;
      const pendingCount = (mappingDataset.mappings || []).filter(row => row.status === "review" || row.status === "unmatched").length;
      refreshMappingState();
      renderStockAdmin();
      closeWarehouseImport();
      setStatus(
        `Đã cập nhật kho dùng chung từ ${importFileName || sharedWarehouse.source}. ` +
        `${newCount} mã mới; ${pendingCount} mã của ${pageTenantLabel} cần kiểm tra ánh xạ.`,
        pendingCount ? "warn" : "ok"
      );
    } catch (error) {
      if (button) button.disabled = false;
      setStatus(`Không cập nhật được kho dùng chung: ${error.message}`, "error");
    }
  }

  async function importStockFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      openWarehouseImport();
      setStatus("Đang đọc file kho và lập bản xem trước…", "warn");
      const stockRows = await InvoiceXlsxReader.parseStockWorkbook(file);
      if (!stockRows.length) throw new Error("File không có dòng tồn kho hợp lệ.");
      const mode = document.querySelector('input[name="it-warehouse-mode"]:checked')?.value || "snapshot";
      pendingWarehouseImport = {
        fileName: file.name,
        preview: InvoiceSharedWarehouse.previewImport(sharedWarehouse, stockRows, mode, {
          source: file.name,
          at: new Date().toISOString()
        })
      };
      document.getElementById("it-stock-file-name").textContent = file.name;
      renderWarehouseImportPreview();
      setStatus("Đã đọc file. Hãy kiểm tra bản xem trước rồi xác nhận áp dụng.", "warn");
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
      catalogDataset = { source: file.name, tenant: pageTenantSlug, generatedAt: new Date().toISOString(), items };
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
      const parsed = await InvoiceXlsxReader.parseBankStatementWorkbook(file, { tenantSlug: pageTenantSlug });
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
          ledgerId: old.ledgerId || "",
          // Giữ dấu đã rà giao dịch lớn: nhập lại sao kê không được bắt người
          // dùng duyệt lại từ đầu những dòng họ đã xác nhận.
          largeCreditReviewedAt: old.largeCreditReviewedAt || ""
        } : item;
      });
      // Chặn ngay tại cửa: giao dịch lớn không được tự vào luồng lập phiếu.
      // Sao kê có cả khoản không phải doanh thu (nạp tiền, lãi) và chúng thường
      // là số lớn; lập hóa đơn cho chúng là sai bản chất, mà phát hành rồi thì
      // không hoàn tác được.
      //
      // Chỉ đụng tới giao dịch CHƯA xử lý: dòng đã planned/done là việc đã rà
      // và đã chạy, đẩy ngược về review sẽ xoá công sức và gây hoang mang.
      let manualReviewCount = 0;
      for (const item of transactions) {
        if (item.status !== "pending") continue;
        if (item.largeCreditReviewedAt) continue;
        if (Math.round(Number(item.credit) || 0) < MANUAL_REVIEW_CREDIT_THRESHOLD) continue;
        item.status = "review";
        item.reviewNote = `Giao dịch từ ${formatMoney(MANUAL_REVIEW_CREDIT_THRESHOLD)}đ trở lên: ` +
          "phải tự kiểm đây là doanh thu hay khoản nạp tiền/chuyển nội bộ trước khi lập phiếu.";
        manualReviewCount += 1;
      }
      statementDataset = { source: file.name, importedAt: new Date().toISOString(), transactions };
      await InvoiceMappingStore.saveStatement(statementDataset);
      // Trích bảng tóm tắt cho cơ sở kia đọc: ngày, giờ, số tiền — vừa đủ để
      // biết trước ngày đó bên này có bao nhiêu việc. Parse đã dùng đúng
      // tenantSlug của tab hiện tại nên requestedAt là giờ giao dịch thật.
      issueCoordination = InvoiceIssueCoordination.recordStatement(
        issueCoordination, pageTenantSlug, transactions, statementDataset.importedAt
      );
      await InvoiceMappingStore.saveIssueCoordination(issueCoordination);
      renderStatementAdmin();
      setStatementMode(true);
      const pending = transactions.filter(item => item.status === "pending").length;
      const review = transactions.filter(item => item.status === "review").length;
      // Việc rà giao dịch lớn phải nổi lên trước mọi việc khác, kèm lối đi thẳng
      // tới đúng danh sách cần rà — nói suông thì người dùng bỏ qua.
      if (manualReviewCount) {
        setStatus(
          `Đã nhập ${transactions.length} giao dịch Credit: ${pending} chờ xử lý, ${review} cần kiểm tra. ` +
          `⚠ ${manualReviewCount} giao dịch từ ${formatMoney(MANUAL_REVIEW_CREDIT_THRESHOLD)}đ trở lên đang chờ bạn xác nhận ` +
          "có phải doanh thu không. Chúng KHÔNG được lập phiếu cho tới khi bạn duyệt.",
          "warn",
          { label: `Rà ${manualReviewCount} giao dịch lớn`, action: "review-large" }
        );
      } else {
        setStatus(`Đã nhập ${transactions.length} giao dịch Credit: ${pending} chờ xử lý, ${review} cần kiểm tra.`, "ok");
      }
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
    const mappedStockCodes = new Set(inventory.flatMap(item => (item.stockCodes || []).map(String)));
    const rows = inventory.map(item => {
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
    for (const item of sharedWarehouse.items || []) {
      if (mappedStockCodes.has(String(item.stockCode))) continue;
      rows.push({
        webCode: "",
        webName: item.stockName,
        webUnit: item.stockUnit,
        webPrice: item.salePrice,
        availableQty: item.availableQty,
        recordedQty: item.availableQty,
        heldQty: 0,
        allocatableQty: item.availableQty,
        stockCodes: [item.stockCode],
        availabilityMode: "stock",
        needsMapping: true,
        stockMissing: item.missingFromLastSnapshot
      });
    }
    return rows.sort((a, b) => Number(Boolean(a.needsMapping)) - Number(Boolean(b.needsMapping)) || String(a.webCode || a.stockCodes?.[0]).localeCompare(String(b.webCode || b.stockCodes?.[0])));
  }

  function renderStockAdmin() {
    const rows = stockViewRows();
    const heldCodes = rows.filter(item => item.heldQty > 0).length;
    const lowCodes = rows.filter(item => item.availabilityMode !== "per_invoice" && item.allocatableQty > 0 && item.allocatableQty <= 3).length;
    const outCodes = rows.filter(item => item.availabilityMode !== "per_invoice" && item.allocatableQty <= 0).length;
    const unmappedCodes = rows.filter(item => item.needsMapping).length;
    const kpis = document.getElementById("it-stock-kpis");
    if (kpis) {
      kpis.innerHTML = `<div><small>Mã đủ điều kiện</small><strong>${rows.length}</strong></div>
        <div><small>Đang giữ</small><strong>${heldCodes}</strong></div>
        <div class="${lowCodes ? "warn" : ""}"><small>Sắp hết</small><strong>${lowCodes}</strong></div>
        <div class="${outCodes ? "error" : ""}"><small>Đã hết</small><strong>${outCodes}</strong></div>
        <div class="${unmappedCodes ? "warn" : ""}"><small>Chưa ánh xạ tại ${escapeHtml(pageTenantLabel)}</small><strong>${unmappedCodes}</strong></div>`;
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
      <td><b>${item.needsMapping ? '<span class="it-needs-mapping">Chưa ánh xạ</span>' : escapeHtml(item.webCode)}</b></td>
      <td title="${escapeHtml(item.webName)}">${escapeHtml(item.webName)}</td>
      <td>${escapeHtml(item.webUnit || "")}</td>
      <td class="it-money">${formatMoney(item.webPrice)}</td>
      <td class="it-qty">${item.availabilityMode === "per_invoice" ? `${item.recordedQty}/HĐ` : formatMoney(item.recordedQty)}</td>
      <td class="it-qty held">${formatMoney(item.heldQty)}</td>
      <td class="it-qty allocatable">${item.availabilityMode === "per_invoice" ? `${item.allocatableQty}/HĐ` : formatMoney(item.allocatableQty)}</td>
      <td title="${escapeHtml((item.stockCodes || []).join(", "))}">${escapeHtml((item.stockCodes || []).join(", "))}${item.stockMissing ? " · cần kiểm tra" : ""}</td>
    </tr>`).join("") || '<tr><td colspan="8">Không có mặt hàng phù hợp bộ lọc.</td></tr>';
  }

  function toggleStockAdmin() {
    const node = document.getElementById("it-stock-admin");
    setStockMode(node.hidden);
  }

  // Mỗi màn hình quản lý là một section độc lập; chỉ một section được mở tại một
  // thời điểm. Bảng này giữ nhãn mặc định của nút để không lặp lại ở từng hàm.
  const PANEL_SCREENS = [
    { mode: "stock-mode", section: "it-stock-admin", title: "Bước 1 · Kho vật lý dùng chung", help: "Kiểm kê sẽ thay số hiện tại; nhập bổ sung sẽ cộng thêm. Mã web vẫn được ánh xạ riêng theo cơ sở." },
    { mode: "mapping-mode", section: "it-mapping-admin", title: "Bước 2 · Đối chiếu mặt hàng", help: "Xác nhận mỗi mặt hàng trong kho tương ứng với đúng mã hàng trên website." },
    { mode: "statement-mode", section: "it-statement-admin", title: "Bước 3 · Giao dịch ngân hàng", help: "Nhập sao kê và kiểm tra trạng thái từng giao dịch trước khi lập hóa đơn." },
    { mode: "batch-mode", section: "it-batch-review", title: "Bước 4 · Lập và duyệt hóa đơn", help: "Xem phương án, tổng tiền và tồn kho. Chỉ Accept khi các thông tin đã hợp lý." }
  ];

  function applyPanelScreen(activeMode) {
    const panel = document.getElementById("it-panel");
    if (!panel) return false;
    const mode = activeMode || "single-mode";
    panel.classList.remove("home-mode", "single-mode", "review-mode", ...PANEL_SCREENS.map(screen => screen.mode));
    panel.classList.add(mode);
    for (const screen of PANEL_SCREENS) {
      const active = screen.mode === mode;
      const section = document.getElementById(screen.section);
      if (section) section.hidden = !active;
    }
    const screen = PANEL_SCREENS.find(item => item.mode === mode);
    const title = document.getElementById("it-screen-title");
    const subtitle = document.getElementById("it-screen-subtitle");
    const help = document.getElementById("it-screen-help");
    if (title) title.textContent = screen?.title || "Điều chỉnh một phiếu";
    if (subtitle) subtitle.textContent = `${pageTenantLabel}${extensionVersion ? ` · v${extensionVersion}` : ""}`;
    // Ở màn hình chính không cần câu hướng dẫn của bước; chỗ đó đã có thẻ chào
    // mừng và thanh Việc tiếp theo nói rõ hơn.
    if (help) {
      help.hidden = mode === "home-mode";
      help.textContent = screen?.help || "Đọc phiếu đang mở, tính phương án và kiểm tra trước khi lưu.";
    }
    markActiveScreenTab(mode);
    return true;
  }

  // Bước 5 là sub-tab của màn Giao dịch nên không có mode riêng; dựa thêm vào
  // statementSubtab để tô đúng tab đang mở.
  const SCREEN_TAB_BY_MODE = {
    "home-mode": "home",
    "stock-mode": "stock",
    "mapping-mode": "mapping",
    "statement-mode": "statement",
    "batch-mode": "batch"
  };

  // Thanh tab có flex-wrap nên chiều cao đổi theo bề rộng panel (1 hay 2 hàng).
  // Đo thật rồi ghi vào --it-tabs-offset để thanh công cụ của từng màn hình dính
  // ngay dưới menu, thay vì dựa vào một hằng số chỉ đúng ở một cỡ panel.
  function syncTabsOffset() {
    const root = document.getElementById("invoice-target-mvp");
    const tabs = document.getElementById("it-screen-tabs");
    if (!root || !tabs) return;
    const header = document.querySelector("#it-panel header");
    const headerHeight = header?.offsetHeight || 58;
    const panelPadding = parseFloat(getComputedStyle(document.getElementById("it-panel")).paddingTop) || 18;
    // Header dính ở top:-padding nên mép dưới của nó là (cao header - padding).
    const offset = headerHeight - panelPadding + tabs.offsetHeight;
    root.style.setProperty("--it-header-offset", `${Math.round(headerHeight - panelPadding)}px`);
    root.style.setProperty("--it-tabs-offset", `${Math.round(offset)}px`);
  }

  function markActiveScreenTab(mode) {
    const tabs = document.getElementById("it-screen-tabs");
    if (!tabs) return;
    syncTabsOffset();
    let active = SCREEN_TAB_BY_MODE[mode] || "";
    if (mode === "statement-mode" && statementSubtab === "einvoice") active = "einvoice";
    for (const button of tabs.querySelectorAll("button[data-screen]")) {
      const current = button.dataset.screen === active;
      button.classList.toggle("active", current);
      // aria-current để trình đọc màn hình biết đang ở bước nào.
      if (current) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    }
  }

  async function syncLatestWebCatalog(event) {
    const button = event?.currentTarget || document.getElementById("it-sync-web");
    const oldLabel = button?.textContent || "Đồng bộ từ website";
    if (button) {
      button.disabled = true;
      button.textContent = "Đang đồng bộ…";
    }
    try {
      setStatus(`Đang lấy danh mục mới nhất của ${pageTenantLabel} từ website…`, "warn");
      const result = await request("fetchLatestProductCatalog");
      const items = Array.isArray(result?.items) ? result.items : [];
      if (!items.length) throw new Error("Website không trả về mặt hàng nào; dữ liệu hiện tại được giữ nguyên.");
      catalogDataset = {
        source: "Website API",
        tenant: pageTenantSlug,
        syncedAt: new Date().toISOString(),
        total: Number(result.total || items.length),
        items
      };
      webCatalog = items;
      const report = InvoiceMappingEngine.reconcileCatalog(mappingDataset, webCatalog);
      await Promise.all([
        InvoiceMappingStore.saveCatalog(catalogDataset),
        InvoiceMappingStore.save(mappingDataset)
      ]);
      refreshMappingState();
      if (!document.getElementById("it-mapping-admin")?.hidden) renderMappingAdmin();
      setStatus(
        `Đã đồng bộ ${items.length} mặt hàng từ ${pageTenantLabel}. ${report.updated} ánh xạ được cập nhật; ${report.missing} mã cần kiểm tra lại.`,
        report.missing ? "warn" : "ok"
      );
    } catch (error) {
      setStatus(`Không đồng bộ được danh mục website: ${error.message}`, "error");
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = oldLabel;
      }
      // Mở khóa xong mới vẽ lại: trong lúc chạy, thanh Việc tiếp theo cố ý không
      // vẽ đè để giữ nút đang khóa, nên phải làm mới ở đây để nó hiện việc kế tiếp.
      renderNextAction();
    }
  }

  function showHomeDashboard() {
    if (!applyPanelScreen("home-mode")) return;
    const title = document.getElementById("it-screen-title");
    if (title) title.textContent = "Trợ lý xuất hóa đơn";
    renderWorkflowDashboard();
  }

  function setStockMode(enabled) {
    if (!applyPanelScreen(enabled ? "stock-mode" : null)) return;
    if (enabled) renderStockAdmin();
  }

  function toggleMappingAdmin() {
    setMappingMode(Boolean(document.getElementById("it-mapping-admin")?.hidden));
  }

  function setMappingMode(enabled) {
    if (!applyPanelScreen(enabled ? "mapping-mode" : null)) return;
    if (enabled) renderMappingAdmin();
  }

  function toggleStatementAdmin() {
    const node = document.getElementById("it-statement-admin");
    setStatementMode(node.hidden);
  }

  function setStatementMode(enabled) {
    if (!applyPanelScreen(enabled ? "statement-mode" : null)) return;
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
    if (!applyPanelScreen(enabled ? "batch-mode" : null)) return;
    if (enabled) renderBatchReview();
    if (openPanel != null) document.getElementById("it-panel").hidden = !openPanel;
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
      <small>Extension sẽ chọn phòng rảnh, áp dụng tổ hợp và lưu bằng API chính thức với tổng tiền/tiền mặt chính xác; không cần bấm Lưu HĐ thủ công.</small>
    </div>`;
  }

  async function armInvoiceApiTrace() {
    const result = await request("armApiTrace");
    const expires = result?.expiresAt
      ? new Date(result.expiresAt).toLocaleTimeString("vi-VN")
      : "10 phút tới";
    setStatus(`Đã bật API Trace đến ${expires}. Hãy mở một phòng trống và tạo phiếu đúng một lần, sau đó bấm Xuất trace JSON.`, "ok");
  }

  function selectApiTemplateFromTrace(records) {
    const candidates = (records || [])
      .filter(record => {
        if (!record?.url || !record?.method || !["text", "urlencoded", "formdata"].includes(record.bodyType)) return false;
        try { return /\/AddEdit\/DoSave/i.test(new URL(record.url, location.href).pathname); }
        catch (_) { return false; }
      })
      .map(record => ({ record, analysis: InvoiceApiTemplate.analyze(record) }));
    if (!candidates.length) return null;
    const reversed = [...candidates].reverse();
    const complete = reversed.find(candidate => candidate.analysis.ready);
    if (complete) return complete;
    const detail = reversed.find(candidate => candidate.analysis.detailArrays?.length);
    const payment = reversed.find(candidate => candidate.analysis.payment?.ready);
    if (detail && payment && detail.record !== payment.record) {
      const record = { ...detail.record, paymentTemplate: payment.record };
      return { record, analysis: InvoiceApiTemplate.analyze(record) };
    }
    return candidates[candidates.length - 1];
  }

  function apiTraceAnalysisMessage(analysis) {
    const reasons = analysis?.reasons || [];
    if (reasons.includes("payment-values-not-equal")) {
      return "Trace mới chỉ có bước lưu tạm: Tiền mặt/Tiền thanh toán chưa bằng Tổng tiền. Hãy thực hiện tới bước Thanh toán hoặc Lưu thoát rồi xuất trace lại.";
    }
    if (reasons.includes("payment-fields-not-found")) return "Request chưa chứa dữ liệu thanh toán của hóa đơn.";
    if (reasons.includes("invoice-detail-not-found")) return "Request chưa chứa danh sách mặt hàng của hóa đơn.";
    return `Request DoSave chưa hợp lệ: ${reasons.join(", ") || "không xác định"}.`;
  }

  async function exportInvoiceApiTrace() {
    const trace = await request("getApiTrace");
    const records = Array.isArray(trace?.records) ? trace.records : [];
    if (!records.length) {
      throw new Error("Chưa ghi được request nào. Hãy bấm Bắt API tạo phiếu trước rồi mở một phòng trống.");
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await downloadJson({
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      sourcePage: trace.page || location.href,
      expiresAt: trace.expiresAt || "",
      security: "Authorization, Cookie và Proxy-Authorization đã bị loại bỏ.",
      records
    }, `invoice-api-trace-${stamp}.json`);
    const selected = selectApiTemplateFromTrace(records);
    if (!selected) {
      setStatus(`Đã xuất ${records.length} request nhưng chưa có request DoSave để tạo mẫu Lưu HĐ.`, "error");
      return;
    }
    await receiveSaveRequestCapture({ detail: selected.record });
    if (selected.analysis.ready) {
      setStatus(`Đã xuất ${records.length} request và tự lưu mẫu Lưu HĐ hợp lệ cho ${pageTenantLabel}.`, "ok");
    } else {
      setStatus(`Đã xuất ${records.length} request. ${apiTraceAnalysisMessage(selected.analysis)}`, "error");
    }
  }

  function apiDebugStorageKey() {
    return `invoiceTarget.apiDebug.latest.${pageTenantSlug}`;
  }

  async function persistGeneratedInvoiceApiDebugLog(context = {}) {
    let trace;
    try {
      trace = await request("getApiTrace");
    } catch (error) {
      trace = { page: location.href, records: [], traceReadError: error.message };
    }
    const exportedAt = new Date().toISOString();
    const payload = {
      schemaVersion: 2,
      kind: "extension-generated-invoice-api-debug",
      exportedAt,
      tenant: pageTenantSlug,
      tenantLabel: pageTenantLabel,
      sourcePage: trace?.page || location.href,
      expected: context.expected || null,
      outcome: context.outcome || "unknown",
      result: context.result || null,
      error: context.error || "",
      security: "Authorization, Cookie và Proxy-Authorization đã bị loại bỏ.",
      records: Array.isArray(trace?.records) ? trace.records : []
    };
    await chrome.storage.local.set({ [apiDebugStorageKey()]: payload });
    const stamp = exportedAt.replace(/[:.]/g, "-");
    const transactionDate = String(context.expected?.invoiceDateKey || "unknown").replace(/[^0-9-]/g, "");
    await downloadJson(payload, `invoice-api-debug-${pageTenantSlug}-${transactionDate}-${stamp}.json`);
    return payload;
  }

  async function exportLatestGeneratedInvoiceApiDebugLog() {
    const saved = await chrome.storage.local.get(apiDebugStorageKey());
    const payload = saved?.[apiDebugStorageKey()];
    if (!payload) throw new Error("Chưa có log API tự động nào của cơ sở hiện tại.");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await downloadJson(payload, `invoice-api-debug-${pageTenantSlug}-latest-${stamp}.json`);
    setStatus("Đã xuất log API gần nhất. File chứa chính xác payload và response nhưng không chứa Cookie/Authorization.", "ok");
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
    <div class="it-api-capture-bar">
      <b>Batch API</b>
      <span id="it-api-capture-status" class="${apiTemplate?.analysis?.ready ? "ready" : ""}">${escapeHtml(apiCaptureSummary(apiTemplate))}</span>
      <small>${apiTemplate
        ? (apiTemplate.analysis?.ready
          ? "Mẫu đã qua kiểm tra; sẵn sàng nối vào hàng đợi tuần tự."
          : `Thiếu: ${(apiTemplate.analysis?.reasons || []).join(", ")}`)
        : "Lưu một phiếu thử bằng nút chính thức của website để tự bắt mẫu."}</small>
      <button id="it-arm-api-trace" type="button">Bắt API tạo phiếu</button>
      <button id="it-export-api-trace" type="button">Xuất trace JSON</button>
      <button id="it-export-latest-api-debug" type="button">Xuất log API gần nhất</button>
    </div>
    ${pendingNewInvoiceContextHtml()}
    <div id="it-batch-summary"></div>
    <div id="it-batch-table"></div>`;
    node.querySelector("#it-build-batch")?.addEventListener("click", buildBatchReview);
    node.querySelector("#it-arm-api-trace")?.addEventListener("click", () => {
      armInvoiceApiTrace().catch(error => setStatus(error.message, "error"));
    });
    node.querySelector("#it-export-api-trace")?.addEventListener("click", () => {
      exportInvoiceApiTrace().catch(error => setStatus(error.message, "error"));
    });
    node.querySelector("#it-export-latest-api-debug")?.addEventListener("click", () => {
      exportLatestGeneratedInvoiceApiDebugLog().catch(error => setStatus(error.message, "error"));
    });
    if (batchPlans.length) renderBatchPlans();
  }

  // ---------------------------------------------------------------------------
  // Phát hành hóa đơn điện tử
  //
  // Website bắt kế toán bấm PHÁT HÀNH rồi xác nhận hai hộp thoại cho từng dòng.
  // Màn hình này gọi thẳng API của website cho nhiều hóa đơn đã chọn, sau mỗi
  // lần phát hành thành công thì ghi lại mặt hàng + số lượng để tab Kho xuất
  // file hạch toán.
  // ---------------------------------------------------------------------------

  function todayDateKey() {
    const now = new Date();
    const part = number => String(number).padStart(2, "0");
    return `${now.getFullYear()}-${part(now.getMonth() + 1)}-${part(now.getDate())}`;
  }

  // Lô phát hành khóa theo ĐÚNG MỘT NGÀY. Số hóa đơn là dải dùng chung hai cơ
  // sở và phải liên tục trong ngày, nên lô trộn nhiều ngày không thể xen kẽ
  // đúng với cơ sở kia: phát hành 01/07 và 02/07 cùng lúc sẽ chiếm luôn phần số
  // mà cơ sở kia cần cho 01/07.
  //
  // Ô "Đến ngày" vẫn giữ để không phá thói quen đọc và các ràng buộc UI khác,
  // nhưng luôn bám theo "Từ ngày".
  function suggestedEInvoiceRange() {
    const fromDate = uiSession?.batchFromDate || uiSession?.eInvoiceFromDate || todayDateKey();
    return { fromDate, toDate: fromDate };
  }

  async function openEInvoiceAdmin() {
    statementSubtab = "einvoice";
    setStatementMode(true);
    showStatementSubtab("einvoice");
    await loadEInvoiceList();
  }

  // Ba tra cứu dưới đây trước kia quét tuyến tính toàn bộ sổ đối soát, sao kê và
  // danh mục web MỖI LẦN gọi. Vẽ lại bảng hóa đơn gọi chúng một lần cho mỗi
  // dòng, nên chi phí là bậc hai theo số phiếu và thấy rõ khi phát hành cả lô.
  //
  // Index được dựng lười và tự dựng lại khi mảng nguồn bị gán mới (so sánh bằng
  // identity, không phải nội dung). Các chỗ ghi vào dataset trong file này đều
  // thay cả mảng chứ không mutate tại chỗ, nên kiểm tra identity là đủ và không
  // cần đụng tới từng điểm gán.
  const lookupIndex = { ledgerSource: null, ledger: null, catalogSource: null, catalog: null, statementSource: null, statement: null };

  function ledgerEntryIndex() {
    const entries = verificationLedger.entries || [];
    if (lookupIndex.ledgerSource !== entries) {
      const byInvoiceNo = new Map();
      for (const item of entries) {
        const key = String(item.invoiceNo || "").trim();
        if (!key) continue;
        // Giữ bản ghi mới nhất theo verifiedAt, đúng như sort giảm dần + [0] cũ.
        const current = byInvoiceNo.get(key);
        if (!current || String(item.verifiedAt || "").localeCompare(String(current.verifiedAt || "")) > 0) {
          byInvoiceNo.set(key, item);
        }
      }
      lookupIndex.ledgerSource = entries;
      lookupIndex.ledger = byInvoiceNo;
    }
    return lookupIndex.ledger;
  }

  function catalogIndex() {
    if (lookupIndex.catalogSource !== webCatalog) {
      const byCode = new Map();
      // Giữ mã đầu tiên khớp, đúng như find() cũ.
      for (const row of webCatalog) {
        const key = String(row.code);
        if (!byCode.has(key)) byCode.set(key, row);
      }
      lookupIndex.catalogSource = webCatalog;
      lookupIndex.catalog = byCode;
    }
    return lookupIndex.catalog;
  }

  function statementTransactionIndex() {
    const transactions = statementDataset.transactions || [];
    if (lookupIndex.statementSource !== transactions) {
      const byInvoiceNo = new Map();
      for (const transaction of transactions) {
        // Một giao dịch có thể mang tối đa 3 mã phiếu; gom về mọi mã của nó và
        // giữ nguyên thứ tự xuất hiện để find() phía sau chọn đúng ứng viên cũ.
        const keys = new Set();
        for (const value of [
          transaction.invoiceNo,
          transaction.pendingPlan?.invoiceNo,
          transaction.batchApprovedPlan?.invoiceNo
        ]) {
          const invoiceNo = String(value || "").trim();
          if (invoiceNo) keys.add(invoiceNo);
        }
        for (const key of keys) {
          const bucket = byInvoiceNo.get(key);
          if (bucket) bucket.push(transaction);
          else byInvoiceNo.set(key, [transaction]);
        }
      }
      lookupIndex.statementSource = transactions;
      lookupIndex.statement = byInvoiceNo;
    }
    return lookupIndex.statement;
  }

  // Sổ đối soát sau lưu đã giữ sẵn mặt hàng + số lượng của đúng phiếu đó, và số
  // liệu này đã được kiểm tra lại với phiếu trên website trước khi trừ tồn. Dùng
  // lại nó thay vì mở lại phiếu để đọc: không phụ thuộc màn hình đang mở, không
  // có nguy cơ đọc nhầm phiếu, và chạy tức thì.
  function ledgerItemsForInvoiceNo(invoiceNo) {
    const wanted = String(invoiceNo || "").trim();
    if (!wanted) return null;
    const entry = ledgerEntryIndex().get(wanted);
    if (!entry || !Array.isArray(entry.items) || !entry.items.length) return null;
    const catalog = catalogIndex();
    return entry.items.map(item => {
      const qty = Math.round(Number(item.qty ?? item.newQty) || 0);
      const price = Math.round(Number(item.price) || 0);
      const product = catalog.get(String(item.code));
      return {
        code: String(item.code || "").trim(),
        name: String(item.name || product?.name || "").trim(),
        unit: String(item.unit || product?.unit || "").trim(),
        qty,
        price,
        amount: qty * price
      };
    }).filter(item => item.code && item.qty > 0);
  }

  function renderEInvoiceAdmin() {
    const node = document.getElementById("it-einvoice-admin");
    if (!node) return;
    const { fromDate, toDate } = suggestedEInvoiceRange();
    node.innerHTML = `<div class="it-batch-toolbar">
      <div><b>Phát hành hóa đơn điện tử</b><br><small>Chọn các hóa đơn cần phát hành rồi xác nhận một lần cho cả lô. Mặt hàng của hóa đơn phát hành thành công được ghi lại để xuất file hạch toán ở tab Kho.</small></div>
      <label title="Lô phát hành luôn đúng một ngày để số hóa đơn liên tục và xen kẽ được với cơ sở kia.">Ngày phát hành<input id="it-einvoice-from-date" type="date" value="${escapeHtml(fromDate)}"></label>
      <label class="it-locked-date" title="Lô phát hành khóa theo đúng một ngày nên Đến ngày luôn bằng Ngày phát hành.">Đến ngày<input id="it-einvoice-to-date" type="date" value="${escapeHtml(toDate)}" readonly tabindex="-1"></label>
      <button id="it-einvoice-prev-day" type="button" title="Lùi một ngày">‹ Ngày trước</button>
      <button id="it-einvoice-next-day" type="button" title="Sang ngày kế">Ngày sau ›</button>
      <label title="Số hóa đơn là dải dùng chung mọi cơ sở. Mỗi cơ sở phát hành hết một ngày rồi cơ sở kế tiếp mới chạy, để số trong ngày liền mạch. Thứ tự này dùng chung cho tất cả các cơ sở.">Thứ tự phát hành<select id="it-einvoice-tenant-order">${
        issueCoordination.tenantOrder.map((slug, index) =>
          `<option value="${escapeHtml(slug)}"${slug === pageTenantSlug ? " selected" : ""}>${
            index + 1}. ${escapeHtml(TENANT_LABELS[slug] || slug)}</option>`).join("")
      }</select></label>
      <button id="it-load-einvoice" type="button" class="primary">Tải danh sách</button>
    </div>
    <div id="it-einvoice-summary"></div>
    <div id="it-einvoice-table"></div>`;
    node.querySelector("#it-load-einvoice")?.addEventListener("click", () => {
      loadEInvoiceList().catch(error => setStatus(error.message, "error"));
    });
    // Đổi ngày phát hành thì "Đến ngày" phải bám theo ngay, để người dùng không
    // nhìn thấy một khoảng ngày mà hệ thống sẽ không dùng.
    const fromInput = node.querySelector("#it-einvoice-from-date");
    const syncLockedToDate = () => {
      const toInput = node.querySelector("#it-einvoice-to-date");
      if (toInput && fromInput) toInput.value = fromInput.value;
    };
    fromInput?.addEventListener("change", syncLockedToDate);
    const shiftIssueDay = days => {
      if (!fromInput) return;
      const current = uiDateKey(fromInput.value) || todayDateKey();
      const [year, month, day] = current.split("-").map(Number);
      // Dùng UTC để việc cộng/trừ ngày không bị lệch bởi giờ mùa hè.
      const moved = new Date(Date.UTC(year, month - 1, day + days));
      const part = number => String(number).padStart(2, "0");
      fromInput.value =
        `${moved.getUTCFullYear()}-${part(moved.getUTCMonth() + 1)}-${part(moved.getUTCDate())}`;
      syncLockedToDate();
      loadEInvoiceList().catch(error => setStatus(error.message, "error"));
    };
    node.querySelector("#it-einvoice-prev-day")?.addEventListener("click", () => shiftIssueDay(-1));
    node.querySelector("#it-einvoice-next-day")?.addEventListener("click", () => shiftIssueDay(1));
    // Ô này hiển thị dãy thứ tự đang áp dụng. Chọn một cơ sở nghĩa là đưa cơ sở
    // đó lên đầu dãy — thao tác duy nhất có nghĩa khi đứng ở một tab, vì sắp xếp
    // lại toàn dãy cần giao diện kéo thả mà nghiệp vụ chưa cần tới.
    node.querySelector("#it-einvoice-tenant-order")?.addEventListener("change", async event => {
      const chosen = String(event.target.value || "");
      try {
        // Đọc lại trước khi ghi: cơ sở khác có thể vừa đổi thứ tự hoặc vừa ghi
        // chốt vào cùng bản ghi; ghi đè cả bản ghi sẽ xóa mất phần đó.
        const current = InvoiceIssueCoordination.normalize(
          await InvoiceMappingStore.loadIssueCoordination(issueCoordination)
        );
        const reordered = [chosen, ...current.tenantOrder.filter(slug => slug !== chosen)];
        issueCoordination = InvoiceIssueCoordination.setTenantOrder(current, reordered);
        await InvoiceMappingStore.saveIssueCoordination(issueCoordination);
        setStatus(
          "Thứ tự phát hành: " +
          issueCoordination.tenantOrder
            .map((slug, index) => `${index + 1}. ${TENANT_LABELS[slug] || slug}`).join(" → ") +
          ". Mọi cơ sở dùng chung thiết lập này.",
          "ok"
        );
        renderEInvoiceAdmin();
      } catch (error) {
        setStatus(`Không lưu được thứ tự cơ sở: ${error.message}`, "error");
      }
    });
    renderEInvoiceRows();
  }

  function renderEInvoiceRows() {
    const summary = document.getElementById("it-einvoice-summary");
    const table = document.getElementById("it-einvoice-table");
    if (!summary || !table) return;
    if (!eInvoiceRows.length) {
      summary.innerHTML = "";
      table.innerHTML = "<p>Chưa có dữ liệu. Hãy chọn khoảng ngày rồi bấm <b>Tải danh sách</b>.</p>";
      return;
    }
    const pending = eInvoiceRows.filter(row => !row.issued && !row.cancelled);
    const issued = eInvoiceRows.filter(row => row.issued);
    const linked = statementInvoiceNos();
    const outsideCount = eInvoiceRows.filter(row => !isStatementInvoice(row, linked)).length;
    // Mặc định chỉ hiện phiếu thuộc danh sách giao dịch; phiếu ngoài giao dịch
    // vẫn xem được nhưng phải chủ động bật.
    const visibleRows = showEInvoicesOutsideStatement
      ? eInvoiceRows
      : eInvoiceRows.filter(row => isStatementInvoice(row, linked));
    // Tính đối chiếu sao kê một lần cho mỗi dòng rồi dùng lại ở cả `selectable`
    // lẫn phần dựng HTML bên dưới, thay vì gọi statementInvoiceMatch hai lần.
    const matchByRowId = new Map(visibleRows.map(row => [row.id, statementInvoiceMatch(row)]));
    const selectable = new Set(
      visibleRows
        .filter(row => !row.issued && !row.cancelled && matchByRowId.get(row.id).valid)
        .map(row => row.id));
    // Bỏ khỏi lựa chọn những dòng không còn phát hành được (hoặc đã bị ẩn).
    eInvoiceSelection = new Set(Array.from(eInvoiceSelection).filter(id => selectable.has(id)));
    summary.innerHTML = `<div class="it-batch-summary-bar">
      <span><b>${visibleRows.length}</b>/${eInvoiceRows.length} hóa đơn</span>
      <span><b>${pending.length}</b> chưa phát hành</span>
      <span><b>${issued.length}</b> đã phát hành</span>
      <span>Đang chọn: <b id="it-einvoice-selected-count">${eInvoiceSelection.size}</b></span>
      ${outsideCount ? `<label title="Phiếu không gắn với giao dịch nào trong sao kê">
        <input id="it-einvoice-show-outside" type="checkbox" ${showEInvoicesOutsideStatement ? "checked" : ""}>
        Hiện ${outsideCount} phiếu ngoài giao dịch</label>` : ""}
    </div>`;
    summary.querySelector("#it-einvoice-show-outside")?.addEventListener("change", event => {
      showEInvoicesOutsideStatement = event.target.checked;
      renderEInvoiceRows();
    });
    if (!visibleRows.length) {
      table.innerHTML = eInvoiceRows.length
        ? `<p>Không có hóa đơn nào thuộc danh sách giao dịch trong khoảng ngày này.${
          outsideCount ? ` Có ${outsideCount} phiếu ngoài giao dịch — tích ô ở trên để xem.` : ""}</p>`
        : "<p>Chưa có dữ liệu. Hãy chọn khoảng ngày rồi bấm <b>Tải danh sách</b>.</p>";
      return;
    }
    const rows = visibleRows.map(row => {
      const recorded = InvoiceIssuedBook.findByInvoiceId(issuedInvoiceBook, row.id);
      const statementMatch = matchByRowId.get(row.id);
      const statusHtml = row.cancelled
        ? '<span class="it-bank-status skipped">Đã hủy</span>'
        : row.issued
          ? `<span class="it-bank-status done">Đã phát hành</span><br><small>Số ${escapeHtml(row.soHoaDon)}${row.soKyHieu ? ` · ${escapeHtml(row.soKyHieu)}` : ""}</small>`
          : '<span class="it-bank-status pending">Chưa phát hành</span>';
      // Chưa phát hành thì xem trước mặt hàng lấy từ sổ đối soát, để biết ngay
      // hóa đơn nào sẽ thiếu số liệu hạch toán trước khi bấm phát hành.
      const preview = recorded?.items?.length ? recorded.items : ledgerItemsForInvoiceNo(row.invoiceNo);
      const source = recorded?.items?.length ? "đã ghi sổ" : preview ? "sổ đối soát" : "";
      const itemsHtml = preview?.length
        ? `<details><summary>${preview.length} mã${source ? ` · ${source}` : ""}</summary><table><thead><tr><th>Mã</th><th>Tên</th><th>SL</th></tr></thead><tbody>${
          preview.map(item => `<tr><td>${escapeHtml(item.code)}</td><td>${escapeHtml(item.name)}</td><td>${formatMoney(item.qty)}</td></tr>`).join("")
        }</tbody></table></details>`
        : recorded?.itemsError
          ? `<small class="it-blocked-note" title="${escapeHtml(recorded.itemsError)}">⚠ chưa đọc được mặt hàng</small>`
          : '<small class="it-blocked-note">chưa có trong sổ đối soát</small>';
      const selectable = !row.issued && !row.cancelled && statementMatch.valid;
      const outside = !isStatementInvoice(row, linked);
      const matchHtml = statementMatch.valid
        ? `<span class="it-bank-status done">Khớp giao dịch</span><br><small>${escapeHtml(statementMatch.dateKey)} · ${formatMoney(statementMatch.credit)} đ${statementMatch.amountDifference ? ` · lệch ${statementMatch.amountDifference > 0 ? "+" : ""}${formatMoney(statementMatch.amountDifference)} đ` : ""}</small>`
        : `<span class="it-bank-status skipped">Không khớp</span><br><small class="it-blocked-note">${escapeHtml(statementMatch.reason)}</small>`;
      const rowClass = [outside ? "it-outside-statement" : "", !outside && !statementMatch.valid ? "it-einvoice-mismatch" : ""]
        .filter(Boolean).join(" ");
      return `<tr data-einvoice-id="${escapeHtml(row.id)}" class="${rowClass}">
        <td>${selectable
          ? `<input class="it-einvoice-select" type="checkbox" ${eInvoiceSelection.has(row.id) ? "checked" : ""}>`
          : ""}</td>
        <td><b>${escapeHtml(row.invoiceNo)}</b><br><small>${escapeHtml(row.dateKey)}</small>${
          outside ? '<br><small class="it-blocked-note">ngoài giao dịch</small>' : ""}</td>
        <td class="it-money">${formatMoney(row.grandTotal)}</td>
        <td>${matchHtml}</td>
        <td>${escapeHtml(row.buyer || "—")}</td>
        <td>${statusHtml}</td>
        <td>${itemsHtml}${row.issued
          ? `<br><button class="it-check-issued" type="button" data-id="${escapeHtml(row.id)}">Check / đồng bộ</button>`
          : ""}</td>
      </tr>`;
    }).join("");
    table.innerHTML = `<div class="it-batch-actions">
      <label><input id="it-einvoice-select-all" type="checkbox"> Chọn tất cả chưa phát hành</label>
      <span>
        <button id="it-test-read-items" type="button" title="Chỉ đọc mặt hàng của các hóa đơn đã chọn, không phát hành">Thử đọc mặt hàng</button>
        <button id="it-sync-issued" type="button" title="Ghi sổ các hóa đơn đã phát hành trên website nhưng chưa có trong sổ hạch toán">Đồng bộ hóa đơn đã phát hành</button>
        <button id="it-issue-einvoices" type="button" class="primary" ${eInvoiceSelection.size && !issuingInProgress ? "" : "disabled"}>Phát hành hóa đơn đã chọn</button>
      </span>
    </div>
    <div id="it-einvoice-progress"></div>
    <div class="it-table-wrap"><table class="it-batch-table it-einvoice-table"><thead><tr><th></th><th>Phiếu</th><th>Tổng cộng</th><th>Giao dịch liên kết</th><th>Người mua</th><th>Trạng thái</th><th>Mặt hàng đã ghi</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    table.querySelector("#it-einvoice-select-all")?.addEventListener("change", event => {
      table.querySelectorAll(".it-einvoice-select").forEach(input => { input.checked = event.target.checked; });
      updateEInvoiceSelection();
    });
    table.querySelectorAll(".it-einvoice-select").forEach(input =>
      input.addEventListener("change", updateEInvoiceSelection));
    table.querySelector("#it-issue-einvoices")?.addEventListener("click", () => {
      issueSelectedEInvoices().catch(error => setStatus(error.message, "error"));
    });
    table.querySelector("#it-test-read-items")?.addEventListener("click", () => {
      testReadInvoiceItems().catch(error => setStatus(error.message, "error"));
    });
    table.querySelector("#it-sync-issued")?.addEventListener("click", () => {
      syncIssuedInvoices().catch(error => setStatus(error.message, "error"));
    });
    table.querySelectorAll(".it-check-issued").forEach(button =>
      button.addEventListener("click", () => {
        checkIssuedInvoice(button.dataset.id).catch(error => setStatus(error.message, "error"));
      }));
  }

  async function checkIssuedInvoice(invoiceId) {
    const current = eInvoiceRows.find(row => row.id === invoiceId);
    if (!current) throw new Error("Không tìm thấy hóa đơn cần Check trong danh sách hiện tại.");
    const result = await request("fetchEInvoiceList", {
      fromDate: current.dateKey,
      toDate: current.dateKey
    });
    const actual = (result.rows || []).find(row => row.id === invoiceId);
    if (!actual) throw new Error(`Website không còn trả về phiếu ${current.invoiceNo} trong ngày ${current.dateKey}.`);
    Object.assign(current, actual);
    if (!actual.issued) {
      renderEInvoiceRows();
      return setStatus(`Phiếu ${current.invoiceNo} hiện vẫn chưa được phát hành trên website.`, "warn");
    }
    const items = ledgerItemsForInvoiceNo(actual.invoiceNo);
    issuedInvoiceBook = InvoiceIssuedBook.record(issuedInvoiceBook, {
      invoiceId: actual.id,
      invoiceNo: actual.invoiceNo,
      dateKey: actual.dateKey,
      issuedAt: new Date().toISOString(),
      grandTotal: actual.grandTotal,
      soHoaDon: actual.soHoaDon,
      soKyHieu: actual.soKyHieu,
      maCQThue: actual.maCQThue,
      maTraCuu: actual.maTraCuu,
      linkTraCuu: actual.linkTraCuu,
      itemsError: items ? "" : "Không có trong sổ đối soát; cần nhập mặt hàng thủ công khi hạch toán.",
      items: items || []
    });
    await InvoiceMappingStore.saveIssuedInvoices(issuedInvoiceBook);
    renderEInvoiceRows();
    setStatus(
      `Đã Check và đồng bộ phiếu ${actual.invoiceNo}: hóa đơn số ${actual.soHoaDon || "—"}.` +
      (items ? "" : " Chưa có mặt hàng trong sổ đối soát."),
      items ? "ok" : "warn"
    );
  }

  // Hóa đơn đã phát hành trên website nhưng chưa có trong sổ hạch toán — do phát
  // hành tay, hoặc do lần phát hành trước mất phản hồi. Ghi bổ sung để file xuất
  // kho không bị thiếu.
  async function syncIssuedInvoices() {
    // Chỉ đồng bộ phiếu thuộc danh sách giao dịch, trừ khi người dùng đang chủ
    // động xem cả phiếu ngoài giao dịch.
    const linked = statementInvoiceNos();
    const issued = eInvoiceRows.filter(row =>
      row.issued && !row.cancelled &&
      (showEInvoicesOutsideStatement || isStatementInvoice(row, linked)));
    const missing = issued.filter(row => !InvoiceIssuedBook.findByInvoiceId(issuedInvoiceBook, row.id));
    if (!missing.length) {
      return setStatus(
        issued.length
          ? `Cả ${issued.length} hóa đơn đã phát hành đều có trong sổ hạch toán.`
          : "Không có hóa đơn đã phát hành nào trong khoảng ngày này.",
        "ok"
      );
    }
    let withItems = 0;
    for (const row of missing) {
      const items = ledgerItemsForInvoiceNo(row.invoiceNo);
      if (items) withItems += 1;
      issuedInvoiceBook = InvoiceIssuedBook.record(issuedInvoiceBook, {
        invoiceId: row.id,
        invoiceNo: row.invoiceNo,
        dateKey: row.dateKey,
        issuedAt: new Date().toISOString(),
        grandTotal: row.grandTotal,
        soHoaDon: row.soHoaDon,
        soKyHieu: row.soKyHieu,
        maCQThue: row.maCQThue,
        maTraCuu: row.maTraCuu,
        linkTraCuu: row.linkTraCuu,
        itemsError: items ? "" : "Không có trong sổ đối soát; cần nhập mặt hàng thủ công khi hạch toán.",
        items: items || []
      });
    }
    await InvoiceMappingStore.saveIssuedInvoices(issuedInvoiceBook);
    renderEInvoiceRows();
    setStatus(
      `Đã ghi sổ ${missing.length} hóa đơn đã phát hành; ${withItems} có mặt hàng từ sổ đối soát` +
      (missing.length - withItems ? `, ${missing.length - withItems} còn thiếu mặt hàng.` : "."),
      missing.length - withItems ? "warn" : "ok"
    );
  }

  // Kiểm tra riêng bước đọc mặt hàng trước khi phát hành thật: chỉ gọi API đọc,
  // không đụng tới kiemTraThongTin/phatHanhHoaDon nên không thay đổi gì.
  async function testReadInvoiceItems() {
    const targets = eInvoiceRows.filter(row => eInvoiceSelection.has(row.id));
    const sample = targets.length ? targets : eInvoiceRows.slice(0, 1);
    if (!sample.length) return setStatus("Chưa có hóa đơn nào để thử đọc.", "error");
    const progress = document.getElementById("it-einvoice-progress");
    const lines = [];
    let listReady = null;
    setStatus(`Đang thử đọc mặt hàng của ${sample.length} hóa đơn…`, "warn");
    const describe = items => items.map(item => `${item.code} x${item.qty}`).join(", ");
    for (const row of sample) {
      const fromLedger = ledgerItemsForInvoiceNo(row.invoiceNo);
      if (fromLedger) {
        lines.push(`${row.invoiceNo}: ${fromLedger.length} mã (sổ đối soát) — ${describe(fromLedger)}`);
        continue;
      }
      // Chỉ hóa đơn không có trong sổ mới phải mở lại phiếu trên website.
      if (listReady == null) {
        listReady = await request("hasInvoiceList").catch(() => ({ present: false }));
      }
      if (!listReady?.present) {
        lines.push(`${row.invoiceNo}: chưa có trong sổ đối soát, và màn hình danh sách Bán hàng chưa mở nên không đọc được.`);
        continue;
      }
      try {
        const result = await request("readInvoiceItems", { id: row.id, invoiceNo: row.invoiceNo });
        const items = result.items || [];
        lines.push(`${row.invoiceNo}: ${items.length} mã (đọc từ phiếu) — ${describe(items) || "không có dòng hàng"}`);
      } catch (error) {
        lines.push(`${row.invoiceNo}: LỖI — ${error.message}`);
      }
    }
    if (progress) progress.textContent = lines.join("\n");
    const failed = lines.filter(line => line.includes("LỖI") || line.includes("không đọc được")).length;
    setStatus(
      failed
        ? `${failed}/${sample.length} hóa đơn chưa có mặt hàng; xem chi tiết bên dưới trước khi phát hành.`
        : `Đã có mặt hàng cho cả ${sample.length} hóa đơn. Có thể phát hành.`,
      failed ? "error" : "ok"
    );
  }

  function updateEInvoiceSelection() {
    const table = document.getElementById("it-einvoice-table");
    if (!table) return;
    eInvoiceSelection = new Set(Array.from(table.querySelectorAll(".it-einvoice-select"))
      .filter(input => input.checked)
      .map(input => input.closest("tr").dataset.einvoiceId));
    const count = document.getElementById("it-einvoice-selected-count");
    if (count) count.textContent = String(eInvoiceSelection.size);
    const button = document.getElementById("it-issue-einvoices");
    if (button) button.disabled = !eInvoiceSelection.size || issuingInProgress;
  }

  async function loadEInvoiceList() {
    const fromDate = document.getElementById("it-einvoice-from-date")?.value || todayDateKey();
    // Lô phát hành luôn đúng một ngày: số hóa đơn phải liên tục trong ngày và
    // xen kẽ được với cơ sở kia. Ép ở đây thay vì chỉ cảnh báo lúc phát hành,
    // để danh sách không bao giờ chứa sẵn nhiều ngày cho người dùng tích chọn.
    const toDate = fromDate;
    const toInput = document.getElementById("it-einvoice-to-date");
    if (toInput && toInput.value !== fromDate) toInput.value = fromDate;
    setStatus("Đang tải danh sách hóa đơn điện tử…", "warn");
    const result = await request("fetchEInvoiceList", { fromDate, toDate });
    eInvoiceRows = result.rows || [];
    for (const row of eInvoiceRows) {
      const recorded = InvoiceIssuedBook.findByInvoiceId(issuedInvoiceBook, row.id);
      if (!recorded) continue;
      if (!String(row.buyer || "").trim() && recorded.buyer) row.buyer = recorded.buyer;
      if (!String(row.paymentMethod || "").trim() && recorded.paymentMethod) row.paymentMethod = recorded.paymentMethod;
    }
    uiSession = { ...(uiSession || {}), eInvoiceFromDate: fromDate, eInvoiceToDate: toDate };
    // Chỉ ghi xuống storage khi đã có phiên Batch Review hợp lệ; nếu chưa thì
    // giữ trong bộ nhớ để không tạo ra bản ghi phiên sai schema.
    if (uiSession.schemaVersion === 1 && uiSession.mode === "batch") {
      await InvoiceMappingStore.saveUiSession(uiSession)
        .catch(error => console.error("Không lưu được khoảng ngày phát hành", error));
    }
    renderEInvoiceRows();
    const pending = eInvoiceRows.filter(row => !row.issued && !row.cancelled).length;
    setStatus(`Đã tải ${eInvoiceRows.length} hóa đơn; ${pending} hóa đơn chưa phát hành.`, pending ? "ok" : "warn");
  }

  // Số phiếu đã gắn với một giao dịch trong sao kê. Chỉ những phiếu này mới phát
  // sinh từ luồng của extension; phiếu ngoài danh sách giao dịch là của nghiệp vụ
  // khác nên mặc định không đưa vào lô phát hành.
  function statementInvoiceNos() {
    return new Set(statementTransactionIndex().keys());
  }

  function isStatementInvoice(row, linked) {
    return linked.has(String(row.invoiceNo || "").trim());
  }

  function statementTransactionsForInvoiceNo(invoiceNo) {
    const wanted = String(invoiceNo || "").trim();
    if (!wanted) return [];
    return statementTransactionIndex().get(wanted) || [];
  }

  const E_INVOICE_AMOUNT_TOLERANCE = 1;

  // Một mã phiếu chỉ được phát hành từ extension khi đồng thời khớp ngày và
  // tổng tiền với đúng giao dịch sao kê đã liên kết. Kiểm tra này ngăn việc
  // phát hành nhầm một phiếu trùng mã nhưng sai ngày hoặc sai số tiền.
  function statementInvoiceMatch(row) {
    const candidates = statementTransactionsForInvoiceNo(row?.invoiceNo);
    if (!candidates.length) {
      return { valid: false, linked: false, reason: "Không có giao dịch sao kê liên kết." };
    }
    const invoiceDate = uiDateKey(row?.dateKey);
    const invoiceTotal = Math.round(Number(row?.grandTotal) || 0);
    const exact = candidates.find(transaction =>
      uiDateKey(transaction.transactionDate) === invoiceDate &&
      Math.abs(Math.round(Number(transaction.credit) || 0) - invoiceTotal) <= E_INVOICE_AMOUNT_TOLERANCE);
    if (exact) {
      const credit = Math.round(Number(exact.credit) || 0);
      return {
        valid: true,
        linked: true,
        transaction: exact,
        dateKey: uiDateKey(exact.transactionDate),
        credit,
        amountDifference: invoiceTotal - credit,
        reason: ""
      };
    }
    const sameDate = candidates.find(transaction => uiDateKey(transaction.transactionDate) === invoiceDate);
    const sameTotal = candidates.find(transaction =>
      Math.abs(Math.round(Number(transaction.credit) || 0) - invoiceTotal) <= E_INVOICE_AMOUNT_TOLERANCE);
    const reference = sameDate || sameTotal || candidates[0];
    const problems = [];
    if (uiDateKey(reference.transactionDate) !== invoiceDate) {
      problems.push(`sai ngày: phiếu ${invoiceDate || "—"}, sao kê ${uiDateKey(reference.transactionDate) || "—"}`);
    }
    if (Math.abs(Math.round(Number(reference.credit) || 0) - invoiceTotal) > E_INVOICE_AMOUNT_TOLERANCE) {
      problems.push(`sai tiền: phiếu ${formatMoney(invoiceTotal)} đ, sao kê ${formatMoney(reference.credit)} đ`);
    }
    return {
      valid: false,
      linked: true,
      transaction: reference,
      dateKey: uiDateKey(reference.transactionDate),
      credit: Math.round(Number(reference.credit) || 0),
      reason: problems.join("; ") || "Không khớp giao dịch sao kê."
    };
  }

  // Sau khi một hóa đơn báo lỗi, đọc lại đúng dòng đó trên website để biết thực
  // sự đã phát hành hay chưa. Trả về null nếu không xác định được.
  async function confirmIssuedAfterFailure(row) {
    try {
      const result = await request("fetchEInvoiceList", {
        fromDate: row.dateKey,
        toDate: row.dateKey
      });
      const found = (result.rows || []).find(item => item.id === row.id);
      return found?.issued ? found : null;
    } catch (_) {
      return null;
    }
  }

  // Giờ giao dịch thật của phiếu, lấy từ sao kê. requestedAt là dấu thời gian
  // khách chuyển tiền; nó quyết định thứ tự nghiệp vụ của hóa đơn trong ngày.
  function issueOrderKey(row) {
    const linked = statementTransactionsForInvoiceNo(row?.invoiceNo);
    // Một mã phiếu chỉ khớp đúng một giao dịch sau statementInvoiceMatch, nhưng
    // vẫn lấy giá trị nhỏ nhất để thứ tự ổn định nếu có nhiều ứng viên.
    let earliest = "";
    for (const transaction of linked) {
      const stamp = String(transaction?.requestedAt || "");
      if (!stamp) continue;
      if (!earliest || stamp < earliest) earliest = stamp;
    }
    return earliest;
  }

  // Số hóa đơn điện tử do máy chủ cấp tăng dần theo đúng thứ tự lời gọi
  // phatHanhHoaDon, nên thứ tự phát hành CHÍNH LÀ thứ tự đánh số. Sắp theo ngày
  // rồi tới giờ giao dịch trong sao kê — KHÔNG theo invoiceNo: phiếu tạo mới
  // nhận số cuối dải nên invoiceNo lộn xộn, còn giờ giao dịch thì không.
  // invoiceNo chỉ làm chốt phụ để thứ tự ổn định khi thiếu giờ.
  function sortTargetsForIssue(rows) {
    return [...(rows || [])].sort((left, right) =>
      String(uiDateKey(left?.dateKey) || "").localeCompare(String(uiDateKey(right?.dateKey) || "")) ||
      String(issueOrderKey(left) || "").localeCompare(String(issueOrderKey(right) || "")) ||
      String(left?.invoiceNo || "").localeCompare(String(right?.invoiceNo || ""), "vi", {
        numeric: true,
        sensitivity: "base"
      })
    );
  }

  async function issueSelectedEInvoices() {
    if (issuingInProgress) return;
    const targets = eInvoiceRows.filter(row => eInvoiceSelection.has(row.id) && !row.issued && !row.cancelled);
    if (!targets.length) return setStatus("Chưa chọn hóa đơn nào để phát hành.", "error");
    // Thứ tự phát hành = thứ tự máy chủ cấp số hóa đơn, nên chốt ngay từ đây và
    // dùng chung cho cả hộp thoại xác nhận lẫn vòng chạy. Người dùng phải nhìn
    // thấy đúng thứ tự sẽ chạy, không phải thứ tự dòng trong bảng.
    const orderedTargets = sortTargetsForIssue(targets);
    const mismatched = targets.filter(row => !statementInvoiceMatch(row).valid);
    if (mismatched.length) {
      const details = mismatched.slice(0, 5).map(row =>
        `${row.invoiceNo}: ${statementInvoiceMatch(row).reason}`).join(" | ");
      throw new Error(`Không phát hành: ${mismatched.length} phiếu không khớp giao dịch sao kê. ${details}`);
    }
    // Mặt hàng lấy từ sổ đối soát; chỉ hóa đơn không có trong sổ mới cần đọc lại
    // từ màn hình danh sách Bán hàng. Cảnh báo trước để người dùng biết hóa đơn
    // nào sẽ thiếu số liệu hạch toán, thay vì chặn cả lô.
    const withoutLedger = targets.filter(row => !ledgerItemsForInvoiceNo(row.invoiceNo));
    // Nếu có phiếu chưa nằm trong sổ đối soát, bridge phải mở phiếu từ danh
    // sách Bán hàng để đọc mặt hàng. Chủ động chuyển màn hình trước khi phát
    // hành, thay vì để bridge ném lỗi sâu sau khi lô đã bắt đầu chạy.
    const listReady = withoutLedger.length
      ? { present: await ensureInvoiceListScreen() }
      : { present: true };
    if (withoutLedger.length && !listReady.present) {
      throw new Error(
        "Chưa mở được danh sách Bán hàng để đọc mặt hàng. Hãy đóng phiếu đang mở, mở Bán hàng rồi thử phát hành lại."
      );
    }
    // Phiếu ngoài danh sách giao dịch không thuộc luồng của extension; chỉ phát
    // hành khi người dùng đã chủ động hiện và chọn, và phải nêu rõ trong xác nhận.
    const linkedNos = statementInvoiceNos();
    const outside = targets.filter(row => !isStatementInvoice(row, linkedNos));
    const total = targets.reduce((sum, row) => sum + row.grandTotal, 0);
    const outsideWarning = outside.length
      ? `\n\n⚠ ${outside.length} phiếu KHÔNG thuộc danh sách giao dịch: ` +
        `${outside.slice(0, 5).map(row => row.invoiceNo).join(", ")}${outside.length > 5 ? "…" : ""}`
      : "";
    const warning = withoutLedger.length
      ? `\n\n⚠ ${withoutLedger.length}/${targets.length} hóa đơn chưa có trong sổ đối soát` +
        (listReady?.present
          ? "; extension sẽ mở từng phiếu để đọc mặt hàng (chậm hơn)."
          : " và màn hình danh sách Bán hàng chưa mở, nên sẽ KHÔNG có mặt hàng để hạch toán.")
      : "";
    // Số hóa đơn là dải dùng chung hai cơ sở và phải liên tục trong ngày, nên lô
    // trộn nhiều ngày sẽ chiếm luôn phần số mà cơ sở kia cần cho ngày sớm hơn.
    // loadEInvoiceList đã khóa danh sách theo đúng một ngày; nếu vẫn lọt nhiều
    // ngày tới đây thì có gì đó sai, phải CHẶN CỨNG chứ không chỉ cảnh báo —
    // phát hành rồi thì không hoàn tác được.
    const batchDates = [...new Set(orderedTargets.map(row => uiDateKey(row.dateKey)).filter(Boolean))].sort();
    if (batchDates.length > 1) {
      throw new Error(
        `Không phát hành: lô đang trộn ${batchDates.length} ngày (${batchDates.join(", ")}). ` +
        "Mỗi lô chỉ được đúng một ngày để số hóa đơn liên tục và xen kẽ đúng với cơ sở kia. " +
        "Hãy tải lại danh sách theo từng ngày."
      );
    }
    const batchDateKey = batchDates[0] || "";
    issueCoordination = InvoiceIssueCoordination.normalize(
      await InvoiceMappingStore.loadIssueCoordination(issueCoordination)
    );
    const coordination = batchDateKey
      ? InvoiceIssueCoordination.evaluate(issueCoordination, pageTenantSlug, batchDateKey)
      : { warnings: [], goesFirst: true, expectedOtherCount: null };
    const coordinationWarning = coordination.warnings.length
      ? `\n\n${coordination.warnings.map(item => `⚠ ${item.text}`).join("\n")}`
      : "";
    const confirmed = window.confirm(
      `Phát hành ${orderedTargets.length} hóa đơn với tổng tiền ${formatMoney(total)} đ?\n\n` +
      "Số hóa đơn sẽ được cấp theo đúng thứ tự này:\n" +
      orderedTargets.slice(0, 10).map((row, index) =>
        `${index + 1}. ${row.invoiceNo} · ${uiDateKey(row.dateKey)} · ${formatMoney(row.grandTotal)} đ`).join("\n") +
      (orderedTargets.length > 10 ? `\n… và ${orderedTargets.length - 10} hóa đơn nữa.` : "") +
      "\n\nHóa đơn đã phát hành không thể tự hủy trong extension." +
      outsideWarning + warning + coordinationWarning
    );
    if (!confirmed) return setStatus("Đã hủy thao tác phát hành.", "warn");

    // Đánh dấu đang chạy để tab của cơ sở kia biết mà không chạy chồng lên.
    if (batchDateKey) {
      issueCoordination = InvoiceIssueCoordination.markCursor(
        issueCoordination, pageTenantSlug, batchDateKey,
        { status: "running", count: orderedTargets.length }
      );
      await InvoiceMappingStore.saveIssueCoordination(issueCoordination);
    }

    const progress = document.getElementById("it-einvoice-progress");
    const button = document.getElementById("it-issue-einvoices");
    const showProgress = message => { if (progress) progress.textContent = message; };
    issuingInProgress = true;
    if (button) button.disabled = true;
    let succeeded = 0;
    const failures = [];
    const warnings = [];
    let completed = 0;
    // Vẽ lại cả bảng sau MỖI hóa đơn là chi phí bậc hai: mỗi lần vẽ đụng tới
    // toàn bộ dòng đang hiển thị và dựng lại mọi node + listener. Thanh tiến
    // trình ở trên đã cập nhật riêng bằng textContent nên người dùng vẫn thấy
    // tiến độ từng phiếu; bảng chỉ cần làm mới thưa hơn, và khối `finally` luôn
    // vẽ lại lần cuối nên trạng thái kết thúc vẫn chính xác.
    const RENDER_EVERY = 10;
    const renderIssueProgress = (done, totalCount) => {
      if (done % RENDER_EVERY === 0 || done === totalCount) renderEInvoiceRows();
    };
    const processTarget = async row => {
        // Hai giai đoạn chạy không theo thứ tự chỉ số ban đầu, nên tiến độ bám
        // theo số phiếu đã xong thay vì vị trí trong danh sách.
        const position = Math.min(completed + 1, targets.length);
        showProgress(`Đang phát hành ${position}/${targets.length}: ${row.invoiceNo}…`);
        setStatus(`Đang phát hành ${row.invoiceNo} (${position}/${targets.length})…`, "warn");
        try {
          const ledgerItems = ledgerItemsForInvoiceNo(row.invoiceNo);
          const result = await request("issueEInvoice", {
            id: row.id,
            invoiceNo: row.invoiceNo,
            dateKey: row.dateKey,
            // Có sẵn mặt hàng thì bridge khỏi phải mở lại phiếu để đọc.
            knownItems: ledgerItems || null,
            canReadItems: Boolean(listReady?.present)
          });
          // Ghi sổ ngay sau từng hóa đơn: nếu lô dừng giữa chừng thì phần đã
          // phát hành vẫn có số liệu hạch toán.
          issuedInvoiceBook = InvoiceIssuedBook.record(issuedInvoiceBook, {
            invoiceId: row.id,
            invoiceNo: row.invoiceNo,
            dateKey: row.dateKey,
            issuedAt: new Date().toISOString(),
            grandTotal: row.grandTotal,
            soHoaDon: result.soHoaDon,
            soKyHieu: result.soKyHieu,
            maCQThue: result.maCQThue,
            maTraCuu: result.maTraCuu,
            linkTraCuu: result.linkTraCuu,
            buyer: result.buyer,
            buyerAddress: result.buyerAddress,
            paymentMethod: result.paymentMethod,
            itemsError: result.itemsError,
            items: result.items
          });
          await InvoiceMappingStore.saveIssuedInvoices(issuedInvoiceBook);
          Object.assign(row, {
            issued: true,
            soHoaDon: result.soHoaDon,
            soKyHieu: result.soKyHieu,
            maCQThue: result.maCQThue,
            maTraCuu: result.maTraCuu,
            linkTraCuu: result.linkTraCuu,
            buyer: String(result.buyer || row.buyer || DEFAULT_INVOICE_BUYER).trim(),
            paymentMethod: String(result.paymentMethod || row.paymentMethod || "").trim()
          });
          succeeded += 1;
          eInvoiceSelection.delete(row.id);
          completed += 1;
          showProgress(`\u0110\u00e3 x\u1eed l\u00fd ${completed}/${targets.length} h\u00f3a \u0111\u01a1n...`);
          renderIssueProgress(completed, targets.length);
        } catch (error) {
          // Hết thời gian chờ hoặc mất phản hồi KHÔNG có nghĩa là chưa phát hành:
          // server có thể đã phát hành xong. Đọc lại danh sách để lấy trạng thái
          // thật, tránh báo lỗi sai rồi người dùng bấm phát hành lại.
          const actual = await confirmIssuedAfterFailure(row);
          if (actual?.issued) {
            issuedInvoiceBook = InvoiceIssuedBook.record(issuedInvoiceBook, {
              invoiceId: row.id,
              invoiceNo: row.invoiceNo,
              dateKey: row.dateKey,
              issuedAt: new Date().toISOString(),
              grandTotal: row.grandTotal,
              soHoaDon: actual.soHoaDon,
              soKyHieu: actual.soKyHieu,
              maCQThue: actual.maCQThue,
              maTraCuu: actual.maTraCuu,
              linkTraCuu: actual.linkTraCuu,
              itemsError: ledgerItemsForInvoiceNo(row.invoiceNo) ? "" : `Mất phản hồi khi phát hành: ${error.message}`,
              items: ledgerItemsForInvoiceNo(row.invoiceNo) || []
            });
            await InvoiceMappingStore.saveIssuedInvoices(issuedInvoiceBook);
            Object.assign(row, actual);
            succeeded += 1;
            eInvoiceSelection.delete(row.id);
            warnings.push(`${row.invoiceNo}: mất phản hồi nhưng hóa đơn ĐÃ phát hành (Số ${actual.soHoaDon}); đã ghi sổ.`);
          } else {
            failures.push(`${row.invoiceNo}: ${error.message}`);
          }
          completed += 1;
          showProgress(`\u0110\u00e3 x\u1eed l\u00fd ${completed}/${targets.length} h\u00f3a \u0111\u01a1n...`);
          renderIssueProgress(completed, targets.length);
        }
    };
    try {
      // Hai đường chạy có ràng buộc khác nhau:
      // Số hóa đơn điện tử (SOHOADON) do máy chủ cấp tăng dần theo đúng thứ tự
      // lời gọi phatHanhHoaDon đến. THỨ TỰ PHÁT HÀNH CHÍNH LÀ THỨ TỰ ĐÁNH SỐ,
      // nên cả lô bắt buộc chạy MỘT luồng.
      //
      // Bản trước chia lô làm hai giai đoạn nối tiếp: nhóm đã có mặt hàng trong
      // sổ đối soát chạy thuần API với 2 luồng song song, rồi mới tới nhóm phải
      // mở giao diện. Cách đó nhanh hơn nhưng làm rối số hóa đơn theo hai đường:
      // hai luồng song song về đích theo độ trễ mạng chứ không theo thứ tự gửi,
      // và việc tách giai đoạn xáo thứ tự theo tiêu chí "đã có mặt hàng hay
      // chưa" — hoàn toàn không liên quan tới giờ giao dịch.
      //
      // Nghiệp vụ cần số hóa đơn liên tục theo giờ giao dịch, kể cả khi xen kẽ
      // với cơ sở còn lại, nên ở đây đổi tốc độ lấy thứ tự. Đừng phân nhóm lại
      // theo bất cứ tiêu chí nào khác: orderedTargets đã là thứ tự cuối cùng.
      for (const row of orderedTargets) await processTarget(row);
    } finally {
      // Luôn mở khóa nút, kể cả khi vòng lặp hỏng giữa chừng.
      issuingInProgress = false;
      renderEInvoiceRows();
      // Chốt PHẢI được gỡ khỏi "running" ngay tại đây. Nếu vòng lặp ném lỗi
      // (mất phiên, mất mạng), lỗi thoát ra ngoài và toàn bộ phần tổng kết bên
      // dưới không chạy — chốt sẽ kẹt ở "running" vĩnh viễn, khiến mọi lần chạy
      // sau đều bị cảnh báo "lô trước đứt giữa chừng" dù thực tế đã xong.
      //
      // Ghi ngay cả khi lô hỏng: phần đã phát hành vẫn chiếm số thật trên máy
      // chủ, nên cơ sở kia cần biết đã dùng tới số nào.
      if (batchDateKey) {
        const issuedSoFar = orderedTargets
          .map(row => String(row.soHoaDon || "").trim())
          .filter(Boolean);
        const reached = InvoiceIssueCoordination.checkContinuity(issuedSoFar);
        issueCoordination = InvoiceIssueCoordination.markCursor(
          issueCoordination, pageTenantSlug, batchDateKey,
          {
            status: "done",
            lastSoHoaDon: reached.to == null ? "" : String(reached.to),
            count: succeeded
          }
        );
        try {
          await InvoiceMappingStore.saveIssueCoordination(issueCoordination);
        } catch (error) {
          console.error("Không lưu được chốt phát hành", error);
        }
      }
    }
    const missingItems = targets.filter(row => {
      const entry = InvoiceIssuedBook.findByInvoiceId(issuedInvoiceBook, row.id);
      return entry && !entry.items.length;
    }).length;
    // Chốt đã được ghi trong khối finally ở trên — kể cả khi lô hỏng giữa chừng.
    // Ở đây chỉ tính lại tính liên tục để đưa vào phần tổng kết.
    const continuity = batchDateKey
      ? InvoiceIssueCoordination.checkContinuity(
        orderedTargets.map(row => String(row.soHoaDon || "").trim()).filter(Boolean)
      )
      : null;
    const progressMessages = [];
    if (failures.length) progressMessages.push(`Thất bại ${failures.length} hóa đơn:\n${failures.join("\n")}`);
    if (warnings.length) progressMessages.push(`Cảnh báo ${warnings.length} hóa đơn:\n${warnings.join("\n")}`);
    // Đứt quãng thường nghĩa là cơ sở kia đã chen vào giữa, hoặc có hóa đơn
    // phát hành ngoài extension. Phải báo ngay thay vì để phát hiện lúc quyết toán.
    if (continuity && !continuity.ok) {
      progressMessages.push(
        `⚠ Số hóa đơn ngày ${batchDateKey} không liên tục (${continuity.from}–${continuity.to}): ` +
        continuity.gaps.map(gap => `thiếu ${gap.missing} số giữa ${gap.after} và ${gap.before}`).join("; ") +
        ". Kiểm tra xem cơ sở kia có phát hành xen vào không."
      );
    }
    showProgress(progressMessages.join("\n\n"));
    // Việc cuối sau khi phát hành là xuất file hạch toán. Chỉ mời khi đã có hóa
    // đơn phát hành được và mọi hóa đơn đều đọc đủ mặt hàng — thiếu mặt hàng mà
    // xuất luôn thì file hạch toán bị hụt dòng, phải kiểm tra trước.
    const canExportIssued = succeeded > 0 && !missingItems && !failures.length;
    // Nhắc chuyển cơ sở kế tiếp trong dãy. Với ba cơ sở trở lên, phải tìm cơ sở
    // ĐỨNG SAU GẦN NHẤT mà ngày này còn giao dịch — bỏ qua cơ sở không có việc,
    // vì bắt chờ một cơ sở rỗng sẽ làm kẹt cả chuỗi.
    let handoffNote = "";
    if (batchDateKey && succeeded > 0) {
      for (const nextTenant of coordination.nextTenants || []) {
        const pending = InvoiceIssueCoordination.statementSummary(
          issueCoordination, nextTenant, batchDateKey
        );
        if (!pending?.count) continue;
        // Các cơ sở dùng chung một domain nên cookie phiên ghi đè nhau: không thể
        // mở song song nhiều tab đã đăng nhập. Phải chuyển hẳn sang cơ sở kế tiếp.
        handoffNote =
          ` Tiếp theo: chuyển sang ${TENANT_LABELS[nextTenant] || nextTenant} (đăng nhập lại) ` +
          `và phát hành cùng ngày ${batchDateKey} — ${pending.count} giao dịch — trước khi sang ngày kế.`;
        break;
      }
    }
    setStatus(
      `Đã phát hành ${succeeded}/${targets.length} hóa đơn.` + handoffNote +
      (failures.length ? ` ${failures.length} hóa đơn lỗi, xem chi tiết bên dưới.` : "") +
      (warnings.length ? ` ${warnings.length} hóa đơn có cảnh báo nhưng đã xác nhận phát hành.` : "") +
      (missingItems ? ` ${missingItems} hóa đơn chưa đọc được mặt hàng; hãy kiểm tra trước khi xuất file hạch toán.` : "") +
      (canExportIssued ? " Bước cuối: xuất file hạch toán cho kỳ này." : ""),
      failures.length ? "error" : warnings.length ? "warn" : "ok",
      canExportIssued ? { label: "Xuất file hạch toán", action: "issued-export" } : undefined
    );
  }

  // Một mã web có thể nhận tồn từ nhiều dòng kho; gộp tên kho theo mã web để
  // cột "Tên hàng kho" nêu đủ nguồn mà không phải chia nhỏ số lượng.
  function stockNameByWebCode() {
    const names = new Map();
    for (const row of mappingDataset.mappings || []) {
      const webCode = String(row.webCode || "").trim();
      const stockCode = String(row.stockCode || "").trim();
      if (!webCode || !stockCode || row.status !== "confirmed") continue;
      const label = `${stockCode}${row.stockName ? ` - ${row.stockName}` : ""}`;
      const current = names.get(webCode);
      names.set(webCode, current ? `${current}; ${label}` : label);
    }
    return names;
  }

  async function exportIssuedInvoices() {
    try {
      const entries = issuedInvoiceBook.entries || [];
      if (!entries.length) {
        return setStatus("Chưa có hóa đơn nào được phát hành qua extension để xuất.", "error");
      }
      const fromDate = uiSession?.eInvoiceFromDate || "";
      const toDate = uiSession?.eInvoiceToDate || "";
      const scoped = InvoiceIssuedBook.filterEntries(issuedInvoiceBook, { fromDate, toDate });
      if (!scoped.length) {
        return setStatus(
          `Không có hóa đơn nào trong khoảng ${fromDate || "…"} → ${toDate || "…"}.`,
          "error"
        );
      }
      const withoutItems = scoped.filter(entry => !entry.items.length);
      if (withoutItems.length === scoped.length) {
        return setStatus(
          `Cả ${scoped.length} hóa đơn đều chưa có mặt hàng nên không xuất được. ` +
          "Hãy đối soát sau lưu hoặc dùng Thử đọc mặt hàng trước.",
          "error"
        );
      }
      const sheets = InvoiceIssuedBook.buildWorkbook({
        book: issuedInvoiceBook,
        fromDate,
        toDate,
        stockNameByWebCode: stockNameByWebCode()
      });
      const bytes = InvoiceXlsxWriter.build(sheets);
      const exportedAt = new Date().toISOString();
      await downloadBase64(
        InvoiceXlsxWriter.toBase64(bytes),
        `XuatKho_${pageTenantFileLabel}_PhatHanh_${localTimestamp(exportedAt)}.xlsx`,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      const lineCount = sheets[0].rows.length;
      const totalQty = sheets[0].rows.reduce((sum, row) => sum + Number(row[6] || 0), 0);
      setStatus(
        `Đã xuất Excel: ${scoped.length - withoutItems.length} hóa đơn · ${lineCount} dòng hàng · ` +
        `${formatMoney(totalQty)} đơn vị.` +
        (withoutItems.length
          ? ` Cảnh báo: ${withoutItems.length} hóa đơn chưa có mặt hàng nên không nằm trong file.`
          : ""),
        withoutItems.length ? "warn" : "ok"
      );
    } catch (error) {
      setStatus(`Không xuất được file hạch toán: ${error.message}`, "error");
    }
  }

  function renderStatementAdmin() {
    const node = document.getElementById("it-statement-admin");
    if (!node) return;
    const statementTransactions = statementDataset.transactions || [];
    const statementTotal = statementTransactions.reduce((sum, item) => sum + Number(item.credit || 0), 0);
    // Không còn hàng sub-tab riêng: menu chuyển bước ở đầu panel đã có sẵn
    // "3 Sao kê" và "5 Phát hành", hai hàng nút cùng chức năng gây rối.
    node.innerHTML = `<div id="it-statement-view">
        <div class="it-statement-toolbar"><div class="it-statement-source"><b>Sao kê: ${escapeHtml(statementDataset.source || "chưa nhập")}</b><button id="it-statement-import-button" type="button" class="primary">Nhập sao kê Excel</button></div>
        <div class="it-statement-total"><small>Tổng tiền sao kê</small><strong>${formatMoney(statementTotal)} đ</strong><span id="it-statement-visible-total"></span></div>
        <select id="it-statement-filter"><option value="open">Chưa xử lý</option><option value="all">Tất cả</option><option value="pending">Chờ xử lý</option><option value="review">Cần kiểm tra</option><option value="done">Đã xử lý</option></select></div>
        <div class="it-table-wrap"><table class="it-statement-table"><thead><tr><th>Ngày GD</th><th>Diễn giải</th><th>Phiếu</th><th>Credit</th><th>Trạng thái</th><th></th></tr></thead><tbody id="it-statement-body"></tbody></table></div>
      </div>
      <div id="it-einvoice-admin" hidden></div>`;
    node.querySelector("#it-statement-filter").addEventListener("change", renderStatementRows);
    node.querySelector("#it-statement-import-button").addEventListener("click", () => {
      document.getElementById("it-statement-file")?.click();
    });
    renderStatementRows();
    showStatementSubtab(statementSubtab);
  }

  // Phát hành hóa đơn dùng chung section với màn Giao dịch (cùng dữ liệu sao kê),
  // nhưng người dùng chuyển giữa hai bước bằng menu ở đầu panel.
  function showStatementSubtab(name) {
    statementSubtab = name === "einvoice" ? "einvoice" : "statement";
    const statementView = document.getElementById("it-statement-view");
    const eInvoiceView = document.getElementById("it-einvoice-admin");
    if (!statementView || !eInvoiceView) return;
    const showEInvoice = statementSubtab === "einvoice";
    statementView.hidden = showEInvoice;
    eInvoiceView.hidden = !showEInvoice;
    // Tiêu đề panel phải nói đúng bước đang xem, vì cùng một section phục vụ hai bước.
    const title = document.getElementById("it-screen-title");
    const help = document.getElementById("it-screen-help");
    if (title) title.textContent = showEInvoice ? "Bước 5 · Phát hành hóa đơn" : "Bước 3 · Giao dịch ngân hàng";
    if (help) {
      help.textContent = showEInvoice
        ? "Chọn các hóa đơn đã đối soát rồi phát hành theo lô. Phát hành xong không hoàn tác được."
        : "Nhập sao kê và kiểm tra trạng thái từng giao dịch trước khi lập hóa đơn.";
    }
    markActiveScreenTab("statement-mode");
    if (showEInvoice) renderEInvoiceAdmin();
  }

  function renderStatementRows() {
    const body = document.getElementById("it-statement-body");
    // Batch Review also refreshes statement statuses after planning. The bank
    // statement screen is lazily rendered, so its tbody does not exist until
    // the user opens that screen at least once.
    if (!body) return;
    const filter = document.getElementById("it-statement-filter")?.value || "open";
    const rows = (statementDataset.transactions || []).filter(item =>
      filter === "all" || item.status === filter || (filter === "open" && isOpenStatementTransaction(item))
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
      ignored: "Bỏ qua",
      already_issued: "Đã có HĐ khớp",
      needs_new_invoice: "Cần tạo phiếu"
    };
    body.innerHTML = rows.map(item => {
      const invoiceNo = String(item.invoiceNo || "");
      const room = normalizeRoomText(item.newInvoiceRoomName);
      // Giao dịch đã có phiếu thì mở thẳng từ đây, khỏi phải dò lại thủ công.
      const invoiceCell = invoiceNo
        ? `<b>${escapeHtml(invoiceNo)}</b>` +
          (room ? `<br><small>${escapeHtml(room)}</small>` : "") +
          `<br><button class="it-open-invoice" type="button" title="Mở phiếu ${escapeHtml(invoiceNo)} trên website">Mở phiếu</button>`
        : "—";
      return `<tr data-transaction-id="${escapeHtml(item.id)}" class="${item.blockedNote ? "it-blocked" : ""}">
      <td><b>${escapeHtml(item.transactionDate)}</b><br><small>${escapeHtml(item.requestedAt)}</small></td>
      <td class="it-statement-description" title="${escapeHtml(item.description)}"><span>${escapeHtml(item.description)}</span>${item.reference ? `<small>${escapeHtml(item.reference)}</small>` : ""}</td>
      <td class="it-statement-invoice">${invoiceCell}</td>
      <td class="it-money">${formatMoney(item.credit)}</td><td><span class="it-bank-status ${escapeHtml(item.status)}">${escapeHtml(statusLabels[item.status] || item.status)}</span>${item.blockedNote ? `<br><small class="it-blocked-note" title="${escapeHtml(item.blockedNote)}">⚠ ${escapeHtml(item.blockedNote)}</small>` : ""}</td>
      <td>${item.status === "review"
        ? '<button class="it-confirm-revenue" type="button" title="Xác nhận đây là doanh thu và đưa vào luồng lập phiếu">Là doanh thu</button>'
        : ""}<button class="it-use-transaction" type="button">Chọn</button><button class="it-skip-transaction" type="button">Bỏ qua</button>${["planned", "batch_ready"].includes(item.status) && (invoiceNo || item.pendingPlan || item.batchApprovedPlan) ? '<button class="it-reset-statement-transaction" type="button" title="Gỡ phiếu đã mất hoặc phương án cũ và đưa giao dịch về Chờ xử lý">Làm lại</button>' : ""}</td></tr>`;
    }).join("") || '<tr><td colspan="6">Không có giao dịch phù hợp.</td></tr>';
    body.querySelectorAll(".it-confirm-revenue").forEach(button => button.addEventListener("click", confirmRevenueTransaction));
    body.querySelectorAll(".it-use-transaction").forEach(button => button.addEventListener("click", useBankTransaction));
    body.querySelectorAll(".it-skip-transaction").forEach(button => button.addEventListener("click", skipBankTransaction));
    body.querySelectorAll(".it-open-invoice").forEach(button => button.addEventListener("click", openStatementInvoice));
    body.querySelectorAll(".it-reset-statement-transaction").forEach(button => button.addEventListener("click", resetStatementTransaction));
  }

  async function resetStatementTransaction(event) {
    const row = event.target.closest("tr");
    const transaction = findStatementTransaction(row?.dataset.transactionId);
    if (!transaction || transaction.status === "done") {
      return setStatus("Giao dịch đã đối soát không thể làm lại từ màn hình này.", "error");
    }
    const oldInvoiceNo = String(transaction.invoiceNo || transaction.pendingPlan?.invoiceNo || transaction.batchApprovedPlan?.invoiceNo || "");
    transaction.status = "pending";
    transaction.invoiceNo = "";
    transaction.linkedAt = "";
    transaction.verifiedAt = "";
    transaction.ledgerId = "";
    transaction.apiSavedAt = "";
    transaction.apiSavedRecordId = "";
    transaction.blockedNote = "";
    transaction.blockedAt = "";
    delete transaction.pendingPlan;
    delete transaction.batchApprovedPlan;
    delete transaction.batchApprovedAt;
    delete transaction.acceptedGrandOverride;
    delete transaction.acceptedGrandOverrideAt;
    batchPlans = batchPlans.filter(entry => String(entry.transactionId) !== String(transaction.id));
    if (pendingNewInvoice && String(pendingNewInvoice.transactionId) === String(transaction.id)) {
      pendingNewInvoice = null;
      document.getElementById("it-pending-new-invoice")?.remove();
    }
    if (currentBankTransaction && String(currentBankTransaction.id) === String(transaction.id)) currentBankTransaction = null;
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: null });
    renderWorkflowDashboard();
    renderStatementRows();
    renderBatchPlans();
    setStatus(
      `Đã gỡ ${oldInvoiceNo ? `phiếu ${oldInvoiceNo} và ` : ""}phương án cũ; giao dịch đã về Chờ xử lý. Tồn kho không bị trừ hoặc hoàn vì phiếu chưa đối soát.`,
      "ok"
    );
  }

  // Mở thẳng phiếu đã gắn với giao dịch. Giao dịch đã đối soát thì phiếu thường
  // đã xuất hóa đơn nên không còn trong danh sách "Chưa xuất"; khi đó phải dò
  // sang danh sách đã xuất theo số tiền.
  async function openStatementInvoice(event) {
    const button = event.target.closest("button");
    const row = button?.closest("tr");
    const transaction = findStatementTransaction(row?.dataset.transactionId);
    const invoiceNo = String(transaction?.invoiceNo || "");
    if (!transaction || !invoiceNo) {
      return setStatus("Giao dịch này chưa gắn số phiếu nào.", "error");
    }
    const originalLabel = button.textContent;
    try {
      button.disabled = true;
      button.textContent = "Đang mở…";
      setStatus(`Đang tìm phiếu ${invoiceNo} trên website…`, "warn");
      const unissued = await request("findInvoiceCandidates", {
        dateKey: transaction.transactionDate,
        usedInvoiceNos: []
      });
      let target = (unissued.candidates || []).find(item => String(item.invoiceNo) === invoiceNo);
      if (!target) {
        const issued = await request("findIssuedInvoiceByAmount", {
          dateKey: transaction.transactionDate,
          amount: transaction.acceptedGrandOverride || transaction.credit
        });
        target = (issued.rows || issued.matches || []).find(item => String(item.invoiceNo) === invoiceNo);
      }
      if (!target) {
        throw new Error(`Không tìm thấy phiếu ${invoiceNo} trong ngày ${transaction.transactionDate}.`);
      }
      await request("openInvoiceCandidate", { uid: target.uid, invoiceNo });
      setStatus(`Đã mở phiếu ${invoiceNo}. Extension không thay đổi gì trên phiếu này.`, "ok");
    } catch (error) {
      setStatus(`Không mở được phiếu ${invoiceNo}: ${error.message}`, "error");
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
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
      const openedScan = await waitForOpenedInvoice(candidate.invoiceNo, candidate.dateKey || currentBankTransaction.transactionDate);
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

  async function waitForOpenedInvoice(expectedInvoiceNo, listDateKey, timeoutMs = 15000) {
    const expected = String(expectedInvoiceNo || "").trim().toUpperCase();
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    let lastReadyInvoice = "";
    while (Date.now() < deadline) {
      const snapshot = await request("scan");
      if (snapshot?.ready) {
        const actual = String(snapshot.invoiceNo || "").trim().toUpperCase();
        lastReadyInvoice = actual || lastReadyInvoice;
        // The previous invoice can remain readable while the requested row is
        // still opening. Do not attribute that stale form to this transaction.
        if (!expected || actual === expected) return { ...snapshot, listDateKey: uiDateKey(listDateKey) };
      }
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

  function isLinhDamFreshApiInvoice(plan) {
    return pageTenantSlug === "parislinhdam" &&
      Boolean(plan?.requiresNewInvoice) &&
      Boolean(plan?.apiSavedRecordId || plan?.savedRecordId);
  }

  function matchesExpectedInvoiceDate(snapshot, plan) {
    if (!isLinhDamFreshApiInvoice(plan)) {
      return invoiceMatchesTransactionDate(snapshot, plan?.invoiceDateKey);
    }
    // Linh Đàm hiện xếp phiếu mới theo ngày tạo của máy chủ, dù NGAY và
    // giờ vào/ra đã được lưu về quá khứ. Chỉ ở nhánh tạo mới bằng API của
    // cơ sở này, đối soát ngày nghiệp vụ từ chi tiết phiếu đã lưu.
    const expected = uiDateKey(plan?.invoiceDateKey);
    const persistedBusinessDates = new Set([
      uiDateKey(snapshot?.invoiceDateKey),
      uiDateKey(snapshot?.checkIn),
      uiDateKey(snapshot?.checkOut)
    ].filter(Boolean));
    return Boolean(expected) && persistedBusinessDates.has(expected);
  }

  function verifySnapshotAgainstPlan(snapshot, plan) {
    const errors = [];
    if (!snapshot?.ready) errors.push("Phiếu chưa sẵn sàng.");
    if (String(snapshot?.invoiceNo || "") !== String(plan.invoiceNo || "")) errors.push("Sai số phiếu.");
    if (!matchesExpectedInvoiceDate(snapshot, plan)) errors.push("Sai ngày phiếu.");
    const compareUsageTime = (label, actualValue, expectedValue) => {
      if (!expectedValue) {
        errors.push(`${label}: phương án chưa lưu mốc giờ.`);
        return;
      }
      const actual = parseUiDateTime(actualValue);
      const expected = parseUiDateTime(expectedValue);
      if (!actual || !expected || Math.abs(actual.getTime() - expected.getTime()) >= 60000) {
        errors.push(`${label}: form ${actualValue || "trống"} ≠ phương án ${expectedValue}.`);
      }
    };
    compareUsageTime("Sai giờ vào", snapshot?.checkIn, plan?.checkIn);
    compareUsageTime("Sai giờ ra", snapshot?.checkOut, plan?.checkOut);
    // Nêu rõ số trên form và số của phương án: chỉ nói "Sai tổng cộng" thì không
    // biết website đang để giá trị nào, rất khó chẩn đoán khi Batch API dừng.
    const compareAmount = (label, actual, expected) => {
      const left = Math.round(Number(actual));
      const right = Math.round(Number(expected));
      if (left === right) return;
      errors.push(`${label}: form ${formatMoney(left)} ≠ phương án ${formatMoney(right)}.`);
    };
    compareAmount("Sai tiền hàng", snapshot?.currentGoods, plan.goods);
    compareAmount("Sai tiền giờ", snapshot?.currentHour, plan.hour);
    compareAmount("Sai tiền VAT", snapshot?.currentTax, plan.tax);
    if (Math.round(Number(snapshot?.taxRate)) !== Math.round(Number(plan.taxRate))) errors.push("Sai thuế suất.");
    compareAmount("Sai tổng cộng", snapshot?.currentGrand, plan.grand);
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

  async function verifySavedInvoice(verifiedSnapshot) {
    if (!currentBankTransaction?.pendingPlan) return setStatus("Không có phương án chờ đối soát.", "error");
    const button = document.getElementById("it-verify-saved-invoice");
    try {
      if (button) button.disabled = true;
      setStatus("Đang đọc lại phiếu đã lưu và đối soát…", "warn");
      // Batch Review đã mở lại phiếu từ đúng dòng của danh sách và gắn
      // listDateKey vào snapshot. Dùng lại chính snapshot đó; nếu scan lần nữa
      // thì listDateKey bị mất và ca hát hôm trước có thể bị báo sai ngày.
      const snapshot = verifiedSnapshot?.ready
        ? verifiedSnapshot
        : await request("scan");
      const plan = currentBankTransaction.pendingPlan;
      const errors = verifySnapshotAgainstPlan(snapshot, plan);
      if (errors.length) throw new Error(errors.join(" "));
      const transactionId = String(currentBankTransaction.id);
      const existing = (verificationLedger.entries || []).find(entry => String(entry.transactionId) === transactionId);
      // Luôn đọc lại kho chung ngay trước khi ghi sổ để một tab/cơ sở khác
      // không thể bị ghi đè bởi bản tồn cũ đang nằm trong bộ nhớ của tab này.
      const latestSharedWarehouse = InvoiceSharedWarehouse.normalize(
        await InvoiceMappingStore.loadSharedWarehouse(InvoiceSharedWarehouse.empty())
      );
      const latestMappingForStock = InvoiceSharedWarehouse.overlayMappings(mappingDataset, latestSharedWarehouse);
      const restoredMapping = existing
        ? restoreVerifiedStock(latestMappingForStock, existing.items)
        : latestMappingForStock;
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
      const nextSharedWarehouse = InvoiceSharedWarehouse.reconcileMappingDelta(
        latestSharedWarehouse,
        latestMappingForStock,
        nextMapping,
        { tenant: pageTenantSlug, invoiceNo: plan.invoiceNo, transactionId }
      );
      await InvoiceMappingStore.commitVerifiedInvoice(nextMapping, nextStatement, nextLedger, nextSharedWarehouse);
      mappingDataset = nextMapping;
      sharedWarehouse = nextSharedWarehouse;
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
      return { verified: true, invoiceNo: plan.invoiceNo };
    } catch (error) {
      setStatus(`Đối soát thất bại: ${error.message} Chưa thay đổi tồn kho hoặc trạng thái sao kê.`, "error");
      return { verified: false, error: error.message };
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  // Duyệt một giao dịch đang chờ rà: xác nhận đây là doanh thu và đưa về pending
  // để Batch Review lập phiếu như bình thường.
  //
  // Tách riêng khỏi nút "Chọn" vì hai việc khác nhau: "Chọn" mở luồng thủ công
  // cho đúng một giao dịch, còn nút này chỉ đổi trạng thái rồi trả người dùng
  // về danh sách để rà tiếp các dòng còn lại.
  async function confirmRevenueTransaction(event) {
    const id = event.target.closest("tr").dataset.transactionId;
    const item = statementDataset.transactions.find(transaction => String(transaction.id) === id);
    if (!item) return;
    item.status = "pending";
    // Ghi lại dấu vết đã rà: nếu nhập lại sao kê, dòng này không bị đẩy về
    // review lần nữa và người dùng khỏi phải duyệt lại từ đầu.
    item.largeCreditReviewedAt = new Date().toISOString();
    delete item.reviewNote;
    await InvoiceMappingStore.saveStatement(statementDataset);
    renderWorkflowDashboard();
    renderStatementRows();
    setStatus(
      `Đã xác nhận giao dịch ${formatMoney(item.credit)}đ ngày ${item.transactionDate} là doanh thu. ` +
      "Giao dịch đã vào hàng chờ lập phiếu.",
      "ok"
    );
  }

  async function skipBankTransaction(event) {
    const id = event.target.closest("tr").dataset.transactionId;
    const item = statementDataset.transactions.find(transaction => String(transaction.id) === id);
    if (!item) return;
    item.status = "ignored";
    await InvoiceMappingStore.saveStatement(statementDataset);
    renderWorkflowDashboard();
    renderStatementRows();
  }

  function optionHtml(item, selectedCode) {
    return `<option value="${escapeHtml(item.webCode)}" ${String(item.webCode) === String(selectedCode) ? "selected" : ""}>` +
      `${escapeHtml(item.webCode)} — ${escapeHtml(item.webName)} — ${formatMoney(item.webPrice)}</option>`;
  }

  function webSearchValue(item) {
    return `${item.webCode} | ${item.webName} | ${formatMoney(item.webPrice)}đ`;
  }

  const PRODUCT_GROUPS = [
    "DOKHO", "BIA - NƯỚC NGỌT", "PHUPHI", "RUOU - VANG",
    "THUOCLA - SHISA - XIGA", "HOAQUA", "DOPHACHE"
  ];
  const PRODUCT_CODE_BASE = {
    "DOKHO": 1000000,
    "BIA - NƯỚC NGỌT": 1100000,
    "PHUPHI": 1200000,
    "RUOU - VANG": 1300000,
    "THUOCLA - SHISA - XIGA": 1400000,
    "HOAQUA": 1500000,
    "DOPHACHE": 1600000
  };
  const productCreateInFlight = new Set();
  const mappingCreateSelection = new Set();

  function inferProductGroup(row) {
    const text = InvoiceMappingEngine.normalizeText(`${row?.stockName || ""} ${row?.stockUnit || ""}`);
    if (/ruou|vang/.test(text)) return "RUOU - VANG";
    if (/thuoc|cigar|xiga|shisha/.test(text)) return "THUOCLA - SHISA - XIGA";
    if (/hoa qua|trai cay/.test(text)) return "HOAQUA";
    if (/pha che|siro|cocktail/.test(text)) return "DOPHACHE";
    if (/bia|nuoc|pepsi|lavie|ion|yen|tra|coca|7up|sting/.test(text)) return "BIA - NƯỚC NGỌT";
    return "DOKHO";
  }

  function nextProductCode(group, reserved) {
    const base = PRODUCT_CODE_BASE[group] || PRODUCT_CODE_BASE.DOKHO;
    const used = new Set((webCatalog || []).map(item => String(item.webCode || "")));
    for (const value of reserved || []) used.add(String(value || ""));
    let max = base;
    for (const code of used) {
      const numeric = Number(code);
      if (Number.isInteger(numeric) && numeric > base && numeric < base + 100000) max = Math.max(max, numeric);
    }
    let candidate = max + 1;
    while (used.has(String(candidate))) candidate += 1;
    return String(candidate);
  }

  function ensureProductDrafts(rows) {
    const reserved = (mappingDataset.mappings || [])
      .map(row => row.productDraft?.webCode)
      .filter(Boolean);
    for (const row of rows) {
      if (row.productDraft?.webCode) continue;
      const group = inferProductGroup(row);
      const webCode = nextProductCode(group, reserved);
      reserved.push(webCode);
      row.productDraft = {
        webCode,
        name: String(row.stockName || "").trim(),
        unit: String(row.stockUnit || "").trim(),
        price: Math.round(Number(row.salePrice) || 0),
        group,
        typeId: "0",
        note: `Tạo từ kho ${pageTenantLabel}`
      };
    }
  }

  function productDraftFromRowElement(tr, row) {
    const draft = {
      webCode: tr.querySelector(".it-create-code")?.value.trim() || "",
      name: tr.querySelector(".it-create-name")?.value.trim() || "",
      unit: tr.querySelector(".it-create-unit")?.value.trim() || "",
      price: parseMoney(tr.querySelector(".it-create-price")?.value),
      group: tr.querySelector(".it-create-group")?.value || "DOKHO",
      typeId: "0",
      note: `Tạo từ kho ${pageTenantLabel}; mã kho ${row.stockCode}`
    };
    row.productDraft = draft;
    return draft;
  }

  function validateProductDraft(draft) {
    if (!/^\d{7}$/.test(draft.webCode)) throw new Error("Mã web phải gồm đúng 7 chữ số.");
    if (!draft.name) throw new Error("Tên mặt hàng không được để trống.");
    if (!draft.unit) throw new Error("Đơn vị tính không được để trống.");
    if (!(draft.price > 0)) throw new Error("Giá bán phải lớn hơn 0.");
    const duplicateCode = webCatalog.find(item => String(item.webCode) === draft.webCode);
    if (duplicateCode) throw new Error(`Mã ${draft.webCode} đã có trong danh mục; hãy ánh xạ vào mã đó.`);
    const normalizedName = InvoiceMappingEngine.normalizeText(draft.name);
    const duplicateName = webCatalog.find(item => InvoiceMappingEngine.normalizeText(item.webName) === normalizedName);
    if (duplicateName) throw new Error(`Tên này đã có ở mã ${duplicateName.webCode}; hãy kiểm tra và ánh xạ thay vì tạo trùng.`);
  }

  async function persistCreatedProduct(row, draft, result) {
    const web = {
      webCode: draft.webCode,
      webName: draft.name,
      webUnit: draft.unit,
      webPrice: draft.price,
      webType: "Mặt hàng kiêm vật tư",
      webGroup: draft.group,
      webId: result.id || ""
    };
    webCatalog = [...webCatalog, web].sort((a, b) => String(a.webCode).localeCompare(String(b.webCode)));
    catalogDataset = {
      ...catalogDataset,
      tenant: pageTenantSlug,
      source: `${catalogDataset.source || "danh mục"} + API`,
      updatedAt: new Date().toISOString(),
      items: webCatalog
    };
    Object.assign(row, web, {
      status: "confirmed",
      confidence: 100,
      confirmedAt: new Date().toISOString(),
      createdViaApi: true,
      createdProductId: result.id || "",
      createError: ""
    });
    mappingCreateSelection.delete(String(row.stockCode));
    await Promise.all([
      InvoiceMappingStore.saveCatalog(catalogDataset),
      InvoiceMappingStore.save(mappingDataset)
    ]);
    refreshMappingState();
  }

  async function createProductForMapping(row, draft) {
    const key = String(row.stockCode || "");
    if (productCreateInFlight.has(key)) throw new Error("Dòng này đang được tạo.");
    validateProductDraft(draft);
    productCreateInFlight.add(key);
    try {
      const result = await request("createProductViaApi", { product: draft });
      if (!result?.created || !result?.id) throw new Error("API không trả ID mặt hàng vừa tạo.");
      await persistCreatedProduct(row, draft, result);
      return result;
    } catch (error) {
      row.createError = error.message;
      await InvoiceMappingStore.save(mappingDataset);
      throw error;
    } finally {
      productCreateInFlight.delete(key);
    }
  }

  async function createSingleMappedProduct(event) {
    const tr = event.target.closest("tr");
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === tr?.dataset.stockCode);
    if (!row) return;
    const button = event.target;
    button.disabled = true;
    button.textContent = "Đang tạo…";
    try {
      const draft = productDraftFromRowElement(tr, row);
      await createProductForMapping(row, draft);
      renderMappingAdmin();
      setStatus(`Đã tạo mã ${draft.webCode} bằng API và xác nhận ánh xạ ${row.stockCode}.`, "ok");
    } catch (error) {
      renderMappingRows();
      setStatus(`Không tạo được ${row.stockCode}: ${error.message}`, "error");
    }
  }

  async function createSelectedMappedProducts() {
    const selected = (mappingDataset.mappings || []).filter(row =>
      mappingCreateSelection.has(String(row.stockCode)) && row.status !== "confirmed"
    );
    if (!selected.length) return setStatus("Hãy chọn ít nhất một dòng cần tạo mặt hàng.", "warn");
    const button = document.getElementById("it-create-selected-products");
    button.disabled = true;
    let completed = 0;
    try {
      for (const row of selected) {
        const draft = row.productDraft;
        button.textContent = `Đang tạo ${completed + 1}/${selected.length}…`;
        await createProductForMapping(row, draft);
        mappingCreateSelection.delete(String(row.stockCode));
        completed += 1;
      }
      renderMappingAdmin();
      setStatus(`Đã tạo tuần tự ${completed} mặt hàng bằng API và tự xác nhận ánh xạ.`, "ok");
    } catch (error) {
      renderMappingAdmin();
      setStatus(`Đã tạo ${completed} dòng rồi dừng tại lỗi: ${error.message}`, "error");
    }
  }

  function renderMappingAdmin() {
    const node = document.getElementById("it-mapping-admin");
    if (!node) return;
    const rows = mappingDataset.mappings || [];
    const pending = rows.filter(row => !["confirmed", "disabled"].includes(row.status)).length;
    const confirmed = rows.filter(row => row.status === "confirmed").length;
    const disabled = rows.filter(row => row.status === "disabled").length;
    node.innerHTML = `<div class="it-mapping-head">
        <div><h3>Đối chiếu mặt hàng kho → web</h3><p>Ghép với mã có sẵn hoặc tạo mặt hàng mới trực tiếp bằng API.</p></div>
        <div class="it-mapping-head-actions"><button id="it-import-mapping" type="button">Nhập hồ sơ</button><button id="it-export-mapping" type="button">Xuất hồ sơ</button></div>
      </div>
      <div class="it-mapping-kpis"><span><b>${rows.length}</b> tổng</span><span class="pending"><b>${pending}</b> cần xử lý</span><span class="confirmed"><b>${confirmed}</b> đã xác nhận</span><span><b>${disabled}</b> bỏ qua</span></div>
      <div class="it-mapping-toolbar">
        <input id="it-mapping-search" type="search" placeholder="Tìm mã kho hoặc tên mặt hàng…">
        <select id="it-mapping-filter"><option value="pending">Cần xử lý</option><option value="all">Tất cả</option><option value="confirmed">Đã xác nhận</option><option value="disabled">Bỏ qua</option></select>
        <label class="it-select-visible"><input id="it-select-visible-create" type="checkbox"> Chọn các dòng đang hiển thị</label>
        <button id="it-create-selected-products" class="primary" type="button" disabled>Tạo API đã chọn (0)</button>
      </div>
      <datalist id="it-web-options">${webCatalog.map(item => `<option value="${escapeHtml(webSearchValue(item))}"></option>`).join("")}</datalist>
      <div class="it-table-wrap it-mapping-table-wrap"><table><thead><tr><th></th><th>Mặt hàng trong kho</th><th>Ghép với sản phẩm web</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody id="it-mapping-body"></tbody></table></div>`;
    node.querySelector("#it-mapping-filter").addEventListener("change", renderMappingRows);
    node.querySelector("#it-mapping-search").addEventListener("input", renderMappingRows);
    node.querySelector("#it-select-visible-create").addEventListener("change", toggleVisibleMappingSelection);
    node.querySelector("#it-import-mapping").addEventListener("click", () => document.getElementById("it-mapping-file").click());
    node.querySelector("#it-export-mapping").addEventListener("click", exportMapping);
    node.querySelector("#it-create-selected-products").addEventListener("click", createSelectedMappedProducts);
    renderMappingRows();
  }

  function mappingStatusLabel(row) {
    const labels = { review: "Cần duyệt", unmatched: "Chưa khớp", confirmed: "Đã xác nhận", disabled: "Bỏ qua" };
    const detail = Number(row.confidence || 0) > 0 && row.status !== "confirmed" ? ` · ${Number(row.confidence).toFixed(0)}%` : "";
    return `<span class="it-map-status ${escapeHtml(row.status)}">${labels[row.status] || "Cần xử lý"}${detail}</span>`;
  }

  function updateMappingSelectionUi() {
    const button = document.getElementById("it-create-selected-products");
    if (button) {
      button.disabled = mappingCreateSelection.size === 0;
      button.textContent = `Tạo API đã chọn (${mappingCreateSelection.size})`;
    }
    const visible = [...document.querySelectorAll("#it-mapping-body .it-create-select")];
    const all = document.getElementById("it-select-visible-create");
    if (all) all.checked = visible.length > 0 && visible.every(input => input.checked);
  }

  function toggleVisibleMappingSelection(event) {
    document.querySelectorAll("#it-mapping-body .it-create-select").forEach(input => {
      input.checked = event.target.checked;
      const key = String(input.dataset.stockCode || "");
      if (event.target.checked) mappingCreateSelection.add(key);
      else mappingCreateSelection.delete(key);
    });
    updateMappingSelectionUi();
  }

  function toggleProductEditor(event) {
    const stockCode = event.target.closest("tr")?.dataset.stockCode;
    const editor = document.querySelector(`#it-mapping-body tr.it-create-editor[data-stock-code="${CSS.escape(stockCode || "")}"]`);
    if (!editor) return;
    editor.hidden = !editor.hidden;
    event.target.textContent = editor.hidden ? "Tạo mặt hàng mới" : "Đóng phần tạo mới";
  }

  function renderMappingRows() {
    const body = document.getElementById("it-mapping-body");
    const filter = document.getElementById("it-mapping-filter")?.value || "pending";
    const keyword = InvoiceMappingEngine.normalizeText(document.getElementById("it-mapping-search")?.value || "");
    const rows = (mappingDataset.mappings || []).filter(row =>
      filter === "all" || row.status === filter || (filter === "pending" && !["confirmed", "disabled"].includes(row.status))
    ).filter(row => !keyword || InvoiceMappingEngine.normalizeText(`${row.stockCode} ${row.stockName}`).includes(keyword));
    ensureProductDrafts(rows);
    body.innerHTML = rows.map(row => {
      const currentWeb = webCatalog.find(item => String(item.webCode) === String(row.webCode));
      const draft = row.productDraft || {};
      const canCreate = !["confirmed", "disabled"].includes(row.status);
      const actionHtml = row.status === "confirmed"
        ? '<button class="it-reopen-map" type="button">Chỉnh sửa ánh xạ</button>'
        : row.status === "disabled"
          ? '<button class="it-reopen-map" type="button">Khôi phục dòng</button>'
          : `<button class="it-confirm-map primary" type="button">Xác nhận ghép</button><button class="it-toggle-create" type="button">Tạo mặt hàng mới</button><button class="it-disable-map quiet" type="button">Bỏ qua</button>`;
      const mainRow = `<tr class="it-mapping-row" data-stock-code="${escapeHtml(row.stockCode)}">
        <td>${canCreate ? `<input class="it-create-select" data-stock-code="${escapeHtml(row.stockCode)}" type="checkbox" ${mappingCreateSelection.has(String(row.stockCode)) ? "checked" : ""}>` : ""}</td>
        <td><b class="it-stock-name">${escapeHtml(row.stockName)}</b><div class="it-stock-meta"><code>${escapeHtml(row.stockCode)}</code><span>Tồn ${formatMoney(row.availableQty)}</span><span>${escapeHtml(row.stockUnit || "—")}</span><span>Giá kho ${formatMoney(row.salePrice)}</span></div></td>
        <td><input class="it-web-search" list="it-web-options" value="${escapeHtml(currentWeb ? webSearchValue(currentWeb) : "")}" placeholder="Tìm mã, tên hoặc giá trên web…"></td>
        <td>${mappingStatusLabel(row)}</td>
        <td class="it-map-actions">${actionHtml}</td></tr>`;
      if (!canCreate) return mainRow;
      const editorRow = `<tr class="it-create-editor" data-stock-code="${escapeHtml(row.stockCode)}" hidden><td></td><td colspan="4"><div class="it-create-product">
        <div class="it-create-title"><b>Tạo sản phẩm mới trên ${escapeHtml(pageTenantLabel)}</b><span>Kiểm tra thông tin trước khi gọi API</span></div>
        <div class="it-create-grid"><label>Mã web<input class="it-create-code" value="${escapeHtml(draft.webCode)}" placeholder="7 chữ số"></label>
        <label>Tên mặt hàng<input class="it-create-name" value="${escapeHtml(draft.name)}" placeholder="Tên mặt hàng"></label>
        <label>ĐVT<input class="it-create-unit" value="${escapeHtml(draft.unit)}" placeholder="ĐVT"></label>
        <label>Giá bán<input class="it-create-price" inputmode="numeric" value="${escapeHtml(formatMoney(draft.price))}" placeholder="Giá bán"></label>
        <label>Nhóm hàng<select class="it-create-group">${PRODUCT_GROUPS.map(group => `<option ${group === draft.group ? "selected" : ""}>${escapeHtml(group)}</option>`).join("")}</select></label>
        <button class="it-create-one primary" type="button">Tạo bằng API và ánh xạ</button></div>
        ${row.createError ? `<div class="it-create-error">${escapeHtml(row.createError)}</div>` : ""}</div></td></tr>`;
      return mainRow + editorRow;
    }).join("") || '<tr><td colspan="5" class="it-empty-state"><b>Không có mặt hàng phù hợp bộ lọc.</b><br>Hãy đổi từ khóa hoặc trạng thái để xem dữ liệu khác.</td></tr>';
    body.querySelectorAll(".it-confirm-map").forEach(button => button.addEventListener("click", confirmMapping));
    body.querySelectorAll(".it-disable-map").forEach(button => button.addEventListener("click", disableMapping));
    body.querySelectorAll(".it-create-one").forEach(button => button.addEventListener("click", createSingleMappedProduct));
    body.querySelectorAll(".it-toggle-create").forEach(button => button.addEventListener("click", toggleProductEditor));
    body.querySelectorAll(".it-reopen-map").forEach(button => button.addEventListener("click", reopenMapping));
    body.querySelectorAll(".it-create-select").forEach(input => input.addEventListener("change", () => {
      if (input.checked) mappingCreateSelection.add(String(input.dataset.stockCode));
      else mappingCreateSelection.delete(String(input.dataset.stockCode));
      updateMappingSelectionUi();
    }));
    body.querySelectorAll(".it-create-editor input,.it-create-editor select").forEach(input => input.addEventListener("change", () => {
      const tr = input.closest("tr");
      const row = mappingDataset.mappings.find(item => String(item.stockCode) === String(tr.dataset.stockCode));
      if (row) productDraftFromRowElement(tr, row);
    }));
    updateMappingSelectionUi();
  }

  async function confirmMapping(event) {
    const tr = event.target.closest("tr");
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === tr.dataset.stockCode);
    const selectedValue = tr.querySelector(".it-web-search").value;
    const selectedCode = selectedValue.split("|")[0].trim();
    const web = webCatalog.find(item => String(item.webCode) === selectedCode);
    if (!row || !web) return setStatus("Hãy chọn một sản phẩm web trước khi xác nhận.", "error");
    Object.assign(row, web, { status: "confirmed", confirmedAt: new Date().toISOString() });
    mappingCreateSelection.delete(String(row.stockCode));
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    renderMappingAdmin();
    setStatus(`Đã xác nhận ${row.stockCode} → ${web.webCode}.`, "ok");
  }

  async function disableMapping(event) {
    const stockCode = event.target.closest("tr").dataset.stockCode;
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === stockCode);
    if (!row) return;
    row.status = "disabled";
    mappingCreateSelection.delete(String(row.stockCode));
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    renderMappingAdmin();
  }

  async function reopenMapping(event) {
    const stockCode = event.target.closest("tr")?.dataset.stockCode;
    const row = mappingDataset.mappings.find(item => String(item.stockCode) === String(stockCode));
    if (!row) return;
    row.status = "review";
    row.reviewNote = "Người dùng mở lại để kiểm tra ánh xạ.";
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    renderMappingAdmin();
    setStatus(`Đã mở lại ánh xạ ${row.stockCode} để chỉnh sửa.`, "ok");
  }

  function exportMapping() {
    const payload = {
      kind: "invoice-target-mapping-profile",
      schemaVersion: 1,
      tenant: pageTenantSlug,
      tenantLabel: pageTenantLabel,
      exportedAt: new Date().toISOString(),
      catalog: { source: String(catalogDataset?.source || ""), itemCount: webCatalog.length },
      mapping: {
        source: String(mappingDataset?.source || ""),
        generatedAt: String(mappingDataset?.generatedAt || ""),
        mappings: structuredClone(mappingDataset?.mappings || [])
      }
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `invoice-mapping-${pageTenantSlug}-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(`Đã xuất hồ sơ ánh xạ của ${pageTenantLabel}. File không thay thế số tồn kho khi nhập lại.`, "ok");
  }

  async function importMappingFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const fileTenant = String(payload?.tenant || payload?.mapping?.tenant || "").trim().toLowerCase();
      if (fileTenant && fileTenant !== pageTenantSlug) {
        throw new Error(`File ánh xạ thuộc cơ sở ${fileTenant}, không phải ${pageTenantSlug}.`);
      }
      if (!fileTenant && pageTenantSlug !== "pariskimgiang") {
        throw new Error(`File ánh xạ thiếu mã cơ sở ${pageTenantSlug}; không thể nhập an toàn.`);
      }
      const incomingRows = payload?.mapping?.mappings || payload?.mappings;
      if (!Array.isArray(incomingRows)) throw new Error("File không có danh sách ánh xạ hợp lệ.");
      const byStockCode = new Map(incomingRows.map(row => [String(row.stockCode || "").trim(), row]));
      let imported = 0;
      let needsReview = 0;
      const nextRows = (mappingDataset?.mappings || []).map(row => {
        const source = byStockCode.get(String(row.stockCode || "").trim());
        if (!source) return row;
        const web = webCatalog.find(item => String(item.webCode) === String(source.webCode));
        if (!web) {
          needsReview += 1;
          return { ...row, status: "review", reviewNote: `Mã web ${source.webCode || "trống"} không có trong danh mục hiện tại.` };
        }
        imported += 1;
        return {
          ...row,
          ...web,
          status: source.status === "disabled" ? "disabled" : "confirmed",
          confidence: Number(source.confidence) || 100,
          confirmedAt: source.confirmedAt || new Date().toISOString(),
          reviewNote: String(source.reviewNote || ""),
          availabilityMode: source.availabilityMode || row.availabilityMode,
          maxQtyPerInvoice: source.maxQtyPerInvoice ?? row.maxQtyPerInvoice
        };
      });
      mappingDataset = {
        ...mappingDataset,
        tenant: pageTenantSlug,
        mappingProfileImportedAt: new Date().toISOString(),
        mappingProfileSource: file.name,
        mappings: nextRows
      };
      await InvoiceMappingStore.save(mappingDataset);
      refreshMappingState();
      renderMappingAdmin();
      setStatus(
        `Đã nhập ${imported} ánh xạ cho ${pageTenantLabel}` +
        `${needsReview ? `; ${needsReview} dòng cần duyệt lại vì mã web đã thay đổi.` : ". Số tồn kho hiện tại được giữ nguyên."}`,
        needsReview ? "warn" : "ok"
      );
    } catch (error) {
      setStatus(`Không nhập được file ánh xạ: ${error.message}`, "error");
    } finally {
      event.target.value = "";
    }
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

  // Hóa đơn càng lớn = nhóm khách càng đông = càng nhiều dòng hàng và nhiều
  // nhóm hàng khác nhau, giống đơn thật hơn là dồn vào vài mã đắt tiền.
  const MAX_PRODUCT_GROUP_SHARE = 0.6;

  function maxActiveLines(goodsTarget) {
    // Hóa đơn lớn ở cơ sở có nhiều mã giá thấp cần thêm dòng để đạt tiền hàng
    // mà vẫn giữ giới hạn thực tế trên từng mã. 9 dòng khiến kho còn nhiều
    // nhưng tổng sức chứa/HĐ vẫn không đạt. Chỉ nâng trần cho hóa đơn lớn;
    // hóa đơn thông thường vẫn giữ tối đa 12 mã để không tạo đơn phi thực tế.
    const target = Math.max(0, Number(goodsTarget || 0));
    const adaptiveCap = target >= 6000000 ? 20 : target >= 4000000 ? 16 : 12;
    return Math.max(4, Math.min(adaptiveCap, Math.round(target / 250000) + 2));
  }

  function reachableGoodsUpperBound(candidates, lineLimit, globalQtyLimit = 20) {
    const maximumLines = Math.max(1, Math.floor(Number(lineLimit) || 1));
    const maximumQty = Math.max(1, Math.floor(Number(globalQtyLimit) || 1));
    return (candidates || [])
      .map(item => {
        const itemLimit = Number.isFinite(Number(item.maxQty))
          ? Math.max(0, Math.floor(Number(item.maxQty)))
          : maximumQty;
        return Math.max(0, Math.round(Number(item.price) || 0)) * Math.min(maximumQty, itemLimit);
      })
      .sort((left, right) => right - left)
      .slice(0, maximumLines)
      .reduce((sum, amount) => sum + amount, 0);
  }

  function minimumGroupCount(goodsTarget) {
    const goods = Math.max(0, Number(goodsTarget) || 0);
    if (goods < 500000) return 1;
    if (goods < 1000000) return 2;
    return 3;
  }

  const MAX_HOUR_TO_GOODS_RATIO = 2;
  // Keep the singing charge close to its time-based baseline. A larger
  // residual is allowed only while the final singing charge remains at most
  // 35% of the invoice total before VAT.
  const MAX_HOUR_BASE_ADJUSTMENT_RATIO = 0.20;
  const MAX_HOUR_PRETAX_RATIO = 0.35;
  // Keep the general calculation version stable so previously Accepted
  // normal invoices are not invalidated; the small-invoice branch is tagged
  // separately through specialRule.
  const CALCULATION_VERSION = "website-inclusive-vat-2";
  const MAX_SESSION_CANDIDATE_PROBES = 3;
  const SESSION_CANDIDATE_PROBE_TIMEOUT_MS = 5000;
  const SMALL_INVOICE_BEER_LIMIT = 500000;
  const SMALL_INVOICE_BEER_QTY = 2;

  function websiteHourAmountForMinutes(durationMinutes, hourlyRate = 600000) {
    const minutes = Math.max(0, Math.round(Number(durationMinutes) || 0));
    const hundredths = Math.round((minutes / 60) * 100);
    return Math.round(hundredths * Number(hourlyRate || 0) / 100);
  }

  function closestReachableHourSlot(targetHour, minimumMinutes, maximumMinutes, hourlyRate = 600000) {
    const target = Math.max(0, Math.round(Number(targetHour) || 0));
    const from = Math.max(1, Math.round(Number(minimumMinutes) || 1));
    const to = Math.max(from, Math.round(Number(maximumMinutes) || from));
    let best = null;
    for (let minutes = from; minutes <= to; minutes += 1) {
      const amount = websiteHourAmountForMinutes(minutes, hourlyRate);
      const difference = Math.abs(target - amount);
      if (!best || difference < best.difference ||
          (difference === best.difference && minutes < best.minutes)) {
        best = { minutes, amount, difference };
      }
    }
    return best;
  }

  function hourPlanningBounds(scan, hourPricing, statementGrand = 0, preTaxTarget = 0) {
    const step = Math.max(1, Math.round(Number(hourPricing?.hourStep) || 1));
    const isNewInvoice = Boolean(scan?.newInvoicePlanning);
    const bankGrand = Math.max(0, Math.round(Number(statementGrand) || Number(scan?.statementGrand) || 0));
    // Kế toán quy định giao dịch sao kê trên 1 triệu phải có tối thiểu 55 phút.
    // Các giao dịch còn lại dùng mốc tối thiểu 30 phút.
    const minimumMinutes = bankGrand > 1000000 ? 50 : 30;
    const minuteBaseHour = Math.max(step, Math.round(Number(hourPricing?.hourlyRate || 600000) * minimumMinutes / 60));
    // Sàn theo phút và trần 35% tổng trước VAT mâu thuẫn nhau ở hóa đơn nhỏ:
    // mốc 30 phút (300.000đ) chỉ nằm dưới trần khi tổng trước VAT ≥ 857.143đ, và
    // mốc 50 phút (500.000đ) cần ≥ 1.428.572đ. Trong khoảng dưới các ngưỡng đó
    // solver không còn giá trị Tiền giờ nào hợp lệ nên phương án rơi về 0.
    // Trần cơ cấu là ràng buộc hình dạng hóa đơn nên phải giữ; sàn phút chỉ là
    // điểm neo khởi tạo nên được phép co lại theo trần.
    const preTax = Math.max(0, Math.round(Number(preTaxTarget) || 0));
    const preTaxCap = preTax > 0 ? Math.max(step, Math.floor(preTax * MAX_HOUR_PRETAX_RATIO)) : 0;
    // Phiếu đã có sẵn lấy Tiền giờ đang nằm trên form làm nền. Giá trị đó thuộc
    // hóa đơn cũ và thường lớn hơn nhiều so với tổng sao kê đang khớp (ví dụ
    // nền 600.000đ cho hóa đơn 560.000đ), nên cũng phải kẹp theo trần 35% giống
    // phiếu mới — nếu không nền đã vượt trần ngay từ đầu và mọi tổ hợp đều vỡ
    // cả hai điều kiện của cổng kiểm tra cuối.
    const currentHour = Math.max(0, Math.round(Number(scan?.currentHour) || 0));
    // Một số phiếu cũ/API trả Tiền giờ = 0 dù giao dịch vẫn phải có tiền phòng.
    // Nếu dùng thẳng số 0 làm nền, goodsTarget sẽ bằng toàn bộ tiền trước VAT;
    // solver ghép tiền hàng ăn hết phần này rồi chốt cuối mới báo "không có Tiền giờ".
    // Với trường hợp đó, dùng mốc 30/50 phút giống phiếu mới ngay từ lúc lập kế hoạch.
    const nominalBaseHour = isNewInvoice || currentHour <= 0
      ? minuteBaseHour
      : currentHour;
    const baseHour = preTaxCap > 0 ? Math.min(nominalBaseHour, preTaxCap) : nominalBaseHour;
    const adjustmentLimit = Math.max(step, Math.round(baseHour * MAX_HOUR_BASE_ADJUSTMENT_RATIO));
    return {
      baseHour,
      adjustmentLimit,
      // Mốc gốc trước khi bị kẹp, giữ lại để hiển thị/đối soát lý do.
      minuteBaseHour,
      nominalBaseHour,
      baseHourClamped: baseHour < nominalBaseHour,
      // A new invoice uses 30 or 50 minutes as the minimum singing baseline,
      // depending on the bank-statement total.
      minHourAmount: isNewInvoice || currentHour <= 0
        ? baseHour
        : Math.max(step, baseHour - adjustmentLimit),
      maxHourAmount: baseHour + adjustmentLimit
    };
  }
  // Đơn thật quan sát được có tiền giờ ≈ 0,87–1,64 lần tiền hàng. Chỉ chặn trần
  // (≤2) thì solver dồn hết vào tiền hàng và ra tỷ lệ 0,2 — xa thực tế. Vì vậy
  // đặt thêm sàn mềm: dưới mức này vẫn hợp lệ nhưng bị xếp sau.
  const NATURAL_MIN_HOUR_TO_GOODS_RATIO = 0.8;

  function minimumGoodsForHourRatio(preTaxTarget) {
    return Math.ceil(Math.max(0, Number(preTaxTarget) || 0) / (MAX_HOUR_TO_GOODS_RATIO + 1));
  }

  // Cận trên tiền hàng phải chừa lại ít nhất minHourAmount cho Tiền giờ.
  // Không được dùng (preTax - trần giờ) làm cả cận dưới lẫn cận trên: số đó
  // thường không chia hết cho bước giá 5.000đ (ví dụ 3.180.450đ), khiến cửa sổ
  // chỉ còn đúng một giá trị không thể biểu diễn dù 3.185.000đ là hợp lệ.
  function maximumGoodsForHourRange(preTaxTarget, minHourAmount, minGoodsAmount = 0) {
    const preTax = Math.max(0, Math.round(Number(preTaxTarget) || 0));
    const minHour = Math.max(0, Math.round(Number(minHourAmount) || 0));
    const minimumGoods = Math.max(0, Math.round(Number(minGoodsAmount) || 0));
    return Math.max(minimumGoods, Math.max(0, preTax - minHour));
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
      // Nhóm bắt buộc suy ra từ tên hàng nên gắn ở đây, nhưng không được ghi đè
      // constraintGroup có sẵn của kho (ví dụ nhóm hoa quả giới hạn 1 đĩa/hóa đơn).
      constraintGroup: stock.constraintGroup || mandatoryGroupFor(stock)?.group,
      constraintGroupMax: stock.constraintGroupMax,
      constraintGroupMin: stock.constraintGroup ? 0 : (mandatoryGroupFor(stock)?.minQty || 0),
      // Nhóm hàng của website, dùng để cân đối cơ cấu hóa đơn cho giống đơn thật.
      productGroup: String(stock.webGroup || "")
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

  // Các nhóm không bao giờ tự đưa vào phương án: đây là phí phát sinh thực tế
  // (đồ vỡ, phí đồ ăn ngoài, phí rượu…) chứ không phải hàng bán chủ động.
  const EXCLUDED_PRODUCT_GROUPS = new Set(["PHUPHI"]);

  function isAutoSellableStock(stock) {
    return !EXCLUDED_PRODUCT_GROUPS.has(String(stock?.webGroup || "").toUpperCase());
  }

  function normalizedProductName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .trim();
  }

  function isBeerStock(stock) {
    // Tên phải bắt đầu bằng "Bia" để không chọn nhầm phụ kiện như BÌNH RÓT BIA.
    return /^BIA(?:\s|$)/.test(normalizedProductName(stock?.webName));
  }

  function isWetTowelStock(stock) {
    // Gồm cả "Khăn ướt" lẫn "Khăn lạnh"; đây là cùng một mặt hàng nghiệp vụ.
    return /KHAN\s+(UOT|LANH)/.test(normalizedProductName(stock?.webName));
  }

  // Món hàng bắt buộc trên mỗi hóa đơn, tính theo TỔNG của cả nhóm chứ không
  // theo từng mã: "3 bia" là 3 chai bất kỳ mã bia nào, nên 2 Tiger + 1 Hà Nội
  // vẫn hợp lệ. Ép theo từng mã sẽ dồn hết lên một mã và cạn tồn mã đó.
  //
  // Hóa đơn dưới 500.000đ KHÔNG áp luật này: nhánh đó có quy tắc riêng đúng 2
  // chai bia, xem calculateSmallInvoiceBeerPlan.
  const MANDATORY_GROUPS = Object.freeze([
    { group: "beer", label: "bia", minQty: 3, matches: isBeerStock },
    { group: "wet_towel", label: "khăn ướt", minQty: 2, matches: isWetTowelStock }
  ]);

  function mandatoryGroupFor(stock) {
    return MANDATORY_GROUPS.find(rule => rule.matches(stock)) || null;
  }

  // Tồn khả dụng của cả nhóm. Phải chạy trên workingInventory (bản đã trừ đặt
  // chỗ của các giao dịch trước trong cùng lô), nếu không giao dịch thứ 5 trong
  // ngày vẫn bị ép 3 bia dù 4 giao dịch trước đã dùng hết tồn — đó là đường dẫn
  // thẳng tới tồn âm.
  function mandatoryGroupAvailability(inventoryState, rule) {
    let available = 0;
    for (const stock of inventoryState || []) {
      if (!isAutoSellableStock(stock) || !rule.matches(stock)) continue;
      if (Math.round(Number(stock.webPrice) || 0) <= 0) continue;
      // Trần mỗi hóa đơn cũng là giới hạn thật: mã còn 10 chai nhưng trần 2 thì
      // chỉ góp được 2 vào một hóa đơn.
      const perInvoice = Math.floor(Number(InvoiceTargetSolver.recommendInvoiceLimit(stock)) || 0);
      available += Math.min(Math.floor(Number(stock.availableQty) || 0), Math.max(0, perInvoice));
    }
    return available;
  }

  // Kiểm tra trước khi giải: thiếu tồn thì báo rõ thay vì để solver trả về
  // phương án thiếu hàng trong im lặng.
  function unmetMandatoryGroup(inventoryState) {
    for (const rule of MANDATORY_GROUPS) {
      const available = mandatoryGroupAvailability(inventoryState, rule);
      if (available < rule.minQty) return { rule, available };
    }
    return null;
  }

  function selectSmallInvoiceBeer(inventoryState, transaction, productUsage) {
    const eligible = (inventoryState || []).filter(stock => {
      if (!isAutoSellableStock(stock) || !isBeerStock(stock)) return false;
      if (Math.floor(Number(stock.availableQty) || 0) < SMALL_INVOICE_BEER_QTY) return false;
      if (Math.round(Number(stock.webPrice) || 0) <= 0) return false;
      return InvoiceTargetSolver.recommendInvoiceLimit(stock) >= SMALL_INVOICE_BEER_QTY;
    });
    if (!eligible.length) return null;

    const rulePriority = new Map(
      priorityRules
        .filter(rule => rule.enabled !== false)
        .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))
        .map((rule, index) => [String(rule.webCode), index])
    );
    const seed = `${transaction?.id || ""}|${transaction?.transactionDate || ""}|small-beer|${transaction?.recalculationNonce || 0}`;
    return eligible.sort((a, b) => {
      const aRule = rulePriority.has(String(a.webCode)) ? rulePriority.get(String(a.webCode)) : Number.POSITIVE_INFINITY;
      const bRule = rulePriority.has(String(b.webCode)) ? rulePriority.get(String(b.webCode)) : Number.POSITIVE_INFINITY;
      return aRule - bRule ||
        Number(productUsage?.get(String(a.webCode)) || 0) - Number(productUsage?.get(String(b.webCode)) || 0) ||
        stableDiversityRank(seed, a.webCode) - stableDiversityRank(seed, b.webCode) ||
        String(a.webCode).localeCompare(String(b.webCode));
    })[0];
  }

  function calculateSmallInvoiceBeerPlan(scan, transaction, inventoryState, productUsage, targets, targetGrand, statementGrand, grandDifference) {
    const beer = selectSmallInvoiceBeer(inventoryState, transaction, productUsage);
    if (!beer) {
      return {
        status: "error",
        reason: "Hóa đơn dưới 500.000đ cần đúng 2 chai bia, nhưng không có mã bia nào còn đủ tồn và giới hạn 2 chai/hóa đơn."
      };
    }
    const price = Math.round(Number(beer.webPrice) || 0);
    const goods = price * SMALL_INVOICE_BEER_QTY;
    const hour = targets.preTaxTarget - goods;
    if (hour <= 0) {
      return {
        status: "error",
        reason: `Hóa đơn dưới 500.000đ cần 2 chai ${beer.webName || "bia"} (${formatMoney(goods)}đ), nhưng tổng trước VAT chỉ có ${formatMoney(targets.preTaxTarget)}đ.`
      };
    }

    const hourlyRate = 600000;
    const durationMinutes = Math.max(1, Math.round(hour / hourlyRate * 60));
    const hourFromTime = websiteHourAmountForMinutes(durationMinutes, hourlyRate);
    const hourAdjustment = hour - hourFromTime;
    const predictedGrand = goods + hour + targets.vatTarget;
    const stockQty = Math.floor(Number(beer.availableQty) || 0);
    const invoiceLimit = Math.floor(Number(InvoiceTargetSolver.recommendInvoiceLimit(beer)) || 0);
    return {
      status: "ready",
      calculationVersion: CALCULATION_VERSION,
      specialRule: "under-500k-two-beers",
      invoiceNo: scan.invoiceNo,
      invoiceDateKey: transaction.transactionDate,
      targetGrand,
      statementGrand,
      grandDifference,
      currentGrand: scan.currentGrand,
      goods,
      hour,
      hourBase: hourFromTime,
      hourBaseAdjustment: hourAdjustment,
      hourPreTaxCap: hour,
      hourAdjustmentSmall: true,
      hourWithinPreTaxCap: true,
      hourFromTime,
      hourAdjustment,
      tax: targets.vatTarget,
      taxRate: 10,
      difference: predictedGrand - targetGrand,
      checkIn: scan.checkIn || "",
      checkOut: scan.sessionRebased
        ? (recommendCheckOut(scan, hourFromTime, hourlyRate) || scan.checkOut || "")
        : (scan.checkOut || ""),
      sessionRebased: Boolean(scan.sessionRebased),
      originalCheckIn: scan.originalCheckIn || "",
      originalCheckOut: scan.originalCheckOut || "",
      proposedCheckOut: recommendCheckOut(scan, hourFromTime, hourlyRate),
      items: [{
        code: String(beer.webCode),
        name: beer.webName,
        qty: SMALL_INVOICE_BEER_QTY,
        price,
        maxQty: Math.min(stockQty, invoiceLimit),
        stockQty,
        invoiceLimit
      }]
    };
  }

  function buildBatchCandidates(inventoryState, target, transaction, productUsage) {
    const sellableStock = (inventoryState || []).filter(isAutoSellableStock);
    const eligibleRules = priorityRules
      .filter(rule => rule.enabled !== false && target > Number(rule.minTotal || 0) &&
        sellableStock.some(item => String(item.webCode) === String(rule.webCode) && Number(item.availableQty) > 0));
    const requiredRules = eligibleRules.filter(rule => rule.mode === "required");
    const rotatingRule = eligibleRules
      .filter(rule => rule.mode !== "required")
      .sort((a, b) => Number(a.priority || 999) - Number(b.priority || 999))[0];
    const activeRules = rotatingRule ? [...requiredRules, rotatingRule] : requiredRules;
    const seed = `${transaction?.id || ""}|${transaction?.transactionDate || ""}|${transaction?.credit || target}|${transaction?.recalculationNonce || 0}`;
    // Mã càng bị bỏ nhiều lần càng bị đẩy ra xa, nên bấm Tính toán lại liên tiếp
    // vẫn ra tổ hợp mới thay vì quay vòng về phương án cũ.
    const rejectionCounts = transaction?.rejectedBatchCodeCounts || {};
    const legacyRejected = (transaction?.lastRejectedBatchPlan?.items || [])
      .map(item => String(item.code || ""))
      .filter(Boolean);
    const rejectionCountFor = code =>
      Number(rejectionCounts[code]) || (legacyRejected.includes(code) ? 1 : 0);
    return sellableStock.map(stock => {
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
        priorUseCount * 30 + rotation + rejectionCountFor(code) * 200,
        maxQty
      );
    }).sort((a, b) =>
      Number(b.minQty || 0) - Number(a.minQty || 0) ||
      Number(a.selectionPenalty || 0) - Number(b.selectionPenalty || 0) ||
      String(a.code).localeCompare(String(b.code))
    );
  }

  // overrideGrand is kept only for backward compatibility with older saved
  // sessions. New plans always use the statement total directly.
  function calculateBatchPlan(scan, transaction, inventoryState, productUsage, overrideGrand) {
    const maxHourToGoodsRatio = 2;
    if (!scan?.ready) return { status: "error", reason: "Không đọc được chi tiết phiếu." };
    if (!invoiceMatchesTransactionDate(scan, transaction.transactionDate)) {
      const formDates = invoiceBusinessDateKeys(scan);
      const invoiceLabel = String(scan?.invoiceNo || "").trim() || "không đọc được số phiếu";
      return {
        status: "error",
        reason: `Ngày phiếu không khớp sao kê: extension đang kiểm tra phiếu ${invoiceLabel}; ` +
          `sao kê ${transaction.transactionDate || "không xác định"}, ` +
          `form ${formDates.length ? formDates.join(" hoặc ") : "không đọc được ngày"}` +
          `${scan?.checkIn || scan?.checkOut ? ` (Giờ vào ${scan.checkIn || "—"}, Giờ ra ${scan.checkOut || "—"})` : ""}.`
      };
    }
    const statementGrand = Math.round(Number(transaction.credit) || 0);
    const requestedGrand = Math.round(Number(overrideGrand) || 0);
    const targetGrand = requestedGrand > 0 ? requestedGrand : statementGrand;
    const grandDifference = targetGrand - statementGrand;
    if (targetGrand < SMALL_INVOICE_BEER_LIMIT) {
      const smallTargets = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, 0, scan.taxRate);
      if (!smallTargets.grandReachable) {
        return {
          status: "error",
          unreachableGrand: true,
          reason: `Tổng ${formatMoney(targetGrand)}đ không biểu diễn chính xác theo công thức VAT 10% của website.`,
          reachableAlternatives: smallTargets.reachableAlternatives || []
        };
      }
      // Quy tắc riêng: đúng 2 chai bia; toàn bộ phần trước VAT còn lại là Tiền giờ.
      // Nhánh này chủ động không áp tỷ lệ Tiền giờ/Tiền hàng của hóa đơn thông thường.
      return calculateSmallInvoiceBeerPlan(
        scan,
        transaction,
        inventoryState,
        productUsage,
        smallTargets,
        targetGrand,
        statementGrand,
        grandDifference
      );
    }
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
    const hourPricing = scan.newInvoicePlanning
      ? { hourlyRate: 600000, hourStep: 6000 }
      : inferHourPricing(scan);
    // preTaxTarget chỉ phụ thuộc targetGrand và taxRate (currentHour chỉ đổi
    // goodsTarget), nên lấy trước để kẹp sàn Tiền giờ rồi mới chốt goodsTarget.
    const preTaxProbe = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, 0, scan.taxRate);
    const hourBounds = hourPlanningBounds(scan, hourPricing, targetGrand, preTaxProbe.preTaxTarget);
    const targets = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, hourBounds.baseHour, scan.taxRate);
    if (!targets.grandReachable) {
      return {
        status: "error",
        unreachableGrand: true,
        reason: `Tổng ${formatMoney(targetGrand)}đ không biểu diễn chính xác theo công thức VAT 10% của website.`,
        reachableAlternatives: targets.reachableAlternatives || []
      };
    }
    // Hóa đơn không được phép không có Tiền giờ. Phiếu mới dùng sàn 30 phút,
    // hoặc 50 phút khi sao kê trên 1 triệu, để solver chừa chỗ cho tiền giờ.
    const hourPreTaxCap = Math.max(0, Math.floor(targets.preTaxTarget * MAX_HOUR_PRETAX_RATIO));
    // Valid upper range is the union of: baseline +/- 20%, or a final
    // singing charge no higher than 35% of the pre-VAT total.
    hourBounds.maxHourAmount = Math.max(hourBounds.maxHourAmount, hourPreTaxCap);
    const minHourAmount = hourBounds.minHourAmount;
    // The goods amount must leave no more than the permitted singing charge.
    // This used to be validated only after solving, causing avoidable errors
    // even when another stock combination was valid.
    const minGoodsForHourRange = Math.max(0, targets.preTaxTarget - hourBounds.maxHourAmount);
    const minGoodsAmount = Math.max(
      Math.ceil(Math.max(0, Number(targets.preTaxTarget) || 0) / (maxHourToGoodsRatio + 1)),
      minGoodsForHourRange
    );
    // Món hàng bắt buộc chỉ áp khi phương án thực sự phải thêm hàng. Phiếu mà
    // toàn bộ phần trước VAT đã là Tiền giờ (goodsTarget = 0) không có dòng hàng
    // nào để mà bắt buộc.
    //
    // inventoryState ở đây là workingInventory đã trừ đặt chỗ của các giao dịch
    // trước trong cùng lô, nên gate bắt được cả trường hợp tồn cạn dần giữa lô —
    // nếu chỉ xét tồn gốc thì giao dịch cuối ngày vẫn bị ép đủ số lượng và sinh
    // phương án âm kho.
    if (targets.goodsTarget > 0) {
      const unmetGroup = unmetMandatoryGroup(inventoryState);
      if (unmetGroup) {
        return {
          status: "error",
          reason: `Mỗi hóa đơn cần ít nhất ${unmetGroup.rule.minQty} ${unmetGroup.rule.label}, ` +
            `nhưng tồn khả dụng của cả nhóm chỉ còn ${unmetGroup.available}. ` +
            "Nhập thêm hàng hoặc bỏ bớt giao dịch khỏi lô."
        };
      }
    }
    const candidates = buildBatchCandidates(inventoryState, targetGrand, transaction, productUsage);
    const activeLineLimit = maxActiveLines(targets.goodsTarget);
    const solution = InvoiceTargetSolver.solveQuantities(candidates, targets.goodsTarget, {
      maxQty: 20,
      tolerance: 0,
      preTaxTarget: targets.preTaxTarget,
      currentHour: hourBounds.baseHour,
      hourStep: hourPricing.hourStep,
      minHourAmount,
      maxHourAmount: hourBounds.maxHourAmount,
      requireHourStepExact: false,
      enforceHourRange: true,
      minGoodsAmount,
      maxGoodsAmount: maximumGoodsForHourRange(targets.preTaxTarget, minHourAmount, minGoodsAmount),
      // Ưu tiên phương án nhiều số lượng: bỏ phạt tập trung, thưởng tổng số
      // lượng, và cho hình phạt "mã vừa bị loại" đủ nặng để Tính toán lại thực
      // sự đổi sang tổ hợp khác.
      concentrationWeight: 0,
      unitWeight: 5000,
      selectionWeight: 20000,
      // Cơ cấu hóa đơn thật: không nhóm hàng nào chiếm quá 60% tiền hàng, và
      // hóa đơn đủ lớn thì phải có ít nhất 3 nhóm khác nhau.
      maxGroupShare: MAX_PRODUCT_GROUP_SHARE,
      minGroupCount: minimumGroupCount(targets.goodsTarget),
      preferredLineCount: preferredLineCount(targets.goodsTarget),
      maxActiveLines: activeLineLimit
    });
    if (!solution.items) {
      const reachableUpperBound = reachableGoodsUpperBound(candidates, activeLineLimit, 20);
      const capacityExplanation = reachableUpperBound < minGoodsForHourRange
        ? ` Với tối đa ${activeLineLimit} mã và giới hạn số lượng/HĐ hiện tại, sức chứa tiền hàng chỉ khoảng ${formatMoney(reachableUpperBound)} đ.`
        : ` Kho có sức chứa lý thuyết khoảng ${formatMoney(reachableUpperBound)} đ nhưng không ghép được tổ hợp hợp lệ theo đơn giá và các rule hiện tại.`;
      return {
        status: "error",
        reason: `Không tìm được tổ hợp hàng đạt tối thiểu ${formatMoney(minGoodsForHourRange)} đ ` +
          `để giữ Tiền giờ không vượt ${formatMoney(hourBounds.maxHourAmount)} đ. ` +
          capacityExplanation + ` Hãy kiểm tra ánh xạ và giới hạn số lượng/HĐ.`
      };
    }
    const selected = solution.items.filter(item => item.newQty > 0);
    const reconciledHour = InvoiceTargetSolver.reconcileHourAmount(
      solution.actual,
      targets.preTaxTarget,
      solution.hourActual
    );
    const { hourFromTime, finalHourAmount, hourAdjustment } = reconciledHour;
    const hourBaseAdjustment = finalHourAmount - hourBounds.baseHour;
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
    // Chốt chặn cuối: dù solver có ép sàn tiền giờ, vẫn không để lọt phương án
    // Tiền giờ = 0 ra trạng thái Sẵn sàng.
    if (finalHourAmount <= 0) {
      return {
        status: "error",
        reason: "Phương án không có Tiền giờ; chưa được tạo hóa đơn thiếu Tiền giờ. Hãy chỉnh tồn kho/rule rồi tính lại."
      };
    }
    const hourAdjustmentSmall = Math.abs(hourBaseAdjustment) <= hourBounds.adjustmentLimit;
    const hourWithinPreTaxCap = finalHourAmount <= hourPreTaxCap;
    if (!hourAdjustmentSmall && !hourWithinPreTaxCap) {
      return {
        status: "error",
        reason: `Phần bù vào Tiền giờ ${formatMoney(hourBaseAdjustment)} vượt 20% tiền giờ nền (${formatMoney(hourBounds.adjustmentLimit)}), đồng thời Tiền giờ ${formatMoney(finalHourAmount)} vượt trần 35% tổng trước VAT (${formatMoney(hourPreTaxCap)}); cần tính lại tổ hợp hàng.`
      };
    }
    if (solution.actual <= 0 || finalHourAmount > solution.actual * maxHourToGoodsRatio) {
      return {
        status: "error",
        reason: `Tiền giờ ${formatMoney(finalHourAmount)} vượt ${maxHourToGoodsRatio} lần tiền hàng ${formatMoney(solution.actual)}; tồn kho/rule hiện tại chưa tạo được phương án thực tế.`
      };
    }
    return {
      status: "ready",
      calculationVersion: CALCULATION_VERSION,
      invoiceNo: scan.invoiceNo,
      invoiceDateKey: transaction.transactionDate,
      targetGrand,
      // Khi người dùng chấp nhận tổng lệch, giữ lại cả tiền sao kê gốc và phần
      // chênh để đối soát/ghi sổ nêu rõ được lý do.
      statementGrand,
      grandDifference,
      currentGrand: scan.currentGrand,
      goods: solution.actual,
      hour: finalHourAmount,
      hourBase: hourBounds.baseHour,
      hourBaseAdjustment,
      // Nền Tiền giờ có bị kẹp theo trần 35% hay không, để đối soát hiểu vì sao
      // số phút thấp hơn mốc 30/50 phút danh nghĩa.
      hourBaseClamped: Boolean(hourBounds.baseHourClamped),
      hourMinuteBase: hourBounds.minuteBaseHour,
      hourPreTaxCap,
      hourAdjustmentSmall,
      hourWithinPreTaxCap,
      hourFromTime,
      hourAdjustment,
      tax: targets.vatTarget,
      taxRate: 10,
      difference,
      checkIn: scan.checkIn || "",
      checkOut: scan.sessionRebased
        ? (recommendCheckOut(scan, hourFromTime, hourPricing.hourlyRate) || scan.checkOut || "")
        : (scan.checkOut || ""),
      sessionRebased: Boolean(scan.sessionRebased),
      originalCheckIn: scan.originalCheckIn || "",
      originalCheckOut: scan.originalCheckOut || "",
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

  // Giờ vào phiếu MỚI luôn từ 17:00 trở đi và không được tràn sang ngày hôm sau.
  // Quy định này chỉ áp dụng cho phiếu tạo mới; phiếu đã tồn tại luôn giữ nguyên
  // giờ vào của website.
  //
  // Website chặn hai phiếu CÙNG PHÒNG chồng giờ, nên các phiếu cùng ngày được
  // rải giãn cách. Khi số phiếu vượt số khung giờ trong buổi tối, slot quay vòng
  // về 17:00 — lúc đó phòng được chọn lại theo khoảng giờ còn trống, xem
  // roomIsFreeForRange.
  const NEW_INVOICE_CHECKIN_START_MINUTES = 17 * 60;
  const NEW_INVOICE_CHECKIN_STEP_MINUTES = 45;
  const NEW_INVOICE_CHECKIN_LAST_MINUTES = 23 * 60 + 30;
  const NEW_INVOICE_CHECKIN_SLOT_COUNT = Math.floor(
    (NEW_INVOICE_CHECKIN_LAST_MINUTES - NEW_INVOICE_CHECKIN_START_MINUTES) /
    NEW_INVOICE_CHECKIN_STEP_MINUTES
  ) + 1;

  function newInvoiceCheckInMinutes(slotIndex) {
    const slot = Math.max(0, Math.round(Number(slotIndex) || 0)) % NEW_INVOICE_CHECKIN_SLOT_COUNT;
    return NEW_INVOICE_CHECKIN_START_MINUTES + slot * NEW_INVOICE_CHECKIN_STEP_MINUTES;
  }

  function newInvoicePlanningScan(transactionDate, slotIndex) {
    const match = String(transactionDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    // Dựng bằng Date để không tạo ra chuỗi giờ không hợp lệ kiểu "24:30".
    // newInvoiceCheckInMinutes đã kẹp trần nên giờ vào luôn nằm trong ngày.
    const checkInDate = match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, newInvoiceCheckInMinutes(slotIndex))
      : null;
    const checkIn = formatUiDateTime(checkInDate);
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

  function calculateNewInvoiceBatchPlan(transaction, inventoryState, productUsage, slotIndex, overrideGrand) {
    const planningScan = newInvoicePlanningScan(transaction.transactionDate, slotIndex);
    const plan = calculateBatchPlan(planningScan, transaction, inventoryState, productUsage, overrideGrand);
    if (plan.status !== "ready") return plan;
    const checkInDate = parseUiDateTime(planningScan.checkIn);
    // Sàn phút phải đi cùng sàn Tiền giờ đã bị kẹp theo trần 35%: nếu vẫn giữ
    // mốc 30/50 phút trong khi phương án chỉ còn ~23 phút thì không có khoảng
    // giờ vào/ra nào biểu diễn được và phiếu bị loại oan.
    const nominalMinimumMinutes = plan.specialRule === "under-500k-two-beers"
      ? 1
      : (Number(transaction.credit) > 1000000 ? 50 : 30);
    const planMinutes = Math.max(1, Math.floor(Number(plan.hour) / 600000 * 60));
    const minimumMinutes = Math.min(nominalMinimumMinutes, planMinutes);
    const remainingMinutesInDay = checkInDate
      ? Math.max(minimumMinutes, 24 * 60 - (checkInDate.getHours() * 60 + checkInDate.getMinutes()) - 1)
      : minimumMinutes;
    const reachableHour = closestReachableHourSlot(
      plan.hour,
      minimumMinutes,
      remainingMinutesInDay,
      600000
    );
    if (!reachableHour || reachableHour.difference > 6000) {
      return {
        status: "error",
        reason: "Không tìm được khoảng giờ vào/ra theo phút có thể biểu diễn tiền giờ của phương án trong sai số 6.000đ."
      };
    }
    const checkOutDate = checkInDate
      ? new Date(checkInDate.getTime() + reachableHour.minutes * 60000)
      : null;
    return {
      ...plan,
      requiresNewInvoice: true,
      checkIn: planningScan.checkIn,
      checkOut: formatUiDateTime(checkOutDate),
      proposedCheckOut: formatUiDateTime(checkOutDate),
      durationMinutes: reachableHour.minutes,
      hourFromTime: reachableHour.amount,
      hourAdjustment: Math.round(Number(plan.hour) || 0) - reachableHour.amount
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

  function rankInvoiceCandidates(candidates, targetAmount, linkedInvoiceNo) {
    const target = Number(targetAmount) || 0;
    const linked = String(linkedInvoiceNo || "");
    const distance = candidate => {
      const total = Number(candidate?.grandTotal);
      return Number.isFinite(total) ? Math.abs(total - target) : Number.POSITIVE_INFINITY;
    };
    return [...(candidates || [])].sort((left, right) =>
      (String(right?.invoiceNo || "") === linked ? 1 : 0) -
        (String(left?.invoiceNo || "") === linked ? 1 : 0) ||
      distance(left) - distance(right) ||
      String(left?.invoiceNo || "").localeCompare(String(right?.invoiceNo || ""), "vi", {
        numeric: true,
        sensitivity: "base"
      })
    );
  }

  function selectBatchReviewTransactions(transactions, options) {
    const fromDate = String(options?.fromDate || "");
    const toDate = String(options?.toDate || "");
    const limit = Math.max(1, Math.min(50, Number(options?.limit) || 10));
    // "review" CỐ TÌNH không có trong danh sách này. Đó là trạng thái của giao
    // dịch đang chờ người rà bằng mắt: dòng Credit không rõ là chuyển khoản, và
    // giao dịch từ 20 triệu trở lên vốn có thể là nạp tiền/chuyển nội bộ chứ
    // không phải doanh thu. Cho Batch Review tự lập phương án cho chúng thì việc
    // chặn lúc import trở nên vô nghĩa, mà phát hành rồi thì không hoàn tác được.
    //
    // Người dùng duyệt bằng nút "Là doanh thu" — nút đó đưa giao dịch về
    // "pending" và từ đó mới vào đây.
    const allowedStatuses = new Set(["pending", "planned", "batch_ready", "done"]);
    return (transactions || []).filter(item => {
      if (!allowedStatuses.has(item.status)) return false;
      const transactionDate = String(item.transactionDate || "");
      if (fromDate && transactionDate < fromDate) return false;
      if (toDate && transactionDate > toDate) return false;
      return true;
    })
      // Sắp theo ngày rồi tới giờ giao dịch TRƯỚC khi cắt theo limit: thứ tự lập
      // phương án quyết định thứ tự cấp slot giờ/phòng cho phiếu mới, và cũng
      // quyết định lô 10 giao dịch đầu là những giao dịch nào. Giữ nguyên thứ tự
      // dòng trong file sao kê thì hai thứ đó đều tùy tiện.
      //
      // requestedAt trống thì rơi về rowNumber — thứ tự xuất hiện trong file —
      // để kết quả luôn ổn định thay vì phụ thuộc thứ tự duyệt.
      .sort((left, right) =>
        String(left.transactionDate || "").localeCompare(String(right.transactionDate || "")) ||
        String(left.requestedAt || "").localeCompare(String(right.requestedAt || "")) ||
        (Number(left.rowNumber) || 0) - (Number(right.rowNumber) || 0)
      )
      .slice(0, limit);
  }

  async function buildBatchReview(options) {
    options = options || {};
    const button = document.getElementById("it-build-batch");
    const summary = document.getElementById("it-batch-summary");
    const onlyTransactionId = String(options.onlyTransactionId || "");
    const previousBatchPlans = batchPlans;
    const previousPlanIndex = onlyTransactionId
      ? previousBatchPlans.findIndex(entry => String(entry.transactionId) === onlyTransactionId)
      : -1;
    try {
      if (button) button.disabled = true;
      const current = await request("scan");
      if (current?.ready) throw new Error("Hãy bấm Thoát để đóng phiếu đang mở trước khi tạo Batch Review.");
      const limit = Math.max(1, Math.min(50, Number(document.getElementById("it-batch-limit")?.value) || 10));
      const fromDate = document.getElementById("it-batch-from-date")?.value || "";
      const toDate = document.getElementById("it-batch-to-date")?.value || "";
      if (fromDate && toDate && fromDate > toDate) throw new Error("Từ ngày không được lớn hơn Đến ngày.");
      let invalidatedLegacyPlans = 0;
      for (const transaction of statementDataset.transactions || []) {
        if (!["planned", "batch_ready"].includes(transaction.status)) continue;
        const savedPlan = transaction.pendingPlan || transaction.batchApprovedPlan;
        const invalidNewInvoiceReason = newInvoicePlanValidationError(savedPlan, transaction);
        if (savedPlan?.calculationVersion === CALCULATION_VERSION && !invalidNewInvoiceReason) continue;
        transaction.status = "pending";
        transaction.pendingPlan = null;
        transaction.batchApprovedPlan = null;
        delete transaction.acceptedGrandOverride;
        delete transaction.acceptedGrandOverrideAt;
        transaction.blockedNote = invalidNewInvoiceReason || "Phương án cũ dùng công thức trước phiên bản hiện tại; cần tính lại.";
        transaction.blockedAt = new Date().toISOString();
        invalidatedLegacyPlans += 1;
      }
      if (invalidatedLegacyPlans) {
        await InvoiceMappingStore.saveStatement(statementDataset);
      }
      let transactions = selectBatchReviewTransactions(statementDataset.transactions, { fromDate, toDate, limit });
      if (onlyTransactionId) {
        const selectedTransaction = (statementDataset.transactions || [])
          .find(item => String(item.id) === onlyTransactionId);
        transactions = selectedTransaction ? [selectedTransaction] : [];
      }
      if (!transactions.length) throw new Error("Không có giao dịch nào trong khoảng ngày đã chọn.");
      batchPlans = onlyTransactionId
        ? previousBatchPlans.filter(entry => String(entry.transactionId) !== onlyTransactionId)
        : [];
      const table = document.getElementById("it-batch-table");
      if (table && !onlyTransactionId) table.innerHTML = "";
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
      if (onlyTransactionId) {
        for (const item of statementDataset.transactions || []) {
          if (String(item.id) === onlyTransactionId) continue;
          const plan = item.pendingPlan || item.batchApprovedPlan;
          if (["planned", "batch_ready", "done"].includes(item.status)) {
            addPlanProductUsage(productUsage, plan?.items);
          }
        }
      }
      // Ghi lại lý do không lập được hóa đơn ngay trên giao dịch, để người dùng
      // thấy ở bảng sao kê mà không phải mở lại Batch Review.
      const noteBlockedTransaction = (item, plan) => {
        if (plan?.unreachableGrand) {
          item.blockedNote = plan.reason;
          item.blockedAt = new Date().toISOString();
          return;
        }
        // Đã chấp nhận tổng lệch: giữ ghi chú để sổ sách nêu rõ chênh bao nhiêu.
        if (plan?.status === "ready" && Number(plan.grandDifference)) {
          const diff = Number(plan.grandDifference);
          item.blockedNote = `Hóa đơn lập ở ${formatMoney(plan.targetGrand)}đ, ` +
            `lệch ${diff > 0 ? "+" : ""}${formatMoney(diff)}đ so với sao kê ${formatMoney(plan.statementGrand)}đ ` +
            "do website làm tròn VAT.";
          item.blockedAt = new Date().toISOString();
          return;
        }
        if (item.blockedNote) {
          delete item.blockedNote;
          delete item.blockedAt;
        }
      };
      // Đếm số phiếu mới đã lập theo từng ngày để rải giờ vào sau 17:00. Phải
      // tính cả những phiếu mới đã lập ở các lần dựng Batch Review trước, nếu
      // không lần chạy sau lại bắt đầu từ 17:00 và trùng giờ phiếu đã có.
      const newInvoiceSlotByDate = new Map();
      const selectedIdSet = new Set(selectedTransactionIds);
      for (const item of statementDataset.transactions || []) {
        // Giao dịch trong lượt này sẽ tự chiếm slot khi lặp bên dưới; đếm ở đây
        // nữa thì slot bị nhảy cóc.
        if (selectedIdSet.has(String(item.id))) continue;
        const plan = item.pendingPlan || item.batchApprovedPlan;
        if (!plan?.requiresNewInvoice) continue;
        const dateKey = String(item.transactionDate || "");
        if (!dateKey) continue;
        newInvoiceSlotByDate.set(dateKey, (newInvoiceSlotByDate.get(dateKey) || 0) + 1);
      }
      // Cấp slot kế tiếp cho một ngày. Mọi phiếu mới đều phải đi qua đây để hai
      // phiếu cùng ngày không nhận cùng một giờ vào.
      const takeNewInvoiceSlot = dateKey => {
        const key = String(dateKey || "");
        const slot = newInvoiceSlotByDate.get(key) || 0;
        newInvoiceSlotByDate.set(key, slot + 1);
        return slot;
      };
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
          if (transaction.pendingPlan.requiresNewInvoice) takeNewInvoiceSlot(transaction.transactionDate);
          batchPlans.push({ transactionId: String(transaction.id), status: "planned", transaction, plan: transaction.pendingPlan });
          addPlanProductUsage(productUsage, transaction.pendingPlan.items);
          workingInventory = reserveBatchStock(workingInventory, transaction.pendingPlan.items);
          usedInvoiceNos.add(String(transaction.invoiceNo || transaction.pendingPlan.invoiceNo));
          continue;
        }
        if (transaction.status === "batch_ready" && transaction.batchApprovedPlan) {
          if (transaction.batchApprovedPlan.requiresNewInvoice) takeNewInvoiceSlot(transaction.transactionDate);
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
        const rankedCandidates = rankInvoiceCandidates(available, transaction.credit, transaction.invoiceNo);
        let candidate = rankedCandidates[0] || null;
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
            const slotIndex = takeNewInvoiceSlot(transaction.transactionDate);
            const plan = calculateNewInvoiceBatchPlan(
              transaction, workingInventory, productUsage, slotIndex, transaction.acceptedGrandOverride
            );
            noteBlockedTransaction(transaction, plan);
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
        // The list date alone is not enough: an old room session can be shown in a
        // later sales list. Inspect a bounded number of the closest candidates
        // and prefer one whose actual
        // check-in/check-out touches the bank-statement date. Keep one rebased
        // fallback only when no such invoice is available.
        let rebasedCandidateScan = null;
        let selectedCandidateScan = null;
        let selectedCandidateLeftOpen = false;
        const candidatesToProbe = rankedCandidates.slice(0, MAX_SESSION_CANDIDATE_PROBES);
        for (let probeIndex = 0; probeIndex < candidatesToProbe.length; probeIndex += 1) {
          const currentCandidate = candidatesToProbe[probeIndex];
          let inspecting = false;
          try {
            if (summary) {
              summary.textContent =
                `Đang tính ${index + 1}/${transactions.length}: ${transaction.transactionDate} · ${formatMoney(transaction.credit)}` +
                ` · kiểm tra phiếu ${probeIndex + 1}/${candidatesToProbe.length}`;
            }
            await request("openInvoiceCandidate", {
              uid: currentCandidate.uid,
              invoiceNo: currentCandidate.invoiceNo
            });
            inspecting = true;
            const inspectedScan = await waitForOpenedInvoice(
              currentCandidate.invoiceNo,
              currentCandidate.dateKey || transaction.transactionDate,
              SESSION_CANDIDATE_PROBE_TIMEOUT_MS
            );
            if (invoiceSessionTouchesTransactionDate(inspectedScan, transaction.transactionDate)) {
              candidate = currentCandidate;
              rebasedCandidateScan = null;
              selectedCandidateScan = inspectedScan;
              selectedCandidateLeftOpen = true;
              inspecting = false;
              break;
            }
            if (!rebasedCandidateScan) {
              const rebased = rebaseInvoiceSession(inspectedScan, transaction.transactionDate);
              if (rebased) {
                candidate = currentCandidate;
                rebasedCandidateScan = rebased;
              }
            }
          } catch (_) {
            // The normal read below will surface an actionable error if every
            // candidate fails. A single unreadable row must not stop the search.
          } finally {
            if (inspecting) {
              try { await request("closeInvoiceDetail"); } catch (_) {}
              await new Promise(resolve => setTimeout(resolve, 120));
            }
          }
        }
        let opened = selectedCandidateLeftOpen;
        try {
          usedInvoiceNos.add(String(candidate.invoiceNo));
          if (!opened) {
            await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo: candidate.invoiceNo });
            opened = true;
          }
          let scan = selectedCandidateScan ||
            await waitForOpenedInvoice(candidate.invoiceNo, candidate.dateKey || transaction.transactionDate);
          if (rebasedCandidateScan &&
              String(rebasedCandidateScan.invoiceNo || "") === String(candidate.invoiceNo || "")) {
            scan = rebasedCandidateScan;
          }
          const plan = calculateBatchPlan(
            scan, transaction, workingInventory, productUsage, transaction.acceptedGrandOverride
          );
          noteBlockedTransaction(transaction, plan);
          batchPlans.push({
            transactionId: String(transaction.id),
            status: plan.status,
            transaction,
            plan,
            candidates: available,
            reason: plan.reason || (available.length > 1
              ? `Tu chon ${candidate.invoiceNo}; uu tien phieu co gio vao/ra phu hop ngay sao ke, sau do moi xet do gan tien.` +
                (plan.sessionRebased
                  ? ` Khong con phieu phu hop; da doi ca phien ${plan.originalCheckIn} - ${plan.originalCheckOut} sang ${plan.checkIn} - ${plan.checkOut}.`
                  : "")
              : "")
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
      if (onlyTransactionId) {
        const recalculatedIndex = batchPlans.findIndex(entry => String(entry.transactionId) === onlyTransactionId);
        if (recalculatedIndex >= 0 && previousPlanIndex >= 0) {
          const [recalculatedEntry] = batchPlans.splice(recalculatedIndex, 1);
          batchPlans.splice(Math.min(previousPlanIndex, batchPlans.length), 0, recalculatedEntry);
        }
      }
      renderBatchPlans();
      renderStatementRows();
      // Ghi chú "không lập được hóa đơn" nằm trên giao dịch nên phải lưu xuống
      // storage, nếu không sẽ mất khi tải lại trang.
      await InvoiceMappingStore.saveStatement(statementDataset);
      await saveBatchUiSession({ panelOpen: true });
      setStatus(
        onlyTransactionId
          ? "Đã tính lại riêng hóa đơn được chọn. Các phương án khác được giữ nguyên."
          : "Đã tạo Batch Review. Chưa có hóa đơn nào bị sửa hoặc lưu.",
        "ok"
      );
    } catch (error) {
      console.error("[InvoiceTarget batch review]", error);
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
    const apiQueue = batchPlans.filter(item => item.status === "batch_ready");
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
      const timeDetails = plan.checkIn && plan.checkOut
        ? `<small class="it-batch-time"><b>${escapeHtml(plan.checkIn)}</b> → <b>${escapeHtml(plan.checkOut)}</b>` +
          `<br>${Math.round(Number(plan.durationMinutes) || 0)} phút · theo giờ ${formatMoney(plan.hourFromTime)}đ` +
          `${Number(plan.hourAdjustment) ? ` · bù ${Number(plan.hourAdjustment) > 0 ? "+" : ""}${formatMoney(plan.hourAdjustment)}đ` : ""}</small>`
        : "—";
      return `<tr class="it-batch-row ${escapeHtml(entry.status)}">
        <td><input class="it-batch-select" type="checkbox" data-index="${index}" ${entry.status === "ready" ? "checked" : "disabled"}></td>
        <td class="it-batch-transaction"><b>${escapeHtml(entry.transaction.transactionDate)}</b><small title="${escapeHtml(entry.transaction.description || "")}">${escapeHtml(entry.transaction.description || "")}</small></td>
        <td>${escapeHtml(plan.invoiceNo || entry.transaction.invoiceNo || "—")}</td>
        <td class="it-money">${formatMoney(entry.transaction.credit)}</td>
        <td class="it-money">${plan.goods == null ? "—" : formatMoney(plan.goods)}</td>
        <td class="it-money">${plan.hour == null ? "—" : formatMoney(plan.hour)}</td>
        <td>${timeDetails}</td>
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
          ${entry.status === "batch_ready" && plan.requiresNewInvoice ? `<br><button class="it-save-new-api" type="button" data-index="${index}">Tạo, lưu API và đối soát</button>` : ""}
          ${entry.status === "batch_ready" && !plan.requiresNewInvoice
            ? `<br><button class="it-save-api" type="button" data-index="${index}">Lưu API & đối soát</button>`
            : ""}
          ${["batch_ready", "planned"].includes(entry.status) && !plan.requiresNewInvoice
            ? `<br><button class="it-apply-accepted" type="button" data-index="${index}">${entry.status === "planned" ? "Mở và áp dụng lại phương án" : "Mở và áp dụng phương án"}</button>`
            : ""}
          ${["batch_ready", "planned"].includes(entry.status)
            ? `<br><button class="it-recalculate-accepted" type="button" data-index="${index}" title="${entry.status === "planned" ? "Bỏ dữ liệu đang chờ lưu trên form, hoàn reservation và tính phương án khác" : "Bỏ phương án hiện tại, hoàn reservation tồn kho và tính một tổ hợp khác"}">Tính toán lại</button>`
            : ""}
          ${entry.status === "planned"
            ? `<br><button class="it-verify-batch" type="button" data-index="${index}">Đối soát sau lưu${plan.requiresNewInvoice ? " & cập nhật kho" : ""}</button>`
            : ""}
          ${entry.status === "lookup_error" ? `<br><button class="it-retry-batch" type="button">Thử dò lại</button>` : ""}
          ${(entry.plan?.reachableAlternatives || []).length ? `<br>${entry.plan.reachableAlternatives.map(value => {
            const diff = value - Number(entry.transaction.credit || 0);
            return `<button class="it-apply-rounded" type="button" data-index="${index}" data-grand="${value}" ` +
              `title="Lập hóa đơn ở ${formatMoney(value)}đ và ghi chú phần lệch ${diff > 0 ? "+" : ""}${formatMoney(diff)}đ">` +
              `Lập ở ${formatMoney(value)}đ (${diff > 0 ? "+" : ""}${formatMoney(diff)}đ)</button>`;
          }).join(" ")}` : ""}
          ${entry.transaction.acceptedGrandOverride && !["planned", "done"].includes(entry.status)
            ? `<br><button class="it-reset-rounded" type="button" data-index="${index}" ` +
              `title="Xóa mức tổng điều chỉnh và tính lại từ đúng số tiền sao kê">Dùng lại tổng sao kê ${formatMoney(entry.transaction.credit)}đ</button>`
            : ""}
        </td>
        <td>${itemDetails ? `<details><summary>${plan.items.length} mã</summary><table><thead><tr><th>Mã</th><th>Tên</th><th>SL</th><th>Giá</th><th>Tồn trước</th><th>Giới hạn/HĐ</th></tr></thead><tbody>${itemDetails}</tbody></table></details>` : "—"}</td>
      </tr>`;
    }).join("");
    table.innerHTML = `<div class="it-batch-actions">
      <label><input id="it-batch-select-all" type="checkbox" checked> Chọn tất cả phương án sẵn sàng</label>
      <button id="it-approve-batch" type="button" class="primary" ${ready.length ? "" : "disabled"}>Accept các phương án đã chọn</button>
      <button id="it-run-batch-api" type="button" class="primary" ${apiQueue.length ? "" : "disabled"}>Lưu API ${apiQueue.length} phiếu đã Accept</button>
    </div>
    <div class="it-table-wrap"><table class="it-batch-table it-batch-plan-table"><thead><tr><th></th><th>Giao dịch</th><th>Phiếu</th><th>Sao kê</th><th>Tiền hàng</th><th>Tiền giờ</th><th>Giờ vào → ra</th><th>VAT</th><th>Trạng thái</th><th>Chi tiết</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    table.querySelector("#it-batch-select-all")?.addEventListener("change", event => {
      table.querySelectorAll(".it-batch-select:not(:disabled)").forEach(input => { input.checked = event.target.checked; });
    });
    table.querySelector("#it-approve-batch")?.addEventListener("click", approveBatchPlans);
    table.querySelector("#it-run-batch-api")?.addEventListener("click", runAcceptedBatchApi);
    table.querySelectorAll(".it-unissued-choice").forEach(select => select.addEventListener("change", chooseUnissuedInvoice));
    table.querySelectorAll(".it-issued-choice").forEach(select => select.addEventListener("change", chooseIssuedInvoice));
    table.querySelectorAll(".it-confirm-issued").forEach(button => button.addEventListener("click", confirmAlreadyIssued));
    table.querySelectorAll(".it-open-pos").forEach(button => button.addEventListener("click", openPosForNewInvoice));
    table.querySelectorAll(".it-save-new-api").forEach(button => button.addEventListener("click", saveNewAcceptedBatchPlanViaApi));
    table.querySelectorAll(".it-apply-accepted").forEach(button => button.addEventListener("click", applyAcceptedBatchPlan));
    table.querySelectorAll(".it-save-api").forEach(button => button.addEventListener("click", saveAcceptedBatchPlanViaApi));
    table.querySelectorAll(".it-recalculate-accepted").forEach(button => button.addEventListener("click", recalculateAcceptedBatchPlan));
    table.querySelectorAll(".it-verify-batch").forEach(button => button.addEventListener("click", verifyBatchSavedInvoice));
    table.querySelectorAll(".it-retry-batch").forEach(button => button.addEventListener("click", buildBatchReview));
    table.querySelectorAll(".it-apply-rounded").forEach(button => button.addEventListener("click", acceptRoundedGrand));
    table.querySelectorAll(".it-reset-rounded").forEach(button => button.addEventListener("click", resetRoundedGrand));
  }

  async function verifyBatchSavedInvoice(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    const entry = batchPlans[index];
    const transaction = findStatementTransaction(entry?.transactionId);
    const plan = transaction?.pendingPlan || entry?.plan;
    if (!entry || entry.status !== "planned" || !transaction || !plan?.invoiceNo) {
      setStatus("Không có phiếu đang chờ đối soát ở dòng này.", "error");
      return { verified: false, closed: false, error: "no-pending-invoice" };
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
      if (!await ensureInvoiceListScreen()) {
        throw new Error("Chưa mở được màn hình danh sách Bán hàng để đọc lại phiếu; hãy mở danh sách rồi thử lại.");
      }
      const usedInvoiceNos = otherRowsInvoiceNos(transaction, plan);
      // Linh Đàm xếp phiếu mới vào ngày tạo của máy chủ. Kim Giang vẫn tìm
      // theo ngày sao kê như trước, không đi qua nhánh ngoại lệ này.
      const lookupDateKey = isLinhDamFreshApiInvoice(plan)
        ? todayDateKey()
        : transaction.transactionDate;
      const found = await request("findInvoiceCandidates", {
        dateKey: lookupDateKey,
        usedInvoiceNos
      });
      const candidate = (found.candidates || []).find(item =>
        String(item.invoiceNo) === String(plan.invoiceNo) && item.available
      );
      if (!candidate) {
        const lookupNote = isLinhDamFreshApiInvoice(plan)
          ? ` trong danh sách ngày server ${lookupDateKey}`
          : "";
        throw new Error(`Không tìm thấy phiếu chưa xuất ${plan.invoiceNo}${lookupNote} để đọc lại từ website.`);
      }
      await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo: plan.invoiceNo });
      const reopened = await waitForOpenedInvoice(plan.invoiceNo, candidate.dateKey || transaction.transactionDate);
      if (String(reopened.invoiceNo || "") !== String(plan.invoiceNo)) {
        throw new Error(`Website mở nhầm phiếu ${reopened.invoiceNo || "không xác định"}; chưa đối soát.`);
      }
      const errors = verifySnapshotAgainstPlan(reopened, plan);
      if (errors.length) throw new Error(errors.join(" "));

      if (button?.isConnected) button.textContent = "Đang ghi sổ tồn…";
      const ledgerVerification = await verifySavedInvoice(reopened);
      if (!ledgerVerification?.verified) {
        throw new Error(ledgerVerification?.error || `Không đối soát được ${plan.invoiceNo}.`);
      }
      if (currentBankTransaction?.status === "done") {
        if (button?.isConnected) button.textContent = "Đang trở về danh sách…";
        const closed = await request("closeInvoiceDetail");
        if (!closed?.closed) {
          setStatus(
            `Đã đối soát phiếu ${plan.invoiceNo}, nhưng website chưa đóng được form. Hãy bấm Thoát để trở về danh sách phiếu.`,
            "warn"
          );
          return { verified: true, closed: false, invoiceNo: plan.invoiceNo, closeResult: closed };
        }
        return { verified: true, closed: true, invoiceNo: plan.invoiceNo, closeResult: closed };
      }
      return { verified: false, closed: false, invoiceNo: plan.invoiceNo, error: "transaction-not-done" };
    } catch (error) {
      setStatus(`Đối soát từ Batch Review thất bại: ${error.message} Chưa thay đổi tồn kho hoặc sao kê.`, "error");
      return { verified: false, closed: false, invoiceNo: plan?.invoiceNo || "", error: error.message };
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
    // Chỉ dựng lại đúng giao dịch vừa chọn phiếu. Gọi không có
    // onlyTransactionId sẽ quét lại toàn bộ khoảng ngày hiện tại, làm mất thời
    // gian và có thể thay đổi các phương án khác trong Batch Review.
    await buildBatchReview({ onlyTransactionId: String(transaction.id) });
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
      delete transaction.rejectedBatchCodeCounts;
      delete transaction.recalculationNonce;
      // Giữ acceptedGrandOverride: phương án đã Accept dựa trên mức tiền này,
      // xóa đi thì lần tính lại sẽ quay về báo lỗi không lập được.
      entry.status = "batch_ready";
      entry.transaction = transaction;
    }
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true });
    renderBatchPlans();
    renderStatementAdmin();
    setStatus(
      `Đã Accept ${selectedIndexes.length} phương án vào hàng đợi. Chưa sửa hoặc lưu hóa đơn. ` +
      `Bước tiếp theo: bấm "Lưu API ${selectedIndexes.length} phiếu đã Accept" ngay phía dưới.`,
      "ok"
    );
  }

  // Số tiền sao kê không tạo được hóa đơn khớp tuyệt đối (website làm tròn VAT).
  // Người dùng chọn một mức gần nhất; lựa chọn được lưu trên giao dịch để lần
  // tính lại nào cũng dùng đúng mức đó.
  async function acceptRoundedGrand(event) {
    const button = event.target.closest("button");
    const entry = batchPlans[Number(button?.dataset.index)];
    const grand = Math.round(Number(button?.dataset.grand) || 0);
    const transaction = findStatementTransaction(entry?.transactionId);
    if (!transaction || !grand) {
      return setStatus("Không xác định được giao dịch hoặc mức tiền đã chọn.", "error");
    }
    const difference = grand - Math.round(Number(transaction.credit) || 0);
    transaction.acceptedGrandOverride = grand;
    transaction.acceptedGrandOverrideAt = new Date().toISOString();
    await InvoiceMappingStore.saveStatement(statementDataset);
    setStatus(
      `Đã chọn lập hóa đơn ở ${formatMoney(grand)}đ (lệch ${difference > 0 ? "+" : ""}${formatMoney(difference)}đ ` +
      "so với sao kê). Đang tính lại phương án…",
      "warn"
    );
    await buildBatchReview({ onlyTransactionId: String(transaction.id) });
  }

  // Không dùng window.alert khi extension chặn lưu: native alert che toàn bộ
  // form và khiến người dùng tưởng website bị treo. Hiển thị cùng thông báo
  // trong panel để người dùng sửa tiền mặt rồi thử Lưu HĐ lại.
  window.addEventListener(SAVE_BLOCKED, event => {
    setStatus(event.detail?.reason || "Extension đã chặn lưu hóa đơn.", "error");
  });

  window.addEventListener(RUNTIME_WARNING, event => {
    setStatus(event.detail?.reason || "Website phát sinh cảnh báo Kendo tạm thời; extension đã bỏ qua.", "warn");
  });

  async function resetRoundedGrand(event) {
    const button = event.target.closest("button");
    const entry = batchPlans[Number(button?.dataset.index)];
    const transaction = findStatementTransaction(entry?.transactionId);
    if (!transaction?.acceptedGrandOverride) {
      return setStatus("Giao dịch này không có mức tổng điều chỉnh để xóa.", "error");
    }
    if (["planned", "done"].includes(entry?.status)) {
      return setStatus("Phiếu đã áp dụng hoặc đã đối soát; không thể đổi tổng tại bước này.", "error");
    }
    delete transaction.acceptedGrandOverride;
    delete transaction.acceptedGrandOverrideAt;
    delete transaction.blockedNote;
    delete transaction.blockedAt;
    if (transaction.status === "batch_ready") {
      transaction.status = "pending";
      transaction.batchApprovedPlan = null;
      transaction.batchApprovedAt = "";
    }
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true });
    setStatus("Đã quay về đúng tổng tiền sao kê. Đang tính lại riêng giao dịch này…", "warn");
    await buildBatchReview({ onlyTransactionId: String(transaction.id) });
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
      // Đếm số lần từng mã bị bỏ. Nếu chỉ nhớ "đã từng bị bỏ" thì sau vài lần
      // mọi mã đều bị phạt bằng nhau, hình phạt triệt tiêu và tổ hợp cũ quay lại.
      const rejectionCounts = { ...(transaction.rejectedBatchCodeCounts || {}) };
      for (const item of activePlan.items || []) {
        const code = String(item.code || "");
        if (code) rejectionCounts[code] = (Number(rejectionCounts[code]) || 0) + 1;
      }
      transaction.rejectedBatchCodeCounts = rejectionCounts;
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
      await buildBatchReview({ onlyTransactionId: String(transaction.id) });
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
    // Reconciliation replaces statementDataset with a cloned snapshot. Never
    // mutate entry.transaction here because it may belong to the previous
    // snapshot after an earlier invoice in the same API batch was committed.
    const transaction = findStatementTransaction(entry?.transactionId);
    const plan = entry?.plan || transaction?.pendingPlan || transaction?.batchApprovedPlan;
    if (!entry || !["batch_ready", "planned"].includes(entry.status) || !transaction || !plan || plan.requiresNewInvoice) {
      const message = "Phương án này không thể áp dụng trực tiếp vào phiếu đã có.";
      setStatus(message, "error");
      return { applied: false, error: message };
    }
    const invoiceNo = String(plan.invoiceNo || transaction.invoiceNo || "");
    if (!invoiceNo || !Array.isArray(plan.items) || !plan.items.length) {
      const message = "Phương án đã Accept thiếu số phiếu hoặc danh sách hàng.";
      setStatus(message, "error");
      return { applied: false, error: message };
    }
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang mở phiếu…";
      }
      currentBankTransaction = transaction;
      setStatus(`Đang mở ${invoiceNo} và áp dụng đúng phương án đã Accept…`, "warn");
      const usedInvoiceNos = otherRowsInvoiceNos(transaction, plan);
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
      const openedScan = await waitForOpenedInvoice(invoiceNo, candidate.dateKey || transaction.transactionDate);
      if (!invoiceMatchesTransactionDate(openedScan, transaction.transactionDate)) {
        throw new Error(`Ngày phiếu ${invoiceBusinessDateKeys(openedScan).join(" hoặc ") || "không xác định"} không khớp ${transaction.transactionDate}.`);
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
        targetTax: plan.tax,
        sessionRebased: Boolean(plan.sessionRebased),
        checkIn: plan.checkIn || openedScan.checkIn || "",
        checkOut: plan.checkOut || openedScan.checkOut || ""
      });
      latestScan = {
        ...openedScan,
        ...applied,
        invoiceNo: openedScan.invoiceNo,
        invoiceDateKey: transaction.transactionDate
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
      return { applied: true, invoiceNo, transactionId: String(transaction.id) };
    } catch (error) {
      let closeResult = null;
      try {
        closeResult = await request("closeInvoiceDetail");
      } catch (_) {}
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Thử mở và áp dụng lại";
      }
      const closeNote = closeResult?.closed
        ? " Form đã được đóng để tránh giữ nhầm phiếu."
        : " Website chưa đóng được form; hãy bấm Thoát trước khi thử lại.";
      setStatus(`${error.message}${closeNote} Không bấm Lưu HĐ nếu form chưa khớp.`, "error");
      return { applied: false, error: error.message, closeResult };
    }
  }

  function batchButtonProxy(index, button) {
    if (button) return button;
    return {
      dataset: { index: String(index) },
      disabled: false,
      textContent: "",
      isConnected: false,
      closest: () => null
    };
  }

  async function openAcceptedInvoiceForApi(index, button) {
    const entry = batchPlans[index];
    const transaction = findStatementTransaction(entry?.transactionId);
    const plan = entry?.plan || transaction?.batchApprovedPlan;
    if (!entry || entry.status !== "batch_ready" || !transaction || !plan || plan.requiresNewInvoice) {
      throw new Error("Dong nay chua o trang thai Da Accept hoac can tao phieu moi.");
    }
    const invoiceNo = String(plan.invoiceNo || transaction.invoiceNo || "");
    if (!invoiceNo || !Array.isArray(plan.items) || !plan.items.length) {
      throw new Error("Phuong an Da Accept thieu so phieu hoac danh sach hang.");
    }
    if (button?.isConnected) button.textContent = "Dang mo phieu...";
    currentBankTransaction = transaction;
    setStatus(`Dang mo ${invoiceNo} de doc ID va gui payload API truc tiep...`, "warn");
    try {
      const usedInvoiceNos = otherRowsInvoiceNos(transaction, plan);
      const found = await request("findInvoiceCandidates", {
        dateKey: transaction.transactionDate,
        usedInvoiceNos
      });
      const candidate = (found.candidates || []).find(item =>
        String(item.invoiceNo) === invoiceNo && item.available
      );
      if (!candidate) {
        throw new Error(`Khong tim thay phieu chua xuat ${invoiceNo} trong ngay ${transaction.transactionDate}.`);
      }
      await request("openInvoiceCandidate", { uid: candidate.uid, invoiceNo });
      const openedScan = await waitForOpenedInvoice(invoiceNo, candidate.dateKey || transaction.transactionDate);
      if (!invoiceMatchesTransactionDate(openedScan, transaction.transactionDate)) {
        throw new Error(`Ngay phieu ${invoiceBusinessDateKeys(openedScan).join(" hoac ") || "khong xac dinh"} khong khop ${transaction.transactionDate}.`);
      }
      const pendingPlan = pendingPlanFromApproved(plan, transaction, openedScan);
      return { applied: true, entry, transaction, plan: pendingPlan, invoiceNo, openedScan };
    } catch (error) {
      try { await request("closeInvoiceDetail"); } catch (_) {}
      throw error;
    }
  }

  async function saveBatchEntryViaApi(index, button) {
    let entry = batchPlans[index];
    if (!entry || entry.status !== "batch_ready" || entry.plan?.requiresNewInvoice) {
      throw new Error("Dòng này chưa ở trạng thái Đã Accept hoặc cần tạo phiếu mới.");
    }
    let transaction = findStatementTransaction(entry.transactionId);
    if (!transaction) throw new Error("Không tìm thấy giao dịch sao kê của dòng đã chọn.");

    const proxy = batchButtonProxy(index, button);
    const applyResult = await openAcceptedInvoiceForApi(index, proxy);
    entry = batchPlans[index];
    transaction = findStatementTransaction(entry?.transactionId);
    if (!applyResult?.applied) {
      throw new Error(
        `${applyResult?.error || "Không áp dụng được phương án vào form."} ` +
        "Chưa gửi request lưu."
      );
    }
    if (!entry || entry.status !== "batch_ready" || transaction?.status !== "batch_ready") {
      throw new Error("Phương án không còn ở trạng thái Đã Accept; chưa gửi request lưu.");
    }
    const plan = applyResult.plan;
    const panel = document.getElementById("it-panel");
    if (panel) panel.hidden = false;
    await saveBatchUiSession({ panelOpen: true });
    setStatus(`Đang lưu ${plan.invoiceNo} qua API chính thức của website…`, "warn");
    let saved;
    try {
      saved = await request("saveExistingInvoicePlanViaApi", {
        invoiceNo: plan.invoiceNo,
        items: plan.items,
        targetGrand: plan.grand ?? plan.targetGrand ?? transaction.credit,
        targetGoods: plan.goods,
        targetHour: plan.hour,
        targetTax: plan.tax,
        // Ngày hóa đơn dùng để khớp sao kê; Giờ vào/Ra là ca hát
        // gốc và có thể nằm ở một ngày quá khứ khác.
        invoiceDateKey: plan.invoiceDateKey || transaction.transactionDate,
        checkIn: plan.checkIn,
        checkOut: plan.checkOut
      });
    } catch (error) {
      transaction.status = "batch_ready";
      delete transaction.pendingPlan;
      transaction.verifiedAt = "";
      transaction.ledgerId = "";
      entry.status = "batch_ready";
      entry.plan = transaction.batchApprovedPlan || entry.plan;
      entry.transaction = transaction;
      await InvoiceMappingStore.saveStatement(statementDataset);
      await saveBatchUiSession({ panelOpen: true });
      try { await request("closeInvoiceDetail"); } catch (_) {}
      throw error;
    }
    if (!saved?.saved) throw new Error(`Website chưa xác nhận lưu ${plan.invoiceNo}.`);

    const apiSavedAt = new Date().toISOString();
    transaction.invoiceNo = plan.invoiceNo;
    transaction.status = "planned";
    transaction.pendingPlan = {
      ...plan,
      apiSavedAt,
      apiSavedRecordId: saved.savedRecordId || ""
    };
    transaction.apiSavedAt = apiSavedAt;
    transaction.apiSavedRecordId = saved.savedRecordId || "";
    transaction.verifiedAt = "";
    transaction.ledgerId = "";
    entry.status = "planned";
    entry.plan = transaction.pendingPlan;
    entry.transaction = transaction;
    await InvoiceMappingStore.saveStatement(statementDataset);
    await saveBatchUiSession({ panelOpen: true });

    setStatus(`API đã nhận ${plan.invoiceNo}; đang đóng form và đọc lại từ server…`, "warn");
    const closedAfterSave = await request("closeInvoiceDetail");
    if (!closedAfterSave?.closed) {
      throw new Error(
        `API đã lưu ${plan.invoiceNo} nhưng form chi tiết vẫn đang mở. ` +
        "Batch đã dừng an toàn; hãy bấm Thoát rồi chọn Đối soát sau lưu."
      );
    }
    await new Promise(resolve => setTimeout(resolve, 450));
    const verifyProxy = batchButtonProxy(index);
    const verification = await verifyBatchSavedInvoice({ target: { closest: () => verifyProxy } });
    // verifySavedInvoice thay statementDataset bằng bản clone đã ghi sổ, nên
    // biến transaction bắt từ đầu hàm vẫn trỏ vào dataset cũ và không bao giờ
    // đổi sang "done". Phải đọc lại theo id từ dataset hiện hành.
    const verified = findStatementTransaction(entry.transactionId);
    if (verified?.status !== "done") {
      throw new Error(`Đã gửi API nhưng chưa đối soát được ${plan.invoiceNo}; tồn kho và sao kê chưa bị thay đổi.`);
    }
    if (!verification?.verified || !verification?.closed) {
      throw new Error(
        `Đã đối soát ${plan.invoiceNo} nhưng form chi tiết chưa đóng; ` +
        "batch không chạy sang phiếu kế tiếp."
      );
    }
    const uiState = await request("getInvoiceUiState");
    if (uiState?.detailVisible || !uiState?.listVisible) {
      throw new Error(
        `Sau khi xử lý ${plan.invoiceNo}, website chưa trở về danh sách phiếu; ` +
        "batch đã dừng để không ghi nhầm phiếu."
      );
    }
    return { invoiceNo: plan.invoiceNo, httpStatus: saved.httpStatus };
  }

  async function saveNewBatchEntryViaWorker(index) {
    const entry = batchPlans[index];
    if (!entry || entry.status !== "batch_ready" || !entry.plan?.requiresNewInvoice) {
      throw new Error("Dong phieu moi chua o trang thai Da Accept.");
    }
    const transactionId = String(entry.transactionId || "");
    const opened = await openPosForNewInvoice({ target: { dataset: { index: String(index) } } });
    if (!opened?.opened) throw new Error(opened?.error || "Khong mo duoc tab worker tao phieu moi.");

    const deadline = Date.now() + 90000;
    let verificationAttempted = false;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 800));
      const latestStatement = await InvoiceMappingStore.loadStatement();
      const latestTransaction = (latestStatement.transactions || []).find(item =>
        String(item.id) === transactionId
      );
      if (latestTransaction?.status === "done") {
        statementDataset = latestStatement;
        mappingDataset = await InvoiceMappingStore.load();
        sharedWarehouse = InvoiceSharedWarehouse.normalize(
          await InvoiceMappingStore.loadSharedWarehouse(InvoiceSharedWarehouse.empty())
        );
        verificationLedger = await InvoiceMappingStore.loadLedger();
        const storedSession = await InvoiceMappingStore.loadUiSession();
        batchPlans = hydrateBatchPlans(
          storedSession?.batchPlans || serializeBatchPlans(batchPlans),
          statementDataset.transactions
        );
        refreshMappingState();
        renderBatchPlans();
        renderStatementAdmin();
        return {
          invoiceNo: latestTransaction.invoiceNo,
          transactionId,
          workerTabId: opened.tabId
        };
      }
      if (!verificationAttempted && latestTransaction?.status === "planned" &&
          latestTransaction?.apiSavedAt && latestTransaction?.pendingPlan?.invoiceNo) {
        verificationAttempted = true;
        // Reload the worker's persisted result, then verify on this original
        // tab where the website's invoice list is already available.
        statementDataset = latestStatement;
        mappingDataset = await InvoiceMappingStore.load();
        sharedWarehouse = InvoiceSharedWarehouse.normalize(
          await InvoiceMappingStore.loadSharedWarehouse(InvoiceSharedWarehouse.empty())
        );
        verificationLedger = await InvoiceMappingStore.loadLedger();
        const storedSession = await InvoiceMappingStore.loadUiSession();
        batchPlans = hydrateBatchPlans(
          storedSession?.batchPlans || serializeBatchPlans(batchPlans),
          statementDataset.transactions
        );
        const verifyIndex = batchPlans.findIndex(item => String(item.transactionId) === transactionId);
        if (verifyIndex < 0) throw new Error("Khong tim thay dong Batch vua duoc worker luu.");
        renderBatchPlans();
        const verification = await verifyBatchSavedInvoice({
          target: { closest: () => batchButtonProxy(verifyIndex) }
        });
        const verifiedTransaction = findStatementTransaction(transactionId);
        if (!verification?.verified || verifiedTransaction?.status !== "done") {
          throw new Error(
            `Da luu ${latestTransaction.pendingPlan.invoiceNo} nhung doc lai tu server chua khop: ` +
            `${verification?.error || "khong ro loi"}. Ton kho chua bi tru.`
          );
        }
        return {
          invoiceNo: verifiedTransaction.invoiceNo,
          transactionId,
          workerTabId: opened.tabId
        };
      }
      if (latestTransaction?.status === "error") {
        throw new Error(latestTransaction.blockedNote || "Tab worker bao loi khi tao phieu moi.");
      }
    }
    throw new Error(
      "Tab tao phieu moi chua hoan tat sau 90 giay. Tab duoc giu lai de kiem tra; khong chay lai API neu phieu da duoc luu."
    );
  }

  async function saveNewAcceptedBatchPlanViaApi(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang tạo, lưu và đối soát…";
      }
      const result = await saveNewBatchEntryViaWorker(index);
      setStatus(
        `Đã tạo, đọc lại và đối soát ${result.invoiceNo}. Tồn kho chỉ được cập nhật sau bước đối soát này.`,
        "ok"
      );
      return result;
    } catch (error) {
      setStatus(
        `${error.message} Giao dịch chưa được đánh dấu hoàn tất và tồn kho chưa bị trừ.`,
        "error"
      );
      return { saved: false, error: error.message };
    } finally {
      if (button?.isConnected) {
        button.disabled = false;
        button.textContent = "Tạo, lưu API và đối soát";
      }
    }
  }

  async function saveAcceptedBatchPlanViaApi(event) {
    const button = event.target.closest("button");
    const index = Number(button?.dataset.index);
    try {
      if (button) {
        button.disabled = true;
        button.textContent = "Đang lưu API…";
      }
      const result = await saveBatchEntryViaApi(index, button);
      renderBatchPlans();
      renderStatementAdmin();
      setStatus(`Đã lưu và đối soát ${result.invoiceNo}. Sao kê và tồn kho đã được cập nhật.`, "ok");
    } catch (error) {
      renderBatchPlans();
      renderStatementAdmin();
      setStatus(`Batch API dừng: ${error.message}`, "error");
    }
  }

  async function runAcceptedBatchApi(event) {
    const button = event.target.closest("button");
    const indexes = batchPlans
      .map((entry, index) => ({ entry, index }))
      .filter(item => item.entry.status === "batch_ready")
      .map(item => item.index);
    if (!indexes.length) return setStatus("Không có phương án đã Accept nào đủ điều kiện lưu API.", "error");
    if (button) {
      button.disabled = true;
      button.textContent = `Đang xử lý 0/${indexes.length}…`;
    }
    let completed = 0;
    try {
      for (const index of indexes) {
        if (button?.isConnected) button.textContent = `Đang xử lý ${completed + 1}/${indexes.length}…`;
        if (batchPlans[index]?.plan?.requiresNewInvoice) {
          await saveNewBatchEntryViaWorker(index);
        } else {
          await saveBatchEntryViaApi(index);
        }
        completed += 1;
      }
      renderBatchPlans();
      renderStatementAdmin();
      // Lưu xong là dữ liệu bước 5 đã sẵn sàng. Mời sang thẳng màn phát hành thay
      // vì bắt kế toán tự thoát ra, đổi tab rồi bấm Tải danh sách. Vẫn phải bấm
      // vì phát hành hóa đơn là thao tác không hoàn tác được.
      setStatus(
        `Đã lưu API và đối soát thành công ${completed}/${indexes.length} phiếu.`,
        "ok",
        { label: `Phát hành ${completed} hóa đơn này`, action: "einvoice" }
      );
    } catch (error) {
      renderBatchPlans();
      renderStatementAdmin();
      setStatus(
        `Batch API đã dừng sau ${completed}/${indexes.length} phiếu: ${error.message} ` +
        "Các phiếu phía sau chưa được gửi; tồn kho chỉ ghi cho phiếu đã đối soát thành công.",
        "error"
      );
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
    const t = findStatementTransaction(entry.transactionId) || entry.transaction;
    entry.transaction = t;
    const plan = entry.plan || t?.batchApprovedPlan || null;
    const planError = newInvoicePlanValidationError(plan, t);
    if (planError) {
      if (t) {
        t.status = "pending";
        t.pendingPlan = null;
        t.batchApprovedPlan = null;
        delete t.acceptedGrandOverride;
        delete t.acceptedGrandOverrideAt;
        t.blockedNote = `${planError} Đã hủy phương án cũ và cần tính lại.`;
        t.blockedAt = new Date().toISOString();
        await InvoiceMappingStore.saveStatement(statementDataset);
      }
      setStatus(`${planError} Không mở form bằng phương án này; đang tính lại Batch Review.`, "error");
      await buildBatchReview();
      return;
    }
    const salesAnchor = Array.from(document.querySelectorAll("a"))
      .find(anchor => (anchor.innerText || "").trim() === "Bán hàng" && anchor.href);
    const salesUrl = salesAnchor?.href || location.href;
    pendingNewInvoice = {
      transactionId: String(entry.transactionId),
      transactionDate: t.transactionDate,
      credit: Number(t.credit || 0),
      description: t.description || "",
      plan: structuredClone(plan),
      requestedAt: new Date().toISOString()
    };
    setStatus(
      `Đang mở tab Bán hàng mới để tạo phiếu ngày ${t.transactionDate}, tổng mục tiêu ${formatMoney(t.credit)}đ. ` +
      "Tab danh sách và phiên Batch Review hiện tại vẫn được giữ nguyên.",
      "warn"
    );
    try {
      await saveBatchUiSession({ panelOpen: true, pendingNewInvoice: structuredClone(pendingNewInvoice) });
      const opened = await sendRuntimeMessage({
        type: "invoiceTarget.openBatchWorkerTab",
        url: salesUrl
      });
      setStatus(
        `Đã mở tab xử lý cho giao dịch ${t.transactionDate} · ${formatMoney(t.credit)}đ. ` +
        "Đang chờ API trả số phiếu và tab danh sách đọc lại đúng ngày; bước này chưa phải là lưu thành công.",
        "warn"
      );
      return { opened: true, tabId: opened.tabId, transactionId: String(t.id) };
    } catch (error) {
      setStatus(`Không lưu được phiên trước khi mở tab mới: ${error.message}`, "error");
      return { opened: false, error: error.message };
    }
  }

  function parseUiDateTime(value) {
    const match = String(value || "").match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})/);
    return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5])) : null;
  }

  function uiDateKey(value) {
    const raw = String(value || "").trim();
    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const date = parseUiDateTime(raw);
    if (!date) return "";
    const part = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
  }

  // Website xếp phiếu theo ngày kết thúc/thanh toán, trong khi scan.invoiceDateKey
  // trước đây ưu tiên ô Giờ vào. Ca hát qua đêm vì vậy có hai ngày nghiệp vụ hợp lệ.
  function invoiceBusinessDateKeys(snapshot) {
    const authoritativeListDate = uiDateKey(snapshot?.listDateKey);
    if (authoritativeListDate) return [authoritativeListDate];
    return [...new Set([
      uiDateKey(snapshot?.invoiceDateKey),
      uiDateKey(snapshot?.checkIn),
      uiDateKey(snapshot?.checkOut)
    ].filter(Boolean))];
  }

  function invoiceMatchesTransactionDate(snapshot, transactionDateKey) {
    const expected = uiDateKey(transactionDateKey);
    return Boolean(expected) && invoiceBusinessDateKeys(snapshot).includes(expected);
  }

  function invoiceSessionTouchesTransactionDate(snapshot, transactionDateKey) {
    const expected = uiDateKey(transactionDateKey);
    return Boolean(expected) && [uiDateKey(snapshot?.checkIn), uiDateKey(snapshot?.checkOut)].includes(expected);
  }

  function rebaseInvoiceSession(snapshot, transactionDateKey) {
    const checkIn = parseUiDateTime(snapshot?.checkIn);
    const checkOut = parseUiDateTime(snapshot?.checkOut);
    const dateMatch = String(transactionDateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!checkIn || !checkOut || !dateMatch || checkOut < checkIn) return null;
    const duration = checkOut.getTime() - checkIn.getTime();
    const rebasedCheckIn = new Date(
      Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]),
      checkIn.getHours(), checkIn.getMinutes()
    );
    const rebasedCheckOut = new Date(rebasedCheckIn.getTime() + duration);
    return {
      ...snapshot,
      checkIn: formatUiDateTime(rebasedCheckIn),
      checkOut: formatUiDateTime(rebasedCheckOut),
      invoiceDateKey: String(transactionDateKey || ""),
      listDateKey: String(transactionDateKey || ""),
      sessionRebased: true,
      originalCheckIn: snapshot.checkIn || "",
      originalCheckOut: snapshot.checkOut || ""
    };
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
      if (!invoiceBusinessDateKeys(latestScan).length) return setStatus("Không đọc được ngày trên phiếu; chưa thể xác nhận khớp ngày sao kê.", "error");
      if (!invoiceMatchesTransactionDate(latestScan, currentBankTransaction.transactionDate)) {
        return setStatus(`Ngày phiếu ${invoiceBusinessDateKeys(latestScan).join(" hoặc ")} không khớp ngày ngân hàng ${currentBankTransaction.transactionDate}.`, "error");
      }
    }
    if (!inventory.length) return setStatus("Không có ánh xạ đã xác nhận nào còn tồn.", "error");
    const targetGrand = parseMoney(document.getElementById("it-target").value);
    if (targetGrand <= 0) return setStatus("Hãy nhập tổng tiền mục tiêu hợp lệ.", "error");
    const maxQty = Math.max(1, Number(document.getElementById("it-max-qty").value) || 20);
    const tolerance = Math.max(0, parseMoney(document.getElementById("it-tolerance").value));
    const hourPricing = inferHourPricing(latestScan);
    const preTaxProbe = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, 0, latestScan.taxRate);
    const hourBounds = hourPlanningBounds(latestScan, hourPricing, targetGrand, preTaxProbe.preTaxTarget);
    const targets = InvoiceTargetSolver.deriveInvoiceTargets(targetGrand, hourBounds.baseHour, latestScan.taxRate);
    const goodsTarget = targets.goodsTarget;
    const hourPreTaxCap = Math.max(0, Math.floor(targets.preTaxTarget * MAX_HOUR_PRETAX_RATIO));
    hourBounds.maxHourAmount = Math.max(hourBounds.maxHourAmount, hourPreTaxCap);
    const minHourAmount = hourBounds.minHourAmount;
    const minGoodsAmount = minimumGoodsForHourRatio(targets.preTaxTarget);
    const candidates = buildCandidates();
    const requiredMinimum = candidates.reduce((sum, item) => sum + Number(item.minQty || 0) * Number(item.price || 0), 0);
    if (requiredMinimum > targets.preTaxTarget + tolerance) {
      return setStatus(`Các mặt hàng đang tích cần tối thiểu ${formatMoney(requiredMinimum)}, vượt tổng trước VAT ${formatMoney(targets.preTaxTarget)}.`, "error");
    }
    const solution = InvoiceTargetSolver.solveQuantities(candidates, goodsTarget, {
      maxQty, tolerance, preTaxTarget: targets.preTaxTarget,
      currentHour: hourBounds.baseHour, hourStep: hourPricing.hourStep,
      minHourAmount, maxHourAmount: hourBounds.maxHourAmount, minGoodsAmount,
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
    const hourBaseAdjustment = finalHourAmount - hourBounds.baseHour;
    const predictedGrand = solution.actual + finalHourAmount + targets.vatTarget;
    const proposedCheckOut = recommendCheckOut(latestScan, hourFromTime, hourPricing.hourlyRate);
    const totalDifference = predictedGrand - targetGrand;
    const dateMatched = !currentBankTransaction || invoiceMatchesTransactionDate(latestScan, currentBankTransaction.transactionDate);
    const stockSufficient = selected.every(item => Number(item.newQty) <= Number(item.maxQty));
    const ratioRealistic = solution.actual > 0 &&
      finalHourAmount <= solution.actual * MAX_HOUR_TO_GOODS_RATIO;
    const hourAdjustmentSmall = Math.abs(hourBaseAdjustment) <= hourBounds.adjustmentLimit;
    const hourWithinPreTaxCap = finalHourAmount <= hourPreTaxCap;
    const hourPolicyAccepted = hourAdjustmentSmall || hourWithinPreTaxCap;
    const canAccept = totalDifference === 0 && dateMatched && stockSufficient &&
      ratioRealistic && hourPolicyAccepted && selected.length > 0;
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
          <div class="${ratioRealistic ? "pass" : "fail"}">${ratioRealistic ? "✓" : "×"} Tiền giờ không vượt ${MAX_HOUR_TO_GOODS_RATIO} lần tiền hàng</div>
          <div class="${hourPolicyAccepted ? "pass" : "fail"}">${hourPolicyAccepted ? "✓" : "×"} Tiền giờ: bù ${formatMoney(hourBaseAdjustment)} (giới hạn 20%: ${formatMoney(hourBounds.adjustmentLimit)}) hoặc không vượt 35% trước VAT (${formatMoney(hourPreTaxCap)})</div>
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
            invoiceDateKey: currentBankTransaction.transactionDate || latestScan.invoiceDateKey || "",
            goods: solution.actual,
            hour: finalHourAmount,
            hourBase: hourBounds.baseHour,
            hourBaseAdjustment,
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

  // Website phan biet chi nhanh bang cookie `shop` dung chung cho ca domain,
  // khong phai bang URL. Mo tab chi nhanh khac se ghi de cookie nay, khien cac
  // lenh luu dang chay ghi vao sai chi nhanh ma URL van trong nhu binh thuong.
  // Chi canh bao cho nguoi dung biet, khong chan thao tac.
  function activeShopFromCookie() {
    const match = String(document.cookie || "").match(/(?:^|;\s*)shop=([^;]*)/);
    if (!match) return "";
    return decodeURIComponent(match[1]).replace(/^\/+|\/+$/g, "").toLowerCase();
  }

  function warnOnTenantMismatch() {
    const pageTenant = String(InvoiceMappingStore.currentTenant() || "").toLowerCase();
    const cookieTenant = activeShopFromCookie();
    if (!cookieTenant || !pageTenant || cookieTenant === pageTenant) return false;
    setStatus(
      `CẢNH BÁO: trang này là "${pageTenant}" nhưng trình duyệt đang hoạt động ở chi nhánh "${cookieTenant}". ` +
      "Có thể bạn đang mở hai chi nhánh cùng lúc — phiếu lưu từ tab này có thể vào nhầm chi nhánh. " +
      "Hãy tải lại trang trước khi tạo phiếu.",
      "error"
    );
    return true;
  }

  async function init() {
    // Cơ sở lạ phải dừng hẳn, không được chạy với dữ liệu mặc định: mã web mỗi
    // cơ sở một khác, nên lập phương án bằng danh mục của cơ sở khác sẽ sinh
    // phiếu sai mã hàng mà chỉ phát hiện sau khi đã lưu.
    if (!tenantConfig) {
      console.error(
        `Invoice Target MVP: cơ sở "${pageTenantSlug}" chưa được khai báo trong TENANT_REGISTRY. ` +
        "Extension không chạy để tránh dùng nhầm danh mục của cơ sở khác."
      );
      return;
    }
    catalogDataset = await InvoiceMappingStore.loadCatalog(embeddedCatalog);
    webCatalog = catalogDataset.items || [];
    const storedMapping = await InvoiceMappingStore.load(embeddedDataset);
    mappingDataset = InvoiceMappingEngine.applyBusinessRules({ ...storedMapping, tenant: pageTenantSlug });
    sharedWarehouse = InvoiceSharedWarehouse.normalize(
      await InvoiceMappingStore.loadSharedWarehouse(InvoiceSharedWarehouse.empty())
    );
    if (sharedWarehouse.initialized) mergeWarehouseIntoCurrentMapping();
    statementDataset = await InvoiceMappingStore.loadStatement();
    verificationLedger = await InvoiceMappingStore.loadLedger();
    stockStateMeta = await InvoiceMappingStore.loadStockStateMeta();
    issuedInvoiceBook = await InvoiceMappingStore.loadIssuedInvoices();
    issueCoordination = InvoiceIssueCoordination.normalize(
      await InvoiceMappingStore.loadIssueCoordination(InvoiceIssueCoordination.empty())
    );
    priorityRules = await InvoiceMappingStore.loadPriorityRules();
    apiTemplate = await InvoiceMappingStore.loadApiTemplate();
    if (apiTemplate) {
      apiTemplate.analysis = InvoiceApiTemplate.analyze(apiTemplate);
      await InvoiceMappingStore.saveApiTemplate(apiTemplate);
    }
    InvoiceMappingEngine.reconcileCatalog(mappingDataset, webCatalog);
    await InvoiceMappingStore.save(mappingDataset);
    refreshMappingState();
    mount();
    await restoreUiSession();
    // Cookie `shop` co the bi tab khac ghi de bat ky luc nao sau khi panel da mo,
    // nen phai kiem tra lai dinh ky chu khong chi mot lan luc khoi tao.
    if (!warnOnTenantMismatch()) {
      setInterval(warnOnTenantMismatch, 15000);
    }
  }

  init().catch(error => console.error("Invoice Target MVP init failed", error));
})();
