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

  function findInvoiceTimes() {
    const inputs = Array.from(document.querySelectorAll("input")).filter(input => isVisible(input) && parseDateTime(input.value));
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
      const listDialog = window.__invoiceTargetListDialogInfo;
      if (!state.detailVisible && listDialog?.client && invoiceListElement()) window.dialogInfo = listDialog;
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
        checkIn: detail.checkIn || "",
        checkOut: detail.checkOut || ""
      };
    } catch (error) {
      await closeTransientQuantityDialogs();
      throw error;
    }
  }

  function findInvoiceDate() {
    const inputs = Array.from(document.querySelectorAll('input'))
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

  function kendoGridElements() {
    return Array.from(document.querySelectorAll(".k-grid")).filter(isVisible).map(element => {
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

  function visibleActionButton(label) {
    return Array.from(document.querySelectorAll("button")).find(button => isVisible(button) && String(button.innerText || button.value || "").trim() === label) || null;
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

  function invoiceListElement() {
    return Array.from(document.querySelectorAll(".k-grid")).find(element => {
      const text = element.querySelector("thead")?.innerText || "";
      return /Số phiếu/i.test(text) && /Tổng cộng/i.test(text) && /Ngày/i.test(text);
    }) || null;
  }

  // Sau khi form phiếu đóng, website dựng lại grid danh sách. Trong lúc đó
  // kendoDropDownList của pager chưa init xong; bấm Refresh hoặc đổi ô lọc ngay
  // lúc này làm website ném "Cannot call method 'value' of kendoDropDownList
  // before it is initialized" và cả batch dừng lại.
  async function waitForInvoiceListReady(timeout = 8000) {
    const jq = window.jQuery || window.$;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const grid = invoiceListElement();
      const widget = grid && jq ? jq(grid).data("kendoGrid") : null;
      const pagerElement = grid?.querySelector(".k-pager-wrap, .k-pager");
      const pagerSelects = pagerElement ? Array.from(pagerElement.querySelectorAll("select")) : [];
      // Chính thẻ SELECT chưa được Kendo khởi tạo là nguyên nhân website ném
      // "before it is initialized". Không coi SELECT thuần là sẵn sàng.
      const pagerReady = !pagerElement || !pagerSelects.length || pagerSelects.every(select =>
        Boolean(jq && (jq(select).data("kendoDropDownList") || jq(select).data("kendoDropDown")))
      );
      const loading = grid?.querySelector(".k-loading-mask");
      if (grid && widget && pagerReady && (!loading || !isVisible(loading))) {
        // Kendo hoàn tất init trong microtask kế tiếp; nhường thêm một nhịp.
        await wait(150);
        return true;
      }
      await wait(150);
    }
    throw new Error("Danh sách phiếu chưa khởi tạo xong bộ lọc Kendo; hãy thử lại sau vài giây.");
  }

  function rememberInvoiceListDialog() {
    const current = window.dialogInfo;
    const runner = current?.client?.get_CodeRunner?.();
    if (invoiceListElement() && runner && typeof runner.Detail_MouseDoubleClick === "function") {
      window.__invoiceTargetListDialogInfo = current;
    }
    return window.__invoiceTargetListDialogInfo || current || null;
  }

  function invoiceListRows() {
    const grid = invoiceListElement();
    if (!grid) return [];
    return Array.from(grid.querySelectorAll("tbody tr[data-uid]")).map(row => {
      const cells = Array.from(row.querySelectorAll('[role="gridcell"]')).map(cell => (cell.innerText || "").trim());
      const offset = cells.length >= 4 && /^\d+$/.test(cells[0]) ? 1 : 0;
      return {
        uid: row.getAttribute("data-uid") || "",
        date: cells[offset] || "",
        dateKey: normalizeDateKey(cells[offset] || ""),
        invoiceNo: cells[offset + 1] || "",
        grandTotal: money(cells[offset + 2])
      };
    }).filter(item => item.invoiceNo && item.dateKey);
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

  async function findInvoiceCandidates(dateKey, usedInvoiceNos) {
    const expected = dateDisplay(dateKey);
    if (!expected) throw new Error("Ngày giao dịch không hợp lệ.");
    if (!invoiceListElement()) throw new Error("Hãy mở màn hình danh sách Bán hàng trước.");
    await waitForInvoiceListReady();
    rememberInvoiceListDialog();

    const unissuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_2"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Chưa xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    if (!unissuedRadio) throw new Error('Không tìm thấy bộ lọc "Chưa xuất hóa đơn".');

    const used = new Set((usedInvoiceNos || []).map(String));
    const cachedRows = invoiceListCache.get(String(dateKey));
    if (unissuedRadio.checked && cachedRows?.length) {
      return {
        dateKey,
        invoiceStatus: "unissued",
        cached: true,
        suppressedAlerts: [],
        candidates: cachedRows.map(row => ({ ...row, available: !used.has(String(row.invoiceNo)) }))
      };
    }
    const currentRows = invoiceListRows();
    // Batch Review normally handles many transactions of one day. Reusing the
    // already loaded unissued list avoids repeatedly destroying/recreating the
    // Kendo pager DropDownList between transactions.
    if (unissuedRadio.checked &&
        currentRows.length &&
        currentRows.every(row => row.dateKey === dateKey)) {
      invoiceListCache.set(String(dateKey), currentRows.map(row => ({ ...row })));
      return {
        dateKey,
        invoiceStatus: "unissued",
        cached: true,
        suppressedAlerts: [],
        candidates: currentRows.map(row => ({ ...row, available: !used.has(String(row.invoiceNo)) }))
      };
    }

    const dateInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(input => normalizeDateKey(input.value));
    if (dateInputs.length < 2) throw new Error("Không tìm thấy bộ lọc Từ ngày/Đến ngày.");
    const refresh = document.querySelector('[id^="btnRefresh"]') ||
      Array.from(document.querySelectorAll("button")).find(button => (button.innerText || "").trim() === "Refresh");
    if (!refresh) throw new Error("Không tìm thấy nút Refresh của danh sách phiếu.");
    // Chặn alert từ TRƯỚC khi chạm vào ô lọc: đổi ngày/radio cũng có thể làm
    // website ném lỗi Kendo nội bộ, và alert đó sẽ treo cả batch.
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    try {
      const jq = window.jQuery || window.$;
      dateInputs.slice(0, 2).forEach(input => {
        const picker = jq ? jq(input).data("kendoDatePicker") : null;
        try {
          if (picker?.value) picker.value(new Date(`${dateKey}T00:00:00`));
        } catch (_) {}
        setNativeValue(input, expected);
      });

      if (!unissuedRadio.checked) unissuedRadio.click();
      if (!unissuedRadio.checked) {
        unissuedRadio.checked = true;
        unissuedRadio.dispatchEvent(new Event("change", { bubbles: true }));
      }

      refresh.click();

      const startedAt = Date.now();
      // The website can show a native "no data" alert while the Kendo source
      // refreshes. Suppress only inside this read-only lookup so a whole batch
      // cannot be blocked by one empty date.
      const deadline = startedAt + 22000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 180));
        const rows = invoiceListRows();
        if (rows.length && rows.every(row => row.dateKey === dateKey)) {
          invoiceListCache.set(String(dateKey), rows.map(row => ({ ...row })));
          return {
            dateKey,
            invoiceStatus: "unissued",
            suppressedAlerts,
            candidates: rows.map(row => ({ ...row, available: !used.has(String(row.invoiceNo)) }))
          };
        }
        if (Date.now() - startedAt > 2500 && !document.querySelector(".k-loading-mask") && !rows.length) {
          return { dateKey, invoiceStatus: "unissued", suppressedAlerts, candidates: [] };
        }
      }
      throw new Error("Danh sách phiếu chưa tải xong. Hãy thử lại.");
    } finally {
      window.alert = originalAlert;
    }
  }

  async function findIssuedInvoiceByAmount(dateKey, amount) {
    const expected = dateDisplay(dateKey);
    if (!expected) throw new Error("Ngày giao dịch không hợp lệ.");
    if (!invoiceListElement()) throw new Error("Hãy mở màn hình danh sách Bán hàng trước.");
    await waitForInvoiceListReady();
    rememberInvoiceListDialog();

    const dateInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(input => normalizeDateKey(input.value));
    if (dateInputs.length < 2) throw new Error("Không tìm thấy bộ lọc Từ ngày/Đến ngày.");
    // Radio "Đã xuất hóa đơn" là _1 (đối ứng "Chưa xuất" _2); dự phòng theo nhãn.
    const issuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_1"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Đã xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    if (!issuedRadio) throw new Error('Không tìm thấy bộ lọc "Đã xuất hóa đơn".');
    const refresh = document.querySelector('[id^="btnRefresh"]') ||
      Array.from(document.querySelectorAll("button")).find(button => (button.innerText || "").trim() === "Refresh");
    if (!refresh) throw new Error("Không tìm thấy nút Refresh của danh sách phiếu.");
    // Chặn alert từ TRƯỚC khi chạm vào ô lọc, xem findInvoiceCandidates.
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    const target = Math.round(Number(amount) || 0);
    try {
      const jq = window.jQuery || window.$;
      dateInputs.slice(0, 2).forEach(input => {
        const picker = jq ? jq(input).data("kendoDatePicker") : null;
        try {
          if (picker?.value) picker.value(new Date(`${dateKey}T00:00:00`));
        } catch (_) {}
        setNativeValue(input, expected);
      });

      if (!issuedRadio.checked) issuedRadio.click();
      if (!issuedRadio.checked) {
        issuedRadio.checked = true;
        issuedRadio.dispatchEvent(new Event("change", { bubbles: true }));
      }

      refresh.click();
      const startedAt = Date.now();
      const deadline = startedAt + 22000;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 180));
        const rows = invoiceListRows();
        if (rows.length && rows.every(row => row.dateKey === dateKey)) {
          const matches = rows.filter(row => Math.round(Number(row.grandTotal) || 0) === target);
          return { dateKey, invoiceStatus: "issued", suppressedAlerts, target, matches, rows };
        }
        if (Date.now() - startedAt > 2500 && !document.querySelector(".k-loading-mask") && !rows.length) {
          return { dateKey, invoiceStatus: "issued", suppressedAlerts, target, matches: [], rows: [] };
        }
      }
      throw new Error("Danh sách phiếu chưa tải xong. Hãy thử lại.");
    } finally {
      window.alert = originalAlert;
    }
  }

  async function waitForInvoiceListRow(invoiceNo, uid, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const grid = invoiceListElement();
      const row = grid && Array.from(grid.querySelectorAll("tbody tr[data-uid]")).find(element =>
        (uid && element.getAttribute("data-uid") === String(uid)) ||
        (invoiceNo && (element.innerText || "").includes(String(invoiceNo)))
      );
      const loading = document.querySelector(".k-loading-mask");
      if (row && (!loading || !isVisible(loading))) return { grid, row };
      await wait(120);
    }
    return { grid: invoiceListElement(), row: null };
  }

  async function openInvoiceCandidate(uid, invoiceNo) {
    const unissuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_2"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Chưa xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    // Luồng lập/sửa phương án chỉ được chạm vào phiếu chưa xuất hóa đơn.
    if (!unissuedRadio?.checked) throw new Error('Chỉ được tự mở khi bộ lọc "Chưa xuất hóa đơn" đang được chọn.');
    return openInvoiceRowForReading(uid, invoiceNo);
  }

  // Phần thao tác mở phiếu, tách riêng để luồng chỉ-đọc (đọc mặt hàng trước khi
  // phát hành) dùng lại mà không phải nới lỏng ràng buộc "Chưa xuất hóa đơn"
  // của luồng lập phương án.
  async function openInvoiceRowForReading(uid, invoiceNo) {
    const initial = await waitForInvoiceListRow(invoiceNo, uid);
    const grid = initial.grid;
    if (!grid) throw new Error("Hãy mở màn hình danh sách Bán hàng trước.");
    const row = initial.row;
    if (!row) throw new Error("Phiếu không còn trong danh sách hiện tại. Hãy tìm lại.");
    await new Promise(resolve => setTimeout(resolve, 350));
    const jq = window.jQuery || window.$;
    const widget = jq ? jq(grid).data("kendoGrid") : null;
    if (widget?.select) widget.select(row);
    row.scrollIntoView({ block: "center", inline: "nearest" });

    // Editable detail is opened by the generated form client's row-double-click
    // handler. The XEM column is only for already-issued electronic invoices.
    const listDialog = rememberInvoiceListDialog();
    const codeRunner = listDialog?.client?.get_CodeRunner?.();
    if (codeRunner && typeof codeRunner.Detail_MouseDoubleClick === "function") {
      codeRunner.Detail_MouseDoubleClick({});
      const formDeadline = Date.now() + 5000;
      while (Date.now() < formDeadline) {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (suffixInput("numTONGCONG")) return { opened: true, method: "form-client", invoiceNo: String(invoiceNo || "") };
      }
    }

    // The list grid binds its editable-detail action through jQuery on some
    // generated form versions. Trigger that binding before raw DOM events.
    if (jq) {
      jq(row).trigger("dblclick");
      const jqueryDeadline = Date.now() + 3000;
      while (Date.now() < jqueryDeadline) {
        await new Promise(resolve => setTimeout(resolve, 120));
        if (suffixInput("numTONGCONG")) {
          return { opened: true, method: "jquery-dblclick", invoiceNo: String(invoiceNo || "") };
        }
      }
    }

    // Fallback for older sale lists that still bind opening to row dblclick.
    const mouse = (type, detail) => row.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, detail }));
    mouse("mousedown", 1); mouse("mouseup", 1); mouse("click", 1);
    await new Promise(resolve => setTimeout(resolve, 70));
    mouse("mousedown", 2); mouse("mouseup", 2); mouse("click", 2); mouse("dblclick", 2);
    return { opened: true, method: "dblclick", invoiceNo: String(invoiceNo || "") };
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
    return {
      ready: items.length > 0,
      mode,
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

  function apply(changes) {
    const found = invoiceGrid();
    if (!found || !found.fields.qty) throw new Error("Không truy cập được Kendo Grid của các dòng hàng.");
    const rows = (typeof found.grid.dataSource.view === "function" && found.grid.dataSource.view()) ||
      (typeof found.grid.dataSource.data === "function" && found.grid.dataSource.data()) || [];
    const byUid = new Map((changes || []).map(change => [String(change.uid), change]));
    let changed = 0;
    rows.forEach((item, index) => {
      const uid = String(item.uid || index);
      const change = byUid.get(uid);
      if (!change) return;
      const nextQty = Math.max(0, Math.round(Number(change.newQty)));
      const maxQty = Math.max(0, Math.floor(Number(change.maxQty)));
      if (!Number.isFinite(maxQty) || nextQty > maxQty) throw new Error(`Số lượng ${nextQty} vượt tồn cho phép ${maxQty}.`);
      const currentQty = money(objectValue(item, found.fields.qty));
      if (nextQty === currentQty) return;
      if (typeof item.set === "function") item.set(found.fields.qty, nextQty);
      else item[found.fields.qty] = nextQty;
      changed += 1;
    });
    return { changed, snapshot: scan() };
  }

  // Phieu do extension lap deu bat nguon tu giao dich chuyen khoan trong sao ke,
  // nen phuong thuc thanh toan ghi la TM/CK thay vi TM.
  const INVOICE_PAYMENT_METHOD = "TM/CK";
  const SALES_TABLE_ID = "d56b4b85-68c8-44c1-947d-9f3899e55a7c";
  const PRODUCT_GRID_TABLE_ID = "c07a4b54-e177-40d9-b077-c140fd4641d9";
  const SALES_FORM_ID = "aaf252bb-ed11-4077-8852-5e453a6881a3";
  const SALES_MENU_ID = "f3ca052a-082b-49f6-8d4f-93b8a525e571";

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

  function visibleOfficialInvoiceSaveControl() {
    const paymentDialog = visiblePaymentDialog();
    return Array.from(document.querySelectorAll(
      "button,input[type='button'],input[type='submit'],a"
    )).find(control => {
      // Form bán hàng của website tự nó cũng nằm trong một Kendo/modal wrapper.
      // Chỉ loại nút thuộc hộp Lưu hóa đơn đang mở; không loại Lưu HĐ hoặc
      // Thanh toán (F12) của form chính.
      if (!isLayoutVisible(control) || paymentDialog?.contains(control)) {
        return false;
      }
      const label = normalizedVietnameseText(dialogControlText(control));
      return label === "LUU HD" || label === "THANH TOAN" || label === "THANH TOAN (F12)";
    }) || null;
  }

  function officialSaveExitControl(dialog) {
    return dialogControls(dialog).find(control =>
      normalizedVietnameseText(dialogControlText(control)) === "LUU THOAT"
    ) || null;
  }

  function officialSaveCancelControl(dialog) {
    return dialogControls(dialog).find(control =>
      normalizedVietnameseText(dialogControlText(control)) === "HUY BO"
    ) || null;
  }

  function waitForSaveCapture(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        window.removeEventListener(SAVE_CAPTURED, onCapture);
        reject(new Error("Website khong gui request DoSave sau khi bam Luu thoat."));
      }, timeoutMs);
      function onCapture(event) {
        window.clearTimeout(timeout);
        window.removeEventListener(SAVE_CAPTURED, onCapture);
        resolve(event.detail || {});
      }
      window.addEventListener(SAVE_CAPTURED, onCapture);
    });
  }

  function verifyDisplayedInvoiceBeforeOfficialSave(expected) {
    const actual = scan();
    if (!actual.ready) throw new Error(actual.reason || "Form phieu moi chua san sang de luu.");
    const expectedGrand = Math.round(Number(expected?.targetGrand) || 0);
    const expectedGoods = Math.round(Number(expected?.targetGoods) || 0);
    const expectedHour = Math.round(Number(expected?.targetHour) || 0);
    const expectedTax = Math.round(Number(expected?.targetTax) || 0);
    if (Math.round(Number(actual.currentGrand) || 0) !== expectedGrand ||
        Math.round(Number(actual.currentGoods) || 0) !== expectedGoods ||
        Math.round(Number(actual.currentHour) || 0) !== expectedHour ||
        Math.round(Number(actual.currentTax) || 0) !== expectedTax) {
      throw new Error("Form phieu moi chua khop tong/tien hang/tien gio/VAT; chua mo hop thoai luu.");
    }
    const expectedItems = expectedItemMap(expected?.items);
    const actualItems = expectedItemMap(actual.items);
    if (actualItems.size !== expectedItems.size) {
      throw new Error("So dong hang tren form phieu moi chua khop phuong an.");
    }
    for (const [code, item] of expectedItems) {
      const current = actualItems.get(code);
      if (!current || current.qty !== item.qty || current.price !== item.price) {
        throw new Error(`Mat hang ${code} tren form phieu moi chua khop phuong an.`);
      }
    }
    return actual;
  }

  async function saveFreshInvoiceThroughOfficialUi(expected) {
    verifyDisplayedInvoiceBeforeOfficialSave(expected);
    const saveControl = visibleOfficialInvoiceSaveControl();
    if (!saveControl) throw new Error("Khong tim thay nut Luu HD/Thanh toan cua website cho phieu moi.");
    saveControl.click();

    const dialogDeadline = Date.now() + 6000;
    let dialog = null;
    while (Date.now() < dialogDeadline) {
      await wait(100);
      dialog = visiblePaymentDialog();
      if (dialog) break;
    }
    if (!dialog) throw new Error("Website khong mo hop thoai LUU HOA DON.");

    // Website khởi tạo ID/NAME/LASTSAVEID khi mở bước thanh toán. Nếu đã có
    // GUID, đóng hộp thoại mà không lưu rồi dùng payload API chính xác của
    // extension. Điều này tránh website lưu tổng đang hiển thị bị làm tròn.
    const initializedFormData = currentFormData({ allowBlankRecordId: true });
    if (isGuid(formDataRecordId(initializedFormData))) {
      const cancel = officialSaveCancelControl(dialog);
      if (!cancel) throw new Error("Website da tao ID phieu nhung khong tim thay nut Huy bo cua hop thoai luu.");
      cancel.click();
      await wait(250);
      if (visiblePaymentDialog()) throw new Error("Khong dong duoc hop thoai luu truoc khi gui API.");
      const saved = await postCurrentInvoiceViaApi(expected);
      return { ...saved, officialUiBootstrap: true };
    }

    const payment = normalizePaymentDialog();
    if (!payment.ready || payment.grand !== Math.round(Number(expected?.targetGrand) || 0)) {
      throw new Error("Tien mat trong hop thoai luu chua khop Tong tien; extension da dung truoc khi gui.");
    }
    const saveExit = officialSaveExitControl(dialog);
    if (!saveExit) throw new Error("Khong tim thay nut Luu thoat trong hop thoai hoa don.");

    const capturedPromise = waitForSaveCapture();
    saveExit.click();
    const captured = await capturedPromise;
    let payload = null;
    try { payload = JSON.parse(String(captured.body || "")); } catch (_) {}
    if (!payload) throw new Error("Khong doc duoc payload DoSave do website vua gui.");
    const verified = validateSavePayload(payload, expected);
    const confirmed = verifySaveResponse(captured.responseText, payload.ID);
    return {
      saved: true,
      officialUiBootstrap: true,
      httpStatus: Number(captured.status || 0),
      endpoint: String(captured.url || ""),
      ...verified,
      ...confirmed
    };
  }

  function localServerDateTime(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function localDateKey(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localMidnightIso(dateKey) {
    const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0);
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
    if (expected?.expectsPaymentMethod &&
        String(fields.PHUONGTHUCTT || "") !== INVOICE_PAYMENT_METHOD) {
      throw new Error(`Phuong thuc thanh toan trong request la "${fields.PHUONGTHUCTT || "trong"}", phai la "${INVOICE_PAYMENT_METHOD}".`);
    }

    const invoiceDateKey = normalizeDateKey(expected?.invoiceDateKey);
    const expectedCheckIn = parseDateTime(expected?.checkIn);
    const expectedCheckOut = parseDateTime(expected?.checkOut);
    if (invoiceDateKey) {
      if (storedLocalDateKey(fields.NGAY) !== invoiceDateKey) {
        throw new Error(`Ngay hoa don trong request chua khop ${invoiceDateKey}.`);
      }
      if (!expectedCheckIn || !expectedCheckOut || expectedCheckOut <= expectedCheckIn ||
          localDateKey(expectedCheckIn) !== invoiceDateKey) {
        throw new Error("Gio vao/ra cua phuong an moi khong hop le voi ngay giao dich.");
      }
      const actualCheckIn = parseStoredDateTime(fields.BATDAUPHONGCUOI || fields.BATDAU);
      const actualCheckOut = parseStoredDateTime(fields.KETTHUC);
      if (!actualCheckIn || !actualCheckOut ||
          Math.abs(actualCheckIn.getTime() - expectedCheckIn.getTime()) >= 60000 ||
          Math.abs(actualCheckOut.getTime() - expectedCheckOut.getTime()) >= 60000) {
        throw new Error("Gio vao/ra trong request chua khop phuong an da Accept.");
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
    const invoiceDateKey = normalizeDateKey(expected?.invoiceDateKey) || localDateKey(checkIn);
    if (expected?.requiresFreshDraft && (!invoiceDateKey || !checkIn || !checkOut || checkOut <= checkIn)) {
      throw new Error("Phuong an phieu moi thieu ngay hoa don hoac gio vao/ra hop le.");
    }
    const overrides = {
      TIENHANG: goods,
      TIENGIO: hour,
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
      // Phieu tu phuong an deu la khach chuyen khoan roi doi soat qua sao ke.
      PHUONGTHUCTT: INVOICE_PAYMENT_METHOD
    };
    if (invoiceDateKey && checkIn && checkOut) {
      overrides.NGAY = localMidnightIso(invoiceDateKey);
      overrides.BATDAUPHONGCUOI = checkIn.toISOString();
      overrides.KETTHUC = checkOut.toISOString();
      overrides.BATDAU = localServerDateTime(checkIn);
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
      expectsPaymentMethod: true
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
    const response = await window.fetch(`${location.origin}/${base}/DataGrid/GetDataSearchData`, {
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

  function freshSessionDetailRows(items, products) {
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
        THUTU: index + 1
      };
    });
  }

  function finalPaymentDetailRows(sessionRows, persistedIds, warehouseId, taxRate) {
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
        NGAYTHUCHIEN: null,
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
    let body;
    try { body = JSON.parse(responseText); } catch (_) {
      throw new Error("Website tra ve DoSave khong phai JSON.");
    }
    if (Number(body?.code) !== 1 || !isGuid(body?.Tag?.ID)) {
      throw new Error(String(body?.message || body?.strData || "DoSave khong thanh cong."));
    }
    return { body, responseText, endpoint: new URL(endpoint).pathname, httpStatus: response.status };
  }

  async function createAndPayFreshInvoiceViaApi(expected) {
    const formData = currentFormData({ allowBlankRecordId: true });
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
    const products = await fetchProductRowsForApiPlan(expected.items, warehouseId);
    const sessionRows = freshSessionDetailRows(expected.items, products);
    const calculatedGoods = sessionRows.reduce((sum, row) => sum + row.THANHTIEN, 0);
    if (calculatedGoods !== goods) throw new Error("Tong chi tiet hang khong bang tien hang cua phuong an.");
    const commonOverrides = {
      BATDAUPHONGCUOI: checkIn.toISOString(),
      KETTHUC: checkOut.toISOString(),
      BATDAU: localServerDateTime(checkIn),
      NGAY: localMidnightIso(invoiceDateKey),
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
      PHUONGTHUCTT: INVOICE_PAYMENT_METHOD,
      SOHD: "",
      MODE: 1
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
            BAN: String(suffixInput("lblTENBAN")?.textContent || ""),
            NOTE: `Them mat hang '${row.TENHANG}' vao bill, so luong: ${row.SLXUATCHUAQUYDOI}`,
            SOLUONG: row.SLXUATCHUAQUYDOI,
            DONGIA: row.DONGIA,
            THANHTIEN: 0,
            TENHANG: row.TENHANG,
            GIOCLIENT: localServerDateTime(new Date()).replace(/-/g, "/"),
            CHUCNANG: "Su dung dich vu",
            THIETBI: ""
          }))
        }],
        CustomPost: { MODEQUANLY: 0, GioClient: localServerDateTime(new Date()) }
      },
      TableID: SALES_TABLE_ID,
      ID: "",
      Loai: 0
    };
    const session = await postDoSavePayload(sessionPayload);
    const sessionTag = session.body.Tag || {};
    if (!isGuid(sessionTag.LASTSAVEID) || !String(sessionTag.NAME || "").trim()) {
      throw new Error("Luu phien thanh cong nhung thieu NAME hoac LASTSAVEID.");
    }
    const paymentRows = finalPaymentDetailRows(sessionRows, sessionTag.detail, warehouseId, taxRate);
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
          GioClient: localServerDateTime(new Date()),
          DVOUCHERID: null,
          XUATHOADON: false
        }
      },
      TableID: SALES_TABLE_ID,
      ID: sessionTag.ID,
      Loai: 0
    };
    const payment = await postDoSavePayload(paymentPayload);
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

  // ---------------------------------------------------------------------------
  // Phat hanh hoa don dien tu (man hinh HoaDonDienTu)
  //
  // Website chay 4 buoc: LayDuLieu -> kiemTraThongTin -> phatHanhHoaDon -> reload.
  // Hai hop thoai xac nhan cua website chi la UI; extension da hoi nguoi dung mot
  // lan cho ca lo nen goi thang API. Tat ca deu POST JSON cung origin, dung
  // cookie phien hien tai.
  // ---------------------------------------------------------------------------

  const EINVOICE_LIST_TAKE = 200;

  function shopBasePath() {
    return location.pathname.split("/").filter(Boolean)[0] || "pariskimgiang";
  }

  async function postEInvoiceApi(action, payload) {
    const endpoint = `${location.origin}/${shopBasePath()}/HoaDonDienTu/${action}`;
    const response = await window.fetch(endpoint, {
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
    let body = null;
    try { body = JSON.parse(responseText); } catch (_) {}
    return { body, responseText: responseText.slice(0, 4000), httpStatus: response.status };
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
        customData: {
          DKHACHHANGID: "",
          TRANGTHAI: 0,
          TuNgay: fromDate,
          DenNgay: toDate
        },
        quickFilter: ""
      });
      const data = Array.isArray(body?.Data) ? body.Data : [];
      total = Number(body?.Total) || total;
      rows.push(...data);
      if (!data.length || rows.length >= total) break;
      page += 1;
    }
    return { rows: rows.map(eInvoiceRow), total: total || rows.length, fromDate, toDate };
  }

  // Doc chi tiet mat hang bang dung duong ma extension da dung de mo phieu:
  // nhap doi tren dong danh sach Ban hang -> scan() doc luoi Kendo dang mo ->
  // dong form. Man hinh hoa don dien tu khong tra ve dong hang.
  //
  // Khong dung fetch AddEdit: trang do duoc website dung bang script client nen
  // HTML tho khong chua san dong hang.
  async function readInvoiceItemsViaUi(invoiceNo) {
    const wanted = String(invoiceNo || "").trim();
    if (!wanted) throw new Error("Thieu so phieu de doc mat hang.");
    if (!invoiceListElement()) throw new Error("Hay mo man hinh danh sach Ban hang truoc.");

    // Neu dang co form phieu mo san thi dong lai de khong doc nham phieu khac.
    if (invoiceUiState().detailVisible) await closeInvoiceDetail();

    const found = await waitForInvoiceListRow(wanted, "");
    if (!found.row) {
      throw new Error(`Khong thay phieu ${wanted} trong danh sach hien tai; hay loc dung ngay cua phieu.`);
    }
    await openInvoiceRowForReading(found.row.getAttribute("data-uid") || "", wanted);
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
      // Luon dong form va tra man hinh ve danh sach de hoa don ke tiep chay duoc.
      await closeInvoiceDetail().catch(() => {});
      await waitForInvoiceListReady().catch(() => {});
    }
  }

  async function readInvoiceItems(detail) {
    return readInvoiceItemsViaUi(detail?.invoiceNo);
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

  async function issueEInvoice(detail) {
    const id = String(detail?.id || "").trim();
    if (!isGuid(id)) throw new Error(`ID hoa don dien tu khong hop le: ${id || "trong"}`);

    // Mat hang uu tien lay tu so doi soat do content script gui sang; so lieu do
    // da duoc kiem tra lai voi phieu tren website khi tru ton. Chi khi khong co
    // moi phai mo lai phieu de doc, va viec do can man hinh danh sach Ban hang.
    //
    // Doc TRUOC khi phat hanh: sau khi phat hanh phieu bi khoa, va neu buoc doc
    // that bai thi chua co gi thay doi tren he thong.
    let items = Array.isArray(detail?.knownItems) ? detail.knownItems : [];
    let itemsError = "";
    if (!items.length) {
      if (detail?.canReadItems === false) {
        itemsError = "Phieu khong co trong so doi soat va man hinh danh sach Ban hang chua mo.";
      } else {
        try {
          items = await readInvoiceItemsViaUi(detail?.invoiceNo);
        } catch (error) {
          itemsError = error.message;
        }
      }
    }

    const check = await postEInvoiceApi("kiemTraThongTin?is_ajax=1", { id });
    const checkFailure = eInvoiceFailureReason(check.body, check.responseText);
    if (checkFailure) throw new Error(`Kiem tra thong tin that bai: ${checkFailure}`);

    const issue = await postEInvoiceApi("phatHanhHoaDon?is_ajax=1", { id });
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

  async function saveCurrentInvoiceViaApi(expected) {
    const formData = currentFormData({ allowBlankRecordId: Boolean(expected?.requiresFreshDraft) });
    if (expected?.requiresFreshDraft && !isGuid(formDataRecordId(formData))) {
      return saveFreshInvoiceThroughOfficialUi(expected);
    }
    return postCurrentInvoiceViaApi(expected);
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
    let result;
    try {
      if (detail.action === "scan") result = scan();
      else if (detail.action === "apply") result = apply(detail.changes);
      else if (detail.action === "replaceInvoiceItems") result = await replaceInvoiceItems(detail.items);
      else if (detail.action === "findInvoiceCandidates") result = await findInvoiceCandidates(detail.dateKey, detail.usedInvoiceNos);
      else if (detail.action === "findIssuedInvoiceByAmount") result = await findIssuedInvoiceByAmount(detail.dateKey, detail.amount);
      else if (detail.action === "openInvoiceCandidate") result = await openInvoiceCandidate(detail.uid, detail.invoiceNo);
      else if (detail.action === "applyCheckOut") result = applyCheckOut(detail.value);
      else if (detail.action === "applyInvoiceTimes") result = applyInvoiceTimes(detail.checkIn, detail.checkOut, detail.keepCheckIn);
      else if (detail.action === "applyHourAmount") result = applyHourAmount(detail.value);
      else if (detail.action === "closeInvoiceDetail") result = await closeInvoiceDetail();
      else if (detail.action === "getInvoiceUiState") result = invoiceUiState();
      else if (detail.action === "applyInvoiceTotals") result = applyInvoiceTotals(detail.targetGrand, detail.targetGoods);
      else if (detail.action === "normalizePaymentDialog") result = normalizePaymentDialog();
      else if (detail.action === "applyInvoicePlan") result = await applyInvoicePlan(detail);
      else if (detail.action === "saveCurrentInvoiceViaApi") result = await saveCurrentInvoiceViaApi(detail);
      else if (detail.action === "saveExistingInvoicePlanViaApi") result = await saveExistingInvoicePlanViaApi(detail);
      else if (detail.action === "createAndPayFreshInvoiceViaApi") result = await createAndPayFreshInvoiceViaApi(detail);
      else if (detail.action === "fetchEInvoiceList") result = await fetchEInvoiceList(detail);
      else if (detail.action === "issueEInvoice") result = await issueEInvoice(detail);
      else if (detail.action === "readInvoiceItems") result = { items: await readInvoiceItems(detail) };
      else if (detail.action === "armApiTrace") result = armApiTrace();
      else if (detail.action === "getApiTrace") result = getApiTrace();
      // Cho content script biết trang hiện tại đã có grid danh sách phiếu chưa,
      // để nó tự điều hướng về màn hình danh sách trước khi đối soát sau lưu.
      else if (detail.action === "hasInvoiceList") result = { present: Boolean(invoiceListElement()) };
      else throw new Error("Thao tác không được hỗ trợ.");
      respond({ id: detail.id, ok: true, result });
    } catch (error) {
      console.error("[InvoiceTarget bridge]", error);
      respond({ id: detail.id, ok: false, error: String(error?.message || error || "Không rõ lỗi.") });
    }
  });
})();
