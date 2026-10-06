(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceIssuedBook = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KIND = "invoice-target-issued-invoices";
  const SCHEMA_VERSION = 1;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createId(now) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `issued-${new Date(now || Date.now()).getTime()}-${Math.random().toString(16).slice(2)}`;
  }

  function normalizeItems(items) {
    return (items || [])
      .map(item => ({
        code: String(item.code || "").trim(),
        name: String(item.name || "").trim(),
        unit: String(item.unit || "").trim(),
        qty: Math.max(0, Math.round(Number(item.qty) || 0)),
        price: Math.max(0, Math.round(Number(item.price) || 0)),
        amount: Math.max(0, Math.round(Number(item.amount) || 0))
      }))
      .filter(item => item.code && item.qty > 0);
  }

  // Mot hoa don co the co nhieu dong cung ma; gop lai de thong ke theo mat hang.
  function mergeItems(items) {
    const merged = new Map();
    for (const item of normalizeItems(items)) {
      const current = merged.get(item.code);
      if (!current) {
        merged.set(item.code, { ...item });
        continue;
      }
      current.qty += item.qty;
      current.amount += item.amount;
      if (!current.name) current.name = item.name;
      if (!current.unit) current.unit = item.unit;
    }
    return Array.from(merged.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  function normalizeEntry(entry) {
    const items = mergeItems(entry?.items);
    return {
      id: String(entry?.id || createId(entry?.issuedAt)),
      invoiceId: String(entry?.invoiceId || ""),
      invoiceNo: String(entry?.invoiceNo || ""),
      dateKey: String(entry?.dateKey || ""),
      issuedAt: String(entry?.issuedAt || new Date().toISOString()),
      grandTotal: Math.max(0, Math.round(Number(entry?.grandTotal) || 0)),
      soHoaDon: String(entry?.soHoaDon || ""),
      soKyHieu: String(entry?.soKyHieu || ""),
      maCQThue: String(entry?.maCQThue || ""),
      maTraCuu: String(entry?.maTraCuu || ""),
      linkTraCuu: String(entry?.linkTraCuu || ""),
      buyer: String(entry?.buyer || ""),
      buyerAddress: String(entry?.buyerAddress || ""),
      paymentMethod: String(entry?.paymentMethod || ""),
      itemsError: String(entry?.itemsError || ""),
      items
    };
  }

  // Phat hanh lai cung mot phieu (hoac chay lai lo) khong duoc cong don so lieu:
  // moi invoiceId chi giu mot ban ghi, ban sau ghi de ban truoc.
  function record(book, entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized.invoiceId) throw new Error("Thiếu ID hóa đơn để ghi sổ phát hành.");
    const entries = (book?.entries || []).map(normalizeEntry);
    const index = entries.findIndex(item => item.invoiceId === normalized.invoiceId);
    if (index >= 0) {
      normalized.id = entries[index].id;
      entries[index] = normalized;
    } else {
      entries.push(normalized);
    }
    return { entries };
  }

  // Tìm trước rồi mới chuẩn hóa đúng một bản ghi. Chuẩn hóa cả sổ trước khi tìm
  // khiến mỗi lần gọi tốn O(số hóa đơn đã ghi), mà hàm này được gọi một lần cho
  // mỗi dòng khi vẽ bảng phát hành.
  function findByInvoiceId(book, invoiceId) {
    const wanted = String(invoiceId || "");
    const found = (book?.entries || []).find(item => String(item?.invoiceId || "") === wanted);
    return found ? normalizeEntry(found) : null;
  }

  function inRange(dateKey, fromDate, toDate) {
    if (!dateKey) return false;
    if (fromDate && dateKey < fromDate) return false;
    if (toDate && dateKey > toDate) return false;
    return true;
  }

  function filterEntries(book, options) {
    const from = String(options?.fromDate || "");
    const to = String(options?.toDate || "");
    return (book?.entries || [])
      .map(normalizeEntry)
      .filter(entry => (!from && !to) || inRange(entry.dateKey, from, to))
      .sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey) ||
        a.invoiceNo.localeCompare(b.invoiceNo));
  }

  // Bang thong ke cho ke toan: tong so luong va thanh tien theo tung mat hang.
  function summarizeItems(entries) {
    const totals = new Map();
    for (const entry of entries) {
      for (const item of entry.items) {
        const current = totals.get(item.code);
        if (!current) {
          totals.set(item.code, {
            code: item.code,
            name: item.name,
            unit: item.unit,
            qty: item.qty,
            amount: item.amount,
            invoiceCount: 1
          });
          continue;
        }
        current.qty += item.qty;
        current.amount += item.amount;
        current.invoiceCount += 1;
        if (!current.name) current.name = item.name;
        if (!current.unit) current.unit = item.unit;
      }
    }
    return Array.from(totals.values()).sort((a, b) => a.code.localeCompare(b.code));
  }

  function build(options) {
    const exportedAt = options?.exportedAt || new Date().toISOString();
    const entries = filterEntries(options?.book, options);
    const items = summarizeItems(entries);
    const incomplete = entries.filter(entry => !entry.items.length);
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      exportId: options?.exportId || createId(exportedAt),
      exportedAt,
      extensionVersion: String(options?.extensionVersion || ""),
      range: {
        fromDate: String(options?.fromDate || ""),
        toDate: String(options?.toDate || "")
      },
      summary: {
        invoiceCount: entries.length,
        itemCodeCount: items.length,
        totalQty: items.reduce((sum, item) => sum + item.qty, 0),
        totalAmount: items.reduce((sum, item) => sum + item.amount, 0),
        invoicesWithoutItems: incomplete.length
      },
      items,
      invoices: entries.map(entry => ({
        invoiceNo: entry.invoiceNo,
        dateKey: entry.dateKey,
        issuedAt: entry.issuedAt,
        grandTotal: entry.grandTotal,
        soHoaDon: entry.soHoaDon,
        soKyHieu: entry.soKyHieu,
        maCQThue: entry.maCQThue,
        maTraCuu: entry.maTraCuu,
        itemsError: entry.itemsError,
        items: entry.items
      }))
    };
  }

  const SHEET_COLUMNS = [
    { header: "Mã phiếu", width: 16 },
    { header: "Ngày", width: 12 },
    { header: "Số hóa đơn", width: 13 },
    { header: "Mã hàng", width: 12 },
    { header: "Tên hàng", width: 34 },
    { header: "Tên hàng kho", width: 38 },
    { header: "Số lượng", width: 10 },
    { header: "Giá tiền", width: 14, money: true },
    { header: "Thành tiền", width: 15, money: true }
  ];

  // Sheet "TheoPhieu" cho kế toán kiểm soát: mỗi phiếu một dòng nhóm (in đậm,
  // thu gọn/mở được bằng nút +/- của Excel), dưới là các dòng hàng CHỈ gồm thông
  // tin hàng web và ánh xạ của nó dưới kho.
  const GROUPED_COLUMNS = [
    { header: "Phiếu", width: 16 },
    { header: "Ngày", width: 11 },
    { header: "Số HĐ", width: 9 },
    { header: "Mã hàng web", width: 13 },
    { header: "Tên hàng web", width: 34 },
    { header: "ĐVT", width: 7 },
    { header: "Số lượng", width: 9 },
    { header: "Đơn giá", width: 12, money: true },
    { header: "Thành tiền", width: 14, money: true },
    { header: "Mã hàng kho", width: 16 },
    { header: "Tên hàng kho", width: 40 }
  ];

  // stockNameByWebCode: Map<webCode, "MAKHO - Tên kho; MAKHO2 - Tên kho 2">.
  // Một mã web có thể nhận tồn từ nhiều dòng kho; extension không biết hóa đơn
  // thực tế trừ từ dòng nào nên ghép tất cả vào một ô và giữ nguyên số lượng,
  // để tổng luôn khớp hóa đơn và kế toán tự quyết định trừ ở đâu.
  function detailRows(book, options) {
    const stockNames = options?.stockNameByWebCode || new Map();
    const rows = [];
    for (const entry of filterEntries(book, options)) {
      for (const item of entry.items) {
        rows.push([
          entry.invoiceNo,
          entry.dateKey,
          entry.soHoaDon,
          item.code,
          item.name,
          String(stockNames.get(String(item.code)) || ""),
          item.qty,
          item.price,
          item.amount
        ]);
      }
    }
    return rows;
  }

  function viDate(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : String(dateKey || "");
  }

  // stockMappingByWebCode: Map<webCode, [{ code, name }]> — các dòng kho đã xác
  // nhận ánh xạ tới mã web đó. Nhiều dòng kho thì ghép mã và tên theo cùng thứ tự,
  // giữ nguyên số lượng (như sheet ChiTiet). Chưa có ánh xạ thì ghi rõ để kế toán
  // thấy ngay dòng nào chưa trừ kho được.
  function groupedRows(book, options) {
    const mapping = options?.stockMappingByWebCode || new Map();
    const rows = [];
    let invoiceCount = 0;
    let lineCount = 0;
    let totalQty = 0;
    let totalAmount = 0;
    for (const entry of filterEntries(book, options)) {
      const qty = entry.items.reduce((sum, item) => sum + item.qty, 0);
      const amount = entry.items.reduce((sum, item) => sum + item.amount, 0);
      invoiceCount += 1;
      lineCount += entry.items.length;
      totalQty += qty;
      totalAmount += amount;
      rows.push({
        style: "group",
        cells: [
          entry.invoiceNo, viDate(entry.dateKey), entry.soHoaDon, "",
          entry.items.length ? `${entry.items.length} mặt hàng` : "⚠ chưa đọc được mặt hàng — kiểm tra trước khi hạch toán",
          "", qty, "", amount, "", ""
        ]
      });
      for (const item of entry.items) {
        const stock = mapping.get(String(item.code)) || [];
        rows.push({
          level: 1,
          cells: [
            "", "", "", item.code, item.name, item.unit, item.qty, item.price, item.amount,
            stock.map(line => line.code).join("; "),
            stock.length ? stock.map(line => line.name).join("; ") : "⚠ chưa ánh xạ kho"
          ]
        });
      }
    }
    if (invoiceCount) {
      rows.push({
        style: "group",
        cells: ["TỔNG CỘNG", "", "", "", `${invoiceCount} phiếu · ${lineCount} dòng hàng`, "", totalQty, "", totalAmount, "", ""]
      });
    }
    return rows;
  }

  function buildWorkbook(options) {
    const rows = detailRows(options?.book, options);
    if (!rows.length) throw new Error("Không có dòng hàng nào để xuất.");
    return [
      // Sheet đầu (mở ra là thấy): theo phiếu. Tắt AutoFilter vì lọc sẽ tách dòng
      // hàng khỏi dòng phiếu của nó; cần lọc/pivot thì dùng sheet ChiTiet.
      { name: "TheoPhieu", columns: GROUPED_COLUMNS, rows: groupedRows(options?.book, options), autoFilter: false },
      { name: "ChiTiet", columns: SHEET_COLUMNS, rows }
    ];
  }

  return {
    KIND, SCHEMA_VERSION, SHEET_COLUMNS, GROUPED_COLUMNS,
    record, normalizeEntry, mergeItems, findByInvoiceId,
    filterEntries, summarizeItems, build, clone,
    detailRows, groupedRows, buildWorkbook
  };
});
