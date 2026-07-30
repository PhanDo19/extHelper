(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceStockState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KIND = "invoice-target-inventory-state";
  const SCHEMA_VERSION = 2;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createId(now) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `stock-${new Date(now || Date.now()).getTime()}-${Math.random().toString(16).slice(2)}`;
  }

  function inventoryRows(mappingDataset) {
    return (mappingDataset?.mappings || [])
      .filter(row => row.availabilityMode !== "per_invoice")
      .map(row => ({
        stockCode: String(row.stockCode || ""),
        stockName: String(row.stockName || ""),
        stockUnit: String(row.stockUnit || ""),
        conversion: Math.max(0, Number(row.conversion) || 0),
        availableQty: Math.max(0, Number(row.availableQty) || 0)
      }))
      .sort((a, b) => a.stockCode.localeCompare(b.stockCode));
  }

  function fingerprintRows(rows) {
    const compact = rows.map(row => ({
      stockCode: String(row.stockCode || ""),
      availableQty: Math.max(0, Number(row.availableQty) || 0)
    }));
    const text = JSON.stringify(compact);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function stateSummary(rows) {
    return {
      stockItemCount: rows.length,
      availableUnitCount: rows.reduce((sum, row) => sum + Math.max(0, Number(row.availableQty) || 0), 0)
    };
  }

  function build(options) {
    const exportedAt = options.exportedAt || new Date().toISOString();
    const rows = inventoryRows(options.mappingDataset);
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      exportId: options.exportId || createId(exportedAt),
      parentExportId: options.parentExportId || null,
      exportedAt,
      extensionVersion: String(options.extensionVersion || ""),
      source: String(options.mappingDataset?.source || ""),
      inventoryFingerprint: fingerprintRows(rows),
      summary: stateSummary(rows),
      inventory: { rows }
    };
  }

  function validate(payload) {
    const errors = [];
    const warnings = [];
    if (!payload || typeof payload !== "object") errors.push("File JSON không chứa một đối tượng hợp lệ.");
    if (payload?.kind !== KIND) errors.push("Không đúng loại file trạng thái tồn kho.");
    if (Number(payload?.schemaVersion) !== SCHEMA_VERSION) errors.push(`Phiên bản dữ liệu không được hỗ trợ: ${payload?.schemaVersion ?? "trống"}.`);
    if (!String(payload?.exportId || "").trim()) errors.push("Thiếu mã lần xuất.");
    if (!Array.isArray(payload?.inventory?.rows)) errors.push("Thiếu danh sách tồn kho.");

    const codes = new Set();
    for (const row of payload?.inventory?.rows || []) {
      const code = String(row.stockCode || "").trim();
      if (!code) errors.push("Có dòng tồn kho thiếu mã kho.");
      if (codes.has(code)) errors.push(`Mã kho ${code} bị lặp trong file.`);
      codes.add(code);
      if (!Number.isFinite(Number(row.availableQty)) || Number(row.availableQty) < 0) {
        errors.push(`Tồn khả dụng của mã ${code || "không rõ"} không hợp lệ.`);
      }
    }

    if (!errors.length) {
      const actualFingerprint = fingerprintRows(payload.inventory.rows);
      if (payload.inventoryFingerprint !== actualFingerprint) errors.push("Dữ liệu tồn kho không còn khớp dấu kiểm tra của file.");
      const exportedTime = Date.parse(payload.exportedAt);
      if (!Number.isFinite(exportedTime)) errors.push("Thời điểm xuất file không hợp lệ.");
      else if (exportedTime > Date.now() + 5 * 60 * 1000) warnings.push("File có thời điểm xuất nằm trong tương lai; hãy kiểm tra đồng hồ máy.");
    }
    return { valid: errors.length === 0, errors: [...new Set(errors)], warnings };
  }

  function byStockCode(rows) {
    return new Map((rows || []).map(row => [String(row.stockCode), Math.max(0, Number(row.availableQty) || 0)]));
  }

  function compare(currentMappingDataset, incomingPayload, currentMeta) {
    const validation = validate(incomingPayload);
    const currentRows = inventoryRows(currentMappingDataset);
    const incomingRows = incomingPayload?.inventory?.rows || [];
    const current = byStockCode(currentRows);
    const incoming = byStockCode(incomingRows);
    let increased = 0;
    let decreased = 0;
    let unchanged = 0;
    let added = 0;
    let removed = 0;
    const changes = [];
    for (const code of new Set([...current.keys(), ...incoming.keys()])) {
      const before = current.has(code) ? current.get(code) : null;
      const after = incoming.has(code) ? incoming.get(code) : null;
      if (before == null) added += 1;
      else if (after == null) removed += 1;
      else if (after > before) increased += 1;
      else if (after < before) decreased += 1;
      else unchanged += 1;
      if (before !== after) changes.push({ stockCode: code, before, after, delta: (after || 0) - (before || 0) });
    }
    changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.stockCode.localeCompare(b.stockCode));

    const warnings = [...validation.warnings];
    if (added) warnings.push(`${added} mã trong file chưa có trong dữ liệu ánh xạ hiện tại; các mã này sẽ chưa được thêm tự động.`);
    if (removed) warnings.push(`${removed} mã hiện tại không có trong file; số tồn của các mã này sẽ được giữ nguyên.`);
    const currentExportedAt = Date.parse(currentMeta?.exportedAt || "");
    const incomingExportedAt = Date.parse(incomingPayload?.exportedAt || "");
    if (Number.isFinite(currentExportedAt) && Number.isFinite(incomingExportedAt) && incomingExportedAt < currentExportedAt) {
      warnings.push("File này cũ hơn trạng thái đang dùng trên trình duyệt.");
    }
    if (currentMeta?.currentExportId && incomingPayload?.exportId === currentMeta.currentExportId) {
      warnings.push("File này chính là trạng thái đang được sử dụng.");
    } else if (currentMeta?.currentExportId && incomingPayload?.parentExportId &&
      incomingPayload.parentExportId !== currentMeta.currentExportId) {
      warnings.push("File không nối tiếp trực tiếp từ trạng thái hiện tại; có thể là một nhánh dữ liệu khác.");
    }
    return {
      validation: { ...validation, warnings },
      counts: { increased, decreased, unchanged, added, removed },
      changes,
      currentSummary: stateSummary(currentRows),
      incomingSummary: stateSummary(incomingRows)
    };
  }

  function applyToMapping(mappingDataset, payload) {
    const validation = validate(payload);
    if (!validation.valid) throw new Error(validation.errors.join(" "));
    const quantities = byStockCode(payload.inventory.rows);
    const next = clone(mappingDataset);
    for (const row of next?.mappings || []) {
      if (row.availabilityMode === "per_invoice") continue;
      const code = String(row.stockCode || "");
      if (quantities.has(code)) row.availableQty = quantities.get(code);
    }
    next.source = payload.source || next.source;
    next.stockStateImportedAt = new Date().toISOString();
    next.stockStateExportId = payload.exportId;
    return next;
  }

  return {
    KIND, SCHEMA_VERSION, build, validate, compare, applyToMapping,
    fingerprintRows, stateSummary, inventoryRows
  };
});
