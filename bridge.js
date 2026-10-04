(function () {
  "use strict";

  const REQUEST = "invoice-target-mvp:request";
  const RESPONSE = "invoice-target-mvp:response";
  const SAVE_CAPTURED = "invoice-target-mvp:save-request-captured";
  const SAVE_BLOCKED = "invoice-target-mvp:save-blocked";
  const RUNTIME_WARNING = "invoice-target-mvp:runtime-warning";
  let saveCaptureArmedUntil = 0;
  let apiTraceArmedUntil = 0;
  const apiTraceRecords = [];
  const invoiceListCache = new Map();

  function isKnownTransientKendoAlert(message) {
    const text = String(message || "").replace(/\s+/g, " ").toLowerCase();
    return text.includes("cannot call method 'value' of kendodropdownlist before it is initialized") ||
      text.includes('cannot call method "value" of kendodropdownlist before it is initialized');
  }

  // The website raises this Kendo pager error from a delayed callback, after the
  // short-lived alert suppression in invoice lookup has already been restored.
  // Keep the guard installed for the page lifetime, but suppress only the exact
  // known transient Kendo message. Every other website alert remains untouched.
  function installTransientKendoAlertGuard() {
    if (window.__invoiceTargetKendoAlertGuardInstalled) return;
    window.__invoiceTargetKendoAlertGuardInstalled = true;
    const nativeAlert = window.alert;
    window.alert = function invoiceTargetAlertGuard(message) {
      if (!isKnownTransientKendoAlert(message)) {
        return Reflect.apply(nativeAlert, window, [message]);
      }
      const detail = {
        reason: "Website vừa gọi bộ lọc Kendo trước khi khởi tạo xong. Extension đã bỏ qua cảnh báo tạm thời và sẽ không làm treo Batch Review.",
        originalMessage: String(message || "")
      };
      console.warn("[InvoiceTarget bridge] Suppressed transient Kendo alert", detail.originalMessage);
      window.dispatchEvent(new CustomEvent(RUNTIME_WARNING, { detail }));
      return undefined;
    };
  }

  installTransientKendoAlertGuard();

  function money(value) {
    if (typeof value === "number") return value;
    const text = String(value == null ? "" : value).replace(/[^0-9-]/g, "");
    return Number(text || 0);
  }

  function safeRequestHeaders(headers) {
    const blocked = /^(authorization|cookie|proxy-authorization)$/i;
    return Object.fromEntries(Object.entries(headers || {})
      .filter(([name]) => !blocked.test(name)));
  }

  function serializeRequestBody(body) {
    if (body == null) return { bodyType: "none", body: "" };
    if (typeof body === "string") return { bodyType: "text", body };
    if (body instanceof URLSearchParams) return { bodyType: "urlencoded", body: body.toString() };
    if (body instanceof FormData) {
      const entries = [];
      body.forEach((value, key) => {
        entries.push([key, typeof value === "string"
          ? value
          : { name: value?.name || "", type: value?.type || "", size: Number(value?.size || 0) }]);
      });
      return { bodyType: "formdata", body: entries };
    }
    return { bodyType: "unsupported", body: "" };
  }

  function shouldCaptureSaveRequest(method, url) {
    if (Date.now() > saveCaptureArmedUntil) return false;
    if (!/^(POST|PUT|PATCH)$/i.test(String(method || ""))) return false;
    try {
      const target = new URL(url, location.href);
      return target.origin === location.origin && /AddEdit/i.test(target.pathname);
    } catch (_) {
      return false;
    }
  }

  function xhrResponseText(xhr, limit = 8000) {
    try { return String(xhr.responseText || "").slice(0, limit); } catch (_) { return ""; }
  }

  function emitSaveCapture(record) {
    window.dispatchEvent(new CustomEvent(SAVE_CAPTURED, {
      detail: {
        ...record,
        url: new URL(record.url, location.href).href,
        capturedAt: new Date().toISOString()
      }
    }));
    saveCaptureArmedUntil = 0;
  }

  function installSaveRequestCapture() {
    if (window.__invoiceTargetSaveCaptureInstalled) return;
    window.__invoiceTargetSaveCaptureInstalled = true;

    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    const nativeSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__invoiceTargetRequest = { method: String(method || "GET"), url: String(url || ""), headers: {} };
      return nativeOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (this.__invoiceTargetRequest) this.__invoiceTargetRequest.headers[String(name)] = String(value);
      return nativeSetHeader.call(this, name, value);
    };
    XMLHttpRequest.prototype.send = function (body) {
      const meta = this.__invoiceTargetRequest;
      const captureSave = Boolean(meta && shouldCaptureSaveRequest(meta.method, meta.url));
      const traceApi = Boolean(meta && shouldTraceApiRequest(meta.method, meta.url));
      if (meta && isSameOriginRequest(meta.url)) {
        // Sơ đồ phòng: website tự tải khi mở màn hình Bán hàng. Nhận diện theo
        // hình dạng dữ liệu (không cần biết trước endpoint) và giữ lại cả
        // request để extension gọi lại khi cần bản mới.
        this.addEventListener("loadend", () => {
          captureRoomMapResponse(meta, body, this.status, xhrResponseText(this, ROOM_MAP_TEXT_LIMIT));
        }, { once: true });
      }
      if (captureSave || traceApi) {
        const serialized = serializeRequestBody(body);
        this.addEventListener("loadend", () => {
          const record = {
            transport: "xhr",
            method: meta.method,
            url: meta.url,
            headers: safeRequestHeaders(meta.headers),
            ...serialized,
            status: Number(this.status || 0),
            responseText: xhrResponseText(this, traceApi ? 131072 : 8000)
          };
          if (traceApi) appendApiTrace(record);
          if (captureSave) emitSaveCapture(record);
        }, { once: true });
      }
      return nativeSend.call(this, body);
    };

    const nativeFetch = window.fetch;
    if (typeof nativeFetch === "function") {
      window.fetch = async function (input, init) {
        const request = input instanceof Request ? input : null;
        const method = String(init?.method || request?.method || "GET");
        const url = String(request?.url || input || "");
        const headers = {};
        new Headers(init?.headers || request?.headers || {}).forEach((value, name) => { headers[name] = value; });
        const capture = shouldCaptureSaveRequest(method, url);
        const traceApi = shouldTraceApiRequest(method, url);
        const serialized = (capture || traceApi) ? serializeRequestBody(init?.body) : null;
        const response = await nativeFetch.apply(this, arguments);
        if (isSameOriginRequest(url) && /json|text/i.test(String(response.headers?.get?.("content-type") || ""))) {
          try {
            const text = await response.clone().text();
            captureRoomMapResponse({ method, url, headers }, init?.body, response.status, text.slice(0, ROOM_MAP_TEXT_LIMIT));
          } catch (_) { /* Không đọc được body thì bỏ qua, không ảnh hưởng website. */ }
        }
        if (capture || traceApi) {
          let responseText = "";
          try {
            responseText = (await response.clone().text()).slice(0, traceApi ? 131072 : 8000);
          } catch (_) {}
          const record = {
            transport: "fetch",
            method,
            url,
            headers: safeRequestHeaders(headers),
            ...serialized,
            status: Number(response.status || 0),
            responseText
          };
          if (traceApi) appendApiTrace(record);
          if (capture) emitSaveCapture(record);
        }
        return response;
      };
    }
  }

  installSaveRequestCapture();

  // ---------------------------------------------------------------------------
  // Sơ đồ phòng (danh sách khu + phòng) do website trả về.
  //
  // Hình dạng: { code, Tag: [ { id, name, items: [ { id, name, DKHUVUCID,
  // trangThai, gio, quay, ... } ] } ] }. item.id chính là DBANID của phiếu lập
  // trên phòng đó; trangThai 0 và gio rỗng là phòng trống. Không suy đoán
  // endpoint: bridge bắt đúng response website tự tải rồi nhớ request đó.
  // ---------------------------------------------------------------------------
  const ROOM_MAP_TEXT_LIMIT = 2 * 1024 * 1024;
  let roomMapCapture = null;

  function isSameOriginRequest(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (_) { return false; }
  }

  function looksLikeRoomMapText(text) {
    return typeof text === "string" &&
      text.includes('"DKHUVUCID"') &&
      text.includes('"trangThai"') &&
      text.includes('"items"');
  }

  function parseRoomMapPayload(payload) {
    const areas = Array.isArray(payload?.Tag) ? payload.Tag : null;
    if (!areas || !areas.length) return null;
    const parsed = areas
      .filter(area => area && typeof area === "object" && Array.isArray(area.items))
      .map(area => ({
        id: String(area.id || ""),
        name: String(area.name || "").trim(),
        rooms: area.items
          .filter(item => item && typeof item === "object" && ("DKHUVUCID" in item || "trangThai" in item))
          .map(item => ({
            id: String(item.id || ""),
            name: String(item.name || "").trim(),
            areaId: String(item.DKHUVUCID || ""),
            areaName: String(area.name || "").trim(),
            status: Number(item.trangThai) || 0,
            gio: String(item.gio || "").trim(),
            counter: Number(item.quay) || 0,
            isTable: Number(item.isTable) || 0
          }))
      }))
      .filter(area => area.rooms.length);
    if (!parsed.length) return null;
    return { areas: parsed, rooms: parsed.flatMap(area => area.rooms) };
  }

  function captureRoomMapResponse(meta, body, status, responseText) {
    if (!looksLikeRoomMapText(responseText)) return;
    let payload;
    try { payload = JSON.parse(responseText); } catch (_) { return; }
    const parsed = parseRoomMapPayload(payload);
    if (!parsed) return;
    roomMapCapture = {
      method: String(meta?.method || "GET"),
      url: new URL(meta?.url || location.href, location.href).href,
      headers: safeRequestHeaders(meta?.headers || {}),
      ...serializeRequestBody(body),
      status: Number(status || 0),
      source: "captured",
      capturedAt: new Date().toISOString(),
      ...parsed
    };
  }

  function rebuildRequestBody(capture) {
    if (!capture) return null;
    if (capture.bodyType === "formdata") {
      const form = new FormData();
      for (const entry of capture.body || []) {
        if (Array.isArray(entry) && typeof entry[1] === "string") form.append(entry[0], entry[1]);
      }
      return form;
    }
    if (["text", "urlencoded"].includes(capture.bodyType)) return String(capture.body || "");
    return null;
  }

  // Endpoint sơ đồ phòng đã xác nhận từ Network (Paris Nhơn, 16/09/2026):
  //   POST /<cơ sở>/Khuvuccontrol/LayDanhSachBan?is_ajax=1
  //   body {"DKHUVUCID":"_ALL_","UITHIETKE":0,"MODE":0}
  // "_ALL_" là mã khu "TẤT CẢ" (trùng id nút trên sơ đồ) nên trả đủ mọi khu.
  // Đường dẫn lấy theo cơ sở của trang hiện tại, cookie phiên tự đi kèm.
  const ROOM_MAP_ENDPOINT = "Khuvuccontrol/LayDanhSachBan?is_ajax=1";
  const ROOM_MAP_REQUEST_BODY = Object.freeze({ DKHUVUCID: "_ALL_", UITHIETKE: 0, MODE: 0 });

  async function fetchRoomMapDirect() {
    const endpoint = `${location.origin}/${shopBasePath()}/${ROOM_MAP_ENDPOINT}`;
    const response = await fetchForRead(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/json;utf-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(ROOM_MAP_REQUEST_BODY)
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) throw new Error(`Website tu choi so do phong (HTTP ${response.status}).`);
    if (isLoginRedirect(response, responseText)) {
      throw new Error("Phien dang nhap da het hoac bi co so khac chiem khi doc so do phong.");
    }
    let payload = null;
    try { payload = JSON.parse(responseText); } catch (_) {}
    if (payload && Number(payload.code) !== 1) {
      throw new Error(`Website tra loi so do phong: ${String(payload.message || payload.code || "khong ro")}`);
    }
    const parsed = parseRoomMapPayload(payload);
    if (!parsed) throw new Error("Phan hoi so do phong khong dung hinh dang mong doi.");
    return { url: endpoint, ...parsed };
  }

  // Thứ tự ưu tiên: gọi thẳng endpoint đã xác nhận → gọi lại request website
  // đã dùng (bắt thụ động) → bản đã bắt (đủ danh sách phòng, trạng thái có
  // thể cũ). Không có nguồn nào thì trả available=false để content rơi về
  // cách quét thẻ trên trang.
  async function getRoomMap(options = {}) {
    if (options.refresh) {
      try {
        const direct = await fetchRoomMapDirect();
        roomMapCapture = {
          ...(roomMapCapture || {}),
          ...direct,
          method: "POST",
          source: "direct",
          capturedAt: new Date().toISOString(),
          refreshed: true
        };
      } catch (error) {
        console.warn("[InvoiceTarget bridge] Khong goi thang duoc so do phong; thu goi lai request da bat.", error);
        if (roomMapCapture?.url && roomMapCapture.source !== "direct") {
          try {
            const init = { method: roomMapCapture.method, credentials: "same-origin", headers: { ...roomMapCapture.headers } };
            const body = rebuildRequestBody(roomMapCapture);
            if (body != null && !/^(GET|HEAD)$/i.test(init.method)) init.body = body;
            const response = await window.fetch(roomMapCapture.url, init);
            const parsed = parseRoomMapPayload(JSON.parse(await response.clone().text()));
            if (parsed) roomMapCapture = { ...roomMapCapture, ...parsed, capturedAt: new Date().toISOString(), refreshed: true };
          } catch (replayError) {
            console.warn("[InvoiceTarget bridge] Khong goi lai duoc so do phong; dung ban da bat.", replayError);
          }
        }
      }
    }
    if (!roomMapCapture) return { available: false, reason: "not-captured", areas: [], rooms: [] };
    return {
      available: true,
      source: roomMapCapture.source || "captured",
      capturedAt: roomMapCapture.capturedAt,
      refreshed: Boolean(roomMapCapture.refreshed),
      url: roomMapCapture.url,
      areas: roomMapCapture.areas,
      rooms: roomMapCapture.rooms
    };
  }

  // Phòng/kho của form phiếu đang mở, để đối chiếu với phòng đã chọn trước khi
  // gửi API tạo phiếu. Không có form thì trả rỗng, không ném lỗi.
  function getOpenFormRoom() {
    try {
      const formData = currentFormData({ allowBlankRecordId: true });
      const fields = mapObject(formData?.mapper?.Maps);
      return {
        roomId: String(fields.DBANID || "").trim(),
        areaId: String(fields.DKHUVUCID || "").trim(),
        warehouseId: String(fields.DKHOXUATID || "").trim(),
        recordId: String(formDataRecordId(formData) || "").trim(),
        // Đơn giá giờ ghi trên phiếu (0 = chưa có): website tính Tiền giờ của
        // phiếu theo số này, kể cả khi phòng đã đổi giá sau đó.
        hourlyRate: formAmount(fields.DONGIA)
      };
    } catch (_) {
      return { roomId: "", areaId: "", warehouseId: "", recordId: "", hourlyRate: 0 };
    }
  }

  function suffixInput(prefix) {
    const pattern = new RegExp(`^${prefix}\\d+$`);
    const candidates = Array.from(document.querySelectorAll(`[id^="${prefix}"]`)).filter(el => pattern.test(el.id));
    return candidates.find(isVisible) || candidates.reverse().find(input => input.isConnected) || null;
  }

  function isVisible(element) {
    if (!element || !element.isConnected) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return false;
    const windowNode = element.closest(".k-window, [role='dialog']");
    if (!windowNode) return true;
    const windowStyle = getComputedStyle(windowNode);
    const windowRect = windowNode.getBoundingClientRect();
    return !windowNode.hidden && windowNode.getAttribute("aria-hidden") !== "true" && windowStyle.display !== "none" && windowStyle.visibility !== "hidden" && windowRect.width > 0 && windowRect.height > 0;
  }

  function isLayoutVisible(element) {
    if (!element || !element.isConnected) return false;
    const view = element.ownerDocument?.defaultView || window;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return !element.hidden &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function valueOf(prefix) {
    const input = suffixInput(prefix);
    return input ? money(input.value) : 0;
  }

  function normalizeDateKey(value) {
    const text = String(value || "").trim();
    let match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
    match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (match) return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
    return "";
  }

  function parseDateTime(value) {
    const text = String(value || "").trim();
    let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s+(\d{1,2}):(\d{2})/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]));
    match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
    return null;
  }

  function invoiceFormScope() {
    const totalInput = suffixInput("numTONGCONG");
    if (!totalInput) return document;
    return totalInput.closest('[role="dialog"],.k-window-content,.ui-dialog-content,form') || document;
  }

  function findInvoiceTimes() {
    const inputs = Array.from(invoiceFormScope().querySelectorAll("input"))
      .filter(input => isVisible(input) && parseDateTime(input.value));
    if (inputs.length < 2) return { checkIn: "", checkOut: "", durationMinutes: 0 };
    const checkInInput = inputs.find(input => /GIOVAO|NGAYVAO|CHECKIN|START/i.test(`${input.id} ${input.name}`)) || inputs[0];
    const remaining = inputs.filter(input => input !== checkInInput);
    const checkOutInput = remaining.find(input => /GIORA|NGAYRA|CHECKOUT|END/i.test(`${input.id} ${input.name}`)) || remaining[0];
    const checkInDate = parseDateTime(checkInInput.value);
    const checkOutDate = parseDateTime(checkOutInput.value);
    return {
      checkIn: checkInInput.value,
      checkOut: checkOutInput.value,
      durationMinutes: checkInDate && checkOutDate ? Math.max(0, (checkOutDate - checkInDate) / 60000) : 0
    };
  }

  function applyCheckOut(value) {
    const targetDate = parseDateTime(value);
    if (!targetDate) throw new Error("Giờ ra đề xuất không hợp lệ.");
    const inputs = Array.from(document.querySelectorAll("input")).filter(input => isVisible(input) && parseDateTime(input.value));
    if (inputs.length < 2) throw new Error("Không tìm thấy ô giờ ra đang hiển thị.");
    const checkInInput = inputs.find(input => /GIOVAO|NGAYVAO|CHECKIN|START/i.test(`${input.id} ${input.name}`)) || inputs[0];
    const remaining = inputs.filter(input => input !== checkInInput);
    const checkOutInput = remaining.find(input => /GIORA|NGAYRA|CHECKOUT|END/i.test(`${input.id} ${input.name}`)) || remaining[0];
    const jq = window.jQuery || window.$;
    const picker = jq ? jq(checkOutInput).data("kendoDateTimePicker") : null;
    if (picker?.value) {
      picker.value(targetDate);
      if (typeof picker.trigger === "function") picker.trigger("change");
    }
    setNativeValue(checkOutInput, value);
    checkOutInput.dispatchEvent(new Event("blur", { bubbles: true }));
    return { checkOut: checkOutInput.value };
  }

  // keepCheckIn = true: chi ghi gio ra, giu nguyen gio vao dang co tren phieu.
  // Dung cho phieu DA TON TAI - gio vao la du lieu that cua khach, khong duoc sua.
  function applyInvoiceTimes(checkInValue, checkOutValue, keepCheckIn) {
    const checkOutDate = parseDateTime(checkOutValue);
    if (!checkOutDate) throw new Error("Gio ra cua phuong an khong hop le.");
    const inputs = Array.from(document.querySelectorAll("input")).filter(input => isVisible(input) && parseDateTime(input.value));
    if (inputs.length < 2) throw new Error("Khong tim thay o gio vao/ra dang hien thi.");
    const checkInInput = inputs.find(input => /GIOVAO|NGAYVAO|CHECKIN|START/i.test(`${input.id} ${input.name}`)) || inputs[0];
    const remaining = inputs.filter(input => input !== checkInInput);
    const checkOutInput = remaining.find(input => /GIORA|NGAYRA|CHECKOUT|END/i.test(`${input.id} ${input.name}`)) || remaining[0];
    // Voi phieu da ton tai, gio vao dung de doi chieu la gio dang co tren form
    // chu khong phai gio trong phuong an.
    const effectiveCheckIn = keepCheckIn ? parseDateTime(checkInInput.value) : parseDateTime(checkInValue);
    if (!effectiveCheckIn) throw new Error("Khong doc duoc gio vao cua phieu.");
    if (checkOutDate < effectiveCheckIn) {
      throw new Error("Gio ra khong duoc som hon gio vao cua phieu.");
    }
    const jq = window.jQuery || window.$;
    const applyValue = (input, date, text) => {
      const picker = jq ? jq(input).data("kendoDateTimePicker") : null;
      if (picker?.value) {
        picker.value(date);
        if (typeof picker.trigger === "function") picker.trigger("change");
      }
      setNativeValue(input, text);
      input.dispatchEvent(new Event("blur", { bubbles: true }));
    };
    if (!keepCheckIn) applyValue(checkInInput, effectiveCheckIn, checkInValue);
    applyValue(checkOutInput, checkOutDate, checkOutValue);
    return { checkIn: checkInInput.value, checkOut: checkOutInput.value, keptCheckIn: Boolean(keepCheckIn) };
  }

  function applyHourAmount(value) {
    const amount = Math.max(0, Math.round(Number(value) || 0));
    const input = suffixInput("numTIENGIO");
    if (!input) throw new Error("Khong tim thay o Tien gio dang hien thi.");
    const wasReadOnly = input.readOnly;
    input.readOnly = false;
    setNativeValue(input, String(amount));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.readOnly = wasReadOnly;
    return { hourAmount: money(input.value) };
  }

  function visibleInvoiceTotalInput() {
    const pattern = /^numTONGCONG\d+$/;
    return Array.from(document.querySelectorAll('[id^="numTONGCONG"]'))
      .find(input => pattern.test(input.id) && isVisible(input)) || null;
  }

  function invoiceUiState() {
    const detailInput = visibleInvoiceTotalInput();
    const list = invoiceListElement();
    return {
      detailVisible: Boolean(detailInput),
      detailTotalId: detailInput?.id || "",
      listVisible: Boolean(list && isVisible(list))
    };
  }

  async function waitForInvoiceDetailClosed(timeout = 2500) {
    const deadline = Date.now() + timeout;
    let state = invoiceUiState();
    while (state.detailVisible && Date.now() < deadline) {
      await wait(100);
      state = invoiceUiState();
    }
    return state;
  }

  async function closeInvoiceDetail() {
    const button = Array.from(document.querySelectorAll('button[id^="btnThoat"]')).find(isVisible);
    const initialState = invoiceUiState();
    if (!initialState.detailVisible) {
      return { closed: true, method: "already-closed", ...initialState };
    }
    if (!button) return { closed: false, method: "button-not-found", ...initialState };
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    try {
      button.click();
      let state = await waitForInvoiceDetailClosed();
      let method = "button-click";
      if (state.detailVisible) {
        const invoked = invokeRunnerHandler([
          /^btnThoat_Click$/i,
          /btnThoat.*Click/i,
          /Thoat.*Click/i,
          /Exit.*Click/i
        ], { sender: button, target: button });
        if (invoked) {
          method = "runner-handler";
          state = await waitForInvoiceDetailClosed();
        }
      }
      return {
        closed: !state.detailVisible,
        method,
        suppressedAlerts,
        ...state
      };
    } finally {
      window.alert = originalAlert;
    }
  }

  function setNumericAmount(prefix, value) {
    const input = suffixInput(prefix);
    if (!input) throw new Error(`Khong tim thay o ${prefix}.`);
    const amount = Math.round(Number(value) || 0);
    const wasReadOnly = input.readOnly;
    input.readOnly = false;
    const jq = window.jQuery || window.$;
    const widget = jq ? jq(input).data("kendoNumericTextBox") : null;
    if (widget?.value) {
      widget.value(amount);
      if (typeof widget.trigger === "function") widget.trigger("change");
    }
    setNativeValue(input, String(amount));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.readOnly = wasReadOnly;
    return money(input.value);
  }

  function shouldTraceApiRequest(method, url) {
    if (Date.now() > apiTraceArmedUntil) return false;
    try {
      const target = new URL(url, location.href);
      return target.origin === location.origin &&
        /^(GET|POST|PUT|PATCH)$/i.test(String(method || "")) &&
        /(AddEdit|GetDataSearchData|LayDuLieu|GridLookupData|KiemTra|DoSave)/i.test(target.pathname);
    } catch (_) {
      return false;
    }
  }

  function appendApiTrace(record) {
    apiTraceRecords.push({
      ...record,
      url: new URL(record.url, location.href).href,
      capturedAt: new Date().toISOString()
    });
    if (apiTraceRecords.length > 200) apiTraceRecords.splice(0, apiTraceRecords.length - 200);
  }

  function armApiTrace() {
    apiTraceRecords.splice(0, apiTraceRecords.length);
    apiTraceArmedUntil = Date.now() + 10 * 60 * 1000;
    return { armed: true, expiresAt: new Date(apiTraceArmedUntil).toISOString() };
  }

  function getApiTrace() {
    return {
      armed: Date.now() <= apiTraceArmedUntil,
      expiresAt: apiTraceArmedUntil ? new Date(apiTraceArmedUntil).toISOString() : "",
      page: location.href,
      records: apiTraceRecords.map(record => ({ ...record }))
    };
  }

  function normalizeProductLabel(value) {
    return String(value || "").normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, match => match === "đ" ? "d" : "D")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }

  const PRODUCT_TABLE_ID_FOR_CREATE = "c07a4b54-e177-40d9-b077-c140fd4641d9";

  function productFormDataFromHtml(source) {
    const text = String(source || "");
    const tableAt = text.indexOf(PRODUCT_TABLE_ID_FOR_CREATE);
    if (tableAt < 0) return null;
    const marker = text.lastIndexOf("new DataTransferJs(", tableAt);
    if (marker < 0) return null;
    const formData = extractJsonObject(text, marker);
    return formData && String(formData._AddEditTableID) === PRODUCT_TABLE_ID_FOR_CREATE ? formData : null;
  }

  function productFormDataFromDocument() {
    const scripts = Array.from(document.scripts).map(script => script.textContent || "").reverse();
    for (const source of scripts) {
      const formData = productFormDataFromHtml(source);
      if (formData) return formData;
    }
    return null;
  }

  async function loadProductCreateFormData() {
    const current = productFormDataFromDocument();
    if (current) return current;
    const base = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
    const query = new URLSearchParams({
      TableID: PRODUCT_TABLE_ID_FOR_CREATE,
      RecordID: "",
      Loai: "-1",
      MaxTab: "0",
      NOTITLE: "1",
      is_dialog: "1"
    });
    const response = await fetchForRead(`${location.origin}/${base}/AddEdit?${query}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    const html = await response.text();
    if (!response.ok) throw new Error(`Khong tai duoc mau tao mat hang (HTTP ${response.status}).`);
    const formData = productFormDataFromHtml(html);
    if (!formData) throw new Error("Website da doi mau form mat hang; khong doc duoc DataTransferJs.");
    return formData;
  }

  function productLookupId(formData, controlPrefix, labelOrValue) {
    const wanted = normalizeProductLabel(labelOrValue);
    const control = Object.entries(formData || {}).find(([key, value]) =>
      key.startsWith(controlPrefix) && Array.isArray(value?.LookupData)
    )?.[1];
    const item = (control?.LookupData || []).find(row =>
      String(row.ID) === String(labelOrValue) || normalizeProductLabel(row.NAME) === wanted
    );
    if (!item) throw new Error(`Khong tim thay "${labelOrValue}" trong ${controlPrefix}.`);
    return String(item.ID);
  }

  async function createProductViaApi(product) {
    const data = product || {};
    const webCode = String(data.webCode || "").trim();
    const name = String(data.name || "").trim();
    const price = Math.round(Number(data.price) || 0);
    if (!webCode || !name || price <= 0) throw new Error("Ma web, ten va gia ban la bat buoc.");
    const formData = await loadProductCreateFormData();
    const unitId = productLookupId(formData, "lueDDONVITINHID", data.unit || "goi");
    const groupId = productLookupId(formData, "lueDNHOMMATHANGID", data.group || "DOKHO");
    // Dung ID on dinh thay vi ten hien thi de khong phu thuoc encoding.
    const typeId = productLookupId(formData, "lueDLOAIMATHANGID", data.typeId ?? data.type ?? "0");
    const required = (formData.mapper?.Maps || []).filter(map => map.AllowEmpty === false);
    const knownRequired = new Set(["CODE", "NAME", "DDONVITINHID", "DNHOMMATHANGID"]);
    const unsupported = required.filter(map => !knownRequired.has(String(map.Field || "").toUpperCase()));
    if (unsupported.length) {
      throw new Error(`Form co them truong bat buoc: ${unsupported.map(map => map.Field).join(", ")}.`);
    }
    const maps = setMapValues(formData.mapper?.Maps, {
      CODE: webCode,
      NAME: name,
      DDONVITINHID: unitId,
      DNHOMMATHANGID: groupId,
      DLOAIMATHANGID: typeId,
      GIABAN: price,
      GIANHAP: Math.max(0, Math.round(Number(data.costPrice) || 0)),
      NOTE: String(data.note || "Tao tu anh xa kho Invoice Target").slice(0, 255),
      TAMKHOA: 0,
      THUEMACDINH: Math.max(0, Number(data.taxRate) || 0)
    });
    const payload = {
      mode: 0,
      clientMap: {
        TableID: PRODUCT_TABLE_ID_FOR_CREATE,
        ID: "",
        Maps: maps,
        Grids: [],
        CustomPostTable: [],
        CustomPost: {}
      },
      TableID: PRODUCT_TABLE_ID_FOR_CREATE,
      ID: "",
      Loai: Number.isFinite(Number(formData.Loai)) ? Number(formData.Loai) : -1
    };
    const result = await postDoSavePayload(payload);
    return {
      created: true,
      id: String(result.body?.Tag?.ID || ""),
      webCode,
      name,
      unit: String(data.unit || ""),
      group: String(data.group || ""),
      type: String(data.type || "Mat hang kiem vat tu"),
      price,
      httpStatus: result.httpStatus,
      endpoint: result.endpoint
    };
  }

  // Dùng ở bước cuối trước Batch API: chỉ đồng bộ giá trị hiển thị/Kendo mà
  // không phát change/blur, vì các event đó khiến website tính lại VAT theo
  // (tiền hàng + tiền giờ) và ghi đè công thức VAT theo sao kê của kế toán.
  function setNumericAmountQuiet(prefix, value) {
    const input = suffixInput(prefix);
    if (!input) throw new Error(`Khong tim thay o ${prefix}.`);
    const amount = Math.round(Number(value) || 0);
    const jq = window.jQuery || window.$;
    const widget = jq ? jq(input).data("kendoNumericTextBox") : null;
    if (widget?.value) widget.value(amount);
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, String(amount));
    else input.value = String(amount);
    return money(input.value);
  }

  function captureInvoiceFormState() {
    const anchor = suffixInput("numTONGCONG");
    const root = anchor?.closest(".k-window, [role='dialog']") || anchor?.parentElement?.parentElement || document;
    return Array.from(root.querySelectorAll("input[id]")).map(input => ({
      id: input.id,
      value: input.value,
      checked: input.checked
    }));
  }

  function restoreInvoiceFormState(state) {
    (state || []).forEach(saved => {
      const input = document.getElementById(saved.id);
      if (!input) return;
      const jq = window.jQuery || window.$;
      const widgets = jq ? [
        jq(input).data("kendoDateTimePicker"),
        jq(input).data("kendoDatePicker"),
        jq(input).data("kendoTimePicker"),
        jq(input).data("kendoNumericTextBox")
      ].filter(Boolean) : [];
      widgets.forEach(widget => {
        if (typeof widget.value !== "function") return;
        try {
          if (/Date|Time/.test(widget.options?.name || "")) {
            const parsed = parseDateTime(saved.value);
            if (parsed) widget.value(parsed);
          } else {
            widget.value(saved.value);
          }
        } catch (_) {
          // Kendo can expose a widget object before its input is initialized.
          // The native input value below is sufficient for these fields.
        }
      });
      setNativeValue(input, saved.value);
      if (input.type === "checkbox" || input.type === "radio") input.checked = saved.checked;
    });
  }

  function applyInvoiceTotals(targetGrand, targetGoods) {
    const found = invoiceGrid();
    const requestedGoods = Math.round(Number(targetGoods) || 0);
    const rows = found?.grid ? Array.from(found.grid.dataSource.data() || []) : [];
    const goods = requestedGoods || rows.reduce((sum, row) => {
      const qty = money(objectValue(row, found.fields.qty));
      const price = money(objectValue(row, found.fields.price));
      return sum + qty * price;
    }, 0);
    if (!goods) throw new Error("Khong xac dinh duoc tong tien hang.");
    const hour = valueOf("numTIENGIO");
    const grandTarget = Math.round(Number(targetGrand) || 0);
    const tax = grandTarget > 0
      ? grandTarget - goods - hour
      : Math.round((goods + hour) * (valueOf("numTILETHUE") || 10) / 100);
    if (tax < 0) throw new Error("Tong muc tieu nho hon tien hang va tien gio.");

    setNumericAmount("numTILEGIAMGIA", 0);
    setNumericAmount("numTIENGIAMGIA", 0);
    setNumericAmount("numTILEGIAMGIAGIO", 0);
    setNumericAmount("numTIENGIAMGIAGIO", 0);
    setNumericAmount("numTIENHANG", goods);
    setNumericAmount("numTILETHUE", 10);
    setNumericAmount("numTIENTHUE", tax);
    setNumericAmount("numTONGCONG", grandTarget || goods + hour + tax);
    return { goods, hour, tax, grand: valueOf("numTONGCONG") };
  }

  function dialogControlText(control) {
    return String(
      control?.innerText ||
      control?.textContent ||
      control?.value ||
      control?.getAttribute?.("value") ||
      ""
    ).replace(/\s+/g, " ").trim();
  }

  function dialogControls(node) {
    if (!node) return [];
    return Array.from(node.querySelectorAll("button,input[type='button'],input[type='submit'],a"));
  }

  function isTransientQuantityDialog(node) {
    if (!node) return false;
    const controls = dialogControls(node);
    const labels = controls.map(dialogControlText);
    const digitCount = new Set(labels.filter(label => /^\d$/.test(label))).size;
    return digitCount >= 10 &&
      labels.includes("H\u1ee7y b\u1ecf") &&
      labels.includes("Ch\u1ea5p nh\u1eadn");
  }

  function dialogZIndex(node) {
    if (!node) return 0;
    const view = node.ownerDocument?.defaultView || window;
    const parsed = Number.parseInt(view.getComputedStyle(node).zIndex, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function transientQuantityDialogs() {
    const roots = Array.from(document.querySelectorAll(
      ".k-window,.k-dialog,[role='dialog'],.ui-dialog,.modal,.RadWindow,.rwWindow"
    ));
    const controls = Array.from(document.querySelectorAll(
      "button,input[type='button'],input[type='submit'],a"
    )).filter(control => ["H\u1ee7y b\u1ecf", "Ch\u1ea5p nh\u1eadn"].includes(dialogControlText(control)));

    controls.forEach(control => {
      let ancestor = control.parentElement;
      for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
        if (isTransientQuantityDialog(ancestor)) {
          roots.push(ancestor);
          break;
        }
      }
    });

    return [...new Set(roots)]
      .filter(node => isLayoutVisible(node) && isTransientQuantityDialog(node))
      // This website incorrectly leaves aria-hidden="true" on the keyboard
      // that is still painted. Kendo also keeps older copies at full size, so
      // the most recently opened/highest z-index dialog is the active one.
      .sort((left, right) =>
        dialogZIndex(right) - dialogZIndex(left) ||
        dialogControls(left).length - dialogControls(right).length
      );
  }

  async function closeTransientQuantityDialogs(maxWaitMs = 1800) {
    const deadline = Date.now() + maxWaitMs;
    let closed = 0;
    while (Date.now() < deadline) {
      const dialog = transientQuantityDialogs()[0];
      if (!dialog) {
        if (closed > 0) return closed;
        await wait(100);
        continue;
      }
      const cancelButton = dialogControls(dialog)
        .find(control =>
          isLayoutVisible(control) &&
          dialogControlText(control) === "H\u1ee7y b\u1ecf"
        );
      if (!cancelButton) {
        await wait(100);
        continue;
      }

      // ButtonJs.click() does not consistently call its generated handler.
      // Close the exact Kendo widget that owns this keyboard first. Calling the
      // global CodeRunner can target a newer/older nested dialog instead.
      const dialogWindow = dialog.ownerDocument?.defaultView || window;
      const jq = dialogWindow.jQuery || dialogWindow.$;
      const widgetNodes = [
        dialog,
        ...Array.from(dialog.querySelectorAll?.(
          "[data-role='dialog'],.k-window-content,.k-content"
        ) || [])
      ];
      const widget = jq
        ? widgetNodes.map(node =>
            jq(node).data("kendoDialog") ||
            jq(node).data("kendoWindow")
          ).find(Boolean)
        : null;
      if (widget && typeof widget.close === "function") {
        widget.close();
      } else {
        const invoked = invokeRunnerHandler([
          /^btnCancel_Click$/i,
          /btnCancel.*Click/i,
          /Cancel.*Click/i
        ]);
        if (!invoked) cancelButton.click();
      }

      await wait(150);
      if (!dialog.isConnected || !isLayoutVisible(dialog)) {
        closed += 1;
        // Multiple keyboard dialogs can remain painted on top of one another
        // after adding several products. Close every copy, newest first.
        continue;
      }

      // Last-resort DOM click if the Kendo close event was prevented.
      cancelButton.click();
      await wait(150);
      if (!dialog.isConnected || !isLayoutVisible(dialog)) {
        closed += 1;
        continue;
      }
      break;
    }
    return closed;
  }

  function visiblePaymentDialog() {
    const dialogs = Array.from(document.querySelectorAll(
      ".k-window,.k-dialog,[role='dialog'],.ui-dialog,.modal"
    )).filter(isLayoutVisible);
    return dialogs
      .filter(dialog => {
        const text = normalizedVietnameseText(dialog.innerText || "");
        return text.includes("LUU HOA DON") &&
          text.includes("TONG TIEN") &&
          text.includes("TIEN MAT") &&
          text.includes("TIEN THANH TOAN") &&
          dialogControls(dialog).some(control =>
            ["LUU IN", "LUU THOAT"].includes(normalizedVietnameseText(dialogControlText(control)))
          );
      })
      .sort((left, right) => dialogZIndex(right) - dialogZIndex(left))[0] || null;
  }

  function paymentDialogInputs(dialog) {
    return Array.from(dialog?.querySelectorAll("input") || [])
      .filter(input => input.type !== "hidden" && isLayoutVisible(input));
  }

  function setPaymentInput(input, amount) {
    if (!input) return;
    const wasDisabled = input.disabled;
    const wasReadOnly = input.readOnly;
    input.disabled = false;
    input.readOnly = false;
    const jq = window.jQuery || window.$;
    const numeric = jq ? jq(input).data("kendoNumericTextBox") : null;
    if (numeric?.value) {
      numeric.value(amount);
      if (typeof numeric.trigger === "function") numeric.trigger("change");
    }
    setNativeValue(input, String(amount));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    input.readOnly = wasReadOnly;
    input.disabled = wasDisabled;
  }

  function normalizePaymentDialog() {
    const dialog = visiblePaymentDialog();
    if (!dialog) return { ready: false, reason: "payment-dialog-not-open" };
    saveCaptureArmedUntil = Date.now() + 2 * 60 * 1000;
    const inputs = paymentDialogInputs(dialog);
    if (inputs.length < 5) {
      return { ready: false, reason: "payment-dialog-fields-missing", fieldCount: inputs.length };
    }

    // Website order: Tổng tiền, Tiền mặt, Khách đưa, Tiền thanh toán, Trả lại.
    const [grandInput, cashInput, customerInput, paidInput, changeInput] = inputs;
    const grand = money(grandInput.value);
    if (grand <= 0) return { ready: false, reason: "payment-grand-invalid", grand };

    // TIỀN MẶT is the editable source field on this website. Dispatch its
    // native/Kendo events first so website formulas can update dependent fields.
    setPaymentInput(cashInput, grand);
    if (money(customerInput.value) !== grand) setPaymentInput(customerInput, grand);
    if (money(paidInput.value) !== grand) setPaymentInput(paidInput, grand);
    if (money(changeInput.value) !== 0) setPaymentInput(changeInput, 0);

    const result = {
      ready: true,
      grand,
      cash: money(cashInput.value),
      customer: money(customerInput.value),
      paid: money(paidInput.value),
      change: money(changeInput.value)
    };
    result.ready = result.cash === grand &&
      result.customer === grand &&
      result.paid === grand &&
      result.change === 0;
    if (!result.ready) result.reason = "payment-values-not-equal";
    return result;
  }

  let paymentDialogSyncTimer = 0;
  function schedulePaymentDialogSync() {
    clearTimeout(paymentDialogSyncTimer);
    paymentDialogSyncTimer = window.setTimeout(() => {
      try {
        normalizePaymentDialog();
      } catch (error) {
        console.error("[InvoiceTarget payment]", error);
      }
    }, 50);
  }

  // Normalize immediately when the website opens its save dialog. Recheck in
  // capture phase before either official save button can submit the request.
  new MutationObserver(schedulePaymentDialogSync).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  document.addEventListener("click", event => {
    const button = event.target?.closest?.("button,input[type='button'],input[type='submit']");
    if (!button || !["LUU IN", "LUU THOAT"].includes(normalizedVietnameseText(dialogControlText(button)))) return;
    const result = normalizePaymentDialog();
    if (!result.ready) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.dispatchEvent(new CustomEvent(SAVE_BLOCKED, {
        detail: { reason: "Tiền mặt chưa khớp Tổng tiền. Extension đã chặn lưu để tránh sai hóa đơn." }
      }));
    }
  }, true);

  async function applyInvoicePlan(detail) {
    await closeTransientQuantityDialogs(500);
    try {
      // Gio ra PHAI duoc ghi moi khi phuong an de xuat gio khac gio dang co tren
      // form. Truoc day chi ghi khi sessionRebased, nen phieu da ton tai giu
      // nguyen gio cu trong khi Tien gio da doi: ca that o Nhon 01/07/2026,
      // phieu HD0126070003 giu 18:06 -> 19:33 (87 phut) du phuong an la 16 phut
      // / 108.000d. Website tinh Tien gio TU gio vao/ra nen khi luu no tinh lai
      // theo 87 phut va phieu lech tong. Phan tinh toan da duoc sua tu truoc
      // (plan.checkOut luon khop Tien gio), nhung phan GHI van bi khoa lai day.
      //
      // Phieu da ton tai: keepCheckIn = true, gio vao la du lieu that cua khach
      // nen khong duoc sua; chi phieu moi (sessionRebased) moi duoc dat ca hai.
      if (detail?.checkOut) {
        const currentCheckOut = findInvoiceTimes()?.checkOut || "";
        if (String(detail.checkOut).trim() !== String(currentCheckOut).trim()) {
          applyInvoiceTimes(detail.checkIn, detail.checkOut, !detail.sessionRebased);
          await wait(500);
        }
      }
      const preservedFormState = captureInvoiceFormState();
      const replaced = await replaceInvoiceItems(detail.items || []);
      restoreInvoiceFormState(preservedFormState);
      applyHourAmount(detail.finalHourAmount);
      const totals = applyInvoiceTotals(detail.targetGrand, detail.targetGoods);
      const deadline = Date.now() + 2000;
      let totalPresent = false;
      while (Date.now() < deadline) {
        await wait(200);
        if (suffixInput("numTONGCONG")?.value) {
          totalPresent = true;
          break;
        }
      }
      if (!totalPresent) {
        throw new Error("Website da reset phan thong tin phieu; chua duoc bam Luu HD.");
      }
      const closedInputDialogs = await closeTransientQuantityDialogs();
      // Kendo tinh lai cac o tien bat dong bo sau moi lan blur, nen gia tri doc
      // ngay trong applyInvoiceTotals co the da bi website ghi de. Doc lai tu
      // form SAU khi moi thu on dinh, neu khong doi soat se bao "Sai tong cong"
      // du form thuc te van dung.
      const settled = {
        goods: valueOf("numTIENHANG"),
        hour: valueOf("numTIENGIO"),
        tax: valueOf("numTIENTHUE"),
        grand: valueOf("numTONGCONG")
      };
      // Website co the tinh lai VAT/tong theo cong thuc rieng sau khi blur. Ghi
      // de mot lan roi doc lai; neu van lech thi tra ve so THAT tren form de
      // content.js bao loi dung ban chat thay vi gui request sai.
      const expectedGrand = Math.round(Number(detail.targetGrand) || 0);
      if (expectedGrand > 0 && settled.grand !== expectedGrand) {
        setNumericAmount("numTIENHANG", totals.goods);
        setNumericAmount("numTIENGIO", Math.round(Number(detail.finalHourAmount) || 0));
        setNumericAmount("numTIENTHUE", totals.tax);
        setNumericAmount("numTONGCONG", expectedGrand);
        await wait(400);
        settled.goods = valueOf("numTIENHANG");
        settled.hour = valueOf("numTIENGIO");
        settled.tax = valueOf("numTIENTHUE");
        settled.grand = valueOf("numTONGCONG");
      }
      // Website đã ổn định xong; ghi lớp hiển thị cuối cùng theo đúng payload
      // sắp gửi. Không phát event để tránh công thức VAT mặc định chạy lại.
      if (expectedGrand > 0) {
        const expectedHour = Math.round(Number(detail.finalHourAmount) || 0);
        const expectedTax = Math.round(Number(detail.targetTax) ||
          (expectedGrand - totals.goods - expectedHour));
        setNumericAmountQuiet("numTIENHANG", totals.goods);
        setNumericAmountQuiet("numTIENGIO", expectedHour);
        setNumericAmountQuiet("numTILETHUE", 10);
        setNumericAmountQuiet("numTIENTHUE", expectedTax);
        setNumericAmountQuiet("numTONGCONG", expectedGrand);
        settled.goods = valueOf("numTIENHANG");
        settled.hour = valueOf("numTIENGIO");
        settled.tax = valueOf("numTIENTHUE");
        settled.grand = valueOf("numTONGCONG");
      }
      return {
        ready: true,
        mode: "kendo-atomic",
        closedInputDialogs,
        items: replaced.snapshot.items,
        currentGoods: settled.goods,
        currentHour: settled.hour,
        currentTax: settled.tax,
        taxRate: valueOf("numTILETHUE"),
        currentGrand: settled.grand,
        // Tra ve gio THAT dang co tren form, khong phai gio cua phuong an vua
        // gui xuong. Echo lai detail se noi doi khi viec ghi gio bi bo qua hoac
        // website tu sua lai, va buoc doi soat sau do se so gio cua phuong an
        // voi chinh no nen luon thay khop — dung con duong da che mat loi
        // "luu xong gio khong doi".
        ...(() => {
          const times = findInvoiceTimes();
          return {
            checkIn: times.checkIn || detail.checkIn || "",
            checkOut: times.checkOut || detail.checkOut || ""
          };
        })()
      };
    } catch (error) {
      await closeTransientQuantityDialogs();
      throw error;
    }
  }

  function findInvoiceDate() {
    const inputs = Array.from(invoiceFormScope().querySelectorAll('input'))
      .filter(input => isVisible(input) && normalizeDateKey(input.value));
    if (!inputs.length) return { value: "", key: "" };
    const preferred = inputs.find(input => /GIOVAO|NGAYVAO|CHECKIN|START/i.test(`${input.id} ${input.name}`)) ||
      inputs.find(input => /Giờ vào|Ngay vao|Ngày vào/i.test(input.closest("td,div,label")?.innerText || "")) || inputs[0];
    return { value: preferred.value, key: normalizeDateKey(preferred.value) };
  }

  function objectValue(item, field) {
    if (!item || !field) return undefined;
    if (typeof item.get === "function") return item.get(field);
    return item[field];
  }

  function itemKeys(item) {
    if (!item) return [];
    const raw = typeof item.toJSON === "function" ? item.toJSON() : item;
    return Object.keys(raw || {});
  }

  function findField(keys, patterns) {
    return keys.find(key => patterns.some(pattern => pattern.test(key))) || null;
  }

  function detectFields(item) {
    const keys = itemKeys(item);
    return {
      code: findField(keys, [/^DMATHANG_CODE$/i, /^CODE$/i, /^MAHANG$/i, /MA.*HANG/i, /ITEM.*CODE/i, /PRODUCT.*CODE/i]),
      name: findField(keys, [/^NAME$/i, /^TENHANG$/i, /TEN.*HANG/i, /ITEM.*NAME/i, /PRODUCT.*NAME/i]),
      qty: findField(keys, [/^SLXUATCHUAQUYDOI$/i, /^SLXUAT$/i, /^SOLUONG$/i, /SO.*LUONG/i, /^QTY$/i, /QUANTITY/i]),
      price: findField(keys, [/^DONGIA$/i, /DON.*GIA/i, /GIA.*BAN/i, /^PRICE$/i]),
      unit: findField(keys, [/^DDONVITINH_NAME$/i, /^DVT$/i, /DON.*VI.*TINH/i, /^UNIT$/i])
    };
  }

  // Lưới dòng hàng/danh mục chỉ lấy trong cửa sổ PHIẾU ĐANG MỞ. Màn Hóa đơn điện
  // tử (giao diện 10/2026) có sẵn lưới grDetail cùng cột Mã hàng/Số lượng/Đơn giá
  // nằm trước form trong DOM; duyệt cả trang thì invoiceGrid() lấy nhầm lưới rỗng
  // đó và Lưu API báo "không có dòng hàng mẫu" dù phiếu có hàng.
  function openInvoiceFormContainer() {
    return visibleInvoiceTotalInput()?.closest(".k-window, [role='dialog']") || null;
  }

  function kendoGridElements() {
    const scope = openInvoiceFormContainer() || document;
    return Array.from(scope.querySelectorAll(".k-grid")).filter(isVisible).map(element => {
      const jq = window.jQuery || window.$;
      const grid = jq ? jq(element).data("kendoGrid") : null;
      return { element, grid };
    }).filter(entry => entry.grid && entry.grid.dataSource);
  }

  function invoiceGrid() {
    const candidates = kendoGridElements();
    for (const entry of candidates) {
      const rows = (entry.grid.dataSource.view ? entry.grid.dataSource.view() : null) ||
        (entry.grid.dataSource.data ? entry.grid.dataSource.data() : null) || [];
      const headers = Array.from(entry.element.querySelectorAll("thead th[data-field]"));
      const fieldByTitle = patterns => {
        const header = headers.find(node => patterns.some(pattern =>
          pattern.test(`${node.innerText || ""} ${node.getAttribute("data-title") || ""}`)
        ));
        return header?.getAttribute("data-field") || null;
      };
      const domFields = {
        code: fieldByTitle([/^Mã hàng\b/i, /\bMã hàng\b/i]),
        name: fieldByTitle([/^Tên hàng\b/i, /\bTên hàng\b/i]),
        qty: fieldByTitle([/^Số lượng\b/i, /\bSố lượng\b/i]),
        price: fieldByTitle([/^Đơn giá\b/i, /\bĐơn giá\b/i]),
        unit: fieldByTitle([/^ĐVT\b/i])
      };
      const fieldByName = patterns => headers
        .map(node => node.getAttribute("data-field"))
        .find(field => field && patterns.some(pattern => pattern.test(field))) || null;
      domFields.code = fieldByName([/^DMATHANG_CODE$/i, /^MAHANG$/i, /^CODE$/i]) || domFields.code;
      domFields.name = fieldByName([/^TENHANG$/i, /^NAME$/i]) || domFields.name;
      domFields.qty = fieldByName([/^SLXUATCHUAQUYDOI$/i, /^SLXUAT$/i, /^SOLUONG$/i]) || domFields.qty;
      domFields.price = fieldByName([/^DONGIA$/i, /^GIABAN$/i, /^PRICE$/i]) || domFields.price;
      domFields.unit = fieldByName([/^DDONVITINH_NAME$/i, /^DVT$/i, /^UNIT$/i]) || domFields.unit;
      const data = typeof entry.grid.dataSource.data === "function" ? entry.grid.dataSource.data() : [];
      const sample = rows[0] || data[0] || null;
      const modelFields = sample ? detectFields(sample) : {};
      const fields = {
        code: domFields.code || modelFields.code,
        name: domFields.name || modelFields.name,
        qty: domFields.qty || modelFields.qty,
        price: domFields.price || modelFields.price,
        unit: domFields.unit || modelFields.unit
      };
      if (fields.qty && fields.price && (fields.code || fields.name)) return { grid: entry.grid, fields };
    }
    return null;
  }

  function productGrid() {
    const invoice = invoiceGrid();
    for (const entry of kendoGridElements()) {
      if (entry.grid === invoice?.grid) continue;

      // Product grids on this site expose stable data-field attributes even
      // while the remote DataSource view is temporarily empty.
      const headers = Array.from(entry.element.querySelectorAll("thead th[data-field]"));
      const fieldByTitle = patterns => {
        const header = headers.find(node => patterns.some(pattern =>
          pattern.test(`${node.innerText || ""} ${node.getAttribute("data-title") || ""}`)
        ));
        return header?.getAttribute("data-field") || null;
      };
      const domFields = {
        code: fieldByTitle([/^Mã hàng\b/i, /\bMã hàng\b/i]),
        name: fieldByTitle([/^Tên hàng\b/i, /\bTên hàng\b/i]),
        price: fieldByTitle([/^Giá bán\b/i, /\bGiá bán\b/i]),
        unit: fieldByTitle([/^ĐVT\b/i])
      };

      const view = typeof entry.grid.dataSource.view === "function" ? entry.grid.dataSource.view() : [];
      const data = typeof entry.grid.dataSource.data === "function" ? entry.grid.dataSource.data() : [];
      const sample = view[0] || data[0] || null;
      const modelFields = sample ? detectFields(sample) : {};
      const fields = {
        code: domFields.code || modelFields.code,
        name: domFields.name || modelFields.name,
        price: domFields.price || modelFields.price,
        unit: domFields.unit || modelFields.unit
      };
      if (fields.code && fields.name && fields.price) return { grid: entry.grid, element: entry.element, fields };
    }
    return null;
  }

  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  // Rớt kết nối giữa lô dài ("Failed to fetch") thường chỉ thoáng qua. Request
  // CHỈ ĐỌC được thử lại; request ghi (DoSave, phát hành) KHÔNG đi qua đây vì
  // server có thể đã nhận và thử lại sẽ ghi hai lần.
  const READ_RETRY_DELAYS_MS = [1500, 4000];

  function isNetworkFetchError(error) {
    return error instanceof TypeError && /Failed to fetch|NetworkError|network error|Load failed/i.test(String(error?.message || ""));
  }

  async function fetchForRead(url, init) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await window.fetch(url, init);
      } catch (error) {
        if (!isNetworkFetchError(error)) throw error;
        if (attempt >= READ_RETRY_DELAYS_MS.length) {
          throw new Error(`Mất kết nối tới website (${error.message}) sau ${attempt + 1} lần thử; kiểm tra mạng rồi bấm lại.`);
        }
        await wait(READ_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  function currentCodeRunner() {
    return window.dialogInfo?.client?.get_CodeRunner?.() || null;
  }

  function invokeRunnerHandler(patterns, argument) {
    const runner = currentCodeRunner();
    if (!runner) return false;
    const prototype = Object.getPrototypeOf(runner);
    const names = [...new Set([
      ...Object.getOwnPropertyNames(prototype || {}),
      ...Object.keys(runner)
    ])];
    const name = names.find(candidate =>
      patterns.some(pattern => pattern.test(candidate)) && typeof runner[candidate] === "function"
    );
    if (!name) return false;
    runner[name](argument || {});
    return true;
  }

  function findLoadedProduct(found, code) {
    const dataSource = found?.grid?.dataSource;
    if (!dataSource) return null;
    const target = String(code || "").trim();
    const view = typeof dataSource.view === "function" ? dataSource.view() : [];
    const data = typeof dataSource.data === "function" ? dataSource.data() : [];
    const loaded = [...new Set([...(view || []), ...(data || [])])];
    const codePatterns = [/^DMATHANG_CODE$/i, /^CODE$/i, /^MAHANG$/i, /ITEM.*CODE/i, /PRODUCT.*CODE/i];
    const modelMatch = loaded.find(item => {
      if (String(objectValue(item, found.fields.code) || "").trim() === target) return true;
      return itemKeys(item).some(key =>
        codePatterns.some(pattern => pattern.test(key)) &&
        String(objectValue(item, key) || "").trim() === target
      );
    });
    if (modelMatch) return modelMatch;

    // Some older Kendo builds expose an incomplete model schema while the DOM
    // row is already correct. Resolve the rendered row by code and map its uid
    // back to the official DataSource model instead of rejecting a valid item.
    const domRow = Array.from(found.element?.querySelectorAll("tbody tr[data-uid]") || [])
      .find(row => Array.from(row.children).some(cell => String(cell.textContent || "").trim() === target));
    const uid = domRow?.getAttribute("data-uid") || "";
    return uid && typeof dataSource.getByUid === "function" ? dataSource.getByUid(uid) : null;
  }

  async function filterProduct(found, code) {
    const dataSource = found.grid.dataSource;
    const exact = () => findLoadedProduct(found, code);
    let item = exact();
    if (item) return item;

    // Do not click the website's F3/search button here. On the touch sales
    // screen it opens a full-screen product/keyboard dialog. Repeating that
    // action while assembling an invoice stacks dialogs and interrupts the
    // atomic replace before the old rows are removed.
    //
    // The catalog is small, so resolve the item deterministically by paging the
    // existing remote Kendo DataSource.
    const scope = document;
    const searchInput = Array.from(scope.querySelectorAll("input")).find(input =>
      isVisible(input) && /Tìm kiếm\s*\(F3\)/i.test(input.placeholder || "")
    );
    const actualSearchInput = searchInput || scope.querySelector("[id^='txtSearch'][placeholder*='F3']") ||
      scope.querySelector("[placeholder*='F3']");
    if (!actualSearchInput) throw new Error("Khong tim thay o Tim kiem F3 cua danh muc web.");
    setNativeValue(actualSearchInput, "");
    try {
      const request = dataSource.read();
      if (request && typeof request.then === "function") await request;
    } catch (_error) {
      // Page traversal below has its own bounded polling.
    }

    const deadline = Date.now() + 1800;
    while (Date.now() < deadline) {
      await wait(180);
      item = exact();
      if (item) return item;
    }

    const total = typeof dataSource.total === "function" ? Number(dataSource.total()) : 0;
    const pageSize = typeof dataSource.pageSize === "function" ? Number(dataSource.pageSize()) : 20;
    const totalPages = Math.min(50, Math.max(1, Math.ceil(total / Math.max(1, pageSize))));
    for (let page = 1; page <= totalPages; page += 1) {
      try {
        const pageRequest = dataSource.page(page);
        if (pageRequest && typeof pageRequest.then === "function") await pageRequest;
      } catch (_error) {
        continue;
      }
      const pageDeadline = Date.now() + 2500;
      while (Date.now() < pageDeadline) {
        item = exact();
        if (item) return item;
        await wait(120);
      }
    }
    if (!item) {
      const currentPage = typeof dataSource.page === "function" ? Number(dataSource.page()) : 0;
      throw new Error(`Khong tim thay ma hang ${code} tren danh muc web ` +
        `(tong ${total || 0}, ${totalPages} trang, trang hien tai ${currentPage || "?"}).`);
    }
    return item;
  }

  function clearProductSearch(found) {
    const scope = document;
    const searchInput = Array.from(scope.querySelectorAll("input")).find(input =>
      isVisible(input) && /Tìm kiếm\s*\(F3\)/i.test(input.placeholder || "")
    );
    const searchButton = Array.from(scope.querySelectorAll("button")).find(button =>
      isVisible(button) && /^btnSearch/i.test(button.id || "")
    );
    const actualSearchInput = searchInput || scope.querySelector("[id^='txtSearch'][placeholder*='F3']") ||
      scope.querySelector("[placeholder*='F3']");
    const actualSearchButton = searchButton || scope.querySelector("[id^='btnSearch']");
    if (actualSearchInput && actualSearchButton) {
      setNativeValue(actualSearchInput, "");
    }
  }

  async function addProductThroughWebsite(found, code, qty) {
    const item = await filterProduct(found, code);
    const row = found.grid.tbody?.find?.(`tr[data-uid='${item.uid}']`);
    if (!row?.length) throw new Error(`Khong tim thay dong giao dien cua ma ${code}.`);
    if (typeof found.grid.select === "function") found.grid.select(row);
    const productScope = document;
    const productQtyInput = productScope.querySelector("[id^='numSoLuong']");
    const productAddButton = productScope.querySelector("[id^='btnThem']");
    if (!productQtyInput || !productAddButton) {
      throw new Error(`Khong tim thay dieu khien SL/Them cho ma ${code} (SL=${Boolean(productQtyInput)}, Them=${Boolean(productAddButton)}).`);
    }
    setNativeValue(productQtyInput, String(Math.max(1, Math.round(Number(qty) || 1))));
    productAddButton.click();
    await wait(350);
  }

  async function replaceInvoiceItems(items) {
    let invoice = invoiceGrid();
    const products = productGrid();
    if (!invoice?.grid) throw new Error("Khong truy cap duoc luoi dong hoa don cua website.");
    if (!products?.grid) throw new Error("Khong truy cap duoc luoi danh muc san pham cua website.");
    const requested = (items || []).filter(item => Number(item.newQty) > 0);
    if (!requested.length) throw new Error("Phuong an khong co mat hang nao de ap dung.");

    const allInvoiceRows = () => {
      const data = invoice.grid.dataSource.data();
      return Array.from(data || []);
    };
    const initialSnapshot = allInvoiceRows().map(row => {
      const raw = typeof row.toJSON === "function" ? row.toJSON() : { ...row };
      return raw;
    });

    const expected = new Map(requested.map(item => [String(item.code), {
      qty: Math.round(Number(item.newQty)),
      price: Math.round(Number(item.price) || 0)
    }]));
    const rowCode = row => String(objectValue(row, invoice.fields.code) || "").trim();
    const setModelValue = (row, field, value) => {
      if (!field) return;
      if (typeof row.set === "function") row.set(field, value);
      else row[field] = value;
    };
    let originalTemplate = allInvoiceRows()[0];
    if (!originalTemplate) {
      await addProductThroughWebsite(products, requested[0].code, 1);
      await wait(500);
      invoice = invoiceGrid();
      originalTemplate = allInvoiceRows()[0];
    }
    if (!originalTemplate) throw new Error("Website khong tao duoc dong hang mau cho phieu moi.");
    const rawValue = (raw, names) => {
      const keys = Object.keys(raw || {});
      const key = keys.find(candidate => names.some(name => candidate.toUpperCase() === name));
      return key ? raw[key] : undefined;
    };
    const createDetailFromProduct = (product, target) => {
      const base = typeof originalTemplate.toJSON === "function"
        ? originalTemplate.toJSON()
        : { ...originalTemplate };
      const raw = typeof product.toJSON === "function" ? product.toJSON() : product;
      const qty = Math.round(Number(target.newQty));
      const price = Math.round(Number(target.price) || Number(objectValue(product, products.fields.price)) || 0);
      base.ID = null;
      base.DMATHANGID = rawValue(raw, ["DMATHANGID", "ID"]);
      base.DMATHANG_CODE = String(target.code);
      base.TENHANG = String(objectValue(product, products.fields.name) || rawValue(raw, ["TENHANG", "NAME"]) || "");
      base.DDONVITINHID = rawValue(raw, ["DDONVITINHID"]);
      base.DDONVITINH_NAME = String(objectValue(product, products.fields.unit) || rawValue(raw, ["DDONVITINH_NAME", "DVT"]) || "");
      base.SLXUATCHUAQUYDOI = qty;
      base.SLXUAT = qty;
      base.SLTHUCXUAT = qty;
      base.DONGIA = price;
      base.DONGIABAOCAO = Math.round(price * 1.1);
      base.TILEGIAMGIA = 0;
      base.TIENGIAMGIA = 0;
      base.THANHTIEN = qty * price;
      base.THANHTIENBAOCAO = Math.round(qty * price * 1.1);
      base.NOTE = "";
      return invoice.grid.dataSource.add(base);
    };

    try {
      // Preserve matching existing rows. This keeps the website's full detail
      // model (IDs, warehouse and accounting fields) instead of recreating it.
      for (const item of requested) {
        const code = String(item.code);
        let row = allInvoiceRows().find(candidate => rowCode(candidate) === code);
        if (!row) {
          const product = await filterProduct(products, code);
          row = createDetailFromProduct(product, item);
        }
        if (!row) throw new Error(`Website khong tao duoc dong hang ${code}.`);
        setModelValue(row, invoice.fields.qty, Math.round(Number(item.newQty)));
        if (Number(item.price) > 0) setModelValue(row, invoice.fields.price, Math.round(Number(item.price)));
        setModelValue(row, "SLXUAT", Math.round(Number(item.newQty)));
        setModelValue(row, "SLTHUCXUAT", Math.round(Number(item.newQty)));
        setModelValue(row, "THANHTIEN", Math.round(Number(item.newQty) * Number(item.price)));
        setModelValue(row, "DONGIABAOCAO", Math.round(Number(item.price) * 1.1));
        setModelValue(row, "THANHTIENBAOCAO", Math.round(Number(item.newQty) * Number(item.price) * 1.1));
      }

      // Remove old, blank and duplicate rows after every requested row exists.
      const seen = new Set();
      allInvoiceRows().slice().forEach(row => {
        const code = rowCode(row);
        if (!expected.has(code) || seen.has(code)) invoice.grid.dataSource.remove(row);
        else seen.add(code);
      });
      // Re-apply final values after add/remove because the website's grid change
      // callback can restore catalog prices while rebinding.
      allInvoiceRows().forEach(row => {
        const target = expected.get(rowCode(row));
        if (!target) return;
        setModelValue(row, invoice.fields.qty, target.qty);
        setModelValue(row, invoice.fields.price, target.price);
        setModelValue(row, "SLXUAT", target.qty);
        setModelValue(row, "SLTHUCXUAT", target.qty);
        setModelValue(row, "THANHTIEN", target.qty * target.price);
        setModelValue(row, "DONGIABAOCAO", Math.round(target.price * 1.1));
        setModelValue(row, "THANHTIENBAOCAO", Math.round(target.qty * target.price * 1.1));
      });
      clearProductSearch(products);
      await wait(300);
    } catch (error) {
      initialSnapshot.forEach((rowData, index) => {
        const current = allInvoiceRows();
        if (index < current.length) {
          const row = current[index];
          Object.keys(rowData).forEach(key => {
            setModelValue(row, key, rowData[key]);
          });
        }
      });
      const toRemove = allInvoiceRows().slice(initialSnapshot.length);
      toRemove.forEach(row => invoice.grid.dataSource.remove(row));
      throw error;
    }

    // Verify against the exact DataSource we just mutated. During a Kendo
    // rebind the form's total inputs can temporarily disappear, which makes
    // scan() report "not ready" even though the invoice rows are already
    // present and correct.
    const finalRows = allInvoiceRows();
    const snapshot = {
      ready: finalRows.length > 0,
      mode: "kendo",
      items: finalRows.map((row, index) => ({
        uid: row.uid || String(index),
        code: String(objectValue(row, invoice.fields.code) || ""),
        name: String(objectValue(row, invoice.fields.name) || ""),
        qty: money(objectValue(row, invoice.fields.qty)),
        unit: String(objectValue(row, invoice.fields.unit) || ""),
        price: money(objectValue(row, invoice.fields.price))
      })).filter(item => item.code && item.price > 0)
    };
    const actual = new Map(snapshot.items.map(item => [String(item.code), Math.round(Number(item.qty))]));
    const mismatches = [...expected].filter(([code, target]) => actual.get(code) !== target.qty);
    if (mismatches.length || actual.size !== expected.size) throw new Error("Website da them hang nhung ket qua chua khop phuong an; chua duoc bam Luu HD.");
    return { changed: true, snapshot };
  }

  // Lưới danh sách phiếu (màn hình Hóa đơn điện tử: Ngày / Số phiếu / Tổng cộng).
  // Chỉ còn dùng để báo trạng thái giao diện; tìm và mở phiếu đi qua API, không
  // điều khiển lưới này nữa.
  function invoiceListElement() {
    return Array.from(document.querySelectorAll(".k-grid")).find(element => {
      const text = element.querySelector("thead")?.innerText || "";
      return /Số phiếu/i.test(text) && /Tổng cộng/i.test(text) && /Ngày/i.test(text);
    }) || null;
  }

  function setNativeValue(input, value) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function dateDisplay(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
  }

  // Danh sách phiếu theo ngày lấy bằng API LayDuLieu của màn hình Hóa đơn điện
  // tử, ô "Loại" do SERVER lọc: Chưa phát hành (2) / Đã phát hành (1). Không dựa
  // vào số hóa đơn trên dòng để đoán trạng thái.
  //
  // Trước giao diện 10/2026 extension đặt ô ngày + radio rdTrangThai_2 trên lưới
  // rồi đọc DOM từng trang. Radio đã thành dropdown và lưới thêm cột Chọn/Chiết
  // khấu, nên cách đó không còn chạy. `uid` của dòng chính là ID phiếu, để
  // openInvoiceCandidate mở theo ID.
  function invoiceCandidateRow(row, dateKey) {
    return {
      uid: row.id,
      id: row.id,
      invoiceNo: row.invoiceNo,
      date: dateDisplay(dateKey),
      dateKey,
      grandTotal: row.grandTotal
    };
  }

  const INVOICE_LIST_CACHE_MS = 120000;

  // ID phiếu đã thấy trong danh sách Chưa phát hành, theo ngày. openInvoiceCandidate
  // chỉ mở ID có ở đây: luồng lập/sửa phương án chỉ được chạm phiếu chưa xuất.
  const unissuedInvoiceIds = new Map();

  function rememberUnissuedRows(dateKey, rows) {
    for (const [id, known] of unissuedInvoiceIds) {
      if (known.dateKey === dateKey) unissuedInvoiceIds.delete(id);
    }
    for (const row of rows) unissuedInvoiceIds.set(row.id, { invoiceNo: row.invoiceNo, dateKey });
  }

  async function findInvoiceCandidates(dateKey, usedInvoiceNos, options = {}) {
    const key = normalizeDateKey(dateKey);
    if (!key) throw new Error("Ngày giao dịch không hợp lệ.");
    const used = new Set((usedInvoiceNos || []).map(String));
    const wantedInvoiceNo = String(options.invoiceNo || "").trim();
    // Tìm đúng một số phiếu (đối soát sau lưu) luôn đọc lại server: phiếu vừa tạo
    // chưa có trong bản đã nhớ.
    const forceRefresh = Boolean(options.forceRefresh || wantedInvoiceNo);
    const entry = invoiceListCache.get(key);
    // Batch Review hỏi nhiều giao dịch cùng ngày liên tiếp: dùng lại bản vừa tải
    // trong thời gian ngắn, quá hạn thì tải lại để tổng tiền không cũ.
    const cached = Boolean(!forceRefresh && entry && Date.now() - entry.at < INVOICE_LIST_CACHE_MS);
    let rows = cached ? entry.rows : null;
    if (!rows) {
      const list = await fetchEInvoiceList({ dateKey: key, status: EINVOICE_STATUS_UNISSUED });
      rows = list.rows
        .filter(row => isGuid(row.id) && row.invoiceNo && !row.issued && !row.cancelled)
        .map(row => invoiceCandidateRow(row, key));
      invoiceListCache.set(key, { at: Date.now(), rows: rows.map(row => ({ ...row })) });
      rememberUnissuedRows(key, rows);
    }
    const picked = wantedInvoiceNo ? rows.filter(row => row.invoiceNo === wantedInvoiceNo) : rows;
    return {
      dateKey: key,
      invoiceStatus: "unissued",
      source: "api",
      cached,
      ...(wantedInvoiceNo ? { exact: picked.length > 0 } : {}),
      suppressedAlerts: [],
      candidates: picked.map(row => ({ ...row, available: !used.has(String(row.invoiceNo)) }))
    };
  }

  async function findIssuedInvoiceByAmount(dateKey, amount) {
    const key = normalizeDateKey(dateKey);
    if (!key) throw new Error("Ngày giao dịch không hợp lệ.");
    const target = Math.round(Number(amount) || 0);
    const list = await fetchEInvoiceList({ dateKey: key, status: EINVOICE_STATUS_ISSUED });
    // Hóa đơn đã hủy không còn là hóa đơn của giao dịch nào.
    const rows = list.rows
      .filter(row => isGuid(row.id) && row.invoiceNo && !row.cancelled)
      .map(row => ({ ...invoiceCandidateRow(row, key), soHoaDon: row.soHoaDon }));
    const matches = rows.filter(row => Math.round(Number(row.grandTotal) || 0) === target);
    return { dateKey: key, invoiceStatus: "issued", source: "api", suppressedAlerts: [], target, matches, rows };
  }

  async function openInvoiceCandidate(uid, invoiceNo) {
    const id = String(uid || "").trim();
    const known = unissuedInvoiceIds.get(id);
    // Luồng lập/sửa phương án chỉ được chạm vào phiếu chưa xuất hóa đơn.
    if (!known) throw new Error('Chỉ được tự mở phiếu lấy từ danh sách "Chưa phát hành". Hãy tìm lại phiếu.');
    const wanted = String(invoiceNo || "").trim();
    if (wanted && wanted !== known.invoiceNo) {
      throw new Error(`ID phiếu thuộc ${known.invoiceNo}, không phải ${wanted}; đã dừng để tránh mở nhầm.`);
    }
    return openInvoiceById(id, known.invoiceNo);
  }

  // Mở form phiếu theo ID đúng như website làm khi nhấp đúp một dòng ở màn hình
  // Hóa đơn điện tử (grDon_MouseDoubleClick -> UiUtils.ShowEditForm). Chạy được ở
  // mọi trang của website (đã thử trên màn Hóa đơn điện tử và sơ đồ phòng), nên
  // không cần chuyển sang màn hình danh sách. Chỉ mở; không sửa gì.
  async function openInvoiceById(id, invoiceNo) {
    const recordId = String(id || "").trim();
    if (!isGuid(recordId)) throw new Error(`ID phiếu không hợp lệ: ${recordId || "trống"}.`);
    const uiUtils = window.UiUtils;
    if (typeof uiUtils?.ShowEditForm !== "function") {
      throw new Error("Trang hiện tại không mở được phiếu (thiếu UiUtils.ShowEditForm); hãy tải lại trang.");
    }
    // Không đóng hộ form đang mở: có thể là phiếu người dùng đang sửa dở.
    if ((await waitForInvoiceDetailClosed()).detailVisible) {
      throw new Error("Đang có một phiếu mở trên website; hãy đóng phiếu đó trước.");
    }
    uiUtils.ShowEditForm(SALES_TABLE_ID, 0, recordId, "Loai=0&notitle=1&ModeQuanLy=30", () => {});
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await wait(120);
      if (visibleInvoiceTotalInput()) {
        return { opened: true, method: "show-edit-form", id: recordId, invoiceNo: String(invoiceNo || "") };
      }
    }
    throw new Error(`Website không mở được phiếu ${invoiceNo || recordId} sau 10 giây.`);
  }

  function canOpenInvoiceById() {
    return typeof window.UiUtils?.ShowEditForm === "function";
  }

  function domInvoiceRows() {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const dialog = dialogs.find(node => isVisible(node) && /Tổng cộng/i.test(node.innerText || ""));
    if (!dialog) return [];
    const headers = Array.from(dialog.querySelectorAll('tr[role="row"]'));
    const header = headers.find(row => /Mã hàng/i.test(row.innerText || "") && /Số lượng/i.test(row.innerText || "") && /Đơn giá/i.test(row.innerText || ""));
    if (!header) return [];
    const grid = header.closest('.k-grid');
    if (!grid) return [];
    return Array.from(grid.querySelectorAll('.k-grid-content tr[role="row"]')).map((row, index) => {
      const cells = Array.from(row.querySelectorAll('[role="gridcell"]')).map(cell => (cell.innerText || "").trim());
      const offset = cells.length >= 10 ? 1 : 0;
      return { uid: row.getAttribute('data-uid') || String(index), code: cells[offset] || "", name: cells[offset + 1] || "", qty: money(cells[offset + 2]), unit: cells[offset + 3] || "", price: money(cells[offset + 4]) };
    }).filter(item => item.price > 0);
  }

  function scan() {
    const input = suffixInput("numTONGCONG");
    if (!input) return { ready: false, reason: "Hãy mở một phiếu bằng cách nhấp đúp trên danh sách." };

    const found = invoiceGrid();
    let items = [];
    let mode = "dom";
    if (found) {
      mode = "kendo";
      const rows = (typeof found.grid.dataSource.view === "function" && found.grid.dataSource.view()) ||
        (typeof found.grid.dataSource.data === "function" && found.grid.dataSource.data()) || [];
      items = rows.map((item, index) => ({
        uid: item.uid || String(index),
        code: String(objectValue(item, found.fields.code) || ""),
        name: String(objectValue(item, found.fields.name) || ""),
        qty: money(objectValue(item, found.fields.qty)),
        unit: String(objectValue(item, found.fields.unit) || ""),
        price: money(objectValue(item, found.fields.price))
      })).filter(item => item.price > 0);
    }
    if (!items.length) items = domInvoiceRows();

    const invoiceDate = findInvoiceDate();
    const invoiceTimes = findInvoiceTimes();
    // Phòng của phiếu: content dựa vào đây để bỏ qua phiếu ở quầy BÁN LẺ
    // (không lập được HĐĐT). Cờ quầy lấy từ sơ đồ phòng nếu đã có.
    const roomName = String(suffixInput("lblTENBAN")?.textContent || "").replace(/\s+/g, " ").trim();
    const openRoom = getOpenFormRoom();
    const roomId = openRoom.roomId;
    const mappedRoom = mappedRoomById(roomId);
    return {
      ready: items.length > 0,
      mode,
      roomName,
      roomId,
      roomRate: openRoom.hourlyRate,
      roomIsRetail: isRetailRoomText(roomName) ||
        Boolean(mappedRoom && (Number(mappedRoom.counter) || isRetailRoomText(mappedRoom.name) || isRetailRoomText(mappedRoom.areaName))),
      invoiceNo: (suffixInput("txtNAME") || {}).value || "",
      currentGoods: valueOf("numTIENHANG"),
      currentHour: valueOf("numTIENGIO"),
      currentTax: valueOf("numTIENTHUE"),
      taxRate: valueOf("numTILETHUE"),
      currentGrand: valueOf("numTONGCONG"),
      invoiceDate: invoiceDate.value,
      invoiceDateKey: invoiceDate.key,
      checkIn: invoiceTimes.checkIn,
      checkOut: invoiceTimes.checkOut,
      durationMinutes: invoiceTimes.durationMinutes,
      items,
      reason: items.length ? "" : "Không đọc được các dòng hàng trong phiếu."
    };
  }

  // Moi phieu extension luu deu ghi PHUONGTHUCTT = TM/CK, ca phieu tu sao ke
  // ngan hang lan dong CK/TM trong danh sach so tien cua ke toan (ke toan chot
  // 02/10/2026; truoc do dong CK/TM giu nguyen CK hoac TM). Hoa don dien tu lay
  // phuong thuc tu phieu nen phieu phai ghi dung TM/CK ngay khi luu: buoc phat
  // hanh chi gui ID, khong doi duoc. CK/TM cua dong nguon van giu trong du lieu
  // extension. Phuong thuc la van bi chan de lo loi truyen du lieu.
  const INVOICE_PAYMENT_METHOD = "TM/CK";
  const CREATION_PAYMENT_METHODS = new Set(["CK", "TM", INVOICE_PAYMENT_METHOD]);
  function invoiceCreationPaymentMethod(expected) {
    const requested = String(expected?.paymentMethod || "").trim().toUpperCase();
    if (requested && !CREATION_PAYMENT_METHODS.has(requested)) {
      throw new Error(`Phuong thuc thanh toan khi tao phieu khong hop le: ${requested}.`);
    }
    return INVOICE_PAYMENT_METHOD;
  }
  // Nguoi mua tren phieu (va hoa don dien tu) cho khach khong lay hoa don.
  // Website mac dinh "Khach le - Khong lay hoa don"; ke toan chot 02/10/2026
  // ghi "Ban cho nguoi tieu dung".
  const DEFAULT_INVOICE_BUYER = "B\u00e1n cho ng\u01b0\u1eddi ti\u00eau d\u00f9ng";
  const DEFAULT_INVOICE_ADDRESS = "Kh\u00e1ch kh\u00f4ng cung c\u1ea5p th\u00f4ng tin";
  // Tiền tố lỗi tạo phiếu mới khi request CHƯA được gửi. content.js dựa vào nó
  // để biết có được gỡ dấu "đang tạo phiếu" hay không; phải giữ khớp hai bên.
  const NEW_INVOICE_NOT_SENT_TAG = "[chua-gui-api] ";
  // Đi sau NEW_INVOICE_NOT_SENT_TAG khi không đọc được form phòng bằng API:
  // content quay về cách mở tab phụ. Cũng phải giữ khớp với content.js.
  const NEW_INVOICE_FORM_UNAVAILABLE_TAG = "[form-phong] ";
  const SALES_TABLE_ID = "d56b4b85-68c8-44c1-947d-9f3899e55a7c";
  const PRODUCT_GRID_TABLE_ID = "c07a4b54-e177-40d9-b077-c140fd4641d9";
  const PRODUCT_CATALOG_MENU_ID = "c4059f67-16f0-4088-a639-9bdf906585de";
  const SALES_FORM_ID = "aaf252bb-ed11-4077-8852-5e453a6881a3";
  const SALES_MENU_ID = "f3ca052a-082b-49f6-8d4f-93b8a525e571";

  async function fetchLatestProductCatalog() {
    const base = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
    const cols = [
      "rowindex", "CODE", "NAME", "DDONVITINHID", "GIABAN", "DLOAIMATHANGID",
      "DNHOMMATHANGID", "TIMECREATED", "GIATOITHIEUVUA", "THUEMACDINH",
      "HIENTHITRENEMENU", "HOAHONG", "THOIGIAN", "DNHACUNGCAPID", "TILEHOAHONG",
      "GIATOITHIEU", "GIATOITHIEULON", "CORFID", "KHOILUONG", "CHOTHUE",
      "COCHAMSOCSAUMUA", "TUNGAY", "NGUOI_TAO", "GIABANVUA", "QUYDOIVUA",
      "DDONVITINHLONID", "GIANHAPLON", "DDONVITINHVUAID", "QUYDOILON",
      "GIABANLON", "GIANHAPVUA", "TIMEMODIFIED"
    ];
    const payload = {
      GUID: PRODUCT_GRID_TABLE_ID,
      cols,
      SourceType: 2,
      FormID: "",
      RecordID: "",
      AddEditTableID: "",
      filters: {},
      MenuID: PRODUCT_CATALOG_MENU_ID,
      TableID: PRODUCT_GRID_TABLE_ID,
      skip: 0,
      take: "1000",
      page: 1,
      pageSize: "1000",
      quickFilter: "",
      filterCategoryID: "TatCa"
    };
    const response = await fetchForRead(`${location.origin}/${base}/DataGrid/GetGridData`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Không tải được danh mục mặt hàng (HTTP ${response.status}).`);
    let result;
    try { result = JSON.parse(text); } catch (_) {
      throw new Error("Website trả về danh mục mặt hàng không đúng định dạng JSON.");
    }
    let rows = Array.isArray(result?.Data) ? result.Data : null;
    if (!rows && typeof result?.strData === "string") {
      try {
        const nested = JSON.parse(result.strData);
        rows = Array.isArray(nested) ? nested : nested?.Data;
      } catch (_) {}
    }
    if (!Array.isArray(rows)) throw new Error(result?.message || "Không tìm thấy danh sách mặt hàng trong phản hồi website.");
    const items = rows.map(row => ({
      webId: String(row.ID || ""),
      webCode: String(row.CODE || "").trim(),
      webName: String(row.NAME || "").trim(),
      webUnit: String(row.DDONVITINHID__NAME || row.DDONVITINH_NAME || "").trim(),
      webPrice: Math.round(Number(row.GIABAN) || 0),
      webType: String(row.DLOAIMATHANGID__NAME || row.DLOAIMATHANG_NAME || "").trim(),
      webGroup: String(row.DNHOMMATHANGID__NAME || row.DNHOMMATHANG_NAME || "").trim(),
      modifiedAt: String(row.TIMEMODIFIED || "")
    })).filter(item => item.webCode && item.webName);
    if (!items.length) throw new Error("Website trả về danh mục rỗng; dữ liệu cũ vẫn được giữ nguyên.");
    return { items, total: Number(result.Total || items.length), tenant: base };
  }

  function extractJsonObject(source, startAt) {
    const start = source.indexOf("{", startAt);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(start, index + 1)); } catch (_) { return null; }
      }
    }
    return null;
  }

  function isGuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(String(value || "").trim());
  }

  function formDataRecordId(formData) {
    return String(formData?._RecordID || formData?.mapper?.ID || "").trim();
  }

  function formDataField(formData, fieldName) {
    const map = (formData?.mapper?.Maps || [])
      .find(item => String(item.Field || "").toUpperCase() === String(fieldName || "").toUpperCase());
    return map?.Value;
  }

  function currentFormData(options) {
    options = options || {};
    const visibleInvoiceNo = String(suffixInput("txtNAME")?.value || "").trim();
    const candidates = [];
    const addCandidate = (formData, source) => {
      if (!formData || String(formData._AddEditTableID || "") !== SALES_TABLE_ID) return;
      if (candidates.some(candidate => candidate.formData === formData)) return;
      candidates.push({ formData, source });
    };

    // Form mới được website mở động thường cập nhật window.formData, trong khi
    // document.scripts vẫn còn nhiều formData cũ của trang cha.
    addCandidate(window.formData, "window.formData");
    Array.from(document.scripts)
      .map(script => script.textContent || "")
      .filter(source => source.includes("new AddEdit_JsClient") && source.includes("new DataTransferJs("))
      .reverse()
      .forEach((source, index) => {
        let marker = source.indexOf("new DataTransferJs(");
        while (marker >= 0) {
          addCandidate(extractJsonObject(source, marker), `script:${index}`);
          marker = source.indexOf("new DataTransferJs(", marker + 1);
        }
      });

    const normalizedVisibleName = /^(TU DONG|TỰ ĐỘNG)$/i.test(visibleInvoiceNo) ? "" : visibleInvoiceNo;
    const ranked = candidates.map(candidate => {
      const recordId = formDataRecordId(candidate.formData);
      const name = String(formDataField(candidate.formData, "NAME") || "").trim();
      const lastSaveId = String(formDataField(candidate.formData, "LASTSAVEID") || "").trim();
      let score = 0;
      if (isGuid(recordId)) score += 100;
      if (isGuid(lastSaveId)) score += 20;
      if (candidate.source === "window.formData") score += 10;
      if (normalizedVisibleName && name === normalizedVisibleName) score += 50;
      return { ...candidate, recordId, name, lastSaveId, score };
    }).sort((left, right) => right.score - left.score);

    // A fresh modal exposes blank window.formData while the parent page may still keep
    // old invoice scripts with valid GUIDs. Prefer the live blank form for mode=0.
    const selected = options.allowBlankRecordId
      ? (ranked.find(candidate => candidate.source === "window.formData" && !candidate.recordId && candidate.name) ||
        ranked.find(candidate => !candidate.recordId && candidate.name) ||
        ranked.find(candidate => isGuid(candidate.recordId)))
      : ranked.find(candidate => isGuid(candidate.recordId));
    if (selected) return selected.formData;
    const details = ranked.slice(0, 4)
      .map(candidate => `${candidate.source}[ID=${candidate.recordId || "rong"},NAME=${candidate.name || "rong"}]`)
      .join("; ");
    throw new Error(`Khong tim thay ID phieu tam hop le${details ? `: ${details}` : "."}`);
  }

  function normalizedVietnameseText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, match => match === "đ" ? "d" : "D")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();
  }

  function localServerDateTime(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function localUsDateTime(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    const hour24 = date.getHours();
    const hour12 = hour24 % 12 || 12;
    const marker = hour24 >= 12 ? "PM" : "AM";
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ` +
      `${hour12}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${marker}`;
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localMidnightIso(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    // All shops operate in Viet Nam (UTC+7). Do not depend on the computer's
    // current timezone: 00:00 on the document day must be 17:00Z on the
    // previous UTC day (for example 2026-06-01 -> 2026-05-31T17:00:00.000Z).
    const VIETNAM_UTC_OFFSET_HOURS = 7;
    const utcMilliseconds = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      -VIETNAM_UTC_OFFSET_HOURS,
      0,
      0,
      0
    );
    const date = new Date(utcMilliseconds);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }

  function storedLocalDateKey(value) {
    const date = new Date(String(value || ""));
    return Number.isNaN(date.getTime()) ? normalizeDateKey(value) : localDateKey(date);
  }

  function parseStoredDateTime(value) {
    const text = String(value || "").trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return date;
    }
    // GIOTHANHTOAN của website dùng định dạng US có AM/PM (M/D/YYYY h:mm:ss A).
    // Không đưa chuỗi này qua parseDateTime vì hàm đó hiểu số đầu là ngày.
    if (/\b(?:AM|PM)\b/i.test(text)) {
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return date;
    }
    return parseDateTime(text);
  }

  function liveDetailRows() {
    const found = invoiceGrid();
    if (!found?.grid?.dataSource) throw new Error("Khong truy cap duoc luoi detail cua phieu.");
    return Array.from(found.grid.dataSource.data() || []).map((row, index) => {
      const raw = typeof row.toJSON === "function" ? row.toJSON() : { ...row };
      const plain = JSON.parse(JSON.stringify(raw));
      plain.THUTU = index + 1;
      return plain;
    });
  }

  function mapObject(maps) {
    return Object.fromEntries((maps || []).map(map => [
      String(map.Field || "").toUpperCase(),
      map.Value
    ]));
  }

  function expectedItemMap(items) {
    return new Map((items || []).map(item => [String(item.code), {
      qty: Math.round(Number(item.qty ?? item.newQty) || 0),
      price: Math.round(Number(item.price) || 0)
    }]));
  }

  function validateSavePayload(payload, expected) {
    if (String(payload?.TableID || "") !== SALES_TABLE_ID ||
        String(payload?.clientMap?.TableID || "") !== SALES_TABLE_ID) {
      throw new Error("TableID cua request khong dung bang hoa don.");
    }
    const recordId = String(payload?.ID || "");
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(recordId) ||
        recordId !== String(payload?.clientMap?.ID || "")) {
      throw new Error("ID phieu trong request khong hop le.");
    }
    const fields = mapObject(payload.clientMap.Maps);
    const expectedGrand = Math.round(Number(expected?.targetGrand) || 0);
    const expectedGoods = Math.round(Number(expected?.targetGoods) || 0);
    const expectedHour = Math.round(Number(expected?.targetHour) || 0);
    const expectedTax = Math.round(Number(expected?.targetTax) || 0);
    if (String(fields.SOHD || "").trim()) throw new Error("Phieu da co so hoa don; Batch API bi chan.");
    if (expected?.invoiceNo && String(fields.NAME || "") !== String(expected.invoiceNo)) {
      throw new Error(`Request dang tro toi ${fields.NAME || "phieu khac"}, khong phai ${expected.invoiceNo}.`);
    }
    if (expected?.requiresFreshDraft) {
      const lastSaveId = String(fields.LASTSAVEID || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lastSaveId)) {
        throw new Error("Phieu nhap moi khong co LASTSAVEID hop le; khong duoc gui lai payload cu.");
      }
    }
    if (money(fields.TONGCONG) !== expectedGrand ||
        money(fields.TIENHANG) !== expectedGoods ||
        money(fields.TIENGIO) !== expectedHour ||
        money(fields.TIENTHUE) !== expectedTax) {
      throw new Error("Tong tien, tien hang, tien gio hoac VAT trong request chua khop phuong an.");
    }
    ["TILEGIAMGIA", "TIENGIAMGIA", "TILEGIAMGIAGIO", "TIENGIAMGIAGIO"].forEach(field => {
      if (money(fields[field]) !== 0) throw new Error("Ke toan khong dung giam gia; request da bi chan.");
    });
    if (["TIENMAT", "KHACHDUA", "TIENTHANHTOAN"].some(field => money(fields[field]) !== expectedGrand) ||
        money(fields.TRALAI) !== 0) {
      throw new Error("Tien mat/khach dua/tien thanh toan chua bang tong cong.");
    }
    // Chi kiem tra voi payload do extension tu dung. Payload bat duoc tu nut Luu
    // cua website la do website tao nen giu nguyen phuong thuc cua no.
    const expectedPaymentMethod = invoiceCreationPaymentMethod(expected);
    if (expected?.expectsPaymentMethod &&
        String(fields.PHUONGTHUCTT || "") !== expectedPaymentMethod) {
      throw new Error(`Phuong thuc thanh toan trong request la "${fields.PHUONGTHUCTT || "trong"}", phai la "${expectedPaymentMethod}".`);
    }

    const invoiceDateKey = normalizeDateKey(expected?.invoiceDateKey);
    const expectedCheckIn = parseDateTime(expected?.checkIn);
    const expectedCheckOut = parseDateTime(expected?.checkOut);
    if (invoiceDateKey) {
      if (storedLocalDateKey(fields.NGAY) !== invoiceDateKey) {
        throw new Error(`Ngay hoa don trong request chua khop ${invoiceDateKey}.`);
      }
      if (!expectedCheckIn || !expectedCheckOut || expectedCheckOut <= expectedCheckIn) {
        throw new Error("Phuong an thieu Gio vao/Ra hop le de luu va doi soat.");
      }
      const actualCheckIn = parseStoredDateTime(fields.BATDAUPHONGCUOI || fields.BATDAU);
      const actualCheckOut = parseStoredDateTime(fields.KETTHUC);
      if (!actualCheckIn || !actualCheckOut ||
          Math.abs(actualCheckIn.getTime() - expectedCheckIn.getTime()) >= 60000 ||
          Math.abs(actualCheckOut.getTime() - expectedCheckOut.getTime()) >= 60000) {
        throw new Error("Gio vao/ra trong request chua khop phuong an da Accept.");
      }
      // Ngày chứng từ và ca sử dụng phòng là hai dữ liệu độc lập đối với phiếu
      // đã có. Vì vậy GIOTHANHTOAN phải khớp Giờ ra đã Accept, không được ép
      // về ngày danh sách. Phiếu mới vẫn có expectedCheckOut thuộc ngày sao kê.
      const actualPaymentAt = parseStoredDateTime(fields.GIOTHANHTOAN);
      if (!actualPaymentAt ||
          Math.abs(actualPaymentAt.getTime() - expectedCheckOut.getTime()) >= 60000) {
        throw new Error("Gio thanh toan trong request chua khop Gio ra cua phuong an da Accept.");
      }
    }

    const rows = payload.clientMap.Grids?.find(grid => String(grid.Name).toLowerCase() === "detail")?.Data || [];
    if (!rows.length) throw new Error("Request khong co dong hang.");
    const expectedItems = expectedItemMap(expected?.items);
    const actualItems = new Map();
    let goods = 0;
    rows.forEach(row => {
      if (invoiceDateKey && normalizeDateKey(row.NGAYTHUCHIEN) !== invoiceDateKey) {
        throw new Error(`Ngay thuc hien cua dong hang chua khop ${invoiceDateKey}.`);
      }
      const code = String(row.DMATHANG_CODE || row.MAHANG || "").trim();
      const qty = Math.round(Number(row.SLXUATCHUAQUYDOI ?? row.SLXUAT ?? row.SOLUONG) || 0);
      const price = Math.round(Number(row.DONGIA) || 0);
      if (!code || qty <= 0 || price <= 0 || actualItems.has(code)) {
        throw new Error("Dong hang trong request bi trong, trung ma hoac sai so luong/gia.");
      }
      actualItems.set(code, { qty, price });
      goods += qty * price;
    });
    if (goods !== expectedGoods || actualItems.size !== expectedItems.size) {
      throw new Error("Chi tiet hang trong request khong khop tong tien hang.");
    }
    for (const [code, item] of expectedItems) {
      const actual = actualItems.get(code);
      if (!actual || actual.qty !== item.qty || actual.price !== item.price) {
        throw new Error(`Chi tiet ma ${code} chua khop phuong an.`);
      }
    }
    return { invoiceNo: String(fields.NAME || ""), recordId, rowCount: rows.length };
  }

  function buildCurrentSavePayload(expected, detailRowsOverride) {
    const formData = currentFormData();
    const recordId = String(formData._RecordID || formData.mapper?.ID || "");
    const grand = Math.round(Number(expected?.targetGrand) || valueOf("numTONGCONG"));
    const goods = Math.round(Number(expected?.targetGoods) || valueOf("numTIENHANG"));
    const hour = Math.round(Number(expected?.targetHour) || valueOf("numTIENGIO"));
    const tax = Math.round(Number(expected?.targetTax) || valueOf("numTIENTHUE"));
    const checkIn = parseDateTime(expected?.checkIn);
    const checkOut = parseDateTime(expected?.checkOut);
    const paymentMethod = invoiceCreationPaymentMethod(expected);
    const invoiceDateKey = normalizeDateKey(expected?.invoiceDateKey) || localDateKey(checkIn);
    if ((invoiceDateKey || expected?.requiresFreshDraft) && (!invoiceDateKey || !checkIn || !checkOut || checkOut <= checkIn)) {
      throw new Error("Phuong an thieu ngay hoa don hoac Gio vao/Ra hop le; khong the luu va doi soat.");
    }
    const overrides = {
      TIENHANG: goods,
      TIENGIO: hour,
      // Website duy tri dong thoi tong tien gio va tien gio cua phong cuoi.
      // Neu chi doi TIENGIO, request van HTTP 200 nhung khi doc lai co the
      // bi website khoi phuc gia tri cu tu TIENGIOPHONGCUOI.
      TIENGIOPHONGCUOI: hour,
      TIENTHUE: tax,
      TILETHUE: 10,
      TILEGIAMGIA: 0,
      TIENGIAMGIA: 0,
      TILEGIAMGIAGIO: 0,
      TIENGIAMGIAGIO: 0,
      TONGCONG: grand,
      TIENMAT: grand,
      KHACHDUA: grand,
      TIENTHANHTOAN: grand,
      TRALAI: 0,
      // Luon TM/CK, ke ca dong CK/TM cua danh sach so tien (invoiceCreationPaymentMethod).
      PHUONGTHUCTT: paymentMethod,
      NGUOIMUAHANG: String(expected?.buyerName || DEFAULT_INVOICE_BUYER).trim() || DEFAULT_INVOICE_BUYER,
      DIACHIKHACH: String(expected?.buyerAddress || DEFAULT_INVOICE_ADDRESS).trim() || DEFAULT_INVOICE_ADDRESS
    };
    if (invoiceDateKey && checkIn && checkOut) {
      overrides.NGAY = localMidnightIso(invoiceDateKey);
      overrides.BATDAUPHONGCUOI = checkIn.toISOString();
      overrides.KETTHUC = checkOut.toISOString();
      overrides.GIOTHANHTOAN = localUsDateTime(checkOut);
      // Request chinh thuc cua website gui BATDAU cung dang ISO UTC nhu
      // BATDAUPHONGCUOI, khong phai chuoi gio local.
      overrides.BATDAU = checkIn.toISOString();
    }
    const maps = (formData.mapper?.Maps || []).map(map => {
      const field = String(map.Field || "").toUpperCase();
      return {
        Field: map.Field,
        Value: Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : map.Value
      };
    });
    const sourceDetailRows = Array.isArray(detailRowsOverride)
      ? cloneJson(detailRowsOverride)
      : liveDetailRows();
    const detailRows = sourceDetailRows.map(row => invoiceDateKey
      ? { ...row, NGAYTHUCHIEN: `${invoiceDateKey} 00:00:00` }
      : row);
    const payload = {
      mode: 2,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: recordId,
        Maps: maps,
        Grids: [{ Name: "detail", Data: detailRows }],
        CustomPostTable: [{
          Name: "LoaiQuy",
          Data: [
            { truong: "TRALAI", value: 0 },
            { truong: "TIENTHANHTOAN", value: grand },
            { truong: "KHACHDUA", value: grand },
            { truong: "TIENMAT", value: grand }
          ]
        }],
        CustomPost: {
          MODEQUANLY: Number(formData.ModeQuanLy) || 30,
          // GioClient la thoi diem client thuc su gui request (audit timestamp),
          // khong phai ngay nghiep vu cua hoa don. Ngay qua khu duoc luu rieng
          // qua NGAY/GIOTHANHTOAN/BATDAU/KETTHUC va NGAYTHUCHIEN.
          GioClient: localServerDateTime(new Date())
        }
      },
      TableID: SALES_TABLE_ID,
      ID: recordId,
      Loai: Number(formData.Loai) || 0
    };
    const verified = validateSavePayload(payload, {
      ...expected,
      targetGrand: grand,
      targetGoods: goods,
      targetHour: hour,
      targetTax: tax,
      // Payload nay do extension tu dung nen bat buoc dung PHUONGTHUCTT.
      expectsPaymentMethod: true,
      paymentMethod
    });
    return { payload, verified };
  }

  // DoSave tra ve HTTP 200 ca khi nghiep vu tu choi, loi nam trong body:
  // { code: 1, message: null, Tag: { ID, LASTSAVEID } } la luu thanh cong.
  // code khac 1 (hoac thieu Tag.ID) nghia la website khong ghi phieu.
  function verifySaveResponse(responseText, expectedRecordId) {
    let body = null;
    try { body = JSON.parse(String(responseText || "")); } catch (_) {}
    if (!body || typeof body !== "object") {
      throw new Error("Website tra ve du lieu khong doc duoc; chua xac nhan luu phieu.");
    }
    const code = Number(body.code);
    if (code !== 1) {
      const reason = String(body.message || body.strData || "").trim();
      const normalizedReason = reason.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[đĐ]/g, match => match === "đ" ? "d" : "D")
        .toUpperCase();
      if (normalizedReason.includes("HOA DON DA THAY DOI")) {
        throw new Error("Phieu nhap da thay doi hoac LASTSAVEID da cu; hay mo mot phieu nhap moi, khong gui lai request nay.");
      }
      throw new Error(`Website tu choi luu phieu (code ${Number.isFinite(code) ? code : "?"})` +
        `${reason ? `: ${reason}` : "; khong co mo ta loi."}`);
    }
    const savedId = String(body.Tag?.ID || "");
    if (!savedId) throw new Error("Website bao thanh cong nhung khong tra ve ID phieu da luu.");
    if (expectedRecordId && savedId.toLowerCase() !== String(expectedRecordId).toLowerCase()) {
      throw new Error(`Website luu nham phieu ${savedId}, khong phai ${expectedRecordId}.`);
    }
    return { savedRecordId: savedId, lastSaveId: String(body.Tag?.LASTSAVEID || "") };
  }

  async function postCurrentInvoiceViaApi(expected, detailRowsOverride) {
    const { payload, verified } = buildCurrentSavePayload(expected, detailRowsOverride);
    const base = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
    const endpoint = `${location.origin}/${base}/AddEdit/DoSave?is_ajax=1`;
    const response = await window.fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json;utf-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(payload)
    });
    let responseText = "";
    try { responseText = (await response.text()).slice(0, 4000); } catch (_) {}
    if (!response.ok) throw new Error(`Website tu choi luu API (HTTP ${response.status}).`);
    const confirmed = verifySaveResponse(responseText, payload.ID);
    return {
      saved: true,
      httpStatus: response.status,
      endpoint: new URL(endpoint).pathname,
      responseText,
      ...confirmed,
      ...verified
    };
  }

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function setMapValues(maps, overrides) {
    const result = cloneJson(maps || []);
    const byName = new Map(result.map((entry, index) => [String(entry.Field || "").toUpperCase(), index]));
    Object.entries(overrides || {}).forEach(([field, value]) => {
      const normalized = String(field).toUpperCase();
      const index = byName.get(normalized);
      if (index == null) {
        byName.set(normalized, result.length);
        result.push({ Field: field, Value: value });
      } else {
        result[index].Value = value;
      }
    });
    return result;
  }

  async function fetchProductRowsForApiPlan(items, warehouseId) {
    const wanted = new Set((items || []).map(item => String(item.code || "").trim()).filter(Boolean));
    if (!wanted.size) throw new Error("Phuong an API khong co ma hang.");
    const base = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
    const response = await fetchForRead(`${location.origin}/${base}/DataGrid/GetDataSearchData`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json;utf-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify({
        LookupMode: false,
        GUID: "d94717a7-1192-417a-bf6f-6cc00262c5de",
        cols: ["rowindex", "CODE", "NAME", "DDONVITINH_NAME", "GIABAN", "TONKHADUNG", "_CARD_"],
        ControlName: "grMatHang",
        SourceType: 0,
        FormID: SALES_FORM_ID,
        RecordID: "",
        AddEditTableID: SALES_TABLE_ID,
        filters: {},
        MenuID: SALES_MENU_ID,
        TableID: PRODUCT_GRID_TABLE_ID,
        skip: 0,
        take: 1000,
        page: 1,
        pageSize: 1000,
        ShowSum: false,
        customData: { DNHOMMATHANGID: "", DKHOXUATID: warehouseId }
      })
    });
    if (!response.ok) throw new Error(`Khong doc duoc danh muc mat hang (HTTP ${response.status}).`);
    const body = await response.json();
    const rows = Array.isArray(body?.Data) ? body.Data : [];
    const byCode = new Map(rows.map(row => [String(row.CODE || "").trim(), row]));
    const missing = Array.from(wanted).filter(code => !byCode.has(code));
    if (missing.length) throw new Error(`Khong tim thay ma hang tren web: ${missing.join(", ")}.`);
    return byCode;
  }

  function existingInvoiceApiDetailRows(items, products, warehouseId) {
    const currentRows = liveDetailRows();
    if (!currentRows.length) throw new Error("Phieu hien tai khong co dong hang mau de tao request API.");
    const template = currentRows[0];
    const currentByCode = new Map(currentRows.map(row => [
      String(row.DMATHANG_CODE || row.MAHANG || "").trim(),
      row
    ]));
    return (items || []).map((item, index) => {
      const code = String(item.code || "").trim();
      const product = products.get(code);
      const qty = Math.max(1, Math.round(Number(item.qty ?? item.newQty) || 0));
      const price = Math.round(Number(item.price) || Number(product?.GIABAN) || 0);
      if (!product?.ID || !product?.DDONVITINHID || price <= 0) {
        throw new Error(`Du lieu web cua ma ${code} thieu ID, don vi hoac gia.`);
      }
      const existing = currentByCode.get(code);
      const row = cloneJson(existing || template);
      if (!existing) row.ID = null;
      delete row.uid;
      row.DMATHANGID = product.ID;
      row.DMATHANG_NAME = product.NAME;
      row.DMATHANG_CODE = code;
      row.DMATHANG_MASANCO = product.MASANCO || "";
      row.TENHANG = product.NAME;
      row.DDONVITINHID = product.DDONVITINHID;
      row.DDONVITINH_NAME = product.DDONVITINH_NAME || "";
      row.DKHOHANGID = warehouseId || row.DKHOHANGID || null;
      row.SLXUATCHUAQUYDOI = qty;
      row.SLXUAT = qty;
      row.SLTHUCXUAT = qty;
      row.DONGIA = price;
      row.DONGIABAOCAO = Math.round(price * 1.1);
      row.TILEGIAMGIA = 0;
      row.TIENGIAMGIA = 0;
      row.GIAMTHEOTIEN = 0;
      row.THANHTIEN = qty * price;
      row.THANHTIENBAOCAO = Math.round(qty * price * 1.1);
      row.TILETHUEMATHANG = 0;
      row.TIENTHUEMATHANG = 0;
      row.NOTE = "";
      row.THUTU = index + 1;
      return row;
    });
  }

  async function saveExistingInvoicePlanViaApi(expected) {
    const formData = currentFormData();
    const baseFields = mapObject(formData.mapper?.Maps);
    // Phiếu có sẵn ở quầy BÁN LẺ không lập được HĐĐT: không sửa để khỏi dùng
    // phiếu đó khớp sao kê.
    assertNotRetailRoom({ roomId: baseFields.DBANID, roomName: suffixInput("lblTENBAN")?.textContent });
    const warehouseId = String(baseFields.DKHOXUATID || "").trim();
    if (!isGuid(warehouseId)) throw new Error("Phieu hien tai thieu DKHOXUATID de lap chi tiet API.");
    const products = await fetchProductRowsForApiPlan(expected?.items, warehouseId);
    const detailRows = existingInvoiceApiDetailRows(expected?.items, products, warehouseId);
    const calculatedGoods = detailRows.reduce((sum, row) => sum + Math.round(Number(row.THANHTIEN) || 0), 0);
    const targetGoods = Math.round(Number(expected?.targetGoods) || 0);
    if (calculatedGoods !== targetGoods) {
      throw new Error(`Tong chi tiet API ${calculatedGoods} khong bang tien hang ${targetGoods}.`);
    }
    return postCurrentInvoiceViaApi(expected, detailRows);
  }

  function freshSessionDetailRows(items, products, invoiceDateKey) {
    return (items || []).map((item, index) => {
      const code = String(item.code || "").trim();
      const product = products.get(code);
      const qty = Math.max(1, Math.round(Number(item.qty ?? item.newQty) || 0));
      const price = Math.round(Number(item.price) || Number(product?.GIABAN) || 0);
      if (!product?.ID || !product?.DDONVITINHID || price <= 0) {
        throw new Error(`Du lieu web cua ma ${code} thieu ID, don vi hoac gia.`);
      }
      return {
        DMATHANGID: product.ID,
        DMATHANG_NAME: product.NAME,
        DMATHANG_CODE: code,
        DMATHANG_MASANCO: product.MASANCO || "",
        DDONVITINHID: product.DDONVITINHID,
        DDONVITINH_NAME: product.DDONVITINH_NAME || "",
        KHUYENMAI: 0,
        DONGIA: price,
        SLKHUYENMAI: 0,
        TILEGIAMGIA: 0,
        TIENGIAMGIA: 0,
        GIAMTHEOTIEN: 0,
        SLXUATCHUAQUYDOI: qty,
        TILETHUEMATHANG: 0,
        KICHTHUOC: null,
        DNHANVIEN1ID: null,
        DNHANVIEN_NAME: null,
        DMATHANG_SOLANDIEUTRI: Number(product.SOLANDIEUTRI) || 0,
        DMATHANG_CHUKYDIEUTRI: Number(product.CHUKYDIEUTRI) || 0,
        TENHANG: product.NAME,
        NOTE: "",
        ID: `it${Date.now().toString(36)}${index}`,
        TIENTHUEMATHANG: 0,
        THANHTIEN: qty * price,
        NGAYTHUCHIEN: invoiceDateKey ? `${invoiceDateKey} 00:00:00` : null,
        THUTU: index + 1
      };
    });
  }

  function finalPaymentDetailRows(sessionRows, persistedIds, warehouseId, taxRate, invoiceDateKey) {
    return sessionRows.map((row, index) => {
      const persistedId = String(persistedIds?.[row.ID] || "").trim();
      if (!isGuid(persistedId)) throw new Error(`Website khong tra ID dong hang ${row.DMATHANG_CODE}.`);
      return {
        ID: persistedId,
        GIATRINHAP: 0,
        COMBOPARENTID: null,
        TRASUASIZE: null,
        GIAVON: 0,
        GIOTINHLUONG: null,
        HANSUDUNG: null,
        HOAHONG2: null,
        SLXUATCHUAQUYDOI: row.SLXUATCHUAQUYDOI,
        DKHOHANGID: warehouseId,
        TDONHANGTRAID: null,
        DONGIABAOCAO: Math.round(row.DONGIA * (1 + taxRate / 100)),
        COMBOSL: null,
        DTRANGTHAICHEBIENID: null,
        XUATVATTU: 0,
        GIAMTHEOTIEN: 0,
        SLTANG: null,
        DONGIA: row.DONGIA,
        HOAHONG3: null,
        NOTE: row.NOTE || "",
        SLNHAPCHUAQUYDOI: 0,
        TILEGIAMGIA: 0,
        DENGIO: null,
        KICHTHUOC: row.KICHTHUOC,
        DNHANVIEN1ID: null,
        DNHANVIEN_NAME: null,
        GIOHATCOMBO: null,
        TENHANG: row.TENHANG,
        NGAYTHUCHIEN: invoiceDateKey ? `${invoiceDateKey} 00:00:00` : null,
        SLDAXUAT: 0,
        SUDUNGNGAY: null,
        LOAIDONVITINH: 0,
        DMATHANGID: row.DMATHANGID,
        DMATHANG_DLOAIMATHANGID: "0",
        DMATHANG_CODE: row.DMATHANG_CODE,
        DMATHANG_SOLANDIEUTRI: row.DMATHANG_SOLANDIEUTRI,
        DMATHANG_CHUKYDIEUTRI: row.DMATHANG_CHUKYDIEUTRI,
        TIENGIAMGIA: 0,
        GIATRIXUAT: 0,
        BAOHANH: null,
        TIENTHUEMATHANG: 0,
        TRUKHO: null,
        HOAHONG1: null,
        THANHTIENBAOCAO: Math.round(row.THANHTIEN * (1 + taxRate / 100)),
        NHAPTHANHTIEN: null,
        TILETHUEMATHANG: 0,
        CKBAOCAO: 0,
        SLNHAP: 0,
        SLKHUYENMAI: 0,
        THANHTIEN: row.THANHTIEN,
        TUGIO: null,
        QUYDOI: 1,
        DDONVITINHID: row.DDONVITINHID,
        DDONVITINH_NAME: row.DDONVITINH_NAME,
        THUTU: index + 1,
        DNHANVIEN2ID: null,
        DNHANVIEN2_NAME: null,
        DNHANVIEN3ID: null,
        DNHANVIEN3_NAME: null,
        SLTHUCTE: 0,
        COMBOID: null,
        SLHETHONG: 0,
        SLXUAT: row.SLXUATCHUAQUYDOI,
        KHUYENMAI: 0,
        TDIEUTRIID: null,
        SLTHUCXUAT: row.SLXUATCHUAQUYDOI
      };
    });
  }

  async function postDoSavePayload(payload) {
    const base = location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
    const endpoint = `${location.origin}/${base}/AddEdit/DoSave?is_ajax=1`;
    const response = await window.fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json;utf-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`Website tu choi DoSave (HTTP ${response.status}).`);
    // Mat phien tra ve HTML trang login kem HTTP 200. Bao dung nguyen nhan thay
    // vi "khong phai JSON", vi cach xu ly hoan toan khac nhau.
    if (isLoginRedirect(response, responseText)) {
      throw new Error(
        "Phien dang nhap da het hoac bi co so khac chiem khi luu phieu. " +
        "Dang nhap lai dung co so nay roi thu lai; phieu chua duoc luu."
      );
    }
    let body;
    try { body = JSON.parse(responseText); } catch (_) {
      throw new Error("Website tra ve DoSave khong phai JSON.");
    }
    if (Number(body?.code) !== 1 || !isGuid(body?.Tag?.ID)) {
      throw new Error(String(body?.message || body?.strData || "DoSave khong thanh cong."));
    }
    return { body, responseText, endpoint: new URL(endpoint).pathname, httpStatus: response.status };
  }

  // ---------------------------------------------------------------------------
  // Quầy BÁN LẺ không lập được hóa đơn điện tử, nên extension không bao giờ
  // tạo hoặc sửa phiếu trên đó. Nhận diện theo tên phòng/khu (có dấu hay không,
  // kể cả "BÁN LẺ 2", "KHU BÁN LẺ") và cờ quầy trong sơ đồ phòng của website.
  // ---------------------------------------------------------------------------
  function roomTextKey(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "D")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function isRetailRoomText(value) {
    return /(^| )BAN LE( |$)/.test(roomTextKey(value));
  }

  function mappedRoomById(roomId) {
    const id = String(roomId || "").trim().toLowerCase();
    if (!id) return null;
    return (roomMapCapture?.rooms || []).find(room => String(room.id || "").toLowerCase() === id) || null;
  }

  function assertNotRetailRoom({ roomId, roomName, room }) {
    const mapped = room || mappedRoomById(roomId);
    const retail = isRetailRoomText(roomName) ||
      Boolean(mapped && (Number(mapped.counter) || isRetailRoomText(mapped.name) || isRetailRoomText(mapped.areaName)));
    if (retail) {
      const label = String(roomName || mapped?.name || roomId || "").trim();
      throw new Error(
        `Phòng ${label} là quầy BÁN LẺ: không lập được hóa đơn điện tử nên extension không tạo hoặc sửa phiếu trên đó.`
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Form phiếu mới của một phòng, đọc bằng API thay vì mở form trên giao diện.
  //
  // GET AddEdit với RecordID rỗng + DBANID/DKHUVUCID chỉ DỰNG form cho phòng,
  // không tạo bản ghi nào (trace 02/08/2026, fixtures/api/create-invoice-init).
  // HTML trả về chứa script `new DataTransferJs({...})` — chính là formData mà
  // currentFormData() đọc khi form mở trên giao diện — nên tab danh sách tạo
  // được phiếu mới mà không cần mở tab Bán hàng phụ.
  // ---------------------------------------------------------------------------
  const FORM_DATA_MARKER = "new DataTransferJs(";

  function salesFormDataFromHtml(html) {
    const found = [];
    const source = String(html || "");
    let marker = source.indexOf(FORM_DATA_MARKER);
    while (marker >= 0) {
      const formData = extractJsonObject(source, marker);
      if (formData && String(formData._AddEditTableID || "") === SALES_TABLE_ID) found.push(formData);
      marker = source.indexOf(FORM_DATA_MARKER, marker + 1);
    }
    return found;
  }

  // Lỗi đọc form (mạng, HTML không đúng dạng) mang cờ formUnavailable: lúc đó
  // chưa gửi request ghi nào nên content được phép quay về cách mở tab phụ.
  function formUnavailableError(message) {
    const error = new Error(message);
    error.formUnavailable = true;
    return error;
  }

  async function loadBlankRoomForm(room) {
    const roomId = String(room?.id || "").trim();
    const areaId = String(room?.areaId || "").trim();
    const roomName = String(room?.name || "").trim();
    if (!isGuid(roomId)) throw new Error("Phòng được chọn thiếu id (DBANID) hợp lệ.");
    assertNotRetailRoom({ roomId, roomName, room });
    const query = new URLSearchParams({
      TableID: SALES_TABLE_ID,
      RecordID: "",
      Loai: "0",
      MaxTab: "0",
      NOTITLE: "1",
      DBANID: roomId,
      DKHUVUCID: areaId,
      is_dialog: "1"
    });
    let response;
    let html = "";
    try {
      response = await fetchForRead(`${location.origin}/${shopBasePath()}/AddEdit?${query}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
      });
      html = await response.text();
    } catch (error) {
      throw formUnavailableError(`Không tải được form phòng ${roomName}: ${error?.message || error}`);
    }
    if (isLoginRedirect(response, html)) {
      throw new Error("Phiên đăng nhập đã hết hoặc bị cơ sở khác chiếm khi mở form phòng; hãy đăng nhập lại.");
    }
    if (!response.ok) throw formUnavailableError(`Website từ chối mở form phòng ${roomName} (HTTP ${response.status}).`);
    const forRoom = salesFormDataFromHtml(html)
      .filter(formData => String(mapObject(formData.mapper?.Maps).DBANID || "").toLowerCase() === roomId.toLowerCase());
    if (!forRoom.length) {
      throw formUnavailableError(`Không đọc được dữ liệu form của phòng ${roomName} từ website.`);
    }
    const formData = forRoom[forRoom.length - 1];
    // Phòng đang có phiên chạy thì website nạp lại phiên đó (RecordID đã có):
    // tạo phiếu mới lúc này là ghi đè lên phiếu của khách đang hát.
    if (isGuid(formDataRecordId(formData))) {
      throw new Error(`Phòng ${roomName} đang có phiên chạy trên website; không tạo phiếu mới trên phòng này.`);
    }
    const fields = mapObject(formData.mapper?.Maps);
    if (!isGuid(fields.DKHOXUATID)) throw new Error(`Form phòng ${roomName} thiếu kho xuất (DKHOXUATID).`);
    return { formData, roomName, roomId, fieldCount: (formData.mapper?.Maps || []).length };
  }

  // Chỉ ĐỌC form của một phòng để người dùng kiểm tra luồng tạo phiếu không
  // cần tab phụ trên website thật. Không gửi request ghi nào.
  async function probeBlankRoomForm(room) {
    const loaded = await loadBlankRoomForm(room);
    const fields = mapObject(loaded.formData.mapper?.Maps);
    return {
      ok: true,
      roomName: loaded.roomName,
      roomId: loaded.roomId,
      fieldCount: loaded.fieldCount,
      recordIdBlank: !isGuid(formDataRecordId(loaded.formData)),
      warehouseId: String(fields.DKHOXUATID || ""),
      areaId: String(fields.DKHUVUCID || ""),
      // Đơn giá giờ form trả về (0 = form chưa có, extension sẽ tự đặt).
      roomRate: formAmount(fields.DONGIA)
    };
  }

  // Đơn giá giờ của TỪNG phòng, đọc từ form phòng trên website (DONGIA) bằng
  // đúng request loadBlankRoomForm dùng khi tạo phiếu: GET AddEdit + DBANID,
  // RecordID rỗng — chỉ dựng form, không tạo bản ghi. Phòng đang có phiên thì
  // website trả form của phiên đó; đơn giá vẫn là của phòng. Chỉ đọc.
  // Kim Giang đổi sang giá theo từng phòng (02/10/2026) nên mặc định 600.000đ
  // không còn đúng; xem docs/ROOM_HOURLY_RATES.md.
  async function readRoomHourlyRates(detail) {
    const rooms = (Array.isArray(detail?.rooms) ? detail.rooms : []).filter(room => isGuid(room?.id));
    const results = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, rooms.length) }, async () => {
      while (next < rooms.length) results.push(await readRoomHourlyRate(rooms[next++]));
    }));
    return { readAt: new Date().toISOString(), rooms: results };
  }

  // Lỗi của một phòng không làm hỏng cả lượt (phòng đó dùng giá dự phòng);
  // riêng mất đăng nhập thì dừng hẳn vì mọi phòng sau cũng sẽ lỗi.
  async function readRoomHourlyRate(room) {
    const roomId = String(room.id).trim();
    const roomName = String(room?.name || "").trim();
    const query = new URLSearchParams({
      TableID: SALES_TABLE_ID,
      RecordID: "",
      Loai: "0",
      MaxTab: "0",
      NOTITLE: "1",
      DBANID: roomId,
      DKHUVUCID: String(room?.areaId || "").trim(),
      is_dialog: "1"
    });
    let response;
    let html = "";
    try {
      response = await fetchForRead(`${location.origin}/${shopBasePath()}/AddEdit?${query}`, {
        method: "GET",
        credentials: "same-origin",
        headers: { "Accept": "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
      });
      html = await response.text();
    } catch (error) {
      return { id: roomId, name: roomName, rate: 0, error: String(error?.message || error) };
    }
    if (isLoginRedirect(response, html)) {
      throw new Error("Phiên đăng nhập đã hết hoặc bị cơ sở khác chiếm khi đọc giá phòng; hãy đăng nhập lại.");
    }
    if (!response.ok) return { id: roomId, name: roomName, rate: 0, error: `HTTP ${response.status}` };
    const formData = salesFormDataFromHtml(html)
      .filter(item => String(mapObject(item.mapper?.Maps).DBANID || "").toLowerCase() === roomId.toLowerCase())
      .at(-1);
    if (!formData) return { id: roomId, name: roomName, rate: 0, error: "không đọc được form phòng" };
    return {
      id: roomId,
      name: roomName,
      rate: formAmount(mapObject(formData.mapper?.Maps).DONGIA),
      busy: isGuid(formDataRecordId(formData))
    };
  }

  // Số tiền trong Maps của form là chuỗi thập phân ("175000.00"); không dùng
  // money() ở đây vì money() bỏ dấu chấm và đọc thành 17.500.000.
  function formAmount(value) {
    return Math.round(Number(String(value ?? "").replace(/,/g, "")) || 0);
  }

  // Đọc số liệu đầu phiếu đã có theo ID bằng API, không mở form trên giao diện:
  // GET AddEdit với RecordID trả HTML chứa DataTransferJs của phiếu (cách các
  // script chuyển phòng data/chuyen-phong-*.js đã chạy trên trang thật). Chỉ
  // đọc. Dòng hàng không nằm trong dữ liệu này; đọc riêng bằng
  // readInvoiceItemsViaApi.
  async function readInvoiceSummary(detail) {
    const id = String(detail?.id || "").trim();
    const formData = await readInvoiceFormById(id, detail?.invoiceNo);
    const fields = mapObject(formData.mapper?.Maps);
    return {
      id,
      invoiceNo: String(fields.NAME || "").trim(),
      goods: formAmount(fields.TIENHANG),
      hour: formAmount(fields.TIENGIO),
      tax: formAmount(fields.TIENTHUE),
      grand: formAmount(fields.TONGCONG),
      roomId: String(fields.DBANID || "").trim()
    };
  }

  // Đọc trọn một phiếu đã lưu chỉ bằng API — đầu phiếu (AddEdit), dòng hàng
  // (LayDuLieuChiTiet), tên phòng (sơ đồ phòng) — và trả CÙNG DẠNG scan() mà
  // luồng đối soát lại dùng. Trước đây phải mở phiếu trên danh sách Bán hàng,
  // không chạy được ở màn hình khác (ở Paris Nhơn "Bán hàng" là sơ đồ phòng).
  async function readInvoiceSnapshot(detail) {
    const id = String(detail?.id || "").trim();
    const formData = await readInvoiceFormById(id, detail?.invoiceNo);
    const fields = mapObject(formData.mapper?.Maps);
    const items = await readInvoiceItemsViaApi(id);
    const roomId = String(fields.DBANID || "").trim();
    return {
      ready: true,
      id,
      invoiceNo: String(fields.NAME || "").trim(),
      currentGoods: formAmount(fields.TIENHANG),
      currentHour: formAmount(fields.TIENGIO),
      currentTax: formAmount(fields.TIENTHUE),
      currentGrand: formAmount(fields.TONGCONG),
      roomId,
      roomName: await roomNameById(roomId),
      checkIn: uiDateTimeText(parseFormDateTime(fields.BATDAUPHONGCUOI) || parseFormDateTime(fields.BATDAU)),
      checkOut: uiDateTimeText(parseFormDateTime(fields.KETTHUC)),
      items
    };
  }

  // Sơ đồ phòng đã bắt trước, chưa có phòng đó thì gọi lại một lần. Không tra
  // được thì trả "" — bên gọi coi như không biết phòng, không đoán.
  async function roomNameById(roomId) {
    if (!roomId) return "";
    const find = map => (map?.rooms || []).find(room => room.id === roomId);
    const room = find(await getRoomMap().catch(() => null)) ||
      find(await getRoomMap({ refresh: true }).catch(() => null));
    return String(room?.name || "").trim();
  }

  // Cùng định dạng ô Giờ vào/Giờ ra trên form ("01/07/2026 19:15"), là dạng
  // content đọc bằng parseUiDateTime.
  function uiDateTimeText(milliseconds) {
    if (!milliseconds) return "";
    const date = new Date(milliseconds);
    if (Number.isNaN(date.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  async function readInvoiceFormById(recordId, invoiceNo) {
    const id = String(recordId || "").trim();
    if (!isGuid(id)) throw new Error(`ID phiếu không hợp lệ: ${id || "trống"}.`);
    const label = String(invoiceNo || id);
    const query = new URLSearchParams({
      TableID: SALES_TABLE_ID,
      RecordID: id,
      Loai: "0",
      MaxTab: "0",
      NOTITLE: "1",
      is_dialog: "1"
    });
    const response = await fetchForRead(`${location.origin}/${shopBasePath()}/AddEdit?${query}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
    });
    const html = await response.text();
    if (isLoginRedirect(response, html)) {
      throw new Error("Phiên đăng nhập đã hết hoặc bị cơ sở khác chiếm khi đọc phiếu; hãy đăng nhập lại.");
    }
    if (!response.ok) throw new Error(`Website từ chối đọc phiếu ${label} (HTTP ${response.status}).`);
    const formData = salesFormDataFromHtml(html)
      .find(item => formDataRecordId(item).toLowerCase() === id.toLowerCase());
    if (!formData) throw new Error(`Không đọc được dữ liệu phiếu ${label} từ website.`);
    return formData;
  }

  // Thời điểm trong Maps của form có nhiều dạng: /Date(ms)/, ISO có múi giờ
  // ("2026-07-01T12:15:00.000Z"), giờ địa phương "2026-07-01 19:15:00" và
  // "7/1/2026 7:50:00 PM". Trả mili-giây, hoặc 0 khi không đọc được.
  function parseFormDateTime(value) {
    if (value == null || value === "") return 0;
    const text = String(value).trim();
    let match = text.match(/\/Date\((-?\d+)/);
    if (match) return Number(match[1]);
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
      const time = Date.parse(text);
      return Number.isFinite(time) ? time : 0;
    }
    match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (match) return new Date(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +(match[6] || 0)).getTime();
    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (match) {
      let hour = +match[4];
      if (match[7]) hour = (hour % 12) + (match[7].toUpperCase() === "PM" ? 12 : 0);
      return new Date(+match[3], +match[1] - 1, +match[2], hour, +match[5], +(match[6] || 0)).getTime();
    }
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Sửa người mua + phương thức thanh toán của phiếu đã lưu, CHƯA xuất hóa đơn
  // (kế toán chốt 02/10/2026; từ 1.29.4 phiếu mới đã lưu đúng):
  //   phương thức đúng "TM" hoặc "CK"             -> TM/CK
  //   người mua mặc định cũ của website hoặc trống -> DEFAULT_INVOICE_BUYER
  // Thay script console scripts/sua-nguoi-mua-tmck.js: chạy thật cứ khoảng 50
  // phiếu lại dừng (rớt kết nối, website đuối sau nhiều lần mở/đóng phiếu), mà
  // script trong Console không sống qua lần tải lại trang. Ở đây content giữ tiến
  // độ trong storage, tự tải lại trang rồi chạy tiếp. Mỗi phiếu được đọc lại từ
  // server trước khi sửa nên phiếu đã xong trước lần tải lại tự được bỏ qua.
  //
  // Chỉ đổi PHUONGTHUCTT/NGUOIMUAHANG (DIACHIKHACH khi trống); mọi trường khác
  // lấy nguyên từ form server. Không dùng buildCurrentSavePayload: hàm đó ghi đè
  // tiền/giờ theo phương án và chặn giảm giá, sai với phiếu nhân viên tự lập.
  // ---------------------------------------------------------------------------
  const BUYER_FIX_PAYMENTS = new Set(["TM", "CK"]);
  // Phiếu extension đã tạo/cập nhật (gắn giao dịch, có trong sổ đối soát): sửa cả
  // phiếu đã TM/CK mà người mua còn mặc định cũ (luồng sao kê trước 1.29.4).
  const BUYER_FIX_OUR_PAYMENTS = new Set(["TM", "CK", "TM/CK", ""]);
  // Người mua mặc định của website (extension cũng ghi người mua này trước 1.29.4).
  const BUYER_FIX_OLD_BUYER = "Khách lẻ - Không lấy hóa đơn";

  function buyerFixDecision(fields, options = {}) {
    const buyer = String(fields?.NGUOIMUAHANG ?? "").trim();
    const payment = String(fields?.PHUONGTHUCTT ?? "").trim().toUpperCase();
    if (String(fields?.SOHD || "").trim()) return { skip: "đã xuất hóa đơn" };
    if (payment === INVOICE_PAYMENT_METHOD && buyer === DEFAULT_INVOICE_BUYER) return { skip: "đã đúng" };
    const payments = options.ourInvoice ? BUYER_FIX_OUR_PAYMENTS : BUYER_FIX_PAYMENTS;
    if (!payments.has(payment)) return { skip: `thanh toán ${payment || "(trống)"}` };
    const replaceable = !buyer || buyer === DEFAULT_INVOICE_BUYER ||
      normalizedVietnameseText(buyer) === normalizedVietnameseText(BUYER_FIX_OLD_BUYER);
    if (!replaceable) return { skip: `người mua khác: ${buyer}` };
    const changes = {};
    if (payment !== INVOICE_PAYMENT_METHOD) changes.PHUONGTHUCTT = INVOICE_PAYMENT_METHOD;
    if (buyer !== DEFAULT_INVOICE_BUYER) changes.NGUOIMUAHANG = DEFAULT_INVOICE_BUYER;
    if (!String(fields?.DIACHIKHACH ?? "").trim()) changes.DIACHIKHACH = DEFAULT_INVOICE_ADDRESS;
    return { changes };
  }

  // Ngày nghiệp vụ theo giờ Việt Nam, không phụ thuộc múi giờ của máy.
  function vietnamDateKey(milliseconds) {
    return milliseconds ? new Date(milliseconds + 7 * 3600000).toISOString().slice(0, 10) : "";
  }

  // Cùng cách script chuyển phòng đã chạy trên website: Maps lấy nguyên từ form
  // server, các mốc giờ giữ nguyên thời điểm, chỉ chuẩn hóa định dạng như request
  // của website; TIENGIOPHONGCUOI = TIENGIO để đọc lại không bị khôi phục số cũ.
  function buyerFixPayload(formData, detailRows, changes) {
    const fields = mapObject(formData.mapper?.Maps);
    const recordId = formDataRecordId(formData);
    const checkIn = parseFormDateTime(fields.BATDAUPHONGCUOI) || parseFormDateTime(fields.BATDAU);
    const checkOut = parseFormDateTime(fields.KETTHUC);
    const paidAt = parseFormDateTime(fields.GIOTHANHTOAN) || checkOut;
    const documentDate = parseFormDateTime(fields.NGAY);
    if (!checkIn || !checkOut || !documentDate) {
      throw new Error(`${fields.NAME}: không đọc được NGAY/giờ vào/giờ ra trên form.`);
    }
    const overrides = {
      ...changes,
      TIENGIOPHONGCUOI: formAmount(fields.TIENGIO),
      NGAY: localMidnightIso(vietnamDateKey(documentDate)),
      BATDAUPHONGCUOI: new Date(checkIn).toISOString(),
      BATDAU: new Date(checkIn).toISOString(),
      KETTHUC: new Date(checkOut).toISOString(),
      GIOTHANHTOAN: localUsDateTime(new Date(paidAt))
    };
    const maps = (formData.mapper?.Maps || []).map(map => {
      const field = String(map.Field || "").toUpperCase();
      return { Field: map.Field, Value: Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : map.Value };
    });
    const grand = formAmount(fields.TONGCONG);
    return {
      mode: 2,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: recordId,
        Maps: maps,
        Grids: [{ Name: "detail", Data: detailRows }],
        CustomPostTable: [{
          Name: "LoaiQuy",
          Data: [
            { truong: "TRALAI", value: formAmount(fields.TRALAI) },
            { truong: "TIENTHANHTOAN", value: formAmount(fields.TIENTHANHTOAN) || grand },
            { truong: "KHACHDUA", value: formAmount(fields.KHACHDUA) || grand },
            { truong: "TIENMAT", value: formAmount(fields.TIENMAT) || grand }
          ]
        }],
        CustomPost: { MODEQUANLY: Number(formData.ModeQuanLy) || 30, GioClient: localServerDateTime(new Date()) }
      },
      TableID: SALES_TABLE_ID,
      ID: recordId,
      Loai: Number(formData.Loai) || 0
    };
  }

  // Dòng hàng gửi lại phải đúng từng dòng đang có: thiếu một dòng là website xóa
  // dòng đó. Phiếu "chỉ hát" (tiền hàng 0) không có dòng nào.
  function buyerFixCheckRows(rows, goods, invoiceNo) {
    if (!rows.length && goods === 0) return;
    if (!rows.length) throw new Error(`${invoiceNo}: form không có dòng hàng.`);
    let sum = 0;
    for (const row of rows) {
      const qty = Math.round(Number(row.SLXUATCHUAQUYDOI ?? row.SLXUAT) || 0);
      const price = Math.round(Number(row.DONGIA) || 0);
      if (!row.DMATHANGID || qty <= 0 || price <= 0 || Math.round(Number(row.THANHTIEN) || 0) !== qty * price) {
        throw new Error(`${invoiceNo}: dòng hàng ${row.DMATHANG_CODE || row.TENHANG || "?"} sai số lượng/giá/thành tiền.`);
      }
      sum += qty * price;
    }
    if (sum !== goods) throw new Error(`${invoiceNo}: tổng dòng hàng ${sum} khác tiền hàng ${goods}.`);
  }

  function buyerFixVerify(before, after, changes) {
    const problems = [];
    for (const [field, value] of Object.entries(changes)) {
      if (String(after[field] ?? "").trim() !== value) problems.push(`${field} là "${after[field] ?? ""}", chưa thành "${value}"`);
    }
    for (const field of ["TONGCONG", "TIENGIO", "TIENHANG", "TIENTHUE"]) {
      if (formAmount(after[field]) !== formAmount(before[field])) {
        problems.push(`${field} ${formAmount(after[field])} (trước ${formAmount(before[field])})`);
      }
    }
    if (String(after.DBANID || "").toLowerCase() !== String(before.DBANID || "").toLowerCase()) problems.push("phòng bị đổi");
    if (String(after.SOHD || "").trim()) problems.push("phiếu đã có số hóa đơn");
    const sameTime = (a, b) => Boolean(a && b && Math.abs(a - b) < 60000);
    const checkIn = fields => parseFormDateTime(fields.BATDAUPHONGCUOI) || parseFormDateTime(fields.BATDAU);
    if (!sameTime(checkIn(after), checkIn(before)) || !sameTime(parseFormDateTime(after.KETTHUC), parseFormDateTime(before.KETTHUC))) {
      problems.push("giờ vào/ra bị đổi");
    }
    return problems;
  }

  // Dòng hàng của phiếu đọc bằng API, không mở phiếu trên giao diện. Chẩn đoán trên
  // trang thật (Linh Đàm 02/10/2026): khi mở phiếu, website chỉ gọi GET AddEdit
  // (MaxTab=6, ModeQuanLy=30) rồi các lookup; không request nào khác trả dòng hàng,
  // nên dòng hàng nằm sẵn trong HTML đó. Mở phiếu qua giao diện (lọc ngày, lật
  // trang, chờ form) thì chập chờn: treo quá 90s ở phiếu nằm trang 2.
  //
  // Không phụ thuộc tên biến trong HTML: lấy mọi object JSON có "DMATHANGID" là
  // GUID cùng SLXUATCHUAQUYDOI và THANHTIEN (định nghĩa cột chỉ có "field":
  // "DMATHANGID" nên không lọt). buyerFixInvoice còn đối chiếu tổng với tiền hàng
  // trước khi lưu và so từng dòng sau khi lưu.
  const BUYER_FIX_ROW_KEY = /"DMATHANGID"\s*:\s*"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/gi;

  // Ngày trong JSON server ("/Date(ms)/") đổi về dạng website gửi khi lưu
  // ("2026-07-01 00:00:00", giờ Việt Nam), như request DoSave thật đã ghi.
  function buyerFixRowDates(row) {
    const copy = { ...row };
    for (const [key, value] of Object.entries(copy)) {
      const match = typeof value === "string" ? value.match(/^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/) : null;
      if (match) copy[key] = new Date(Number(match[1]) + 7 * 3600000).toISOString().slice(0, 19).replace("T", " ");
    }
    return copy;
  }

  function buyerFixRowsFromHtml(html) {
    const source = String(html || "");
    const rows = new Map();
    BUYER_FIX_ROW_KEY.lastIndex = 0;
    let match;
    while ((match = BUYER_FIX_ROW_KEY.exec(source))) {
      // Object nhỏ nhất bao quanh khóa: lùi từng "{" cho tới object có DMATHANGID.
      let brace = match.index;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        brace = source.lastIndexOf("{", brace - 1);
        if (brace < 0) break;
        const object = extractJsonObject(source, brace);
        if (object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, "DMATHANGID") &&
            object.SLXUATCHUAQUYDOI !== undefined && object.THANHTIEN !== undefined) {
          if (isGuid(object.ID)) rows.set(String(object.ID).toLowerCase(), buyerFixRowDates(object));
          break;
        }
      }
    }
    return [...rows.values()];
  }

  // Đọc phiếu đúng như website gọi khi mở phiếu: formData + dòng hàng (kèm ID dòng).
  async function buyerFixReadInvoice(recordId, invoiceNo) {
    const id = String(recordId || "").trim();
    if (!isGuid(id)) throw new Error(`ID phiếu không hợp lệ: ${id || "trống"}.`);
    const label = String(invoiceNo || id);
    const query = new URLSearchParams({
      TableID: SALES_TABLE_ID,
      RecordID: id,
      Loai: "0",
      MaxTab: "6",
      notitle: "1",
      ModeQuanLy: "30",
      is_dialog: "1"
    });
    const response = await fetchForRead(`${location.origin}/${shopBasePath()}/AddEdit?${query}`, {
      method: "GET",
      credentials: "same-origin",
      headers: { "Accept": "text/html, */*; q=0.01", "X-Requested-With": "XMLHttpRequest" }
    });
    const html = await response.text();
    if (isLoginRedirect(response, html)) {
      throw new Error("Phiên đăng nhập đã hết hoặc bị cơ sở khác chiếm khi đọc phiếu; hãy đăng nhập lại.");
    }
    if (!response.ok) throw new Error(`Website từ chối đọc phiếu ${label} (HTTP ${response.status}).`);
    const formData = salesFormDataFromHtml(html)
      .find(item => formDataRecordId(item).toLowerCase() === id.toLowerCase());
    if (!formData) throw new Error(`Không đọc được dữ liệu phiếu ${label} từ website.`);
    return { formData, rows: buyerFixRowsFromHtml(html) };
  }

  // So từng dòng hàng trước/sau khi lưu: cùng ID, mặt hàng, số lượng, giá, thành tiền, ngày.
  function buyerFixRowsDiffer(before, after) {
    const key = row => [
      String(row.ID || "").toLowerCase(),
      String(row.DMATHANGID || "").toLowerCase(),
      Math.round(Number(row.SLXUATCHUAQUYDOI ?? row.SLXUAT) || 0),
      Math.round(Number(row.DONGIA) || 0),
      Math.round(Number(row.THANHTIEN) || 0),
      String(row.NGAYTHUCHIEN ?? "")
    ].join("|");
    const left = before.map(key).sort();
    const right = after.map(key).sort();
    return left.length !== right.length || left.some((value, index) => value !== right[index]);
  }

  // Danh sách phiếu cần xét trong khoảng ngày. Chọn sơ bộ theo dòng danh sách
  // (một request) thay vì đọc từng form; buyerFixInvoice đọc lại form trước khi
  // sửa nên chọn sơ bộ thừa cũng không sao.
  async function buyerFixScan(detail) {
    const fromDate = normalizeDateKey(detail?.fromDate);
    const toDate = normalizeDateKey(detail?.toDate);
    // Chỉ phiếu extension đã tạo/cập nhật: content gửi danh sách số phiếu gắn
    // giao dịch / có trong sổ đối soát. Phiếu nhân viên tự lập không bị đụng tới.
    const allowed = Array.isArray(detail?.invoiceNos) ? new Set(detail.invoiceNos.map(value => String(value).trim())) : null;
    const { rows } = await fetchEInvoiceList({ fromDate, toDate });
    // Danh sách không mang phương thức thanh toán thì không lọc sơ bộ được: đưa
    // mọi phiếu chưa xuất vào, buyerFixInvoice tự xét theo form từng phiếu.
    const listHasPayment = rows.some(row => String(row.paymentMethod || "").trim());
    const targets = [];
    const skipped = {};
    const skip = reason => {
      const key = reason.startsWith("người mua khác") ? "người mua khác (giữ nguyên)" : reason;
      skipped[key] = (skipped[key] || 0) + 1;
    };
    for (const row of rows) {
      if (allowed && !allowed.has(String(row.invoiceNo).trim())) { skip("ngoài giao dịch của extension"); continue; }
      if (row.cancelled) { skip("đã hủy"); continue; }
      if (row.issued) { skip("đã xuất hóa đơn"); continue; }
      const decision = listHasPayment
        ? buyerFixDecision({ NGUOIMUAHANG: row.buyer, PHUONGTHUCTT: row.paymentMethod, DIACHIKHACH: "-" }, { ourInvoice: Boolean(allowed) })
        : { changes: {} };
      if (!decision.changes) { skip(decision.skip); continue; }
      targets.push({
        id: row.id,
        invoiceNo: row.invoiceNo,
        dateKey: row.dateKey,
        grandTotal: row.grandTotal,
        paymentMethod: String(row.paymentMethod || "").trim().toUpperCase()
      });
    }
    targets.sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.invoiceNo.localeCompare(right.invoiceNo));
    return { fromDate, toDate, total: rows.length, targets, skipped, listHasPayment };
  }

  // Sửa một phiếu. Kết quả: fixed, hoặc skipped kèm lý do (đã đúng — kể cả phiếu
  // vừa lưu trước lần tải lại —, đã xuất, quầy BÁN LẺ, người mua thật...).
  // Chỉ dùng API: đọc phiếu (kèm dòng hàng) -> DoSave -> đọc lại so cả đầu phiếu lẫn
  // từng dòng hàng. Không mở form, không lọc/lật trang danh sách.
  async function buyerFixInvoice(detail) {
    // ID phiếu đi trong `recordId`: `id` của sự kiện là mã yêu cầu để trả lời.
    const id = String(detail?.recordId || "").trim();
    const invoiceNo = String(detail?.invoiceNo || "").trim();
    const { formData, rows } = await buyerFixReadInvoice(id, invoiceNo);
    const before = mapObject(formData.mapper?.Maps);
    if (String(before.NAME || "").trim() !== invoiceNo) {
      throw new Error(`Phiếu ${id} trên website là ${before.NAME || "?"}, không phải ${invoiceNo}.`);
    }
    const decision = buyerFixDecision(before, { ourInvoice: Boolean(detail?.ourInvoice) });
    if (!decision.changes) return { status: "skipped", reason: decision.skip };
    await getRoomMap().catch(() => null);
    try {
      assertNotRetailRoom({ roomId: before.DBANID });
    } catch (_) {
      return { status: "skipped", reason: "quầy BÁN LẺ" };
    }
    // Dòng hàng gửi lại phải đúng từng dòng đang có (thiếu dòng là website xóa
    // dòng đó): không đọc được hoặc tổng không khớp tiền hàng thì bỏ qua phiếu,
    // không gửi gì.
    const goods = formAmount(before.TIENHANG);
    try {
      buyerFixCheckRows(rows, goods, invoiceNo);
    } catch (error) {
      return { status: "skipped", reason: `dòng hàng không khớp: ${error.message}` };
    }
    const payload = buyerFixPayload(formData, rows, decision.changes);
    const response = await window.fetch(`${location.origin}/${shopBasePath()}/AddEdit/DoSave?is_ajax=1`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json;utf-8", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(payload)
    });
    verifySaveResponse(await response.text(), id);
    const reread = await buyerFixReadInvoice(id, invoiceNo);
    const after = mapObject(reread.formData.mapper?.Maps);
    const problems = buyerFixVerify(before, after, decision.changes);
    if (buyerFixRowsDiffer(rows, reread.rows)) problems.push("dòng hàng sau khi lưu khác trước khi lưu");
    if (problems.length) throw new Error(`${invoiceNo}: đã lưu nhưng đọc lại thấy sai: ${problems.join("; ")}.`);
    return { status: "fixed", changes: Object.keys(decision.changes) };
  }

  // Lịch phòng THẬT của một ngày trên website: mọi phiếu của ngày (danh sách
  // hóa đơn điện tử, gồm cả phiếu đã phát hành, bỏ phiếu đã hủy) kèm phòng và
  // giờ vào/ra đọc từ đầu phiếu. Chỉ đọc. Sơ đồ phòng chỉ cho trạng thái HÔM
  // NAY, nên phiếu lập bù cho ngày quá khứ cần lịch này để không chồng giờ với
  // phiếu khác cùng phòng (cách script data/chuyen-phong-01000000269.js làm).
  async function readDayRoomBookings(detail) {
    const dateKey = normalizeDateKey(detail?.dateKey);
    if (!dateKey) throw new Error("Thiếu ngày để đọc lịch phòng.");
    const list = await fetchEInvoiceList({ dateKey });
    const rows = (list.rows || []).filter(row => row.id && !row.cancelled);
    const bookings = [];
    const unreadable = [];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        const formData = await readInvoiceFormById(row.id, row.invoiceNo);
        const fields = mapObject(formData.mapper?.Maps);
        const from = parseFormDateTime(fields.BATDAUPHONGCUOI) || parseFormDateTime(fields.BATDAU);
        const to = parseFormDateTime(fields.KETTHUC);
        const roomId = String(fields.DBANID || "").trim();
        if (roomId && from && to) bookings.push({ invoiceNo: row.invoiceNo, roomId, from, to });
        else unreadable.push(row.invoiceNo);
      }
    }));
    return { dateKey, invoiceCount: rows.length, bookings, unreadable };
  }

  // Tạo phiếu mới bằng hai request DoSave giống website: mode=0 tạo phiên (server
  // cấp số phiếu), rồi mode=2 thanh toán đúng ID đó. `progress` cho lớp gọi biết
  // request đã rời trình duyệt chưa, để phân biệt lỗi an toàn với lỗi chưa rõ.
  // `context` có formData/roomName khi form được đọc bằng API; không có thì
  // dùng form đang mở trên giao diện (luồng tab phụ).
  async function postFreshInvoiceTwoStep(expected, progress = {}, context = null) {
    const formData = context?.formData || currentFormData({ allowBlankRecordId: true });
    const roomLabel = context ? String(context.roomName || "") : String(suffixInput("lblTENBAN")?.textContent || "");
    const paymentMethod = invoiceCreationPaymentMethod(expected);
    if (isGuid(formDataRecordId(formData))) {
      throw new Error("Form hien tai da co ID; khong duoc dung flow tao phieu moi hai buoc.");
    }
    const grand = Math.round(Number(expected?.targetGrand) || 0);
    const goods = Math.round(Number(expected?.targetGoods) || 0);
    const hour = Math.round(Number(expected?.targetHour) || 0);
    const tax = Math.round(Number(expected?.targetTax) || 0);
    const taxRate = 10;
    const checkIn = parseDateTime(expected?.checkIn);
    const checkOut = parseDateTime(expected?.checkOut);
    const invoiceDateKey = normalizeDateKey(expected?.invoiceDateKey);
    if (!grand || goods <= 0 || hour <= 0 || tax < 0 || goods + hour + tax !== grand) {
      throw new Error("Tong = tien hang + tien gio + VAT cua phuong an API khong hop le.");
    }
    if (!invoiceDateKey || !checkIn || !checkOut || checkOut <= checkIn || localDateKey(checkIn) !== invoiceDateKey) {
      throw new Error("Ngay va gio vao/ra cua phieu moi khong hop le.");
    }
    const baseFields = mapObject(formData.mapper?.Maps);
    const roomId = String(baseFields.DBANID || "").trim();
    const warehouseId = String(baseFields.DKHOXUATID || "").trim();
    if (!isGuid(roomId) || !isGuid(warehouseId)) throw new Error("Form phong moi thieu DBANID hoac DKHOXUATID.");
    assertNotRetailRoom({ roomId, roomName: roomLabel });
    // Đơn giá giờ của phòng (DONGIA ở đầu phiếu). Phương án tính Tiền giờ theo
    // đơn giá hạng phòng, nên phiếu phải LƯU đúng đơn giá đó — để 0 (form đọc
    // bằng API có thể chưa được giao diện điền) hoặc đơn giá khác thì Tiền giờ
    // không còn khớp đơn giá × thời lượng. Các script chuyển phòng trong data/
    // cũng phải tự đặt DONGIA khi đổi phòng. Form có sẵn đơn giá KHÁC phương án
    // nghĩa là bảng giá phòng của extension sai cho phòng này: dừng trước khi gửi.
    const plannedRate = Math.round(Number(expected?.hourlyRate) || 0);
    const formRate = formAmount(baseFields.DONGIA);
    if (plannedRate > 0 && formRate > 0 && formRate !== plannedRate) {
      throw new Error(
        `Phòng ${String(roomLabel || "").trim() || roomId} có đơn giá giờ ${formRate} trên website nhưng phương án tính theo ` +
        `${plannedRate}; không tạo phiếu. Bấm "Đọc giá giờ các phòng" ở Batch Review rồi tính lại phương án của giao dịch này.`
      );
    }
    const products = await fetchProductRowsForApiPlan(expected.items, warehouseId);
    const sessionRows = freshSessionDetailRows(expected.items, products, invoiceDateKey);
    const calculatedGoods = sessionRows.reduce((sum, row) => sum + row.THANHTIEN, 0);
    if (calculatedGoods !== goods) throw new Error("Tong chi tiet hang khong bang tien hang cua phuong an.");
    const commonOverrides = {
      BATDAUPHONGCUOI: checkIn.toISOString(),
      KETTHUC: checkOut.toISOString(),
      BATDAU: checkIn.toISOString(),
      NGAY: localMidnightIso(invoiceDateKey),
      GIOTHANHTOAN: localUsDateTime(checkOut),
      TILETHUE: taxRate,
      TILEGIAMGIA: 0,
      TIENGIAMGIA: 0,
      TILEGIAMGIAGIO: 0,
      TIENGIAMGIAGIO: 0,
      TIENGIAMGIATONG: 0,
      TIENHANG: goods,
      TIENGIO: hour,
      TIENGIOPHONGCUOI: hour,
      TIENTHUE: tax,
      TONGCONG: grand,
      PHUONGTHUCTT: paymentMethod,
      NGUOIMUAHANG: String(expected?.buyerName || DEFAULT_INVOICE_BUYER).trim() || DEFAULT_INVOICE_BUYER,
      DIACHIKHACH: String(expected?.buyerAddress || DEFAULT_INVOICE_ADDRESS).trim() || DEFAULT_INVOICE_ADDRESS,
      SOHD: "",
      MODE: 1,
      // Cùng định dạng chuỗi thập phân website dùng ("400000.00").
      ...(plannedRate > 0 ? { DONGIA: plannedRate.toFixed(2) } : {})
    };
    const sessionPayload = {
      mode: 0,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: "",
        Maps: setMapValues(formData.mapper?.Maps, {
          ...commonOverrides,
          NAME: "Tự động",
          LASTSAVEID: "",
          DIENGIAI: ""
        }),
        Grids: [{ Name: "detail", Data: sessionRows }],
        CustomPostTable: [{
          Name: "LuuVet",
          Data: sessionRows.map(row => ({
            PHANLOAI: 4,
            BAN: roomLabel,
            NOTE: `Them mat hang '${row.TENHANG}' vao bill, so luong: ${row.SLXUATCHUAQUYDOI}`,
            SOLUONG: row.SLXUATCHUAQUYDOI,
            DONGIA: row.DONGIA,
            THANHTIEN: 0,
            TENHANG: row.TENHANG,
            // Fresh DoSave derives NGAY from this client time.
            GIOCLIENT: localServerDateTime(checkOut).replace(/-/g, "/"),
            CHUCNANG: "Su dung dich vu",
            THIETBI: ""
          }))
        }],
        CustomPost: { MODEQUANLY: 0, GioClient: localServerDateTime(checkOut) }
      },
      TableID: SALES_TABLE_ID,
      ID: "",
      Loai: 0
    };
    // Từ đây request đã rời trình duyệt: server có thể đã tạo phiếu dù phía
    // này nhận lỗi, nên lỗi phía sau KHÔNG được coi là an toàn để tạo lại.
    progress.sessionSent = true;
    const session = await postDoSavePayload(sessionPayload);
    const sessionTag = session.body.Tag || {};
    if (!isGuid(sessionTag.LASTSAVEID) || !String(sessionTag.NAME || "").trim()) {
      throw new Error("Luu phien thanh cong nhung thieu NAME hoac LASTSAVEID.");
    }
    progress.sessionInvoiceNo = String(sessionTag.NAME);
    progress.sessionRecordId = String(sessionTag.ID || "");
    const paymentRows = finalPaymentDetailRows(sessionRows, sessionTag.detail, warehouseId, taxRate, invoiceDateKey);
    const paymentPayload = {
      mode: 2,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: sessionTag.ID,
        Maps: setMapValues(sessionPayload.clientMap.Maps, {
          ...commonOverrides,
          NAME: sessionTag.NAME,
          LASTSAVEID: sessionTag.LASTSAVEID,
          DIENGIAI: "Xuat ban hang"
        }),
        Grids: [{ Name: "detail", Data: paymentRows }],
        CustomPostTable: [
          { Name: "ThanhToan", Data: [
            { truong: "KHACHDUA", value: grand },
            { truong: "TRALAI", value: 0 }
          ] },
          { Name: "LoaiQuy", Data: [
            { truong: "TIENMAT", value: grand },
            { truong: "TIENTHANHTOAN", value: grand }
          ] }
        ],
        CustomPost: {
          MODEQUANLY: 0,
          // Keep the newly-created invoice on the accepted bank-statement day.
          GioClient: localServerDateTime(checkOut),
          DVOUCHERID: null,
          XUATHOADON: false
        }
      },
      TableID: SALES_TABLE_ID,
      ID: sessionTag.ID,
      Loai: 0
    };
    let payment;
    try {
      payment = await postDoSavePayload(paymentPayload);
    } catch (error) {
      if (!isNetworkFetchError(error)) throw error;
      // Mất phản hồi: server có thể ĐÃ đóng bill. Đọc lại trước, KHÔNG gửi lại.
      await wait(1500);
      const check = await confirmFreshInvoicePayment({
        recordId: sessionTag.ID,
        invoiceNo: sessionTag.NAME,
        expected: { targetGrand: grand, targetGoods: goods, targetHour: hour, targetTax: tax }
      });
      if (!check.confirmed) {
        throw new Error(`${error.message}; doc lai phieu chua thay da thanh toan (${check.reason}).`);
      }
      return {
        saved: true,
        createdFresh: true,
        invoiceNo: String(sessionTag.NAME),
        savedRecordId: String(sessionTag.ID),
        lastSaveId: check.lastSaveId,
        endpoint: session.endpoint,
        httpStatus: null,
        sessionHttpStatus: session.httpStatus,
        rowCount: paymentRows.length,
        targetGrand: grand,
        recoveredBy: "readback"
      };
    }
    if (String(payment.body.Tag.ID).toLowerCase() !== String(sessionTag.ID).toLowerCase()) {
      throw new Error("API thanh toan tra ve ID khac phien vua tao.");
    }
    return {
      saved: true,
      createdFresh: true,
      invoiceNo: String(sessionTag.NAME),
      savedRecordId: String(sessionTag.ID),
      lastSaveId: String(payment.body.Tag.LASTSAVEID || ""),
      endpoint: payment.endpoint,
      httpStatus: payment.httpStatus,
      sessionHttpStatus: session.httpStatus,
      rowCount: paymentRows.length,
      targetGrand: grand
    };
  }

  // Bước thanh toán (mode=2) của phiếu mới có thể đã được server ghi mà phản hồi
  // rớt trên đường về ("Failed to fetch"). Ca thật Paris Nhơn 04/10/2026:
  // 01000000781 đã đóng bill đủ 491.700 nhưng extension nhận lỗi và dừng lô.
  // Chỉ coi là ĐÃ thanh toán khi mọi dấu hiệu cùng khớp: cờ đã thanh toán
  // (DATHANHTOAN = 30, như mọi phiếu đóng bill), diễn giải "Xuất bán hàng" (bước
  // lưu phiên mode=0 ghi rỗng), tiền thanh toán = tổng, tiền hàng/giờ/VAT/tổng
  // đúng phương án, đúng số phiếu, chưa có số HĐ. Thiếu một dấu hiệu là không kết
  // luận. Dòng hàng còn được bước đối soát sau lưu so từng mã trước khi trừ kho.
  function freshPaymentProblems(fields, expected, invoiceNo) {
    const problems = [];
    const amount = key => formAmount(fields?.[key]);
    const want = key => Math.round(Number(expected?.[key]) || 0);
    if (String(fields?.NAME || "").trim() !== String(invoiceNo || "").trim()) problems.push(`số phiếu ${fields?.NAME || "?"}`);
    if (!["30", "true", "1"].includes(String(fields?.DATHANHTOAN ?? "").trim().toLowerCase())) {
      problems.push(`chưa có cờ đã thanh toán (${fields?.DATHANHTOAN ?? "trống"})`);
    }
    if (normalizedVietnameseText(fields?.DIENGIAI) !== "XUAT BAN HANG") problems.push(`diễn giải "${fields?.DIENGIAI || ""}"`);
    const grand = want("targetGrand");
    if (!grand || amount("TONGCONG") !== grand) problems.push(`tổng ${amount("TONGCONG")} khác ${grand}`);
    if (amount("TIENTHANHTOAN") !== grand) problems.push(`tiền thanh toán ${amount("TIENTHANHTOAN")}`);
    for (const [field, key, label] of [["TIENHANG", "targetGoods", "tiền hàng"], ["TIENGIO", "targetHour", "tiền giờ"], ["TIENTHUE", "targetTax", "VAT"]]) {
      if (amount(field) !== want(key)) problems.push(`${label} ${amount(field)} khác ${want(key)}`);
    }
    if (String(fields?.SOHD || "").trim()) problems.push("đã có số hóa đơn");
    return problems;
  }

  // Đọc lại phiếu mới theo ID (chỉ đọc) để biết bước thanh toán bị mất phản hồi
  // đã được server ghi chưa. Dùng ngay sau lỗi, và cho giao dịch đã bị chặn vì lỗi
  // đó ở lần chạy trước ("Da tao phien ... nhung buoc thanh toan loi").
  async function confirmFreshInvoicePayment(detail) {
    const recordId = String(detail?.recordId || "").trim();
    const invoiceNo = String(detail?.invoiceNo || "").trim();
    const formData = await readInvoiceFormById(recordId, invoiceNo);
    const fields = mapObject(formData.mapper?.Maps);
    const problems = freshPaymentProblems(fields, detail?.expected, invoiceNo);
    if (problems.length) return { confirmed: false, reason: problems.join("; ") };
    const roomId = String(fields.DBANID || "").trim();
    return {
      confirmed: true,
      saved: true,
      createdFresh: true,
      invoiceNo,
      savedRecordId: recordId,
      lastSaveId: String(fields.LASTSAVEID || ""),
      targetGrand: formAmount(fields.TONGCONG),
      // Phòng thật của phiếu: lịch phòng của phiếu mới kế tiếp trong ngày dựa vào đây.
      roomId,
      roomName: await roomNameById(roomId).catch(() => ""),
      recoveredBy: "readback"
    };
  }

  // Use the same two server phases as the website: first create a sale
  // session (mode=0), then pay that exact record (mode=2). Both requests carry
  // the accepted bank-statement day. GioClient controls the generated invoice
  // number/audit time; NGAY is persisted again while paying the created ID.
  async function createAndPayFreshInvoiceViaApi(expected) {
    const progress = { sessionSent: false, sessionInvoiceNo: "", sessionRecordId: "" };
    let result;
    let roomName = "";
    try {
      // Có `room` là luồng không cần tab phụ: đọc form của phòng bằng API.
      const context = expected?.room ? await loadBlankRoomForm(expected.room) : null;
      roomName = context?.roomName || "";
      result = await postFreshInvoiceTwoStep(expected, progress, context);
    } catch (error) {
      const message = String(error?.message || error || "Khong ro loi.");
      // Lỗi trước khi gửi request: chắc chắn chưa có gì trên server, content
      // được phép gỡ dấu "đang tạo" để thử lại. Không đọc được form phòng thì
      // gắn thêm nhãn để content quay về cách mở tab phụ.
      if (!progress.sessionSent) {
        const formTag = error?.formUnavailable ? NEW_INVOICE_FORM_UNAVAILABLE_TAG : "";
        throw new Error(`${NEW_INVOICE_NOT_SENT_TAG}${formTag}${message}`);
      }
      // Phiên mode=0 đã được cấp số nhưng bước thanh toán hỏng: phải nêu đúng
      // số phiếu để người dùng xử lý trên website thay vì tạo thêm phiếu khác.
      if (progress.sessionInvoiceNo) {
        throw new Error(
          `Da tao phien ${progress.sessionInvoiceNo} (ID ${progress.sessionRecordId || "khong ro"}) ` +
          `nhung buoc thanh toan loi: ${message}`
        );
      }
      throw error;
    }
    return {
      ...result,
      invoiceDateKey: normalizeDateKey(expected?.invoiceDateKey),
      createProtocol: "mode0-then-mode2",
      formSource: expected?.room ? "api" : "ui",
      roomName
    };
  }

  // ---------------------------------------------------------------------------
  // Phat hanh hoa don dien tu (man hinh HoaDonDienTu)
  //
  // Website chay 4 buoc: LayDuLieu -> kiemTraThongTin -> phatHanhHoaDon -> reload.
  // Hai hop thoai xac nhan cua website chi la UI; extension da hoi nguoi dung mot
  // lan cho ca lo nen goi thang API. Tat ca deu POST JSON cung origin, dung
  // cookie phien hien tai.
  //
  // Giao dien moi (10/2026, Form ID 9bc781f5-...): o loc "Loai" thay radio, them
  // nut Phat hanh/Kiem tra hang loat va luoi mat hang cua phieu dang chon. API
  // van giu ten cu; khac biet duoc doc tu HoaDonDienTu_JsClient tren trang:
  //   - LayDuLieu: customData co them 6 o loc (rong = khong loc).
  //   - phatHanhHoaDon(id, kyHieu): kyHieu = "" khi form tat ChonKyHieu.
  //   - Mat hang: TDONHANG0Ae/LayDuLieuChiTiet (xem readInvoiceItemsViaApi).
  // ---------------------------------------------------------------------------

  const EINVOICE_LIST_TAKE = 200;
  // O loc "Loai" (rdTrangThai): 0 Tat ca, 1 Da phat hanh, 2 Chua phat hanh.
  // Man Phat hanh lay Tat ca vi Check/Dong bo so can ca phieu da phat hanh; tim
  // phieu de lap phuong an lay Chua phat hanh (findInvoiceCandidates).
  const EINVOICE_STATUS_ALL = 0;
  const EINVOICE_STATUS_ISSUED = 1;
  const EINVOICE_STATUS_UNISSUED = 2;
  // Website gui kyHieu rong khi khong bat chon ky hieu (ChonKyHieu = false);
  // server dung ky hieu mac dinh cua co so.
  const EINVOICE_DEFAULT_KY_HIEU = "";

  function shopBasePath() {
    return location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
  }

  function postEInvoiceApi(action, payload, options) {
    return postShopApi(`HoaDonDienTu/${action}`, payload, action, options);
  }

  // `options.read`: request CHỈ ĐỌC (danh sách, mặt hàng) thì được thử lại khi
  // rớt mạng. Phát hành/kiểm tra không truyền cờ này: thử lại có thể gửi hai lần.
  async function postShopApi(path, payload, action, options = {}) {
    const endpoint = `${location.origin}/${shopBasePath()}/${path}`;
    const send = options.read ? fetchForRead : (url, init) => window.fetch(url, init);
    const response = await send(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json;utf-8",
        "X-Requested-With": "XMLHttpRequest"
      },
      body: JSON.stringify(payload)
    });
    const responseText = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(`Website tu choi ${action} (HTTP ${response.status}).`);
    }
    // Hai co so dung chung mot domain nen cookie phien ghi de nhau: dang nhap
    // co so kia se da tab nay ra man hinh login. Khi do server thuong tra ve
    // HTTP 200 kem HTML trang login chu khong phai loi, JSON.parse that bai va
    // body = null — lo se chay tiep trong im lang. Phai dung han va noi ro.
    if (isLoginRedirect(response, responseText)) {
      throw new Error(
        `Phien dang nhap da het hoac bi co so khac chiem (khi goi ${action}). ` +
        "Dang nhap lai dung co so nay roi chay lai lo; cac hoa don da phat hanh truoc do van giu nguyen."
      );
    }
    let body = null;
    try { body = JSON.parse(responseText); } catch (_) {}
    return { body, responseText: responseText.slice(0, 4000), httpStatus: response.status };
  }

  // Mat phien it khi tra ve 401/403: server thuong chuyen huong sang trang
  // login va tra ve HTML kem HTTP 200. Nhan dien theo ba dau hieu doc lap de
  // khong bo sot, va khong duoc nham voi phan hoi JSON binh thuong.
  function isLoginRedirect(response, responseText) {
    if (response.status === 401 || response.status === 403) return true;
    // fetch da di theo chuyen huong: URL cuoi cung khong con la endpoint API.
    if (/\/(Account\/)?(Log[Ii]n|DangNhap)/i.test(String(response.url || ""))) return true;
    const text = String(responseText || "").slice(0, 2000);
    if (!text) return false;
    // Phan hoi JSON hop le khong bao gio la trang login.
    const trimmed = text.trimStart();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
    return /<form[^>]+(login|dangnhap)/i.test(text) ||
      /name=["']?(UserName|Username|TenDangNhap)["']?/i.test(text) ||
      /<title>[^<]*(ang nh|Login)/i.test(text);
  }

  // /Date(1780246800000)/ -> yyyy-mm-dd theo gio local, dung chung dinh dang voi
  // normalizeDateKey de loc theo ngay giao dich.
  function eInvoiceDateKey(value) {
    const match = /\/Date\((-?\d+)\)\//.exec(String(value || ""));
    if (!match) return normalizeDateKey(value) || "";
    const date = new Date(Number(match[1]));
    if (!Number.isFinite(date.getTime())) return "";
    const part = number => String(number).padStart(2, "0");
    return `${date.getFullYear()}-${part(date.getMonth() + 1)}-${part(date.getDate())}`;
  }

  function parseInvoiceData(value) {
    if (!value) return null;
    if (typeof value === "object") return value;
    try { return JSON.parse(String(value)); } catch (_) { return null; }
  }

  // Mot dong duoc coi la "da phat hanh" khi co so hoa don thuc te tu CQT.
  function eInvoiceRow(row) {
    const invoiceData = parseInvoiceData(row?.INVOICEDATA);
    const soHoaDon = String(row?.SOHOADON ?? invoiceData?.SOHOADON ?? "").trim();
    return {
      id: String(row?.ID || ""),
      invoiceNo: String(row?.NAME || ""),
      dateKey: eInvoiceDateKey(row?.NGAY),
      grandTotal: Math.round(Number(row?.TONGCONG) || 0),
      buyer: String(row?.NGUOIMUAHANG || ""),
      paymentMethod: String(row?.PHUONGTHUCTT || ""),
      soHoaDon,
      soKyHieu: String(row?.SOKYHIEU ?? invoiceData?.SOKYHIEU ?? "").trim(),
      maCQThue: String(row?.MACQTHUE ?? invoiceData?.MACQTHUE ?? "").trim(),
      maTraCuu: String(invoiceData?.MATRACUU || "").trim(),
      linkTraCuu: String(invoiceData?.LINKTRACUU || "").trim(),
      cancelled: Number(row?.DAHUY ?? invoiceData?.DAHUY ?? 0) === 1,
      issued: Boolean(soHoaDon)
    };
  }

  // Bo loc TuNgay/DenNgay cua man hinh nay dung dinh dang MM/dd/yyyy, khac voi
  // o loc dd/MM/yyyy cua danh sach Ban hang.
  function eInvoiceFilterDate(dateKey) {
    const normalized = normalizeDateKey(dateKey);
    if (!normalized) throw new Error(`Ngay loc hoa don dien tu khong hop le: ${dateKey}`);
    const [year, month, day] = normalized.split("-");
    return `${month}/${day}/${year}`;
  }

  async function fetchEInvoiceList(options) {
    const fromDate = eInvoiceFilterDate(options?.fromDate || options?.dateKey);
    const toDate = eInvoiceFilterDate(options?.toDate || options?.dateKey);
    const status = options?.status ?? EINVOICE_STATUS_ALL;
    if (![EINVOICE_STATUS_ALL, EINVOICE_STATUS_ISSUED, EINVOICE_STATUS_UNISSUED].includes(status)) {
      throw new Error(`Trang thai loc hoa don dien tu khong hop le: ${status}`);
    }
    const rows = [];
    let page = 1;
    let total = 0;
    // Danh sach mot ngay thuong duoi 200 dong, nhung van phan trang de khong bo sot.
    while (page <= 20) {
      const { body } = await postEInvoiceApi("LayDuLieu", {
        filters: {},
        skip: (page - 1) * EINVOICE_LIST_TAKE,
        take: EINVOICE_LIST_TAKE,
        page,
        pageSize: EINVOICE_LIST_TAKE,
        sort: [{ field: "NAME", dir: "asc" }],
        // Du cac o loc nhu source_ParameterMap cua website; rong = khong loc.
        customData: {
          DXEID: "",
          DNHANVIENID: "",
          DKHACHHANGID: "",
          DNHOMMATHANGID: "",
          DKHOXUATID: "",
          DHANGSANXUATID: "",
          TRANGTHAI: status,
          TuNgay: fromDate,
          DenNgay: toDate
        },
        quickFilter: ""
      }, { read: true });
      const data = Array.isArray(body?.Data) ? body.Data : [];
      total = Number(body?.Total) || total;
      rows.push(...data);
      if (!data.length || rows.length >= total) break;
      page += 1;
    }
    return { rows: rows.map(eInvoiceRow), total: total || rows.length, fromDate, toDate, status };
  }

  // Man hinh hoa don dien tu moi hien mat hang cua phieu dang chon bang chinh API
  // nay (grDon_SelectionChanged): chi doc, khong mo phieu, khong can man hinh
  // danh sach Ban hang. Tag chi co dong hang; tien gio khong nam trong do.
  function eInvoiceDetailItem(row) {
    const qty = Math.round(Number(row?.SOLUONG) || 0);
    const price = Math.round(Number(row?.DONGIA) || 0);
    return {
      code: String(row?.DMATHANG_CODE || "").trim(),
      name: String(row?.DMATHANG_NAME || "").trim(),
      unit: String(row?.DDONVITINH_NAME || "").trim(),
      qty,
      price,
      amount: qty * price
    };
  }

  async function readInvoiceItemsViaApi(id) {
    const recordId = String(id || "").trim();
    if (!isGuid(recordId)) throw new Error(`ID phieu khong hop le: ${recordId || "trong"}.`);
    const { body, responseText } = await postShopApi(
      "TDONHANG0Ae/LayDuLieuChiTiet?is_ajax=1",
      { ID: recordId, STABLEDESCID: SALES_TABLE_ID },
      "LayDuLieuChiTiet",
      { read: true }
    );
    if (Number(body?.code) !== 1 || !Array.isArray(body?.Tag)) {
      const reason = String(body?.message || "").trim() || responseText.slice(0, 200) || "khong co du lieu";
      throw new Error(`Website khong tra mat hang cua phieu (${reason}).`);
    }
    return body.Tag.map(eInvoiceDetailItem).filter(item => item.code && item.qty > 0);
  }

  // Duong du phong khi API tren loi: mo phieu theo ID (openInvoiceById) ->
  // scan() doc luoi Kendo dang mo -> dong form. Chi doc, khong can man hinh
  // danh sach.
  async function readInvoiceItemsViaUi(detail) {
    const wanted = String(detail?.invoiceNo || "").trim();
    if (!wanted) throw new Error("Thieu so phieu de doc mat hang.");

    // Neu dang co form phieu mo san thi dong lai de khong doc nham phieu khac.
    if (invoiceUiState().detailVisible) await closeInvoiceDetail();

    await openInvoiceById(detail?.id, wanted);
    try {
      const deadline = Date.now() + 10000;
      let snapshot = null;
      while (Date.now() < deadline) {
        snapshot = scan();
        if (snapshot.ready) break;
        await wait(200);
      }
      if (!snapshot?.ready) {
        throw new Error(snapshot?.reason || `Khong doc duoc dong hang cua phieu ${wanted}.`);
      }
      // scan() tra ve so phieu dang mo; kiem tra de chac chan khong doc nham.
      const openedNo = String(snapshot.invoiceNo || "").trim();
      if (openedNo && openedNo !== wanted) {
        throw new Error(`Website mo phieu ${openedNo} thay vi ${wanted}; da dung de tranh ghi nham so lieu.`);
      }
      return (snapshot.items || []).map(item => ({
        code: String(item.code || "").trim(),
        name: String(item.name || "").trim(),
        unit: String(item.unit || "").trim(),
        qty: Math.round(Number(item.qty) || 0),
        price: Math.round(Number(item.price) || 0),
        amount: Math.round((Number(item.qty) || 0) * (Number(item.price) || 0))
      })).filter(item => item.code && item.qty > 0);
    } finally {
      // Luon dong form de hoa don ke tiep chay duoc.
      await closeInvoiceDetail().catch(() => {});
    }
  }

  // API truoc; chi mo phieu tren giao dien khi API loi va trang mo phieu duoc.
  async function readInvoiceItems(detail) {
    try {
      return await readInvoiceItemsViaApi(detail?.id);
    } catch (apiError) {
      if (detail?.canReadItems === false || !canOpenInvoiceById()) throw apiError;
      try {
        return await readInvoiceItemsViaUi(detail);
      } catch (uiError) {
        throw new Error(`${apiError.message} Mo phieu de doc cung loi: ${uiError.message}`);
      }
    }
  }

  // kiemTraThongTin + phatHanhHoaDon deu tra HTTP 200 ke ca khi nghiep vu tu choi,
  // nen phai doc code/message trong body giong DoSave.
  function eInvoiceFailureReason(body, responseText) {
    if (!body || typeof body !== "object") {
      return responseText ? `Website tra ve du lieu khong doc duoc: ${responseText.slice(0, 200)}` : "Website khong tra ve du lieu.";
    }
    const code = Number(body.code ?? body.Code);
    const message = String(body.message ?? body.Message ?? body.strData ?? "").trim();
    if (Number.isFinite(code) && code !== 1) {
      return message || `Website tu choi phat hanh (code ${code}).`;
    }
    if (body.success === false || body.Success === false) {
      return message || "Website tu choi phat hanh.";
    }
    return "";
  }

  // Khi phat hanh thanh cong, Tag KHONG phai object ma la chuoi HTML dung de do
  // thang vao hop thoai cua website:
  //   "So HD: 2036</br>Ma CQT: M1-...</br>Ky hieu: 1C26MVN</br>Ma tra cuu: ...</br>
  //    Link tra cuu: https://..."
  // Tach theo nhan (khong dau) de khong phu thuoc thu tu cac dong.
  function parseIssuedInvoiceTagHtml(tag) {
    const text = String(tag || "")
      .replace(/<\/?br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ");
    const fields = new Map();
    for (const line of text.split("\n")) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const label = normalizedVietnameseText(line.slice(0, separator));
      const value = line.slice(separator + 1).trim();
      if (label && value) fields.set(label, value);
    }
    const pick = (...labels) => {
      for (const label of labels) {
        const found = fields.get(label);
        if (found) return found;
      }
      return "";
    };
    return {
      // "Link tra cuu: https://..." bi cat o dau ":" dau tien nen phai noi lai.
      SOHOADON: pick("SO HD", "SO HOA DON"),
      MACQTHUE: pick("MA CQT", "MA CQ THUE", "MA CQTHUE"),
      SOKYHIEU: pick("KY HIEU", "KI HIEU"),
      MATRACUU: pick("MA TRA CUU"),
      LINKTRACUU: (text.match(/https?:\/\/\S+/) || [""])[0]
    };
  }

  // kiemTraThongTin returns the exact buyer/address that will be sent to the
  // e-invoice provider. Keep these values so the extension can refresh its
  // table immediately after issuing instead of waiting for another list load.
  function parseEInvoiceCheckTagHtml(tag) {
    const fields = new Map();
    const text = String(tag || "")
      .replace(/<\/?br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ");
    for (const line of text.split("\n")) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      const label = normalizedVietnameseText(line.slice(0, separator));
      const value = line.slice(separator + 1).trim();
      if (label) fields.set(label, value);
    }
    return {
      buyer: fields.get("NGUOI MUA") || "",
      address: fields.get("DIA CHI") || "",
      paymentMethod: fields.get("THANH TOAN") || ""
    };
  }

  async function issueEInvoice(detail) {
    const id = String(detail?.id || "").trim();
    if (!isGuid(id)) throw new Error(`ID hoa don dien tu khong hop le: ${id || "trong"}`);

    // Mat hang uu tien lay tu so doi soat do content script gui sang; so lieu do
    // da duoc kiem tra lai voi phieu tren website khi tru ton. Chi khi khong co
    // moi doc tu website (readInvoiceItems).
    //
    // Doc TRUOC khi phat hanh: sau khi phat hanh phieu bi khoa, va neu buoc doc
    // that bai thi chua co gi thay doi tren he thong.
    let items = Array.isArray(detail?.knownItems) ? detail.knownItems : [];
    let itemsError = "";
    if (!items.length) {
      try {
        items = await readInvoiceItems(detail);
      } catch (error) {
        itemsError = error.message;
      }
    }

    const check = await postEInvoiceApi("kiemTraThongTin?is_ajax=1", { id });
    const checkFailure = eInvoiceFailureReason(check.body, check.responseText);
    if (checkFailure) throw new Error(`Kiem tra thong tin that bai: ${checkFailure}`);
    const checkedMetadata = parseEInvoiceCheckTagHtml(check.body?.Tag ?? check.body?.data ?? "");

    const issue = await postEInvoiceApi("phatHanhHoaDon?is_ajax=1", { id, kyHieu: EINVOICE_DEFAULT_KY_HIEU });
    const issueFailure = eInvoiceFailureReason(issue.body, issue.responseText);
    if (issueFailure) throw new Error(issueFailure);

    const rawTag = issue.body?.Tag ?? issue.body?.data ?? null;
    // Tag la chuoi HTML khi phat hanh thanh cong; van chap nhan dang object
    // phong khi website doi kieu tra ve.
    const tag = typeof rawTag === "string"
      ? parseIssuedInvoiceTagHtml(rawTag)
      : (rawTag && typeof rawTag === "object" ? rawTag : {});
    const invoiceData = parseInvoiceData(tag.INVOICEDATA) || tag;
    const result = {
      id,
      soHoaDon: String(invoiceData.SOHOADON ?? tag.SOHOADON ?? "").trim(),
      soKyHieu: String(invoiceData.SOKYHIEU ?? tag.SOKYHIEU ?? "").trim(),
      maCQThue: String(invoiceData.MACQTHUE ?? tag.MACQTHUE ?? "").trim(),
      maTraCuu: String(invoiceData.MATRACUU ?? tag.MATRACUU ?? "").trim(),
      linkTraCuu: String(invoiceData.LINKTRACUU ?? tag.LINKTRACUU ?? "").trim(),
      buyer: checkedMetadata.buyer,
      buyerAddress: checkedMetadata.address,
      paymentMethod: checkedMetadata.paymentMethod,
      httpStatus: issue.httpStatus,
      items,
      itemsError
    };
    if (!result.soHoaDon) {
      // Body thanh cong nhung thieu so hoa don: doc lai danh sach de xac nhan
      // thay vi bao thanh cong mo ho.
      const confirmed = detail?.dateKey
        ? (await fetchEInvoiceList({ dateKey: detail.dateKey })).rows.find(row => row.id === id)
        : null;
      if (!confirmed?.issued) {
        throw new Error("Website bao thanh cong nhung khong tra ve so hoa don; hay kiem tra lai tren website.");
      }
      Object.assign(result, {
        soHoaDon: confirmed.soHoaDon,
        soKyHieu: confirmed.soKyHieu,
        maCQThue: confirmed.maCQThue,
        maTraCuu: confirmed.maTraCuu,
        linkTraCuu: confirmed.linkTraCuu
      });
    }
    return result;
  }

  // Bridge chay o MAIN world, content script o isolated world; detail cua
  // CustomEvent bi structured-clone khi di qua ranh gioi nay. Neu ket qua chua
  // gia tri khong clone duoc (vi du dong Kendo con giu ham), dispatchEvent NEM
  // loi. Truoc day loi do xay ra ngay trong khoi try nen content script khong
  // bao gio nhan duoc phan hoi va bang dieu khien treo o "dang phat hanh".
  //
  // Vi vay: luon lam sach payload truoc khi gui, va neu van khong gui duoc thi
  // gui ve mot loi mo ta duoc. Tuyet doi khong de request nao khong co phan hoi.
  function plainClone(value) {
    if (value == null || typeof value !== "object") return value;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_) {
      return null;
    }
  }

  function respond(payload) {
    const safe = {
      id: payload.id,
      ok: Boolean(payload.ok),
      ...(payload.ok ? { result: plainClone(payload.result) } : { error: String(payload.error || "") })
    };
    try {
      window.dispatchEvent(new CustomEvent(RESPONSE, { detail: safe }));
    } catch (error) {
      console.error("[InvoiceTarget bridge] khong gui duoc phan hoi", error);
      window.dispatchEvent(new CustomEvent(RESPONSE, {
        detail: {
          id: payload.id,
          ok: false,
          error: `Khong chuyen duoc ket qua ve extension: ${error?.message || error}`
        }
      }));
    }
  }

  window.addEventListener(REQUEST, async event => {
    const detail = event.detail || {};
    // Trả lời theo mã yêu cầu: `detail.id` có thể đã bị ID phiếu trong payload đè
    // (content.js request). Content cũ không gửi requestId thì dùng id như trước.
    const replyId = detail.requestId || detail.id;
    let result;
    try {
      if (detail.action === "scan") result = scan();
      else if (detail.action === "getRoomMap") result = await getRoomMap({ refresh: Boolean(detail.refresh) });
      else if (detail.action === "getOpenFormRoom") result = getOpenFormRoom();
      else if (detail.action === "replaceInvoiceItems") result = await replaceInvoiceItems(detail.items);
      else if (detail.action === "findInvoiceCandidates") result = await findInvoiceCandidates(
        detail.dateKey,
        detail.usedInvoiceNos,
        { invoiceNo: detail.invoiceNo, forceRefresh: detail.forceRefresh }
      );
      else if (detail.action === "findIssuedInvoiceByAmount") result = await findIssuedInvoiceByAmount(detail.dateKey, detail.amount);
      else if (detail.action === "openInvoiceCandidate") result = await openInvoiceCandidate(detail.uid, detail.invoiceNo);
      else if (detail.action === "applyCheckOut") result = applyCheckOut(detail.value);
      else if (detail.action === "applyHourAmount") result = applyHourAmount(detail.value);
      else if (detail.action === "closeInvoiceDetail") result = await closeInvoiceDetail();
      else if (detail.action === "getInvoiceUiState") result = invoiceUiState();
      else if (detail.action === "applyInvoicePlan") result = await applyInvoicePlan(detail);
      else if (detail.action === "saveExistingInvoicePlanViaApi") result = await saveExistingInvoicePlanViaApi(detail);
      else if (detail.action === "createAndPayFreshInvoiceViaApi") result = await createAndPayFreshInvoiceViaApi(detail);
      else if (detail.action === "probeBlankRoomForm") result = await probeBlankRoomForm(detail.room);
      else if (detail.action === "readRoomHourlyRates") result = await readRoomHourlyRates(detail);
      else if (detail.action === "readInvoiceSummary") result = await readInvoiceSummary(detail);
      else if (detail.action === "readInvoiceSnapshot") result = await readInvoiceSnapshot(detail);
      else if (detail.action === "confirmFreshInvoicePayment") result = await confirmFreshInvoicePayment(detail);
      else if (detail.action === "readDayRoomBookings") result = await readDayRoomBookings(detail);
      else if (detail.action === "fetchEInvoiceList") result = await fetchEInvoiceList(detail);
      else if (detail.action === "issueEInvoice") result = await issueEInvoice(detail);
      else if (detail.action === "buyerFixScan") result = await buyerFixScan(detail);
      else if (detail.action === "buyerFixInvoice") result = await buyerFixInvoice(detail);
      else if (detail.action === "readInvoiceItems") result = { items: await readInvoiceItems(detail) };
      else if (detail.action === "armApiTrace") result = armApiTrace();
      else if (detail.action === "getApiTrace") result = getApiTrace();
      else if (detail.action === "createProductViaApi") result = await createProductViaApi(detail.product);
      else if (detail.action === "fetchLatestProductCatalog") result = await fetchLatestProductCatalog();
      // Cho content script biết trang hiện tại đã có grid danh sách phiếu chưa,
      // để nó tự điều hướng về màn hình danh sách trước khi đối soát sau lưu.
      // Tìm/mở phiếu nay đi qua API và mở theo ID, nên "sẵn sàng" nghĩa là trang
      // mở được phiếu theo ID, không còn đòi lưới danh sách.
      else if (detail.action === "hasInvoiceList") result = { present: canOpenInvoiceById() || Boolean(invoiceListElement()) };
      else throw new Error("Thao tác không được hỗ trợ.");
      respond({ id: replyId, ok: true, result });
    } catch (error) {
      console.error("[InvoiceTarget bridge]", error);
      respond({ id: replyId, ok: false, error: String(error?.message || error || "Không rõ lỗi.") });
    }
  });
})();
