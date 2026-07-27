(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceMappingEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ALLOWED_STATUSES = new Set(["confirmed", "review", "unmatched", "disabled"]);

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/đ/g, "d")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function normalizeUnit(value) {
    const unit = normalizeText(value);
    const aliases = {
      goi: "goi", bao: "bao", chai: "chai", lon: "lon", cay: "cay",
      cai: "cai", hop: "hop", hu: "hu", thung: "thung", dia: "dia"
    };
    return aliases[unit] || unit;
  }

  function positiveNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function tokens(value) {
    return new Set(normalizeText(value).split(" ").filter(token => token.length > 1));
  }

  function tokenSimilarity(left, right) {
    const a = tokens(left);
    const b = tokens(right);
    if (!a.size || !b.size) return 0;
    let intersection = 0;
    for (const token of a) if (b.has(token)) intersection += 1;
    return intersection / (a.size + b.size - intersection);
  }

  function scoreCandidate(stock, web) {
    const stockName = normalizeText(stock.stockName);
    const webName = normalizeText(web.webName);
    const similarity = tokenSimilarity(stockName, webName);
    const contains = stockName && webName && (stockName.includes(webName) || webName.includes(stockName)) ? 1 : 0;
    const priceEqual = positiveNumber(stock.salePrice) === positiveNumber(web.webPrice) ? 1 : 0;
    const unitEqual = normalizeUnit(stock.stockUnit) === normalizeUnit(web.webUnit) ? 1 : 0;
    return Math.round((similarity * 55 + contains * 15 + priceEqual * 25 + unitEqual * 5) * 10) / 10;
  }

  function suggestCatalog(stock, catalog, limit) {
    return (catalog || []).map(web => ({ web, score: scoreCandidate(stock, web) }))
      .sort((a, b) => b.score - a.score || String(a.web.webCode).localeCompare(String(b.web.webCode)))
      .slice(0, limit || 3);
  }

  function mergeStockSnapshot(stockRows, catalog, previousMappings) {
    const previous = new Map((previousMappings || []).map(row => [String(row.stockCode), row]));
    return (stockRows || []).map(stock => {
      const old = previous.get(String(stock.stockCode));
      if (old?.status === "confirmed") return { ...old, ...stock, status: "confirmed" };
      const suggestions = suggestCatalog(stock, catalog, 3);
      const best = suggestions[0];
      return {
        ...stock,
        webCode: best?.web.webCode || "",
        webName: best?.web.webName || "",
        webUnit: best?.web.webUnit || "",
        webPrice: best?.web.webPrice || 0,
        status: best ? "review" : "unmatched",
        confidence: best?.score || 0,
        suggestions: suggestions.map(item => ({
          webCode: item.web.webCode, webName: item.web.webName, webPrice: item.web.webPrice, score: item.score
        }))
      };
    });
  }

  function applyBusinessRules(dataset) {
    const rules = {
      TC: { webCode: "1500006", webName: "HOA QUẢ THẬP CẨM (Đĩa nhỏ)", webUnit: "đĩa", webPrice: 350000 },
      TCTO: { webCode: "1500007", webName: "HOA QUẢ THẬP CẨM (ĐĨA TO)", webUnit: "đĩa", webPrice: 450000 }
    };
    for (const row of dataset?.mappings || []) {
      const rule = rules[String(row.stockCode)];
      if (!rule) continue;
      Object.assign(row, rule, {
        status: "confirmed",
        availabilityMode: "per_invoice",
        perInvoiceMax: 1,
        constraintGroup: "fruit_platter",
        constraintGroupMax: 1,
        reviewNote: "Ngoại lệ kế toán: tối đa một đĩa hoa quả thập cẩm (nhỏ hoặc to) trên mỗi hóa đơn."
      });
    }
    return dataset;
  }

  function reconcileCatalog(dataset, catalog) {
    const byCode = new Map((catalog || []).map(item => [String(item.webCode), item]));
    const report = { updated: 0, missing: 0 };
    for (const row of dataset?.mappings || []) {
      if (!row.webCode) continue;
      const web = byCode.get(String(row.webCode));
      if (!web) {
        if (row.status === "confirmed") row.status = "review";
        row.reviewNote = `Mã web ${row.webCode} không còn trong danh mục mới.`;
        report.missing += 1;
        continue;
      }
      if (row.webName !== web.webName || row.webUnit !== web.webUnit || Number(row.webPrice) !== Number(web.webPrice)) report.updated += 1;
      Object.assign(row, {
        webName: web.webName,
        webUnit: web.webUnit,
        webPrice: web.webPrice,
        webGroup: web.webGroup,
        webType: web.webType
      });
    }
    applyBusinessRules(dataset);
    for (const row of dataset?.mappings || []) {
      if (row.webCode && !byCode.has(String(row.webCode))) {
        row.status = "review";
        row.reviewNote = `Mã web ${row.webCode} không còn trong danh mục mới.`;
      }
    }
    return report;
  }

  function validateMapping(row) {
    const errors = [];
    if (!row || !String(row.stockCode || "").trim()) errors.push("Thiếu mã kho");
    if (!ALLOWED_STATUSES.has(String(row?.status || ""))) errors.push("Trạng thái không hợp lệ");
    if (row?.status === "confirmed") {
      if (!String(row.webCode || "").trim()) errors.push("Thiếu mã web");
      if (!String(row.webName || "").trim()) errors.push("Thiếu tên web");
      if (!positiveNumber(row.webPrice)) errors.push("Giá web không hợp lệ");
      if (!positiveNumber(row.conversion || 1)) errors.push("Quy đổi không hợp lệ");
    }
    return { valid: errors.length === 0, errors };
  }

  function eligibleMappings(dataset) {
    return (dataset?.mappings || []).filter(row =>
      row.status === "confirmed" &&
      validateMapping(row).valid &&
      (positiveNumber(row.availableQty) > 0 || (row.availabilityMode === "per_invoice" && positiveNumber(row.perInvoiceMax) > 0))
    );
  }

  function buildInventory(dataset) {
    const byWebCode = new Map();
    for (const row of eligibleMappings(dataset)) {
      const webCode = String(row.webCode);
      const availableQty = row.availabilityMode === "per_invoice"
        ? Math.floor(positiveNumber(row.perInvoiceMax))
        : Math.floor(positiveNumber(row.availableQty));
      const existing = byWebCode.get(webCode);
      if (!existing) {
        byWebCode.set(webCode, {
          webCode,
          webName: String(row.webName),
          webUnit: String(row.webUnit || ""),
          webPrice: Math.round(positiveNumber(row.webPrice)),
          availableQty,
          stockCodes: [String(row.stockCode)],
          mappingStatus: "confirmed",
          availabilityMode: row.availabilityMode || "stock",
          constraintGroup: row.constraintGroup || "",
          constraintGroupMax: positiveNumber(row.constraintGroupMax) || null
        });
        continue;
      }
      if (existing.webPrice !== Math.round(positiveNumber(row.webPrice))) continue;
      existing.availableQty += availableQty;
      existing.stockCodes.push(String(row.stockCode));
    }
    return [...byWebCode.values()].sort((a, b) => a.webCode.localeCompare(b.webCode));
  }

  function summarize(dataset) {
    const rows = dataset?.mappings || [];
    const summary = { total: rows.length, confirmed: 0, review: 0, unmatched: 0, disabled: 0, invalid: 0, eligible: 0 };
    for (const row of rows) {
      if (Object.prototype.hasOwnProperty.call(summary, row.status)) summary[row.status] += 1;
      if (!validateMapping(row).valid) summary.invalid += 1;
    }
    summary.eligible = eligibleMappings(dataset).length;
    return summary;
  }

  return {
    normalizeText, normalizeUnit, validateMapping, eligibleMappings, buildInventory, summarize,
    tokenSimilarity, scoreCandidate, suggestCatalog, mergeStockSnapshot, applyBusinessRules, reconcileCatalog
  };
});
