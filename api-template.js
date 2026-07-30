(function (root) {
  "use strict";

  function money(value) {
    if (typeof value === "number") return Math.round(value);
    const text = String(value == null ? "" : value).trim().replace(/\s/g, "");
    if (!text) return 0;
    if (/^-?\d+\.\d{1,2}$/.test(text)) return Math.round(Number(text));
    return Number(text.replace(/[^0-9-]/g, "") || 0);
  }

  function parseJson(value) {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!text || !["{", "["].includes(text[0])) return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function decodeBody(template) {
    if (!template) return null;
    if (template.bodyType === "formdata") {
      return Object.fromEntries((template.body || []).filter(entry => Array.isArray(entry) && entry.length === 2));
    }
    const text = String(template.body || "");
    const direct = parseJson(text);
    if (direct) return direct;
    if (["text", "urlencoded"].includes(template.bodyType)) {
      return Object.fromEntries(new URLSearchParams(text).entries());
    }
    return null;
  }

  function walkPayload(value, path, output, depth) {
    if (depth > 10 || value == null) return;
    const parsed = parseJson(value);
    if (parsed) return walkPayload(parsed, `${path}:json`, output, depth + 1);
    if (Array.isArray(value)) {
      if (value.length && value.every(item =>
        item && typeof item === "object" && "Field" in item && "Value" in item
      )) {
        const mapped = Object.fromEntries(value.map(item => [
          String(item.Field || "").toUpperCase(),
          item.Value
        ]));
        if ("TONGCONG" in mapped &&
            ("TIENMAT" in mapped || "TIENTHANHTOAN" in mapped || "KHACHDUA" in mapped)) {
          output.paymentObjects.push({ path, value: mapped });
        }
      }
      if (value.length && value.every(item =>
        item && typeof item === "object" && "truong" in item && "value" in item
      )) {
        const mapped = Object.fromEntries(value.map(item => [
          String(item.truong || "").toUpperCase(),
          item.value
        ]));
        if ("TIENMAT" in mapped || "TIENTHANHTOAN" in mapped || "KHACHDUA" in mapped) {
          output.cashObjects.push({ path, value: mapped });
        }
      }
      if (value.some(item => item && typeof item === "object" &&
          ("DONGIA" in item || "SOLUONG" in item || "SLXUAT" in item))) {
        output.detailArrays.push({ path, count: value.length });
      }
      value.forEach((item, index) => walkPayload(item, `${path}[${index}]`, output, depth + 1));
      return;
    }
    if (typeof value !== "object") return;
    const keys = Object.keys(value);
    if (keys.includes("TONGCONG") &&
        (keys.includes("TIENMAT") || keys.includes("TIENTHANHTOAN") || keys.includes("KHACHDUA"))) {
      output.paymentObjects.push({ path, value });
    }
    for (const [key, child] of Object.entries(value)) {
      walkPayload(child, `${path}.${key}`, output, depth + 1);
    }
  }

  function paymentResult(record) {
    const grand = money(record?.TONGCONG);
    const cash = money(record?.TIENMAT);
    const customer = money(record?.KHACHDUA);
    const paid = money(record?.TIENTHANHTOAN);
    const change = money(record?.TRALAI);
    return {
      grand, cash, customer, paid, change,
      ready: grand > 0 &&
        cash === grand &&
        customer === grand &&
        paid === grand &&
        change === 0
    };
  }

  function analyze(template) {
    const reasons = [];
    let endpointReady = false;
    try {
      const url = new URL(template?.url || "");
      endpointReady = /AddEdit/i.test(url.pathname) && /^(POST|PUT|PATCH)$/i.test(template?.method || "");
    } catch (_) {}
    if (!endpointReady) reasons.push("endpoint-not-addedit");
    if (Number(template?.status || 0) < 200 || Number(template?.status || 0) >= 300) {
      reasons.push("response-not-success");
    }

    const decoded = decodeBody(template);
    const found = { paymentObjects: [], cashObjects: [], detailArrays: [] };
    walkPayload(decoded, "$", found, 0);
    const payments = found.paymentObjects.map(item => ({
      path: item.path,
      ...paymentResult(item.value)
    }));
    let payment = payments.find(item => item.ready) || payments[0] || null;
    if (payment && found.cashObjects.length) {
      const cash = found.cashObjects[0].value;
      payment = paymentResult({
        TONGCONG: payment.grand,
        TIENMAT: cash.TIENMAT ?? payment.cash,
        KHACHDUA: cash.KHACHDUA ?? payment.customer,
        TIENTHANHTOAN: cash.TIENTHANHTOAN ?? payment.paid,
        TRALAI: cash.TRALAI ?? payment.change
      });
    }
    if (!payment) reasons.push("payment-fields-not-found");
    else if (!payment.ready) reasons.push("payment-values-not-equal");
    if (!found.detailArrays.length) reasons.push("invoice-detail-not-found");

    return {
      ready: reasons.length === 0,
      reasons,
      payment,
      paymentObjectCount: payments.length,
      detailArrays: found.detailArrays.slice(0, 10)
    };
  }

  root.InvoiceApiTemplate = { analyze, decodeBody, paymentResult };
})(typeof globalThis !== "undefined" ? globalThis : this);
