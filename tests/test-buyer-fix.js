// Sửa người mua + phương thức thanh toán của phiếu đã lưu, chưa xuất hóa đơn,
// chạy trong extension để tự tải lại trang và chạy tiếp (1.29.5), chỉ bằng API
// (GET AddEdit -> DoSave -> đọc lại). Thay script console
// scripts/sua-nguoi-mua-tmck.js: chạy thật 02/10/2026 cứ khoảng 50 phiếu lại dừng
// vì rớt kết nối, mà script trong Console mất khi tải lại trang.
process.env.TZ = "Asia/Ho_Chi_Minh";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function extractor(source) {
  const fn = name => {
    let start = source.indexOf(`async function ${name}(`);
    if (start < 0) start = source.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`Không tìm thấy ${name}`);
    const paramsEnd = (() => {
      let depth = 0;
      for (let i = source.indexOf("(", start); i < source.length; i += 1) {
        if (source[i] === "(") depth += 1;
        if (source[i] === ")" && --depth === 0) return i;
      }
      return -1;
    })();
    let depth = 0;
    for (let i = source.indexOf("{", paramsEnd); i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      if (source[i] === "}" && --depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Không đọc hết ${name}`);
  };
  // Hàm top-level (thụt 2 dấu cách) kết thúc ở dòng "  }" đầu tiên. Dùng cho hàm
  // có chuỗi chứa dấu ngoặc nhọn, nơi cách đếm ngoặc bị lệch.
  const top = name => {
    const text = source.replace(/\r\n/g, "\n");
    let start = text.indexOf(`\n  async function ${name}(`);
    if (start < 0) start = text.indexOf(`\n  function ${name}(`);
    if (start < 0) throw new Error(`Không tìm thấy ${name}`);
    const end = text.indexOf("\n  }\n", start);
    return text.slice(start + 1, end + 4);
  };
  const constant = name => {
    const match = source.match(new RegExp(`const ${name} = [^;]+;`));
    if (!match) throw new Error(`Không tìm thấy hằng số ${name}`);
    return match[0];
  };
  return { fn, top, constant };
}

const bridge = extractor(fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8"));
const content = extractor(fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"));
const OLD_BUYER = "Khách lẻ - Không lấy hóa đơn";
const NEW_BUYER = "Bán cho người tiêu dùng";

// --- Bridge: sửa từng phiếu chỉ bằng API, trên website giả lập ---------------------
// Chẩn đoán trên trang thật (Linh Đàm 02/10/2026): mở phiếu chỉ gọi GET AddEdit
// (MaxTab=6) — dòng hàng nằm sẵn trong HTML đó, cạnh định nghĩa cột lưới.
const guid = (prefix, n) => `${String(n).padStart(8, "0")}-${prefix}-bbbb-cccc-${String(n).padStart(12, "0")}`;
const vnMidnight = (y, m, d) => `/Date(${Date.UTC(y, m - 1, d, -7)})/`;

function makeBridgeBox() {
  const server = new Map();
  const box = {
    server,
    retailRooms: new Set(["r-banle"]),
    saves: [],
    reads: [],
    rejectSave: false,
    corruptAfterSave: false,
    changeRowAfterSave: false,
    console,
    setTimeout,
    URLSearchParams,
    location: { origin: "http://banhang.test" },
    window: {}
  };
  // HTML như website trả: formData (DataTransferJs), định nghĩa cột lưới (có
  // "field": "DMATHANGID" — không được nhầm là dòng hàng), danh mục hàng (có
  // DMATHANGID nhưng không phải dòng) và dữ liệu dòng hàng với ngày "\/Date(ms)\/".
  const html = (id, record) => [
    "<div class=\"k-content\"><script>",
    `var client = new AddEdit_JsClient(); var formData = new DataTransferJs(${JSON.stringify({
      _AddEditTableID: box.SALES_TABLE_ID, _RecordID: id, ModeQuanLy: 30, Loai: 0,
      mapper: { ID: id, Maps: Object.entries(record.fields).map(([Field, Value]) => ({ Field, Value })) }
    })});`,
    `var hangHoa = ${JSON.stringify([{ DMATHANGID: guid("ffff", 99), TENHANG: "Bia Tiger", DONGIA: 45000 }])};`,
    `jQuery("#grdetail").kendoGrid(${JSON.stringify({
      columns: [{ field: "DMATHANGID", title: "Mã hàng" }, { field: "SLXUATCHUAQUYDOI", title: "Số lượng" }, { field: "THANHTIEN" }],
      dataSource: { data: record.rows }
    }).replace(/\/Date\((\d+)\)\//g, "\\/Date($1)\\/")});`,
    "</script></div>"
  ].join("\n");
  const serverDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `/Date(${Date.parse(`${value.replace(" ", "T")}+07:00`)})/` : value;
  box.window.fetch = async (url, options = {}) => {
    if (String(url).includes("/AddEdit?")) {
      const query = new URLSearchParams(String(url).split("?")[1]);
      box.reads.push(`${query.get("MaxTab")}/${query.get("ModeQuanLy")}`);
      return { ok: true, status: 200, text: async () => html(query.get("RecordID"), server.get(query.get("RecordID"))) };
    }
    assert.match(String(url), /\/parislinhdam\/AddEdit\/DoSave\?is_ajax=1$/);
    const payload = JSON.parse(options.body);
    box.saves.push(payload);
    if (box.rejectSave) return { ok: true, status: 200, text: async () => JSON.stringify({ code: 0, message: "Lỗi lưu" }) };
    const record = server.get(payload.ID);
    const maps = Object.fromEntries(payload.clientMap.Maps.map(map => [map.Field, map.Value]));
    for (const field of ["NGUOIMUAHANG", "PHUONGTHUCTT", "DIACHIKHACH"]) record.fields[field] = maps[field];
    // Website lưu đúng các dòng được gửi (dòng không gửi là bị xóa).
    record.rows = payload.clientMap.Grids[0].Data.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, serverDate(value)])));
    if (box.corruptAfterSave) record.fields.TONGCONG = "1.00";
    if (box.changeRowAfterSave && record.rows[0]) record.rows[0].SLXUATCHUAQUYDOI = 3;
    record.fields.LASTSAVEID = `saved-${box.saves.length}`;
    return { ok: true, status: 200, text: async () => JSON.stringify({ code: 1, Tag: { ID: payload.ID, LASTSAVEID: record.fields.LASTSAVEID } }) };
  };
  box.isLoginRedirect = () => false;
  box.getRoomMap = async () => ({});
  box.assertNotRetailRoom = ({ roomId }) => {
    if (box.retailRooms.has(roomId)) throw new Error("quầy BÁN LẺ");
  };
  box.shopBasePath = () => "parislinhdam";
  vm.createContext(box);
  vm.runInContext([
    bridge.constant("SALES_TABLE_ID"), bridge.constant("INVOICE_PAYMENT_METHOD"), bridge.constant("DEFAULT_INVOICE_BUYER"),
    bridge.constant("DEFAULT_INVOICE_ADDRESS"), bridge.constant("FORM_DATA_MARKER"), bridge.constant("BUYER_FIX_PAYMENTS"),
    bridge.constant("BUYER_FIX_OUR_PAYMENTS"), bridge.constant("BUYER_FIX_OLD_BUYER"), bridge.constant("BUYER_FIX_ROW_KEY"),
    "const fetchEInvoiceList = (...args) => this.fetchEInvoiceList(...args);",
    // Request đọc đi qua fetchForRead (thử lại khi rớt mạng); mock ném Error
    // thường nên không bị thử lại.
    "const READ_RETRY_DELAYS_MS = []; const wait = () => Promise.resolve();",
    ...["isNetworkFetchError", "fetchForRead", "normalizedVietnameseText", "mapObject", "formDataRecordId", "parseFormDateTime", "formAmount", "localMidnightIso",
      "localUsDateTime", "localServerDateTime", "normalizeDateKey", "verifySaveResponse", "isGuid",
      "salesFormDataFromHtml", "buyerFixDecision", "vietnamDateKey", "buyerFixPayload", "buyerFixCheckRows", "buyerFixVerify",
      "buyerFixRowDates", "buyerFixReadInvoice", "buyerFixRowsDiffer",
      "buyerFixScan", "buyerFixInvoice"].map(bridge.fn),
    ...["extractJsonObject", "buyerFixRowsFromHtml"].map(bridge.top),
    "this.SALES_TABLE_ID = SALES_TABLE_ID;",
    "this.buyerFixInvoice = buyerFixInvoice; this.buyerFixScan = buyerFixScan; this.buyerFixDecision = buyerFixDecision;"
  ].join("\n"), box);
  return box;
}

function addInvoice(box, n, overrides = {}, rows) {
  const fields = {
    NAME: `HD01260800${String(n).padStart(2, "0")}`, SOHD: "", NGUOIMUAHANG: OLD_BUYER, PHUONGTHUCTT: "CK",
    DIACHIKHACH: "Khách không cung cấp thông tin", DBANID: "r-vip", NGAY: "2026-08-04T17:00:00.000Z",
    BATDAU: "2026-08-05 20:00:00", BATDAUPHONGCUOI: "2026-08-05T13:00:00.000Z", KETTHUC: "2026-08-05T14:00:00.000Z",
    GIOTHANHTOAN: "8/5/2026 9:00:00 PM", TIENGIO: "600000.00", TIENGIOPHONGCUOI: "600000.00", TIENHANG: "90000.00",
    TIENTHUE: "69000.00", TONGCONG: "759000.00", TIENMAT: "759000.00", KHACHDUA: "759000.00", TIENTHANHTOAN: "759000.00",
    TRALAI: "0.00", DONGIA: "600000.00", LASTSAVEID: `ls-${n}`, ...overrides
  };
  box.server.set(guid("aaaa", n), {
    fields,
    // Dòng có object con đứng trước DMATHANGID: vẫn phải lấy đúng cả dòng.
    rows: rows ?? [
      { HANG: { TEN: "Bia Tiger" }, ID: guid("dddd", n), DMATHANGID: guid("eeee", n), DMATHANG_CODE: "1100027", SLXUAT: 2,
        SLXUATCHUAQUYDOI: 2, DONGIA: 30000, THANHTIEN: 60000, NGAYTHUCHIEN: vnMidnight(2026, 8, 5), THUTU: 1 },
      { ID: guid("dddd", n + 500), DMATHANGID: guid("eeee", n + 500), DMATHANG_CODE: "1500001", SLXUAT: 1,
        SLXUATCHUAQUYDOI: 1, DONGIA: 30000, THANHTIEN: 30000, NGAYTHUCHIEN: vnMidnight(2026, 8, 5), THUTU: 2 }
    ]
  });
  return { recordId: guid("aaaa", n), invoiceNo: fields.NAME, dateKey: "2026-08-05" };
}

(async () => {
  {
    const box = makeBridgeBox();
    const ck = addInvoice(box, 1);
    const result = await box.buyerFixInvoice(ck);
    assert.strictEqual(result.status, "fixed");
    const saved = box.server.get(ck.recordId).fields;
    assert.strictEqual(saved.PHUONGTHUCTT, "TM/CK");
    assert.strictEqual(saved.NGUOIMUAHANG, NEW_BUYER);
    assert.strictEqual(box.saves.length, 1);
    assert.deepStrictEqual(box.reads, ["6/30", "6/30"], "Đọc phiếu đúng như website mở phiếu, trước và sau khi lưu");
    const sent = Object.fromEntries(box.saves[0].clientMap.Maps.map(map => [map.Field, map.Value]));
    // Chỉ đổi người mua/phương thức; mốc giờ giữ nguyên thời điểm; tiền giữ nguyên.
    for (const field of ["TONGCONG", "TIENHANG", "TIENGIO", "TIENTHUE", "DBANID", "DONGIA", "TIENMAT", "KHACHDUA", "SOHD", "NAME"]) {
      assert.strictEqual(sent[field], saved[field], `${field} không được đổi`);
    }
    assert.strictEqual(sent.TONGCONG, "759000.00");
    assert.strictEqual(box.saves[0].clientMap.Maps.length, Object.keys(saved).length, "Không thêm/bớt trường");
    assert.strictEqual(sent.LASTSAVEID, "ls-1", "Gửi đúng LASTSAVEID đang có để website chặn bản cũ");
    assert.strictEqual(sent.NGAY, "2026-08-04T17:00:00.000Z");
    assert.strictEqual(sent.BATDAUPHONGCUOI, "2026-08-05T13:00:00.000Z");
    assert.strictEqual(sent.BATDAU, "2026-08-05T13:00:00.000Z");
    assert.strictEqual(sent.KETTHUC, "2026-08-05T14:00:00.000Z");
    assert.strictEqual(sent.GIOTHANHTOAN, "8/5/2026 9:00:00 PM");
    assert.strictEqual(sent.TIENGIOPHONGCUOI, 600000);
    const sentRows = box.saves[0].clientMap.Grids[0].Data;
    assert.deepStrictEqual(Array.from(sentRows, row => row.ID), [guid("dddd", 1), guid("dddd", 501)],
      "Gửi đúng các dòng hàng đang có (giữ ID dòng); định nghĩa cột và danh mục hàng không lọt vào");
    assert.deepStrictEqual({ ...sentRows[0].HANG }, { TEN: "Bia Tiger" });
    assert.strictEqual(sentRows[0].DMATHANG_CODE, "1100027");
    assert.strictEqual(sentRows[0].NGAYTHUCHIEN, "2026-08-05 00:00:00", "Ngày \\/Date()\\/ đổi về dạng website gửi khi lưu");

    // Chạy lại (vd sau khi tải lại trang): phiếu đã đúng, không lưu lần hai.
    assert.deepStrictEqual({ ...await box.buyerFixInvoice(ck) }, { status: "skipped", reason: "đã đúng" });
    assert.strictEqual(box.saves.length, 1);
    // ID phiếu không khớp số phiếu: lỗi, không lưu.
    await assert.rejects(box.buyerFixInvoice({ ...ck, invoiceNo: "HD0126089999" }), /không phải HD0126089999/);
  }

  {
    const box = makeBridgeBox();
    // Phiếu nhân viên / extension trước 07/08: TM, người mua trống, địa chỉ trống.
    const tm = addInvoice(box, 2, { PHUONGTHUCTT: "TM", NGUOIMUAHANG: "", DIACHIKHACH: "" });
    assert.strictEqual((await box.buyerFixInvoice(tm)).status, "fixed");
    assert.deepStrictEqual(
      ["PHUONGTHUCTT", "NGUOIMUAHANG", "DIACHIKHACH"].map(field => box.server.get(tm.recordId).fields[field]),
      ["TM/CK", NEW_BUYER, "Khách không cung cấp thông tin"]);

    // Phiếu "chỉ hát": không dòng hàng, tiền hàng 0.
    const hourOnly = addInvoice(box, 3, { TIENHANG: "0.00" }, []);
    assert.strictEqual((await box.buyerFixInvoice(hourOnly)).status, "fixed");
    assert.deepStrictEqual(box.saves.at(-1).clientMap.Grids[0].Data, []);

    const companies = addInvoice(box, 4, { NGUOIMUAHANG: "CÔNG TY TNHH TUỆ LÂM SƠN", PHUONGTHUCTT: "TM" });
    assert.match((await box.buyerFixInvoice(companies)).reason, /người mua khác/);
    const staffOther = addInvoice(box, 5, { PHUONGTHUCTT: "" });
    assert.strictEqual((await box.buyerFixInvoice(staffOther)).reason, "thanh toán (trống)");
    const retail = addInvoice(box, 7, { DBANID: "r-banle" });
    assert.strictEqual((await box.buyerFixInvoice(retail)).reason, "quầy BÁN LẺ");
    const withNumber = addInvoice(box, 8, { SOHD: "977" });
    assert.strictEqual((await box.buyerFixInvoice(withNumber)).reason, "đã xuất hóa đơn");
    assert.strictEqual(box.saves.length, 2, "Các phiếu bỏ qua không được lưu");

    // Dòng hàng không đọc được / không khớp tiền hàng (giảm giá, khuyến mãi...):
    // bỏ qua phiếu, không gửi gì — thiếu dòng là website xóa mất hàng.
    const mismatch = addInvoice(box, 9, { TIENHANG: "135000.00" });
    assert.match((await box.buyerFixInvoice(mismatch)).reason, /^dòng hàng không khớp: .*tổng dòng hàng 90000 khác tiền hàng 135000/);
    const noRows = addInvoice(box, 12, {}, []);
    assert.match((await box.buyerFixInvoice(noRows)).reason, /^dòng hàng không khớp: .*không có dòng hàng/);
    const badRow = addInvoice(box, 13, {}, [{ ID: guid("dddd", 13), DMATHANGID: guid("eeee", 13), SLXUAT: 2, SLXUATCHUAQUYDOI: 2,
      DONGIA: 0, THANHTIEN: 90000 }]);
    assert.match((await box.buyerFixInvoice(badRow)).reason, /^dòng hàng không khớp: .*sai số lượng\/giá\/thành tiền/);
    // Dòng không có ID dạng GUID thì không gửi lại được đúng dòng đó: coi như thiếu dòng.
    const noRowId = addInvoice(box, 15, {}, [{ ID: "", DMATHANGID: guid("eeee", 15), SLXUAT: 2, SLXUATCHUAQUYDOI: 2,
      DONGIA: 45000, THANHTIEN: 90000 }]);
    assert.match((await box.buyerFixInvoice(noRowId)).reason, /^dòng hàng không khớp: .*không có dòng hàng/);
    assert.strictEqual(box.saves.length, 2, "Phiếu dòng hàng lệch/sai không được lưu");

    const rejected = addInvoice(box, 10);
    box.rejectSave = true;
    await assert.rejects(box.buyerFixInvoice(rejected), /tu choi luu/i);
    box.rejectSave = false;
    const corrupted = addInvoice(box, 11);
    box.corruptAfterSave = true;
    await assert.rejects(box.buyerFixInvoice(corrupted), /đã lưu nhưng đọc lại thấy sai: TONGCONG/);
    box.corruptAfterSave = false;
    // Đọc lại thấy dòng hàng khác sau khi lưu: lỗi để dừng cả lượt, xem tay.
    const rowChanged = addInvoice(box, 14);
    box.changeRowAfterSave = true;
    await assert.rejects(box.buyerFixInvoice(rowChanged), /đã lưu nhưng đọc lại thấy sai: dòng hàng sau khi lưu khác trước khi lưu/);
    box.changeRowAfterSave = false;
  }

  {
    // Đọc phiếu lỗi: hết phiên thì dừng; lỗi máy chủ / HTML không có form thì
    // content tải lại trang rồi thử lại (thông báo khớp isBuyerFixReloadable).
    const box = makeBridgeBox();
    const invoice = addInvoice(box, 30);
    const nativeFetch = box.window.fetch;
    box.window.fetch = async () => ({ ok: false, status: 502, text: async () => "Bad gateway" });
    await assert.rejects(box.buyerFixInvoice(invoice), /Website từ chối đọc phiếu HD0126080030 \(HTTP 502\)/);
    box.window.fetch = async () => ({ ok: true, status: 200, text: async () => "<html>Lỗi</html>" });
    await assert.rejects(box.buyerFixInvoice(invoice), /Không đọc được dữ liệu phiếu HD0126080030/);
    box.window.fetch = nativeFetch;
    box.isLoginRedirect = () => true;
    await assert.rejects(box.buyerFixInvoice(invoice), /đăng nhập/);
    assert.strictEqual(box.saves.length, 0);
  }

  {
    // Phiếu extension đã tạo/cập nhật: sửa cả phiếu đã TM/CK mà người mua còn cũ
    // (luồng sao kê trước 1.29.4); ngoài phạm vi đó thì TM/CK được giữ nguyên.
    const box = makeBridgeBox();
    const bankFlow = addInvoice(box, 20, { PHUONGTHUCTT: "TM/CK" });
    assert.strictEqual((await box.buyerFixInvoice(bankFlow)).reason, "thanh toán TM/CK");
    assert.strictEqual((await box.buyerFixInvoice({ ...bankFlow, ourInvoice: true })).status, "fixed");
    const sent = Object.fromEntries(box.saves[0].clientMap.Maps.map(map => [map.Field, map.Value]));
    assert.strictEqual(sent.NGUOIMUAHANG, NEW_BUYER);
    assert.strictEqual(sent.PHUONGTHUCTT, "TM/CK");
    assert.deepStrictEqual({ ...await box.buyerFixInvoice({ ...bankFlow, ourInvoice: true }) }, { status: "skipped", reason: "đã đúng" });
  }

  {
    // Quét sơ bộ theo danh sách website.
    const box = makeBridgeBox();
    const row = (invoiceNo, paymentMethod, buyer, extra = {}) =>
      ({ id: `id-${invoiceNo}`, invoiceNo, dateKey: "2026-08-05", grandTotal: 1, paymentMethod, buyer, issued: false, cancelled: false, ...extra });
    box.fetchEInvoiceList = async () => ({ rows: [
      row("HD3", "TM", ""), row("HD1", "CK", OLD_BUYER), row("HD2", "TM/CK", NEW_BUYER), row("HD4", "TM", "CÔNG TY A"),
      row("HD5", "CK", OLD_BUYER, { issued: true }), row("HD6", "TM", "", { cancelled: true }), row("HD7", "", "")
    ] });
    const scanned = await box.buyerFixScan({ fromDate: "2026-08-01", toDate: "2026-08-31" });
    assert.deepStrictEqual(Array.from(scanned.targets, item => `${item.invoiceNo}:${item.paymentMethod}`), ["HD1:CK", "HD3:TM"]);
    assert.deepStrictEqual({ ...scanned.skipped }, {
      "đã đúng": 1, "người mua khác (giữ nguyên)": 1, "đã xuất hóa đơn": 1, "đã hủy": 1, "thanh toán (trống)": 1
    });
    assert.strictEqual(scanned.fromDate, "2026-08-01");
    // Chỉ phiếu extension: phiếu ngoài danh sách bị bỏ qua dù ghi TM/CK.
    box.fetchEInvoiceList = async () => ({ rows: [
      row("HD1", "CK", OLD_BUYER), row("HD3", "TM", ""), row("HD10", "TM/CK", OLD_BUYER), row("HD11", "TM", ""), row("HD12", "TM/CK", NEW_BUYER)
    ] });
    const ours = await box.buyerFixScan({ fromDate: "2026-08-01", toDate: "2026-08-31", invoiceNos: ["HD1", "HD10", "HD12"] });
    assert.deepStrictEqual(Array.from(ours.targets, item => item.invoiceNo), ["HD1", "HD10"]);
    assert.deepStrictEqual({ ...ours.skipped }, { "ngoài giao dịch của extension": 2, "đã đúng": 1 });
    // Danh sách không mang phương thức: đưa mọi phiếu chưa xuất vào, xét theo form.
    box.fetchEInvoiceList = async () => ({ rows: [row("HD8", "", ""), row("HD9", "", "", { issued: true })] });
    const noPayment = await box.buyerFixScan({ fromDate: "2026-08-01", toDate: "2026-08-31" });
    assert.deepStrictEqual(Array.from(noPayment.targets, item => item.invoiceNo), ["HD8"]);
    assert.strictEqual(noPayment.listHasPayment, false);
  }

  // --- Content: tự tải lại trang và chạy tiếp ------------------------------------------
  function makeContentBox(outcomes) {
    const storage = {};
    const box = {
      storage,
      statuses: [],
      reloads: [],
      requests: [],
      pageTenantSlug: "parislinhdam",
      uiSession: { autoResumeAttempts: 0 },
      console,
      setTimeout,
      document: { getElementById: () => null },
      chrome: { storage: { local: {
        get: async key => ({ [key]: storage[key] ? JSON.parse(JSON.stringify(storage[key])) : undefined }),
        set: async values => { for (const [key, value] of Object.entries(values)) storage[key] = JSON.parse(JSON.stringify(value)); },
        remove: async key => { delete storage[key]; }
      } } },
      setStatus: (message, tone) => box.statuses.push(`${tone}: ${message}`),
      ensureInvoiceListScreen: async () => true,
      saveBatchUiSession: async overrides => { Object.assign(box.uiSession, overrides); },
      scheduleAutoReloadResume: async (mode, reason, options = {}) => {
        if (!options.planned) box.uiSession.autoResumeAttempts += 1;
        if (!options.planned && box.uiSession.autoResumeAttempts > 3) return false;
        box.reloads.push({ mode, reason, planned: Boolean(options.planned) });
        return true;
      },
      request: async (action, payload) => {
        // Như request() thật: payload trải SAU mã yêu cầu. Payload có `id` là đè mã
        // đó, bridge trả lời sai mã và content chờ tới hết 90s (chạy thật 02/10/2026).
        const detail = { id: "it-request", action, ...payload };
        assert.strictEqual(detail.id, "it-request", "Payload không được có khóa id");
        assert.match(String(payload.recordId), /^id-\d+$/, "ID phiếu đi trong recordId");
        box.requests.push(payload.invoiceNo);
        const outcome = outcomes(payload.invoiceNo, box.requests.length);
        if (outcome instanceof Error) throw outcome;
        return outcome;
      }
    };
    vm.createContext(box);
    vm.runInContext([
      content.constant("AUTO_RELOAD_EVERY_SAVED_INVOICES"),
      content.constant("BUYER_FIX_JOB_KEY"),
      content.constant("BUYER_FIX_SCOPE"),
      "let buyerFixRunning = false; let buyerFixStopRequested = false;",
      ...["isPageOverloadError", "loadBuyerFixJob", "saveBuyerFixJob", "isBuyerFixReloadable", "buyerFixSummary", "buyerFixSkipKey",
        "renderBuyerFixProgress", "runBuyerFixJob"].map(content.fn),
      "this.run = runBuyerFixJob; this.load = loadBuyerFixJob; this.save = saveBuyerFixJob;",
      "this.reloadable = isBuyerFixReloadable; this.stop = () => { buyerFixStopRequested = true; };"
    ].join("\n"), box);
    return box;
  }
  const job = count => ({
    scope: "extension-invoices", notes: [],
    fromDate: "2026-08-01", toDate: "2026-08-31", total: count, fixed: 0, skipped: {}, paused: false, lastError: "",
    pending: Array.from({ length: count }, (_, i) => ({ id: `id-${i + 1}`, invoiceNo: `HD${i + 1}`, dateKey: "2026-08-05" }))
  });

  {
    const box = makeContentBox(() => ({ status: "fixed" }));
    for (const [message, expected] of [
      ["Failed to fetch", true], ["Trang không phản hồi sau 150s (buyerFixInvoice).", true],
      ["Danh sách phiếu chưa tải xong. Hãy thử lại.", true], ["Không đọc được dòng hàng của phiếu HD1 (form đang hiện: không có; tiền hàng 1).", true],
      ["Website từ chối đọc phiếu HD1 (HTTP 502).", true], ["Không mở được form phiếu HD1 (form đang hiện: không có; tiền hàng 1).", true],
      ["HD1: đã lưu nhưng đọc lại thấy sai: TONGCONG 1 (trước 2).", false], ["Website tu choi luu phieu (code 0): Lỗi", false],
      ["Phiên đăng nhập đã hết hoặc bị cơ sở khác chiếm khi đọc phiếu; hãy đăng nhập lại.", false],
      ["HD1: tổng dòng hàng 1 khác tiền hàng 2.", false]
    ]) assert.strictEqual(box.reloadable(new Error(message)), expected, message);

    // 20 phiếu: chủ động tải lại sau 15 phiếu đã sửa, 5 phiếu còn lại nằm trong storage.
    await box.save(job(20));
    await box.run();
    assert.deepStrictEqual(box.reloads.map(item => item.planned), [true]);
    let stored = await box.load();
    assert.strictEqual(stored.fixed, 15);
    assert.strictEqual(stored.pending.length, 5);
    assert.strictEqual(stored.pending[0].invoiceNo, "HD16");
    // Sau khi tải lại: chạy tiếp đúng chỗ rồi xóa lượt.
    await box.run();
    assert.strictEqual(await box.load(), null, "Xong thì xóa lượt khỏi storage");
    assert.deepStrictEqual(box.requests, Array.from({ length: 20 }, (_, i) => `HD${i + 1}`), "Không phiếu nào bị làm hai lần");
    assert.match(box.statuses.at(-1), /^ok: Xong sửa người mua\/TM-CK .*20\/20 phiếu đã sửa/);
  }

  {
    // Rớt mạng ở HD2: tải lại trang, HD2 vẫn chờ; sau tải lại HD2 ra "đã đúng"
    // (website đã lưu dù mất phản hồi) và được tính là bỏ qua, không lưu lần hai.
    let failed = false;
    const box = makeContentBox(no => {
      if (no === "HD2" && !failed) { failed = true; return new Error("Failed to fetch"); }
      if (no === "HD2") return { status: "skipped", reason: "đã đúng" };
      return { status: "fixed" };
    });
    await box.save(job(3));
    await box.run();
    assert.deepStrictEqual(box.reloads.map(item => item.planned), [false]);
    let stored = await box.load();
    assert.deepStrictEqual(Array.from(stored.pending, item => item.invoiceNo), ["HD2", "HD3"]);
    assert.match(stored.lastError, /HD2: Failed to fetch/);
    await box.run();
    assert.strictEqual(await box.load(), null);
    assert.match(box.statuses.at(-1), /2\/3 phiếu đã sửa; bỏ qua đã đúng: 1/);
    assert.strictEqual(box.uiSession.autoResumeAttempts, 0, "Có tiến triển thì đếm lại số lần tải lại vì lỗi");
  }

  {
    // Lỗi dữ liệu: dừng, giữ lượt ở trạng thái tạm dừng, không tải lại.
    const box = makeContentBox(no => no === "HD2" ? new Error("HD2: đã lưu nhưng đọc lại thấy sai: TONGCONG 1 (trước 2).") : { status: "fixed" });
    await box.save(job(3));
    await box.run();
    assert.strictEqual(box.reloads.length, 0);
    const stored = await box.load();
    assert.strictEqual(stored.paused, true);
    assert.deepStrictEqual(Array.from(stored.pending, item => item.invoiceNo), ["HD2", "HD3"]);
    assert.match(box.statuses.at(-1), /^error: Dừng sửa người mua\/TM-CK tại HD2/);
    // Đang tạm dừng thì lần tải trang sau không tự chạy.
    await box.run();
    assert.deepStrictEqual(box.requests, ["HD1", "HD2"]);
  }

  {
    // Lỗi lặp lại mãi trên cùng một phiếu: sau 3 lần tải lại liên tiếp thì dừng.
    const box = makeContentBox(no => no === "HD1" ? new Error("Failed to fetch") : { status: "fixed" });
    await box.save(job(2));
    for (let i = 0; i < 4; i += 1) await box.run();
    assert.strictEqual(box.reloads.length, 3);
    assert.strictEqual((await box.load()).paused, true);
  }

  {
    // Bấm Dừng: làm xong phiếu đang chạy rồi dừng, lượt còn lại giữ để chạy tiếp.
    let box;
    box = makeContentBox(no => { if (no === "HD2") box.stop(); return { status: "fixed" }; });
    await box.save(job(4));
    await box.run();
    const stored = await box.load();
    assert.strictEqual(stored.paused, true);
    assert.strictEqual(stored.fixed, 2);
    assert.deepStrictEqual(Array.from(stored.pending, item => item.invoiceNo), ["HD3", "HD4"]);
  }

  {
    // Lượt cũ (lập trước khi giới hạn phạm vi, gồm cả phiếu nhân viên): bỏ, không chạy tiếp.
    const box = makeContentBox(() => ({ status: "fixed" }));
    const legacy = job(22);
    delete legacy.scope;
    await box.save(legacy);
    await box.run();
    assert.strictEqual(await box.load(), null);
    assert.deepStrictEqual(box.requests, []);
  }

  {
    // Phiếu bỏ qua vì dòng hàng: gom lý do và ghi lại số phiếu để xem tay.
    const box = makeContentBox(no => no === "HD2"
      ? { status: "skipped", reason: "dòng hàng không khớp: tổng dòng hàng 1 khác tiền hàng 2" }
      : { status: "fixed" });
    await box.save(job(3));
    await box.run();
    assert.match(box.statuses.at(-1), /^warn: Xong .*2\/3 phiếu đã sửa; bỏ qua dòng hàng không khớp: 1\. Cần xem tay: HD2: dòng hàng không khớp/);
  }

  console.log("sửa người mua/TM-CK trong extension: OK");
})().catch(error => { console.error(error); process.exit(1); });
