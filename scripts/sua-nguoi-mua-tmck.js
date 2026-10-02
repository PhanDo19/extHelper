// ƯU TIÊN dùng khối "Sửa người mua / TM-CK" ở màn Phát hành hóa đơn của extension
// (từ 1.29.5): cùng quy tắc, nhưng tự tải lại trang và chạy tiếp khi website đuối.
// Script này giữ để dùng tay khi cần.
//
// SỬA NGƯỜI MUA + PHƯƠNG THỨC THANH TOÁN cho phiếu extension đã tạo nhưng CHƯA
// xuất hóa đơn (kế toán chốt 02/10/2026, extension 1.29.4):
//   Phương thức thanh toán TM hoặc CK                     -> TM/CK
//   Người mua "Khách lẻ - Không lấy hóa đơn" (hoặc trống) -> "Bán cho người tiêu dùng"
// Chỉ đổi hai trường đó. Tổng tiền, tiền giờ, giờ vào/ra, phòng và dòng hàng giữ
// nguyên; đọc lại sau mỗi phiếu để xác nhận.
//
// Mọi phiếu chưa xuất ghi đúng "TM" hoặc "CK" đều đổi thành TM/CK (người dùng
// chốt 02/10/2026). TM cũng là mặc định của website nên gồm cả phiếu nhân viên tự
// lập; chạy thật Linh Đàm T7 ra TM 298, CK 235. Phiếu đã là TM/CK hoặc ghi khác
// thì bỏ qua. Cũng bỏ qua phiếu đã xuất hóa đơn, đã hủy, ở quầy BÁN LẺ, hoặc có
// người mua thật (tên công ty...).
//
// Hóa đơn điện tử lấy người mua/phương thức từ phiếu, nên phải sửa TRƯỚC khi
// xuất hóa đơn. Phiếu đã xuất thì không sửa được bằng cách này.
//
// Cách dùng (từng cơ sở, mỗi lần một khoảng ngày):
//   1. F5. Mở danh sách Bán hàng, lọc Từ ngày/Đến ngày ĐÚNG bằng TU_NGAY/DEN_NGAY
//      bên dưới, chọn "Chưa xuất hóa đơn", bấm Refresh. Không mở phiếu nào.
//   2. Sửa TU_NGAY / DEN_NGAY. Lần đầu để CHAY_THU_1_PHIEU = true.
//   3. F12 -> Console -> dán toàn bộ file -> Enter. Xem bảng (có số phiếu theo
//      từng phương thức thanh toán), bấm OK.
//   4. Chạy thử xong: mở phiếu vừa sửa trên website kiểm tra bằng mắt, rồi đổi
//      CHAY_THU_1_PHIEU = false và chạy lại để sửa hết. Script dừng ở lỗi đầu
//      tiên; chạy lại thì phiếu đã sửa (đã là TM/CK) tự được bỏ qua.
(async () => {
  const TU_NGAY = "2026-08-01";
  const DEN_NGAY = "2026-08-31";
  // Để trống = mọi phiếu TM/CK chưa xuất trong khoảng ngày; hoặc liệt kê số phiếu.
  const CHI_CAC_PHIEU = [];
  const CHAY_THU_1_PHIEU = false;

  // Phiếu mang đúng một trong hai phương thức này được đổi thành TM/CK.
  const OUR_PAYMENTS = ["TM", "CK"];
  const NEW_BUYER = "Bán cho người tiêu dùng";
  const NEW_PAYMENT = "TM/CK";
  const DEFAULT_ADDRESS = "Khách không cung cấp thông tin";
  // Người mua được phép thay: mặc định của website. Tên khác là người mua thật.
  const REPLACEABLE_BUYERS = ["Khách lẻ - Không lấy hóa đơn"];
  const SALES_TABLE_ID = "d56b4b85-68c8-44c1-947d-9f3899e55a7c";
  const SHOPS = ["pariskimgiang", "parislinhdam", "parisnhon"];
  const CONCURRENCY = 4;
  // Nghỉ giữa hai phiếu để không dồn request lên website (chạy thật hay bị rớt kết nối).
  const PAUSE_BETWEEN_INVOICES_MS = 400;

  const pad = n => String(n).padStart(2, "0");
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const upper = value => String(value ?? "").trim().toUpperCase();
  const money = value => Math.round(Number(String(value ?? "").replace(/,/g, "")) || 0);
  const mapObject = maps => Object.fromEntries((maps || []).map(m => [upper(m.Field), m.Value]));
  const textKey = value => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "D").toUpperCase().replace(/\s+/g, " ").trim();
  const isRetailText = value => /(^| )BAN LE( |$)/.test(textKey(value));
  const dateKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const usDate = key => { const [y, m, d] = key.split("-"); return `${m}/${d}/${y}`; };
  const serverDateTime = date => `${dateKey(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  // Cùng định dạng extension gửi trong DoSave (bridge.js: localMidnightIso, localUsDateTime).
  const localMidnightIso = key => { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, -7)).toISOString(); };
  const usDateTime = date => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()} ` +
    `${date.getHours() % 12 || 12}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${date.getHours() >= 12 ? "PM" : "AM"}`;

  function parseTime(value) {
    if (value == null || value === "") return null;
    const text = String(value).trim();
    let m = text.match(/\/Date\((-?\d+)/);
    if (m) return new Date(Number(m[1]));
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(text)) {
      const t = Date.parse(text);
      return Number.isFinite(t) ? new Date(t) : null;
    }
    m = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (m) {
      let hour = +m[4];
      if (m[7]) hour = (hour % 12) + (m[7].toUpperCase() === "PM" ? 12 : 0);
      return new Date(+m[3], +m[1] - 1, +m[2], hour, +m[5], +(m[6] || 0));
    }
    return null;
  }

  function extractJsonObject(source, startAt) {
    const start = source.indexOf("{", startAt);
    if (start < 0) return null;
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < source.length; i += 1) {
      const c = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') { inString = true; continue; }
      if (c === "{") depth += 1;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(source.slice(start, i + 1)); } catch (_) { return null; }
      }
    }
    return null;
  }

  // Phiếu nào cần sửa, đọc từ form server. Trả về lý do bỏ qua hoặc các thay đổi.
  function classify(f, { retail = false, cancelled = false, issuedNo = "" } = {}) {
    const no = String(f.NAME || "").trim();
    if (cancelled) return { no, skip: "đã hủy" };
    if (String(f.SOHD || issuedNo || "").trim()) return { no, skip: "đã xuất hóa đơn" };
    if (retail) return { no, skip: "quầy BÁN LẺ" };
    const buyer = String(f.NGUOIMUAHANG ?? "").trim();
    const payment = String(f.PHUONGTHUCTT ?? "").trim();
    // Chỉ phiếu ghi đúng TM hoặc CK là phiếu extension tạo. Phiếu đã sửa (nay là
    // TM/CK) và phiếu nhân viên tự lập đều dừng ở đây.
    if (!OUR_PAYMENTS.includes(upper(payment))) {
      const fixed = upper(payment) === NEW_PAYMENT && buyer === NEW_BUYER;
      return { no, skip: fixed ? "đã đúng" : `thanh toán ${payment || "(trống)"}` };
    }
    // Người mua trống cũng sửa: extension chỉ ghi người mua từ 07/08/2026 (trước
    // đó ghi TM, người mua để trống như phiếu nhân viên), và người dùng chốt
    // 02/10/2026 mọi phiếu TM cũng thành TM/CK. Người mua thật thì giữ nguyên.
    const buyerReplaceable = !buyer || buyer === NEW_BUYER ||
      REPLACEABLE_BUYERS.some(value => textKey(value) === textKey(buyer));
    if (!buyerReplaceable) return { no, skip: `người mua khác: ${buyer}` };
    const changes = { PHUONGTHUCTT: NEW_PAYMENT };
    if (buyer !== NEW_BUYER) changes.NGUOIMUAHANG = NEW_BUYER;
    if (!String(f.DIACHIKHACH ?? "").trim()) changes.DIACHIKHACH = DEFAULT_ADDRESS;
    return { no, changes, buyer, payment };
  }

  // Payload giống extension lưu phiếu có sẵn (bridge.js buildCurrentSavePayload)
  // và script chuyển phòng đã chạy trên website: Maps lấy từ form server, các mốc
  // giờ giữ nguyên thời điểm, chỉ chuẩn hóa định dạng như request của website.
  // Khác script chuyển phòng: KHÔNG đổi phòng/đơn giá, chỉ đổi người mua/phương thức.
  function buildPayload(formData, detailRows, changes) {
    const f = mapObject(formData.mapper.Maps);
    const recordId = String(formData._RecordID || formData.mapper?.ID || "");
    const checkIn = parseTime(f.BATDAUPHONGCUOI) || parseTime(f.BATDAU);
    const checkOut = parseTime(f.KETTHUC);
    const paidAt = parseTime(f.GIOTHANHTOAN) || checkOut;
    const docDate = parseTime(f.NGAY);
    if (!checkIn || !checkOut || !docDate) throw new Error(`${f.NAME}: không đọc được NGAY/giờ vào/giờ ra trên form.`);
    const overrides = {
      ...changes,
      // Website giữ song song tổng tiền giờ và tiền giờ phòng cuối; gửi lệch là
      // khi đọc lại có thể bị khôi phục TIENGIO cũ (bridge.js).
      TIENGIOPHONGCUOI: money(f.TIENGIO),
      NGAY: localMidnightIso(dateKey(docDate)),
      BATDAUPHONGCUOI: checkIn.toISOString(),
      BATDAU: checkIn.toISOString(),
      KETTHUC: checkOut.toISOString(),
      GIOTHANHTOAN: usDateTime(paidAt)
    };
    const maps = formData.mapper.Maps.map(m => {
      const field = upper(m.Field);
      return { Field: m.Field, Value: Object.prototype.hasOwnProperty.call(overrides, field) ? overrides[field] : m.Value };
    });
    const grand = money(f.TONGCONG);
    return {
      mode: 2,
      clientMap: {
        TableID: SALES_TABLE_ID,
        ID: recordId,
        Maps: maps,
        Grids: [{ Name: "detail", Data: detailRows }],
        CustomPostTable: [{
          Name: "LoaiQuy",
          Data: [
            { truong: "TRALAI", value: money(f.TRALAI) },
            { truong: "TIENTHANHTOAN", value: money(f.TIENTHANHTOAN) || grand },
            { truong: "KHACHDUA", value: money(f.KHACHDUA) || grand },
            { truong: "TIENMAT", value: money(f.TIENMAT) || grand }
          ]
        }],
        CustomPost: { MODEQUANLY: Number(formData.ModeQuanLy) || 30, GioClient: serverDateTime(new Date()) }
      },
      TableID: SALES_TABLE_ID,
      ID: recordId,
      Loai: Number(formData.Loai) || 0
    };
  }

  function checkDetailRows(rows, goods, no) {
    // Phiếu "chỉ hát" (extension lập cho số tiền quá nhỏ) không có dòng hàng.
    if (!rows.length && goods === 0) return;
    if (!rows.length) throw new Error(`${no}: form không có dòng hàng.`);
    let sum = 0;
    for (const row of rows) {
      const qty = Math.round(Number(row.SLXUATCHUAQUYDOI ?? row.SLXUAT) || 0);
      const price = Math.round(Number(row.DONGIA) || 0);
      if (!row.DMATHANGID || qty <= 0 || price <= 0 || Math.round(Number(row.THANHTIEN) || 0) !== qty * price) {
        throw new Error(`${no}: dòng hàng ${row.DMATHANG_CODE || row.TENHANG || "?"} sai số lượng/giá/thành tiền.`);
      }
      sum += qty * price;
    }
    if (sum !== goods) throw new Error(`${no}: tổng dòng hàng ${sum} khác tiền hàng ${goods}.`);
  }

  // Đọc lại form sau khi lưu: chỉ hai trường được đổi, mọi số tiền/giờ/phòng giữ nguyên.
  function verifyAfterSave(before, after, changes) {
    const problems = [];
    for (const [field, value] of Object.entries(changes)) {
      if (String(after[field] ?? "").trim() !== value) problems.push(`${field} là "${after[field] ?? ""}", chưa thành "${value}"`);
    }
    for (const field of ["TONGCONG", "TIENGIO", "TIENHANG", "TIENTHUE"]) {
      if (money(after[field]) !== money(before[field])) problems.push(`${field} ${money(after[field])} (trước ${money(before[field])})`);
    }
    if (String(after.DBANID || "").toLowerCase() !== String(before.DBANID || "").toLowerCase()) problems.push("phòng bị đổi");
    if (String(after.SOHD || "").trim()) problems.push("phiếu đã có số hóa đơn");
    const sameTime = (a, b) => Boolean(a && b && Math.abs(a - b) < 60000);
    if (!sameTime(parseTime(after.BATDAUPHONGCUOI) || parseTime(after.BATDAU), parseTime(before.BATDAUPHONGCUOI) || parseTime(before.BATDAU)) ||
        !sameTime(parseTime(after.KETTHUC), parseTime(before.KETTHUC))) {
      problems.push("giờ vào/ra bị đổi");
    }
    return problems;
  }

  // "Failed to fetch" = kết nối tới website bị rớt (server ngắt, mạng chập chờn,
  // bị chặn vì gọi dồn dập). Chạy thật 02/10/2026: cứ khoảng 50 phiếu lại gặp một
  // lần và script dừng hẳn. Lỗi mạng thì thử lại được; lỗi dữ liệu thì không.
  function isNetworkError(error) {
    return /failed to fetch|networkerror|network error|load failed|không trả JSON|\(HTTP 5\d\d\)/i
      .test(String(error?.message || ""));
  }
  const RETRY_DELAYS_MS = [2000, 5000, 15000];
  async function withRetry(label, task, delays = RETRY_DELAYS_MS) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await task();
      } catch (error) {
        if (!isNetworkError(error) || attempt >= delays.length) throw error;
        console.warn(`${label}: ${error.message} — thử lại sau ${delays[attempt] / 1000}s (lần ${attempt + 1}/${delays.length}).`);
        await wait(delays[attempt]);
      }
    }
  }

  // Chỉ phiếu CHƯA XUẤT HÓA ĐƠN theo chính website: phải có mặt trong danh sách
  // Bán hàng đang lọc "Chưa xuất hóa đơn". API LayDuLieu trả cả phiếu đã xuất, và
  // không thể chỉ dựa vào số hóa đơn trên dòng/form để biết phiếu đã xuất.
  function splitByWebsiteStatus(listRows, unissuedKeys) {
    const candidates = [];
    const issued = [];
    for (const row of listRows) {
      const id = String(row.ID || "").trim().toLowerCase();
      const no = String(row.NAME || "").trim();
      (unissuedKeys.has(id) || unissuedKeys.has(no) ? candidates : issued).push(row);
    }
    return { candidates, issued };
  }

  if (globalThis.__SUA_NGUOI_MUA_TEST__) {
    globalThis.__SUA_NGUOI_MUA_TEST__.lib = {
      classify, buildPayload, checkDetailRows, verifyAfterSave, splitByWebsiteStatus, parseTime, NEW_BUYER, NEW_PAYMENT,
      isNetworkError, withRetry
    };
    return;
  }

  const base = location.pathname.split("/").filter(Boolean)[0] || "";
  if (!SHOPS.includes(base)) { console.error(`Không nhận ra cơ sở của trang hiện tại: /${base}`); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(TU_NGAY) || !/^\d{4}-\d{2}-\d{2}$/.test(DEN_NGAY) || TU_NGAY > DEN_NGAY) {
    console.error("TU_NGAY/DEN_NGAY phải dạng YYYY-MM-DD và TU_NGAY ≤ DEN_NGAY.");
    return;
  }

  // Chỉ dùng cho request ĐỌC (danh sách, sơ đồ phòng) nên thử lại được.
  const postJson = (path, body) => withRetry(path, () => postJsonOnce(path, body));
  async function postJsonOnce(path, body) {
    const response = await fetch(`/${base}/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json;utf-8", "X-Requested-With": "XMLHttpRequest" },
      body: JSON.stringify(body)
    });
    const text = await response.text();
    try { return JSON.parse(text); } catch (_) {
      throw new Error(`${path} không trả JSON (HTTP ${response.status}); có thể đã mất phiên đăng nhập.`);
    }
  }

  const readForm = recordId => withRetry(`Đọc phiếu ${recordId}`, () => readFormOnce(recordId));
  async function readFormOnce(recordId) {
    const query = new URLSearchParams({ TableID: SALES_TABLE_ID, RecordID: recordId, Loai: "0", MaxTab: "0", NOTITLE: "1", is_dialog: "1" });
    const response = await fetch(`/${base}/AddEdit?${query}`, { credentials: "same-origin", headers: { "X-Requested-With": "XMLHttpRequest" } });
    const html = await response.text();
    let at = html.indexOf("new DataTransferJs(");
    while (at >= 0) {
      const formData = extractJsonObject(html, at);
      if (Array.isArray(formData?.mapper?.Maps) && formData.mapper.Maps.length) return formData;
      at = html.indexOf("new DataTransferJs(", at + 1);
    }
    throw new Error(`Không đọc được form phiếu ${recordId} (HTTP ${response.status}).`);
  }

  // ---- UI: danh sách Bán hàng và form phiếu (giống script chuyển phòng) ----
  const jq = window.jQuery || window.$;
  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0 || rect.width <= 0 || rect.height <= 0) return false;
    const win = el.closest(".k-window, [role='dialog']");
    if (!win) return true;
    const winStyle = getComputedStyle(win);
    const winRect = win.getBoundingClientRect();
    return !win.hidden && win.getAttribute("aria-hidden") !== "true" && winStyle.display !== "none" &&
      winStyle.visibility !== "hidden" && winRect.width > 0 && winRect.height > 0;
  }
  const listGridElement = () => Array.from(document.querySelectorAll(".k-grid")).find(el => {
    const t = el.querySelector("thead")?.innerText || "";
    return /Số phiếu/i.test(t) && /Tổng cộng/i.test(t);
  }) || null;
  const listRowFor = no => Array.from(listGridElement()?.querySelectorAll("tbody tr[data-uid]") || [])
    .find(tr => Array.from(tr.querySelectorAll('[role="gridcell"], td')).some(td => (td.innerText || "").trim() === no)) || null;
  const detailGrids = () => Array.from(document.querySelectorAll(".k-grid")).filter(isVisible)
    .map(el => jq?.(el).data("kendoGrid")).filter(g => g?.dataSource)
    .filter(g => {
      const data = Array.from(g.dataSource.data() || []);
      return data.length && data.every(r => r.DMATHANGID !== undefined && r.DONGIA !== undefined &&
        r.THANHTIEN !== undefined && (r.SLXUAT !== undefined || r.SLXUATCHUAQUYDOI !== undefined));
    });
  // Form phiếu "chỉ hát" có lưới dòng hàng rỗng nên detailGrids() không thấy;
  // nhận form qua số phiếu đang hiện trên form.
  const formOpen = () => detailGrids().length > 0 || openFormNames().length > 0;
  const openFormNames = () => Array.from(document.querySelectorAll('[id^="numTONGCONG"]'))
    .filter(el => /^numTONGCONG\d+$/.test(el.id) && isVisible(el))
    .map(el => document.getElementById(`txtNAME${el.id.slice("numTONGCONG".length)}`))
    .filter(Boolean).map(el => String(el.value ?? "").trim());
  const openFormRecordId = () => String(window.formData?._RecordID || window.formData?.mapper?.ID || "").toLowerCase();

  function findListRunner() {
    const sources = [["dialogInfo", window.dialogInfo?.client],
      ["__invoiceTargetListDialogInfo", window.__invoiceTargetListDialogInfo?.client], ["client", window.client]];
    for (const key of Object.keys(window)) {
      try {
        const value = window[key];
        if (value && typeof value === "object" && typeof value.get_CodeRunner === "function") sources.push([key, value]);
      } catch (_) {}
    }
    for (const [where, client] of sources) {
      try {
        const found = client?.get_CodeRunner?.();
        if (typeof found?.Detail_MouseDoubleClick === "function") return { where, runner: found };
      } catch (_) {}
    }
    return null;
  }
  const listDialog = window.dialogInfo?.client ? window.dialogInfo : window.__invoiceTargetListDialogInfo || window.dialogInfo;
  const listRunner = findListRunner();
  const runner = () => listRunner?.runner;

  // Danh sách lọc cả tháng có thể nhiều trang; phiếu phải có trên trang đang
  // hiện thì mới nhấp đúp mở được.
  async function showAllListRows(expectedCount) {
    const grid = jq?.(listGridElement()).data("kendoGrid");
    const ds = grid?.dataSource;
    if (!ds?.pageSize) return;
    const total = Number(ds.total?.()) || 0;
    if (total <= (Number(ds.pageSize()) || 0)) return;
    ds.pageSize(Math.max(total, expectedCount, 50));
    for (let i = 0; i < 100; i += 1) {
      await wait(150);
      const loading = document.querySelector(".k-loading-mask");
      if ((!loading || !isVisible(loading)) && (Number(ds.view?.().length) || 0) >= Math.min(total, ds.pageSize())) return;
    }
  }

  // Radio "Chưa xuất hóa đơn" của danh sách Bán hàng (cùng cách bridge.js tìm: _2).
  const unissuedFilterChecked = () => Boolean((
    document.querySelector('input[type="radio"][id^="rdTrangThai"][id$="_2"]') ||
    Array.from(document.querySelectorAll('input[type="radio"]'))
      .find(input => /Chưa xuất hóa đơn/i.test(`${input.value} ${input.closest("label,td")?.innerText || ""}`))
  )?.checked);

  // Số phiếu + ID của MỌI phiếu trong danh sách "Chưa xuất hóa đơn" đang lọc.
  // Danh sách phải đã nạp đủ (showAllListRows), nếu không phiếu ở trang sau bị
  // coi nhầm là đã xuất và bỏ qua.
  function unissuedListKeys() {
    const ds = jq?.(listGridElement()).data("kendoGrid")?.dataSource;
    const keys = new Set();
    const items = ds?.data ? Array.from(ds.data()) : [];
    const total = Number(ds?.total?.()) || items.length;
    if (items.length < total) {
      throw new Error(`Danh sách Bán hàng mới nạp ${items.length}/${total} phiếu. Lọc ít ngày hơn rồi chạy lại.`);
    }
    for (const item of items) {
      if (item?.ID) keys.add(String(item.ID).trim().toLowerCase());
      if (item?.NAME) keys.add(String(item.NAME).trim());
    }
    // Lưới không mang NAME/ID trong dữ liệu: đọc số phiếu trên các dòng đang hiện.
    if (!keys.size) {
      for (const tr of listGridElement()?.querySelectorAll("tbody tr[data-uid]") || []) {
        for (const td of tr.querySelectorAll('[role="gridcell"], td')) {
          const text = (td.innerText || "").trim();
          if (/^\d{6,}$/.test(text)) keys.add(text);
        }
      }
    }
    return keys;
  }

  function detailRowsFromOpenForm(goods) {
    const matches = detailGrids();
    if (!matches.length && goods === 0) return [];
    if (matches.length !== 1) throw new Error(`Tìm thấy ${matches.length} lưới dòng hàng trên form, cần đúng 1.`);
    return Array.from(matches[0].dataSource.data()).map((row, index) => {
      const plain = JSON.parse(JSON.stringify(typeof row.toJSON === "function" ? row.toJSON() : row));
      plain.THUTU = index + 1;
      return plain;
    });
  }

  async function openInvoice(no, recordId, goods) {
    let row = null;
    for (let i = 0; i < 60 && !row; i += 1) {
      const loading = document.querySelector(".k-loading-mask");
      if (!loading || !isVisible(loading)) row = listRowFor(no);
      if (!row) await wait(150);
    }
    if (!row) throw new Error(`Không thấy phiếu ${no} trên danh sách. Kiểm tra bộ lọc ${TU_NGAY}..${DEN_NGAY} + "Chưa xuất hóa đơn".`);
    await wait(300);
    const grid = jq?.(listGridElement()).data("kendoGrid");
    if (grid?.select) grid.select(row);
    if (listDialog) window.dialogInfo = listDialog;
    // Phiếu có hàng: đợi lưới dòng hàng nạp xong. Phiếu tiền hàng 0: lưới rỗng.
    const isOurForm = () => (openFormNames().includes(no) || openFormRecordId() === recordId.toLowerCase()) &&
      (detailGrids().length === 1 || (goods === 0 && detailGrids().length === 0));
    const waitOpened = async ms => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (isOurForm()) { await wait(goods === 0 ? 1000 : 400); if (isOurForm()) return true; }
        await wait(150);
      }
      return false;
    };
    const cell = row.querySelector('td[role="gridcell"]') || row.querySelector("td") || row;
    const attempts = [
      typeof runner()?.Detail_MouseDoubleClick === "function" ? () => runner().Detail_MouseDoubleClick({}) : null,
      jq ? () => { jq(cell).trigger("click"); jq(cell).trigger("dblclick"); } : null,
      () => ["mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"].forEach((type, i) =>
        cell.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, button: 0, detail: i < 3 ? 1 : 2 })))
    ].filter(Boolean);
    for (const attempt of attempts) {
      attempt();
      if (await waitOpened(8000)) return;
      if (formOpen()) break;
    }
    throw new Error(`Không mở được hoặc không nhận ra form phiếu ${no} ` +
      `(form đang hiện: ${openFormNames().join(", ") || "không có"}; lưới dòng hàng: ${detailGrids().length}; tiền hàng ${goods}).`);
  }

  async function closeInvoice() {
    if (!formOpen()) return;
    const originalAlert = window.alert;
    window.alert = () => {};
    try {
      const buttons = Array.from(document.querySelectorAll('button[id^="btnThoat"]')).filter(isVisible);
      buttons[buttons.length - 1]?.click();
      for (let i = 0; i < 50 && formOpen(); i += 1) await wait(100);
    } finally {
      window.alert = originalAlert;
      if (listDialog) window.dialogInfo = listDialog;
    }
    if (formOpen()) throw new Error("Không đóng được form phiếu; đóng tay (Thoát, KHÔNG lưu) rồi chạy lại.");
  }

  try {
    if (!listGridElement()) { console.error(`Mở danh sách Bán hàng (lọc ${TU_NGAY}..${DEN_NGAY}, Chưa xuất hóa đơn) trước.`); return; }
    if (formOpen()) { console.error("Đang có form phiếu mở. Đóng form (không lưu) rồi chạy lại."); return; }
    if (!unissuedFilterChecked()) {
      console.error('Danh sách Bán hàng chưa lọc "Chưa xuất hóa đơn". Chọn "Chưa xuất hóa đơn", bấm Refresh rồi chạy lại.');
      return;
    }

    // ---- 1. Đọc danh sách + form server, chọn phiếu cần sửa ----
    const list = [];
    for (let page = 1; page <= 50; page += 1) {
      const body = await postJson("HoaDonDienTu/LayDuLieu", {
        filters: {}, skip: (page - 1) * 500, take: 500, page, pageSize: 500, sort: [{ field: "NAME", dir: "asc" }],
        customData: { DKHACHHANGID: "", TRANGTHAI: 0, TuNgay: usDate(TU_NGAY), DenNgay: usDate(DEN_NGAY) }, quickFilter: ""
      });
      const data = Array.isArray(body?.Data) ? body.Data : [];
      list.push(...data);
      if (!data.length || list.length >= (Number(body?.Total) || 0)) break;
    }
    const mapBody = await postJson("Khuvuccontrol/LayDanhSachBan?is_ajax=1", { DKHUVUCID: "_ALL_", UITHIETKE: 0, MODE: 0 });
    const rooms = new Map();
    for (const area of Array.isArray(mapBody?.Tag) ? mapBody.Tag : []) {
      for (const item of area?.items || []) {
        rooms.set(String(item.id || "").toLowerCase(), { name: String(item.name || ""), areaName: String(area.name || ""), counter: Number(item.quay) || 0 });
      }
    }
    const isRetailRoom = id => { const r = rooms.get(String(id || "").toLowerCase()); return Boolean(r && (r.counter || isRetailText(r.name) || isRetailText(r.areaName))); };
    const wanted = new Set(CHI_CAC_PHIEU.map(no => String(no).trim()).filter(Boolean));
    const inScope = list.filter(row => !wanted.size || wanted.has(String(row.NAME || "").trim()));
    const listedNos = new Set(list.map(row => String(row.NAME || "").trim()));
    const outsideRange = [...wanted].filter(no => !listedNos.has(no));
    if (outsideRange.length) {
      console.warn(`${outsideRange.length} số phiếu trong CHI_CAC_PHIEU không có trong ${TU_NGAY}..${DEN_NGAY}, bỏ qua: ` +
        `${outsideRange.slice(0, 10).join(", ")}${outsideRange.length > 10 ? "…" : ""}`);
    }
    await showAllListRows(list.length);
    const { candidates: rows, issued: issuedRows } = splitByWebsiteStatus(inScope, unissuedListKeys());
    if (!rows.length) {
      console.log(`/${base} ${TU_NGAY}..${DEN_NGAY}: ${inScope.length} phiếu, không phiếu nào nằm trong danh sách "Chưa xuất hóa đơn" đang lọc. ` +
        "Kiểm tra bộ lọc ngày trên màn hình có đúng TU_NGAY/DEN_NGAY không.");
      return;
    }

    const scanned = issuedRows.map(row => ({ no: String(row.NAME || "").trim(), id: String(row.ID), skip: "không có trong danh sách Chưa xuất hóa đơn" }));
    let next = 0;
    let read = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (next < rows.length) {
        const row = rows[next++];
        const formData = await readForm(String(row.ID));
        const f = mapObject(formData.mapper.Maps);
        if (String(f.NAME || "").trim() !== String(row.NAME || "").trim()) throw new Error(`Form ${row.ID} trả NAME=${f.NAME}, danh sách là ${row.NAME}.`);
        // Số HĐĐT có thể chỉ nằm trong INVOICEDATA. Dùng || chứ không ??: dòng
        // danh sách có thể ghi SOHOADON = "" trong khi INVOICEDATA đã có số.
        let invoiceData = null;
        try { invoiceData = typeof row.INVOICEDATA === "object" ? row.INVOICEDATA : JSON.parse(row.INVOICEDATA || "null"); } catch (_) {}
        const result = classify(f, {
          retail: isRetailRoom(f.DBANID),
          cancelled: row.DAHUY === true || Number(row.DAHUY) === 1 || Number(invoiceData?.DAHUY) === 1,
          issuedNo: String(row.SOHOADON || invoiceData?.SOHOADON || "").trim()
        });
        read += 1;
        if (read % 50 === 0) console.log(`Đã đọc ${read}/${rows.length} phiếu…`);
        scanned.push({ ...result, id: String(row.ID), lastSaveId: String(f.LASTSAVEID || ""), goods: money(f.TIENHANG), total: money(f.TONGCONG) });
      }
    }));
    scanned.sort((a, b) => a.no.localeCompare(b.no));
    const targets = scanned.filter(item => item.changes);
    const skipped = scanned.filter(item => item.skip);
    const skipCounts = skipped.reduce((acc, item) => {
      const key = item.skip.startsWith("người mua khác") ? "người mua khác (giữ nguyên)" : item.skip;
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    // CK đối chiếu được với số dòng CK đã nhập; TM gồm cả phiếu nhân viên tự lập.
    const byPayment = OUR_PAYMENTS.map(method => `${method}: ${targets.filter(item => upper(item.payment) === method).length}`).join(", ");
    console.log(`/${base} ${TU_NGAY}..${DEN_NGAY}: ${scanned.length} phiếu, cần sửa ${targets.length} (${byPayment}). Bỏ qua:`, skipCounts);
    const otherBuyers = skipped.filter(item => item.skip.startsWith("người mua khác"));
    if (otherBuyers.length) console.table(otherBuyers.map(item => ({ "Số phiếu": item.no, "Lý do": item.skip })));
    if (!targets.length) { console.log("Không có phiếu nào cần sửa."); return; }
    const batch = CHAY_THU_1_PHIEU ? targets.slice(0, 1) : targets;
    console.table(batch.map(item => ({ "Số phiếu": item.no, "Tổng": item.total, "Người mua hiện tại": item.buyer || "(trống)",
      "TT hiện tại": item.payment || "(trống)", "Đổi": Object.keys(item.changes).join(", ") })));
    if (!window.confirm(`${CHAY_THU_1_PHIEU ? "CHẠY THỬ 1 phiếu" : `Sửa ${batch.length} phiếu`} như bảng trong Console?\n` +
        `Người mua → "${NEW_BUYER}", thanh toán → ${NEW_PAYMENT}. Tiền, giờ, phòng và dòng hàng giữ nguyên.`)) {
      console.warn("Đã hủy, chưa lưu gì.");
      return;
    }

    // ---- 2. Lưu từng phiếu ----
    // Một phiếu: đọc lại form, mở phiếu lấy dòng hàng, gửi DoSave, đọc lại xác
    // nhận. state.before/changes giữ form ngay trước lần gửi để đối chiếu khi mất
    // phản hồi. DoSave KHÔNG tự gửi lại: có thể website đã lưu xong.
    async function saveOne(item, state) {
      if (!unissuedFilterChecked()) throw new Error("Bộ lọc \"Chưa xuất hóa đơn\" vừa bị đổi trên màn hình.");
      const before = await readForm(item.id);
      const f = mapObject(before.mapper.Maps);
      if (String(f.LASTSAVEID || "") !== item.lastSaveId) throw new Error(`${item.no} vừa bị sửa ở nơi khác trong lúc chạy.`);
      const recheck = classify(f, { retail: isRetailRoom(f.DBANID) });
      if (!recheck.changes) throw new Error(`${item.no}: không còn cần sửa (${recheck.skip}).`);
      await openInvoice(item.no, item.id, money(f.TIENHANG));
      const detailRows = detailRowsFromOpenForm(money(f.TIENHANG));
      checkDetailRows(detailRows, money(f.TIENHANG), item.no);
      const payload = buildPayload(before, detailRows, recheck.changes);
      state.before = f;
      state.changes = recheck.changes;
      const response = await fetch(`/${base}/AddEdit/DoSave?is_ajax=1`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json;utf-8", "X-Requested-With": "XMLHttpRequest" },
        body: JSON.stringify(payload)
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch (_) {}
      if (!body || Number(body.code) !== 1 || String(body.Tag?.ID || "").toLowerCase() !== item.id.toLowerCase()) {
        throw new Error(`${item.no}: website không lưu (HTTP ${response.status}): ${text.slice(0, 300)}`);
      }
      await closeInvoice();
      const after = mapObject((await readForm(item.id)).mapper.Maps);
      const problems = verifyAfterSave(f, after, recheck.changes);
      if (problems.length) throw new Error(`${item.no}: đã lưu nhưng đọc lại thấy sai: ${problems.join("; ")}.`);
    }

    // Rớt mạng giữa chừng: chờ rồi đọc lại phiếu. Lần gửi trước đã được lưu thì
    // xác nhận như thường; chưa lưu thì làm lại cả phiếu. Lỗi không phải mạng
    // (sai dữ liệu, phiếu bị sửa nơi khác...) vẫn dừng ngay.
    async function saveWithRetry(item) {
      const state = {};
      for (let attempt = 0; ; attempt += 1) {
        try {
          await saveOne(item, state);
          return "OK";
        } catch (error) {
          try { await closeInvoice(); } catch (closeError) { console.error(closeError.message); }
          if (!isNetworkError(error) || attempt >= RETRY_DELAYS_MS.length) return `LỖI: ${error.message}`;
          console.warn(`${item.no}: ${error.message} — thử lại sau ${RETRY_DELAYS_MS[attempt] / 1000}s ` +
            `(lần ${attempt + 1}/${RETRY_DELAYS_MS.length}).`);
          await wait(RETRY_DELAYS_MS[attempt]);
          if (!state.before) continue;
          const now = mapObject((await readForm(item.id)).mapper.Maps);
          const saved = Object.entries(state.changes).every(([field, value]) => String(now[field] ?? "").trim() === value);
          if (!saved) continue;
          const problems = verifyAfterSave(state.before, now, state.changes);
          return problems.length ? `LỖI: ${item.no}: đã lưu nhưng đọc lại thấy sai: ${problems.join("; ")}.` : "OK";
        }
      }
    }

    const results = [];
    for (const [index, item] of batch.entries()) {
      let outcome;
      try {
        outcome = await saveWithRetry(item);
      } catch (error) {
        outcome = `LỖI: ${error.message}`;
      }
      results.push({ "Số phiếu": item.no, "Kết quả": outcome });
      if (outcome !== "OK") {
        console.error(`DỪNG tại ${item.no}:`, outcome.replace(/^LỖI: /, ""));
        break;
      }
      console.log(`%c[${index + 1}/${batch.length}] ${item.no}: OK`, "color:green");
      await wait(PAUSE_BETWEEN_INVOICES_MS);
    }
    console.table(results);
    const ok = results.filter(r => r["Kết quả"] === "OK").length;
    console.log(CHAY_THU_1_PHIEU
      ? `Chạy thử xong (${ok}/1). Mở phiếu ${batch[0].no} trên website kiểm tra; ổn thì đặt CHAY_THU_1_PHIEU = false và chạy lại.`
      : `Xong ${ok}/${batch.length} phiếu. Còn ${targets.length - ok} phiếu chưa sửa${ok < batch.length ? " — xem lỗi phía trên rồi chạy lại" : ""}.`);
  } catch (error) {
    console.error("DỪNG:", error.message);
  }
})();
