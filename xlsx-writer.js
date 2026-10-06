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

  // Định dạng ô (chỉ có khi sheet dùng tới, xem STYLES_XML): chỉ số trong cellXfs.
  const STYLE = Object.freeze({ none: 0, money: 1, header: 2, group: 3, groupMoney: 4 });

  // Sheet cũ (mảng giá trị thuần) xuất y như trước; sheet có cột tiền (`money`)
  // hoặc dòng dạng { cells, level, style } mới cần styles.xml.
  function sheetUsesStyles(sheet) {
    return (sheet.columns || []).some(column => column.money) ||
      (sheet.rows || []).some(row => row && !Array.isArray(row));
  }

  function cellXml(value, rowNumber, columnIndex, style = STYLE.none) {
    const reference = `${columnName(columnIndex)}${rowNumber}`;
    const styleAttr = style ? ` s="${style}"` : "";
    if (value && typeof value === "object" && typeof value.formula === "string") {
      const cached = value.value == null ? "" : value.value;
      if (isNumeric(cached)) return `<c r="${reference}"${styleAttr}><f>${escapeXml(value.formula)}</f><v>${cached}</v></c>`;
      return `<c r="${reference}"${styleAttr} t="str"><f>${escapeXml(value.formula)}</f><v>${escapeXml(sanitizeText(cached))}</v></c>`;
    }
    if (isNumeric(value)) {
      return `<c r="${reference}"${styleAttr}><v>${value}</v></c>`;
    }
    const text = sanitizeText(value);
    // Ô trống của dòng nhóm vẫn phải mang định dạng để cả dòng được tô nền.
    if (!text) return style ? `<c r="${reference}"${styleAttr}/>` : "";
    // inlineStr tránh phải dựng bảng sharedStrings riêng.
    return `<c r="${reference}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
  }

  function cellStyle(styled, rowStyle, column) {
    if (!styled) return STYLE.none;
    if (rowStyle === "header") return STYLE.header;
    if (rowStyle === "group") return column?.money ? STYLE.groupMoney : STYLE.group;
    return column?.money ? STYLE.money : STYLE.none;
  }

  function sheetXml(sheet, styled = sheetUsesStyles(sheet)) {
    const columns = sheet.columns || [];
    const headers = columns.map(column => column.header);
    const rows = [{ cells: headers, style: "header" }, ...(sheet.rows || [])]
      .map(row => (Array.isArray(row) ? { cells: row } : row));
    // Nhóm dòng (outline) kiểu Excel: dòng tóm tắt nằm TRÊN các dòng con, để nút
    // +/- thu gọn/mở rộng nằm ngay ở dòng phiếu.
    const maxLevel = rows.reduce((max, row) => Math.max(max, Math.round(Number(row.level) || 0)), 0);
    const body = rows.map((row, rowIndex) => {
      const cells = (row.cells || []).map((value, columnIndex) =>
        cellXml(value, rowIndex + 1, columnIndex, cellStyle(styled, row.style, columns[columnIndex]))).join("");
      const level = Math.round(Number(row.level) || 0);
      return `<row r="${rowIndex + 1}"${level ? ` outlineLevel="${level}"` : ""}>${cells}</row>`;
    }).join("");
    const colsXml = columns.length
      ? `<cols>${columns.map((column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${Number(column.width) || 16}" customWidth="1"/>`
      ).join("")}</cols>`
      : "";
    // Cố định dòng tiêu đề và bật AutoFilter cho vùng dữ liệu (trừ khi sheet tắt:
    // lọc trên sheet có nhóm dòng sẽ tách dòng hàng khỏi dòng phiếu của nó).
    const lastColumn = columns.length ? columnName(columns.length - 1) : "A";
    const dimension = `A1:${lastColumn}${rows.length}`;
    const sheetPr = maxLevel ? '<sheetPr><outlinePr summaryBelow="0"/></sheetPr>' : "";
    const formatPr = maxLevel ? `<sheetFormatPr defaultRowHeight="15" outlineLevelRow="${maxLevel}"/>` : "";
    const autoFilter = sheet.autoFilter === false ? "" : `<autoFilter ref="${dimension}"/>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheetPr}<dimension ref="${dimension}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${formatPr}${colsXml}<sheetData>${body}</sheetData>${autoFilter}</worksheet>`;
  }

  // Số tiền có dấu phân cách hàng nghìn; tiêu đề in đậm; dòng nhóm in đậm, nền xanh nhạt.
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3ECF8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

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

  // sheets: [{ name, columns: [{ header, width, money? }], rows: [[value, …] | { cells, level?, style? }],
  //            autoFilter? }]
  //   level: 1 = dòng con thu gọn được dưới dòng ngay trên có level 0.
  //   style: "group" = dòng nhóm (in đậm, tô nền).
  function build(sheets) {
    const list = (sheets || []).filter(sheet => sheet && sheet.name);
    if (!list.length) throw new Error("Không có sheet nào để xuất.");
    const styled = list.some(sheetUsesStyles);

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
      list.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")
    }${styled ? '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' : ""}</Types>`;

    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${
      list.map((sheet, index) =>
        `<sheet name="${escapeXml(sheet.name).slice(0, 31)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      ).join("")
    }</sheets><calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>`;

    const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
      list.map((_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      ).join("")
    }${styled ? `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` : ""}</Relationships>`;

    const entries = [
      zipEntry("[Content_Types].xml", contentTypes),
      zipEntry("_rels/.rels", rootRels),
      zipEntry("xl/workbook.xml", workbook),
      zipEntry("xl/_rels/workbook.xml.rels", workbookRels),
      ...(styled ? [zipEntry("xl/styles.xml", STYLES_XML)] : []),
      ...list.map((sheet, index) => zipEntry(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet, styled)))
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
