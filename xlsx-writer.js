(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceXlsxWriter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Ghi file .xlsx không cần thư viện ngoài. XLSX là một file ZIP chứa vài phần
  // XML; ở đây dùng phương thức "stored" (không nén) nên chỉ cần CRC32, không
  // cần bộ nén. Đổi lại file to hơn, nhưng bảng vài nghìn dòng vẫn rất nhỏ.

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[index] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let index = 0; index < bytes.length; index += 1) {
      crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8(text) {
    return new TextEncoder().encode(text);
  }

  function escapeXml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;"
    })[char]);
  }

  // Excel từ chối mở file nếu gặp ký tự điều khiển không hợp lệ trong XML 1.0.
  // Chỉ tab, xuống dòng và về đầu dòng được phép.
  const INVALID_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\uFFFE\uFFFF]/g;

  function sanitizeText(value) {
    return String(value == null ? '' : value).replace(INVALID_XML_CHARS, '');
  }

  function columnName(index) {
    let name = "";
    let current = index;
    while (current >= 0) {
      name = String.fromCharCode(65 + (current % 26)) + name;
      current = Math.floor(current / 26) - 1;
    }
    return name;
  }

  function isNumeric(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function cellXml(value, rowNumber, columnIndex) {
    const reference = `${columnName(columnIndex)}${rowNumber}`;
    if (value && typeof value === "object" && typeof value.formula === "string") {
      const cached = value.value == null ? "" : value.value;
      if (isNumeric(cached)) return `<c r="${reference}"><f>${escapeXml(value.formula)}</f><v>${cached}</v></c>`;
      return `<c r="${reference}" t="str"><f>${escapeXml(value.formula)}</f><v>${escapeXml(sanitizeText(cached))}</v></c>`;
    }
    if (isNumeric(value)) {
      return `<c r="${reference}"><v>${value}</v></c>`;
    }
    const text = sanitizeText(value);
    if (!text) return "";
    // inlineStr tránh phải dựng bảng sharedStrings riêng.
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const columns = sheet.columns || [];
    const headers = columns.map(column => column.header);
    const rows = [headers, ...(sheet.rows || [])];
    const body = rows.map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => cellXml(value, rowIndex + 1, columnIndex)).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");
    const colsXml = columns.length
      ? `<cols>${columns.map((column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${Number(column.width) || 16}" customWidth="1"/>`
      ).join("")}</cols>`
      : "";
    // Cố định dòng tiêu đề và bật AutoFilter cho vùng dữ liệu.
    const lastColumn = columns.length ? columnName(columns.length - 1) : "A";
    const dimension = `A1:${lastColumn}${rows.length}`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${body}</sheetData><autoFilter ref="${dimension}"/></worksheet>`;
  }

  function zipEntry(name, text) {
    const data = utf8(text);
    return { name, data, crc: crc32(data) };
  }

  function buildZip(entries) {
    const chunks = [];
    const central = [];
    let offset = 0;
    const nameBytes = entries.map(entry => utf8(entry.name));

    entries.forEach((entry, index) => {
      const name = nameBytes[index];
      const header = new Uint8Array(30 + name.length);
      const view = new DataView(header.buffer);
      view.setUint32(0, 0x04034b50, true);
      view.setUint16(4, 20, true);
      view.setUint16(6, 0, true);
      view.setUint16(8, 0, true); // stored
      view.setUint16(10, 0, true);
      view.setUint16(12, 0, true);
      view.setUint32(14, entry.crc, true);
      view.setUint32(18, entry.data.length, true);
      view.setUint32(22, entry.data.length, true);
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);
      header.set(name, 30);
      chunks.push(header, entry.data);

      const record = new Uint8Array(46 + name.length);
      const recordView = new DataView(record.buffer);
      recordView.setUint32(0, 0x02014b50, true);
      recordView.setUint16(4, 20, true);
      recordView.setUint16(6, 20, true);
      recordView.setUint16(8, 0, true);
      recordView.setUint16(10, 0, true);
      recordView.setUint16(12, 0, true);
      recordView.setUint16(14, 0, true);
      recordView.setUint32(16, entry.crc, true);
      recordView.setUint32(20, entry.data.length, true);
      recordView.setUint32(24, entry.data.length, true);
      recordView.setUint16(28, name.length, true);
      recordView.setUint16(30, 0, true);
      recordView.setUint16(32, 0, true);
      recordView.setUint16(34, 0, true);
      recordView.setUint16(36, 0, true);
      recordView.setUint32(38, 0, true);
      recordView.setUint32(42, offset, true);
      record.set(name, 46);
      central.push(record);

      offset += header.length + entry.data.length;
    });

    const centralSize = central.reduce((sum, record) => sum + record.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(8, entries.length, true);
    endView.setUint16(10, entries.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);

    const all = [...chunks, ...central, end];
    const total = all.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let cursor = 0;
    for (const part of all) {
      output.set(part, cursor);
      cursor += part.length;
    }
    return output;
  }

  // sheets: [{ name, columns: [{ header, width }], rows: [[value, …]] }]
  function build(sheets) {
    const list = (sheets || []).filter(sheet => sheet && sheet.name);
    if (!list.length) throw new Error("Không có sheet nào để xuất.");

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
      list.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    }</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/><sheets>${
      list.map((sheet, index) =>
        `<sheet name="${escapeXml(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      ).join("")
    }</sheets></workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      list.map((_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      ).join("")
    }</Relationships>`;

    const entries = [
      zipEntry("[Content_Types].xml", contentTypes),
      zipEntry("_rels/.rels", rootRels),
      zipEntry("xl/workbook.xml", workbook),
      zipEntry("xl/_rels/workbook.xml.rels", workbookRels),
      ...list.map((sheet, index) => zipEntry(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet)))
    ];
    return buildZip(entries);
  }

  function toBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  }

  return { build, toBase64, crc32, columnName, escapeXml, sanitizeText };
});
