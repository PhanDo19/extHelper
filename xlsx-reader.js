(function (root) {
  "use strict";
  const decoder = new TextDecoder("utf-8");

  function u16(view, offset) { return view.getUint16(offset, true); }
  function u32(view, offset) { return view.getUint32(offset, true); }

  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    let eocd = bytes.length - 22;
    while (eocd >= 0 && u32(view, eocd) !== 0x06054b50) eocd -= 1;
    if (eocd < 0) throw new Error("File không phải XLSX hợp lệ.");
    const count = u16(view, eocd + 10);
    let cursor = u32(view, eocd + 16);
    const files = new Map();
    for (let index = 0; index < count; index += 1) {
      if (u32(view, cursor) !== 0x02014b50) throw new Error("Cấu trúc ZIP không hợp lệ.");
      const method = u16(view, cursor + 10);
      const compressedSize = u32(view, cursor + 20);
      const nameLength = u16(view, cursor + 28);
      const extraLength = u16(view, cursor + 30);
      const commentLength = u16(view, cursor + 32);
      const localOffset = u32(view, cursor + 42);
      const name = decoder.decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
      const localNameLength = u16(view, localOffset + 26);
      const localExtraLength = u16(view, localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(start, start + compressedSize);
      const content = method === 0 ? compressed : method === 8 ? await inflate(compressed) : null;
      if (content) files.set(name, decoder.decode(content));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return files;
  }

  function cellColumn(reference) {
    const letters = String(reference).match(/[A-Z]+/)?.[0] || "A";
    let result = 0;
    for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
    return result - 1;
  }

  function parseSheet(xml, shared) {
    const documentXml = new DOMParser().parseFromString(xml, "application/xml");
    return [...documentXml.querySelectorAll("sheetData > row")].map(row => {
      const values = [];
      for (const cell of row.querySelectorAll(":scope > c")) {
        const index = cellColumn(cell.getAttribute("r"));
        const type = cell.getAttribute("t");
        let value = cell.querySelector(":scope > v")?.textContent ?? cell.querySelector("is > t")?.textContent ?? "";
        if (type === "s") value = shared[Number(value)] || "";
        else if (type !== "str" && type !== "inlineStr" && value !== "" && Number.isFinite(Number(value))) value = Number(value);
        values[index] = value;
      }
      return values;
    });
  }

  async function readFirstSheet(file) {
    const files = await unzip(await file.arrayBuffer());
    const sharedXml = files.get("xl/sharedStrings.xml");
    const shared = sharedXml ? [...new DOMParser().parseFromString(sharedXml, "application/xml").querySelectorAll("si")]
      .map(node => [...node.querySelectorAll("t")].map(text => text.textContent || "").join("")) : [];
    const sheetName = [...files.keys()].find(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
    if (!sheetName) throw new Error("Không tìm thấy worksheet trong XLSX.");
    return parseSheet(files.get(sheetName), shared);
  }

  async function parseStockWorkbook(file) {
    const rows = await readFirstSheet(file);
    return rows.slice(2).filter(row => row[0]).map(row => ({
      stockCode: String(row[0] || "").trim(),
      stockName: String(row[1] || "").trim(),
      stockUnit: String(row[2] || "").trim(),
      stockQty: Number(row[3]) || 0,
      conversion: Number(row[4]) || 1,
      availableQty: Math.max(0, Math.floor(Number(row[5]) || 0)),
      salePrice: Math.max(0, Math.round(Number(row[8]) || 0))
    }));
  }

  async function parseWebCatalogWorkbook(file) {
    const rows = await readFirstSheet(file);
    const items = rows.slice(1).filter(row => row[1]).map(row => ({
      webCode: String(row[1] || "").trim(),
      webName: String(row[2] || "").trim(),
      webUnit: String(row[3] || "").trim(),
      webPrice: Math.max(0, Math.round(Number(row[4]) || 0)),
      webType: String(row[5] || "").trim(),
      webGroup: String(row[6] || "").trim()
    }));
    if (!items.length) throw new Error("Không tìm thấy dữ liệu danh mục web.");
    return items;
  }

  function normalizedHeader(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();
  }

  function dateKey(value, withTime) {
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000);
      return withTime ? date.toISOString().slice(0, 19).replace("T", " ") : date.toISOString().slice(0, 10);
    }
    const text = String(value || "").trim();
    const iso = text.match(/^(\d{4})[-/]?(\d{2})[-/]?(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
    if (iso) return withTime && iso[4] ? `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6] || "00"}` : `${iso[1]}-${iso[2]}-${iso[3]}`;
    // Ban tieng Viet ghi "30/05/2026 14:58:04": phai giu lai gio khi withTime,
    // neu khong requestedAt mat gio va cac dong cung ngay khong con phan biet duoc.
    const vietnamese = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (vietnamese) {
      const day = `${vietnamese[3]}-${String(vietnamese[2]).padStart(2, "0")}-${String(vietnamese[1]).padStart(2, "0")}`;
      if (!withTime || !vietnamese[4]) return day;
      return `${day} ${String(vietnamese[4]).padStart(2, "0")}:${vietnamese[5]}:${vietnamese[6] || "00"}`;
    }
    return "";
  }

  function money(value) {
    if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : 0;
    return Math.round(Number(String(value || "").replace(/[^0-9.-]/g, ""))) || 0;
  }

  // Sao ke co hai format: ban tieng Anh (Transaction Date/Credit) va ban tieng
  // Viet cua ngan hang (Ngay giao dich/So tien gui vao). Nhan dien header phai
  // chap nhan ca hai, neu khong ban tieng Viet se bao "khong tim thay tieu de".
  const CREDIT_PATTERNS = ["so tien gui vao", "so tien vao", "ghi co", "phat sinh co"];
  const DEBIT_PATTERNS = ["so tien rut ra", "so tien ra", "ghi no", "phat sinh no"];

  function findMoneyColumn(headers, englishWord, vietnamesePatterns) {
    const english = new RegExp(`(^| )${englishWord}($| )`);
    const index = headers.findIndex(header => english.test(header));
    if (index >= 0) return index;
    return headers.findIndex(header => vietnamesePatterns.some(pattern => header.includes(pattern)));
  }

  function parseBankRows(rows, options = {}) {
    const tenantSlug = String(options.tenantSlug || "").trim().toLowerCase();
    const hasCreditHeader = headers =>
      headers.some(value => /(^| )credit($| )/.test(value)) ||
      headers.some(value => CREDIT_PATTERNS.some(pattern => value.includes(pattern)));
    const headerIndex = rows.findIndex(row => {
      const headers = row.map(normalizedHeader);
      const hasDate = headers.some(value => value.includes("transaction date") || value.includes("ngay giao dich"));
      return hasDate && hasCreditHeader(headers);
    });
    if (headerIndex < 0) throw new Error("Không tìm thấy hàng tiêu đề sao kê.");
    const headers = rows[headerIndex].map(normalizedHeader);
    const find = patterns => headers.findIndex(header => patterns.some(pattern => header.includes(pattern)));
    const columns = {
      requested: find(["requesting date", "ngay kh thuc hien", "ngay hieu luc"]),
      transaction: find(["transaction date", "ngay giao dich"]),
      // "So GD" cua ban tieng Viet la so but toan duy nhat, dung lam id on dinh.
      reference: find(["reference number", "so but toan", "so gd", "so chung tu"]),
      bank: find(["remitter s bank", "ngan hang doi tac"]),
      account: find(["account number", "tai khoan dich"]),
      accountName: find(["account name", "ten tai khoan doi ung"]),
      description: find(["description", "dien giai", "noi dung giao dich", "noi dung"]),
      debit: findMoneyColumn(headers, "debit", DEBIT_PATTERNS),
      credit: findMoneyColumn(headers, "credit", CREDIT_PATTERNS),
      balance: find(["running balance", "so du"]),
      invoiceCheck: find(["check hd", "check da xuat hd", "hoa don da xuat"])
    };
    if (columns.transaction < 0 || columns.credit < 0) throw new Error("Thiếu cột ngày giao dịch hoặc Credit.");
    // Ban tieng Viet co "Ngay hieu luc" (ky sao ke) lech "Ngay giao dich" (luc
    // tien thuc chuyen): giao dich 30/05 nam trong sao ke thang 06. Lay ngay
    // hieu luc lam ngay lap phieu de moi dong deu nam gon trong ky cua file.
    // Kim Giang exports both "Requesting date" (the customer's execution
    // timestamp) and "Transaction date" (the accounting date shown on the
    // website invoice list). Linh Dam's Vietnamese export instead uses
    // "Ngay hieu luc" as the accounting/document date. Keep these tenant
    // semantics separate so importing one branch cannot shift another.
    // Nhon dung sao ke Techcombank co header tieng Anh giong Kim Giang: ngay
    // nghiep vu lay tu "Transaction date", gio that tu "Requesting date".
    // Linh Dam thi nguoc lai. Danh sach nay la theo NGU NGHIA COT, khong phai
    // theo co so, nen them co so moi chi can xep vao dung nhom.
    const isKimGiang = tenantSlug === "pariskimgiang" || tenantSlug === "parisnhon";
    const effectiveDateColumn = isKimGiang
      ? columns.transaction
      : (columns.requested >= 0 ? columns.requested : columns.transaction);
    return rows.slice(headerIndex + 1).map((row, index) => {
      const credit = money(row[columns.credit]);
      const description = String(row[columns.description] || "").trim();
      const transactionDate = dateKey(row[effectiveDateColumn], false) || dateKey(row[columns.transaction], false);
      // In Vietnamese statements, "Ngay giao dich" contains the real event
      // timestamp while "Ngay hieu luc" is the accounting/document date.
      const requestedAt = isKimGiang
        ? (dateKey(row[columns.requested], true) || dateKey(row[columns.transaction], true))
        : (dateKey(row[columns.transaction], true) || dateKey(row[columns.requested], true));
      const reference = String(row[columns.reference] || "").trim();
      const id = reference || `${requestedAt}|${transactionDate}|${credit}|${description}`;
      const transferLike = /chuyen tien|chuyen tie n|chuyen khoan|transfer|qr|mbvcb|ibft|liobank/i.test(normalizedHeader(description));
      // Cot "Check da xuat HD" duoc dien bang cong thuc VLOOKUP nen o chua khop
      // tra ve #N/A. Loai cac ma loi Excel de chi giu ghi chu that.
      const invoiceCheckRaw = String(row[columns.invoiceCheck] ?? "").trim();
      const invoiceCheck = /^#(N\/A|REF!|VALUE!|NAME\?|DIV\/0!|NULL!|NUM!)$/i.test(invoiceCheckRaw) ? "" : invoiceCheckRaw;
      const alreadyIssued = Boolean(invoiceCheck);
      return {
        id, rowNumber: headerIndex + index + 2, requestedAt, transactionDate, reference,
        bank: String(row[columns.bank] || "").trim(),
        account: String(row[columns.account] || "").trim(),
        accountName: String(row[columns.accountName] || "").trim(),
        description, debit: money(row[columns.debit]), credit,
        balance: money(row[columns.balance]), invoiceCheck,
        status: credit > 0 && transactionDate
          ? (alreadyIssued ? "ignored" : transferLike ? "pending" : "review")
          : "ignored"
      };
    }).filter(item => item.credit > 0 && item.transactionDate);
  }

  async function parseBankStatementWorkbook(file, options = {}) {
    return parseBankRows(await readFirstSheet(file), options);
  }

  root.InvoiceXlsxReader = { parseStockWorkbook, parseWebCatalogWorkbook, parseBankStatementWorkbook, parseBankRows, dateKey };
})(typeof globalThis !== "undefined" ? globalThis : this);
