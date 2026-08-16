(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.InvoiceSharedWarehouse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KIND = "invoice-target-shared-warehouse";
  const SCHEMA_VERSION = 1;

  const text = value => String(value == null ? "" : value).trim();
  const quantity = value => Math.max(0, Math.floor(Number(value) || 0));
  const money = value => Math.max(0, Math.round(Number(value) || 0));

  function empty() {
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      initialized: false,
      source: "",
      updatedAt: "",
      items: [],
      ledger: []
    };
  }

  function normalizeItem(row) {
    return {
      stockCode: text(row?.stockCode),
      stockName: text(row?.stockName),
      stockUnit: text(row?.stockUnit),
      stockQty: Number(row?.stockQty) || 0,
      conversion: Number(row?.conversion) || 1,
      availableQty: quantity(row?.availableQty),
      salePrice: money(row?.salePrice),
      active: row?.active !== false,
      missingFromLastSnapshot: Boolean(row?.missingFromLastSnapshot),
      firstSeenAt: text(row?.firstSeenAt),
      lastSeenAt: text(row?.lastSeenAt),
      source: text(row?.source)
    };
  }

  function normalize(dataset) {
    const base = empty();
    const seen = new Set();
    const items = [];
    for (const source of dataset?.items || []) {
      const item = normalizeItem(source);
      if (!item.stockCode || seen.has(item.stockCode)) continue;
      seen.add(item.stockCode);
      items.push(item);
    }
    return {
      ...base,
      ...dataset,
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      initialized: Boolean(dataset?.initialized),
      items,
      ledger: Array.isArray(dataset?.ledger) ? dataset.ledger.slice(-500) : []
    };
  }

  function summarize(items) {
    return (items || []).reduce((result, item) => {
      const qty = quantity(item.availableQty);
      result.codes += 1;
      result.units += qty;
      result.value += qty * money(item.salePrice);
      return result;
    }, { codes: 0, units: 0, value: 0 });
  }

  function previewImport(currentDataset, incomingRows, mode, options) {
    const current = normalize(currentDataset);
    const importMode = mode === "add" ? "add" : "snapshot";
    const now = text(options?.at) || new Date().toISOString();
    const source = text(options?.source) || "File kho";
    const beforeByCode = new Map(current.items.map(item => [item.stockCode, item]));
    const incomingByCode = new Map();
    for (const row of incomingRows || []) {
      const item = normalizeItem(row);
      if (!item.stockCode) continue;
      const duplicate = incomingByCode.get(item.stockCode);
      if (duplicate && importMode === "add") {
        duplicate.availableQty += item.availableQty;
      } else {
        incomingByCode.set(item.stockCode, item);
      }
    }

    const nextItems = [];
    const changes = [];
    for (const [stockCode, incoming] of incomingByCode) {
      const before = beforeByCode.get(stockCode);
      const beforeQty = quantity(before?.availableQty);
      const afterQty = importMode === "add" ? beforeQty + incoming.availableQty : incoming.availableQty;
      const next = normalizeItem({
        ...before,
        ...incoming,
        availableQty: afterQty,
        active: true,
        missingFromLastSnapshot: false,
        firstSeenAt: before?.firstSeenAt || now,
        lastSeenAt: now,
        source
      });
      nextItems.push(next);
      changes.push({
        stockCode,
        stockName: next.stockName,
        before: beforeQty,
        after: afterQty,
        delta: afterQty - beforeQty,
        isNew: !before
      });
      beforeByCode.delete(stockCode);
    }

    // Mã không có trong file kiểm kê không bị xóa hoặc đưa về 0. Kế toán sẽ
    // thấy cờ cảnh báo và có thể xử lý ở lần kiểm kê kế tiếp.
    for (const item of beforeByCode.values()) {
      nextItems.push(normalizeItem({
        ...item,
        missingFromLastSnapshot: importMode === "snapshot" ? true : item.missingFromLastSnapshot
      }));
    }
    nextItems.sort((a, b) => a.stockCode.localeCompare(b.stockCode));

    const counts = {
      incoming: incomingByCode.size,
      added: changes.filter(item => item.isNew).length,
      increased: changes.filter(item => item.delta > 0 && !item.isNew).length,
      decreased: changes.filter(item => item.delta < 0).length,
      unchanged: changes.filter(item => item.delta === 0).length,
      missing: importMode === "snapshot" ? beforeByCode.size : 0
    };
    return {
      mode: importMode,
      source,
      at: now,
      counts,
      beforeSummary: summarize(current.items),
      afterSummary: summarize(nextItems),
      changes,
      nextItems
    };
  }

  function applyImport(currentDataset, preview, tenant) {
    if (!preview || !Array.isArray(preview.nextItems)) throw new Error("Chưa có bản xem trước kho hợp lệ.");
    const current = normalize(currentDataset);
    const entry = {
      id: `warehouse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: preview.mode === "add" ? "inbound" : "snapshot",
      tenant: text(tenant),
      source: text(preview.source),
      at: text(preview.at) || new Date().toISOString(),
      changes: preview.changes.filter(item => item.delta !== 0).map(item => ({
        stockCode: item.stockCode,
        before: item.before,
        after: item.after,
        delta: item.delta
      }))
    };
    return normalize({
      ...current,
      initialized: true,
      source: preview.source,
      updatedAt: entry.at,
      items: preview.nextItems,
      ledger: [...current.ledger, entry].slice(-500)
    });
  }

  function overlayMappings(mappingDataset, warehouseDataset) {
    const warehouse = normalize(warehouseDataset);
    if (!warehouse.initialized) return structuredClone(mappingDataset);
    const qtyByCode = new Map(warehouse.items.map(item => [item.stockCode, item]));
    const next = structuredClone(mappingDataset);
    for (const row of next?.mappings || []) {
      if (row.availabilityMode === "per_invoice") continue;
      const item = qtyByCode.get(text(row.stockCode));
      row.availableQty = item ? item.availableQty : 0;
      row.stockQty = item ? item.stockQty : row.stockQty;
      row.stockMissing = !item || item.missingFromLastSnapshot;
    }
    return next;
  }

  function reconcileMappingDelta(warehouseDataset, beforeMapping, afterMapping, metadata) {
    const warehouse = normalize(warehouseDataset);
    if (!warehouse.initialized) return warehouse;
    const before = new Map((beforeMapping?.mappings || [])
      .filter(row => row.availabilityMode !== "per_invoice")
      .map(row => [text(row.stockCode), quantity(row.availableQty)]));
    const after = new Map((afterMapping?.mappings || [])
      .filter(row => row.availabilityMode !== "per_invoice")
      .map(row => [text(row.stockCode), quantity(row.availableQty)]));
    const changes = [];
    const nextItems = warehouse.items.map(item => {
      if (!before.has(item.stockCode) || !after.has(item.stockCode)) return item;
      const delta = after.get(item.stockCode) - before.get(item.stockCode);
      if (!delta) return item;
      const nextQty = quantity(item.availableQty + delta);
      if (item.availableQty + delta < 0) throw new Error(`Kho chung ${item.stockCode} không đủ để trừ ${Math.abs(delta)}.`);
      changes.push({ stockCode: item.stockCode, before: item.availableQty, after: nextQty, delta });
      return { ...item, availableQty: nextQty };
    });
    if (!changes.length) return warehouse;
    const at = new Date().toISOString();
    return normalize({
      ...warehouse,
      updatedAt: at,
      items: nextItems,
      ledger: [...warehouse.ledger, {
        id: `warehouse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: "invoice",
        tenant: text(metadata?.tenant),
        invoiceNo: text(metadata?.invoiceNo),
        transactionId: text(metadata?.transactionId),
        at,
        changes
      }].slice(-500)
    });
  }

  return {
    KIND,
    SCHEMA_VERSION,
    empty,
    normalize,
    summarize,
    previewImport,
    applyImport,
    overlayMappings,
    reconcileMappingDelta
  };
});
