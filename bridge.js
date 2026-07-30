(function () {
  "use strict";

  const REQUEST = "invoice-target-mvp:request";
  const RESPONSE = "invoice-target-mvp:response";
  const SAVE_CAPTURED = "invoice-target-mvp:save-request-captured";
  let saveCaptureArmedUntil = 0;

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

  function xhrResponseText(xhr) {
    try { return String(xhr.responseText || "").slice(0, 8000); } catch (_) { return ""; }
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
      if (meta && shouldCaptureSaveRequest(meta.method, meta.url)) {
        const serialized = serializeRequestBody(body);
        this.addEventListener("loadend", () => {
          emitSaveCapture({
            transport: "xhr",
            method: meta.method,
            url: meta.url,
            headers: safeRequestHeaders(meta.headers),
            ...serialized,
            status: Number(this.status || 0),
            responseText: xhrResponseText(this)
          });
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
        const serialized = capture ? serializeRequestBody(init?.body) : null;
        const response = await nativeFetch.apply(this, arguments);
        if (capture) {
          let responseText = "";
          try { responseText = (await response.clone().text()).slice(0, 8000); } catch (_) {}
          emitSaveCapture({
            transport: "fetch",
            method,
            url,
            headers: safeRequestHeaders(headers),
            ...serialized,
            status: Number(response.status || 0),
            responseText
          });
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

  function applyInvoiceTimes(checkInValue, checkOutValue) {
    const checkInDate = parseDateTime(checkInValue);
    const checkOutDate = parseDateTime(checkOutValue);
    if (!checkInDate || !checkOutDate || checkOutDate < checkInDate) {
      throw new Error("Khoang gio vao/ra cua phuong an phieu moi khong hop le.");
    }
    const inputs = Array.from(document.querySelectorAll("input")).filter(input => isVisible(input) && parseDateTime(input.value));
    if (inputs.length < 2) throw new Error("Khong tim thay o gio vao/ra dang hien thi.");
    const checkInInput = inputs.find(input => /GIOVAO|NGAYVAO|CHECKIN|START/i.test(`${input.id} ${input.name}`)) || inputs[0];
    const remaining = inputs.filter(input => input !== checkInInput);
    const checkOutInput = remaining.find(input => /GIORA|NGAYRA|CHECKOUT|END/i.test(`${input.id} ${input.name}`)) || remaining[0];
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
    applyValue(checkInInput, checkInDate, checkInValue);
    applyValue(checkOutInput, checkOutDate, checkOutValue);
    return { checkIn: checkInInput.value, checkOut: checkOutInput.value };
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

  async function closeInvoiceDetail() {
    const button = Array.from(document.querySelectorAll('button[id^="btnThoat"]')).find(isVisible);
    if (!button) return { closed: false };
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    try {
      button.click();
      await wait(500);
      const listDialog = window.__invoiceTargetListDialogInfo;
      if (listDialog?.client && invoiceListElement()) window.dialogInfo = listDialog;
      return { closed: !suffixInput("numTONGCONG"), suppressedAlerts };
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
        jq(input).data("kendoNumericTextBox"),
        jq(input).data("kendoComboBox"),
        jq(input).data("kendoDropDownList")
      ].filter(Boolean) : [];
      widgets.forEach(widget => {
        if (typeof widget.value !== "function") return;
        if (/Date|Time/.test(widget.options?.name || "")) {
          const parsed = parseDateTime(saved.value);
          if (parsed) widget.value(parsed);
        } else {
          widget.value(saved.value);
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
        const text = String(dialog.innerText || "").replace(/\s+/g, " ");
        return /LƯU HÓA ĐƠN/i.test(text) &&
          /TỔNG TIỀN/i.test(text) &&
          /TIỀN MẶT/i.test(text) &&
          /Tiền thanh toán/i.test(text) &&
          dialogControls(dialog).some(control =>
            ["Lưu in", "Lưu thoát"].includes(dialogControlText(control))
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
    if (!button || !["Lưu in", "Lưu thoát"].includes(dialogControlText(button))) return;
    const result = normalizePaymentDialog();
    if (!result.ready) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.alert("Tiền mặt chưa khớp Tổng tiền. Extension đã chặn lưu để tránh sai hóa đơn.");
    }
  }, true);

  async function applyInvoicePlan(detail) {
    await closeTransientQuantityDialogs(500);
    try {
      const preservedFormState = captureInvoiceFormState();
      const replaced = await replaceInvoiceItems(detail.items || []);
      restoreInvoiceFormState(preservedFormState);
      const hour = applyHourAmount(detail.finalHourAmount);
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
      return {
        ready: true,
        mode: "kendo-atomic",
        closedInputDialogs,
        items: replaced.snapshot.items,
        currentGoods: totals.goods,
        currentHour: hour.hourAmount,
        currentTax: totals.tax,
        taxRate: valueOf("numTILETHUE"),
        currentGrand: totals.grand,
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

  async function filterProduct(found, code) {
    const dataSource = found.grid.dataSource;
    const field = found.fields.code;
    const exact = () => dataSource.view().find(item => String(objectValue(item, field) || "").trim() === String(code).trim());
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
      const pageDeadline = Date.now() + 1500;
      while (Date.now() < pageDeadline) {
        item = exact();
        if (item) return item;
        await wait(120);
      }
    }
    if (!item) throw new Error(`Khong tim thay ma hang ${code} tren danh muc web.`);
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
    rememberInvoiceListDialog();

    const dateInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(input => normalizeDateKey(input.value));
    if (dateInputs.length < 2) throw new Error("Không tìm thấy bộ lọc Từ ngày/Đến ngày.");
    const jq = window.jQuery || window.$;
    dateInputs.slice(0, 2).forEach(input => {
      const picker = jq ? jq(input).data("kendoDatePicker") : null;
      if (picker?.value) picker.value(new Date(`${dateKey}T00:00:00`));
      setNativeValue(input, expected);
    });

    const unissuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_2"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Chưa xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    if (!unissuedRadio) throw new Error('Không tìm thấy bộ lọc "Chưa xuất hóa đơn".');
    if (!unissuedRadio.checked) unissuedRadio.click();
    if (!unissuedRadio.checked) {
      unissuedRadio.checked = true;
      unissuedRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const refresh = document.querySelector('[id^="btnRefresh"]') ||
      Array.from(document.querySelectorAll("button")).find(button => (button.innerText || "").trim() === "Refresh");
    if (!refresh) throw new Error("Không tìm thấy nút Refresh của danh sách phiếu.");
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    try {
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
          const used = new Set((usedInvoiceNos || []).map(String));
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
    rememberInvoiceListDialog();

    const dateInputs = Array.from(document.querySelectorAll('input[type="text"]')).filter(input => normalizeDateKey(input.value));
    if (dateInputs.length < 2) throw new Error("Không tìm thấy bộ lọc Từ ngày/Đến ngày.");
    const jq = window.jQuery || window.$;
    dateInputs.slice(0, 2).forEach(input => {
      const picker = jq ? jq(input).data("kendoDatePicker") : null;
      if (picker?.value) picker.value(new Date(`${dateKey}T00:00:00`));
      setNativeValue(input, expected);
    });

    // Radio "Đã xuất hóa đơn" là _1 (đối ứng "Chưa xuất" _2); dự phòng theo nhãn.
    const issuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_1"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Đã xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    if (!issuedRadio) throw new Error('Không tìm thấy bộ lọc "Đã xuất hóa đơn".');
    if (!issuedRadio.checked) issuedRadio.click();
    if (!issuedRadio.checked) {
      issuedRadio.checked = true;
      issuedRadio.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const refresh = document.querySelector('[id^="btnRefresh"]') ||
      Array.from(document.querySelectorAll("button")).find(button => (button.innerText || "").trim() === "Refresh");
    if (!refresh) throw new Error("Không tìm thấy nút Refresh của danh sách phiếu.");
    const originalAlert = window.alert;
    const suppressedAlerts = [];
    window.alert = message => { suppressedAlerts.push(String(message || "")); };
    const target = Math.round(Number(amount) || 0);
    try {
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

  async function openInvoiceCandidate(uid, invoiceNo) {
    const grid = invoiceListElement();
    if (!grid) throw new Error("Hãy mở màn hình danh sách Bán hàng trước.");
    const unissuedRadio = document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_2"]') ||
      Array.from(document.querySelectorAll('input[type="radio"]')).find(input => /Chưa xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`));
    if (!unissuedRadio?.checked) throw new Error('Chỉ được tự mở khi bộ lọc "Chưa xuất hóa đơn" đang được chọn.');
    const row = Array.from(grid.querySelectorAll("tbody tr[data-uid]")).find(element =>
      (uid && element.getAttribute("data-uid") === String(uid)) ||
      (!uid && (element.innerText || "").includes(String(invoiceNo || "")))
    );
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

  const SALES_TABLE_ID = "d56b4b85-68c8-44c1-947d-9f3899e55a7c";

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

  function currentFormData() {
    const scripts = Array.from(document.scripts)
      .map(script => script.textContent || "")
      .filter(source => source.includes("new AddEdit_JsClient") && source.includes("new DataTransferJs("))
      .reverse();
    const visibleInvoiceNo = String(suffixInput("txtNAME")?.value || "").trim();
    let fallback = null;
    for (const source of scripts) {
      const marker = source.indexOf("var formData = new DataTransferJs(");
      if (marker < 0) continue;
      const formData = extractJsonObject(source, marker);
      if (!formData || String(formData._AddEditTableID || "") !== SALES_TABLE_ID) continue;
      fallback ||= formData;
      const nameMap = (formData.mapper?.Maps || []).find(map => String(map.Field).toUpperCase() === "NAME");
      if (!visibleInvoiceNo || String(nameMap?.Value || "").trim() === visibleInvoiceNo) return formData;
    }
    if (fallback) return fallback;
    throw new Error("Khong doc duoc formData cua phieu dang mo.");
  }

  function localServerDateTime(date) {
    const pad = value => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
    if (String(fields.SOHD || "").trim()) throw new Error("Phieu da co so hoa don; Batch API bi chan.");
    if (expected?.invoiceNo && String(fields.NAME || "") !== String(expected.invoiceNo)) {
      throw new Error(`Request dang tro toi ${fields.NAME || "phieu khac"}, khong phai ${expected.invoiceNo}.`);
    }
    if (money(fields.TONGCONG) !== expectedGrand ||
        money(fields.TIENHANG) !== expectedGoods ||
        money(fields.TIENGIO) !== expectedHour) {
      throw new Error("Tong tien, tien hang hoac tien gio trong request chua khop phuong an.");
    }
    ["TILEGIAMGIA", "TIENGIAMGIA", "TILEGIAMGIAGIO", "TIENGIAMGIAGIO"].forEach(field => {
      if (money(fields[field]) !== 0) throw new Error("Ke toan khong dung giam gia; request da bi chan.");
    });
    if (["TIENMAT", "KHACHDUA", "TIENTHANHTOAN"].some(field => money(fields[field]) !== expectedGrand) ||
        money(fields.TRALAI) !== 0) {
      throw new Error("Tien mat/khach dua/tien thanh toan chua bang tong cong.");
    }

    const rows = payload.clientMap.Grids?.find(grid => String(grid.Name).toLowerCase() === "detail")?.Data || [];
    if (!rows.length) throw new Error("Request khong co dong hang.");
    const expectedItems = expectedItemMap(expected?.items);
    const actualItems = new Map();
    let goods = 0;
    rows.forEach(row => {
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

  function buildCurrentSavePayload(expected) {
    const formData = currentFormData();
    const recordId = String(formData._RecordID || formData.mapper?.ID || "");
    const grand = Math.round(Number(expected?.targetGrand) || valueOf("numTONGCONG"));
    const goods = Math.round(Number(expected?.targetGoods) || valueOf("numTIENHANG"));
    const hour = Math.round(Number(expected?.targetHour) || valueOf("numTIENGIO"));
    const tax = Math.round(Number(expected?.targetTax) || valueOf("numTIENTHUE"));
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
      TRALAI: 0
    };
    const maps = (formData.mapper?.Maps || []).map(map => {
      const field = String(map.Field || "").toUpperCase();
      return {
        Field: map.Field,
        Value: Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : map.Value
      };
    });
    const payload = {
      mode: 2,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: recordId,
        Maps: maps,
        Grids: [{ Name: "detail", Data: liveDetailRows() }],
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
      targetHour: hour
    });
    return { payload, verified };
  }

  async function saveCurrentInvoiceViaApi(expected) {
    const { payload, verified } = buildCurrentSavePayload(expected);
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
    return {
      saved: true,
      httpStatus: response.status,
      endpoint: new URL(endpoint).pathname,
      responseText,
      ...verified
    };
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
      else if (detail.action === "applyInvoiceTimes") result = applyInvoiceTimes(detail.checkIn, detail.checkOut);
      else if (detail.action === "applyHourAmount") result = applyHourAmount(detail.value);
      else if (detail.action === "closeInvoiceDetail") result = await closeInvoiceDetail();
      else if (detail.action === "applyInvoiceTotals") result = applyInvoiceTotals(detail.targetGrand, detail.targetGoods);
      else if (detail.action === "normalizePaymentDialog") result = normalizePaymentDialog();
      else if (detail.action === "applyInvoicePlan") result = await applyInvoicePlan(detail);
      else if (detail.action === "saveCurrentInvoiceViaApi") result = await saveCurrentInvoiceViaApi(detail);
      else throw new Error("Thao tác không được hỗ trợ.");
      window.dispatchEvent(new CustomEvent(RESPONSE, { detail: { id: detail.id, ok: true, result } }));
    } catch (error) {
      console.error("[InvoiceTarget bridge]", error);
      window.dispatchEvent(new CustomEvent(RESPONSE, { detail: { id: detail.id, ok: false, error: error.message } }));
    }
  });
})();
