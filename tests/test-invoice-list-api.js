"use strict";

// Giao diện Hóa đơn điện tử 10/2026 đổi radio "Chưa phát hành" (rdTrangThai_2)
// thành dropdown và thêm cột Chọn/Chiết khấu vào lưới, nên cách cũ — đặt bộ lọc
// rồi đọc DOM từng trang — không còn chạy. Danh sách phiếu nay lấy bằng API
// LayDuLieu với ô Loại do server lọc, và phiếu được mở theo ID.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8").replace(/\r\n/g, "\n");

function extract(name) {
  const match = new RegExp(`\\n  (async )?function ${name}\\(`).exec(source);
  assert(match, `Không tìm thấy ${name} trong bridge.js`);
  const start = match.index + 1;
  let depth = 0;
  // Thân hàm bắt đầu sau ") {" — tham số có thể chứa "{}" (options = {}).
  for (let index = source.indexOf(") {", start) + 2; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không cắt được ${name}`);
}

const UNISSUED = 2;
const ISSUED = 1;
const ID_699 = "15c445fd-2794-4c14-8829-24083d67b6d6";
const ID_700 = "2a2b6c1e-0f54-4a8e-9a49-5c2d0c7e8f10";
const ID_701 = "3b3c7d2f-1a65-4b9f-8b5a-6d3e1d8f9a21";

function makeBox(listByStatus) {
  const calls = { list: [], opened: [] };
  const box = {
    calls,
    fetchEInvoiceList: async options => {
      calls.list.push(`${options.dateKey}#${options.status}`);
      return { rows: (listByStatus[options.status] || []).map(row => ({ ...row })) };
    },
    openInvoiceById: async (id, invoiceNo) => {
      calls.opened.push(`${id}:${invoiceNo}`);
      return { opened: true, id, invoiceNo };
    }
  };
  vm.createContext(box);
  vm.runInContext([
    "const invoiceListCache = new Map();",
    "const EINVOICE_STATUS_ISSUED = 1;",
    "const EINVOICE_STATUS_UNISSUED = 2;",
    "const INVOICE_LIST_CACHE_MS = 120000;",
    "const unissuedInvoiceIds = new Map();",
    ...[
      "normalizeDateKey", "isGuid", "dateDisplay", "invoiceCandidateRow", "rememberUnissuedRows",
      "findInvoiceCandidates", "findIssuedInvoiceByAmount", "openInvoiceCandidate", "uiDateTimeText"
    ].map(extract),
    "this.api = { findInvoiceCandidates, findIssuedInvoiceByAmount, openInvoiceCandidate, uiDateTimeText, invoiceListCache };"
  ].join("\n"), box);
  return box;
}

// Dòng theo dạng eInvoiceRow() trả về.
const row = (id, invoiceNo, grandTotal, extra = {}) =>
  ({ id, invoiceNo, dateKey: "2026-10-04", grandTotal, issued: false, cancelled: false, ...extra });

(async () => {
  const box = makeBox({
    [UNISSUED]: [
      row(ID_699, "01000000699", 3586000),
      row(ID_700, "01000000700", 1250000),
      // Server đã lọc Chưa phát hành nhưng vẫn phòng thủ: dòng đã có số HĐ, đã
      // hủy hoặc thiếu ID không được thành ứng viên.
      row(ID_701, "01000000701", 990000, { issued: true }),
      row("khong-phai-guid", "01000000702", 500000)
    ],
    [ISSUED]: [
      row(ID_701, "01000000701", 990000, { issued: true, soHoaDon: "120" }),
      row("4c4d8e3a-2b76-4ca1-9c6b-7e4f2e9a0b32", "01000000703", 990000, { issued: true, cancelled: true })
    ]
  });
  const { api, calls } = box;

  // --- Danh sách chưa xuất -----------------------------------------------------
  const found = await api.findInvoiceCandidates("2026-10-04", ["01000000700"]);
  assert.strictEqual(calls.list.join(","), `2026-10-04#${UNISSUED}`, "Phải hỏi server với Loại = Chưa phát hành");
  assert.strictEqual(found.invoiceStatus, "unissued");
  assert.strictEqual(found.cached, false);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(found.candidates)),
    [
      { uid: ID_699, id: ID_699, invoiceNo: "01000000699", date: "04/10/2026", dateKey: "2026-10-04", grandTotal: 3586000, available: true },
      { uid: ID_700, id: ID_700, invoiceNo: "01000000700", date: "04/10/2026", dateKey: "2026-10-04", grandTotal: 1250000, available: false }
    ],
    "uid là ID phiếu; phiếu đã dùng vẫn hiện nhưng available = false"
  );

  // Giao dịch kế tiếp cùng ngày dùng lại bản vừa tải.
  const again = await api.findInvoiceCandidates("2026-10-04", []);
  assert.strictEqual(again.cached, true);
  assert.strictEqual(calls.list.length, 1, "Cùng ngày trong thời gian ngắn không tải lại");

  // Tìm đúng một số phiếu (đối soát sau lưu) luôn đọc lại server.
  const exact = await api.findInvoiceCandidates("2026-10-04", [], { invoiceNo: "01000000699" });
  assert.strictEqual(calls.list.length, 2, "Tìm số phiếu cụ thể phải tải lại");
  assert.strictEqual(exact.exact, true);
  assert.strictEqual(exact.candidates.length, 1);
  const missing = await api.findInvoiceCandidates("2026-10-04", [], { invoiceNo: "01000000999" });
  assert.strictEqual(missing.exact, false);
  assert.strictEqual(missing.candidates.length, 0);

  // Bản nhớ quá hạn thì tải lại.
  api.invoiceListCache.get("2026-10-04").at -= 121000;
  await api.findInvoiceCandidates("2026-10-04", []);
  assert.strictEqual(calls.list.length, 4, "Quá hạn bản nhớ phải tải lại");

  await assert.rejects(api.findInvoiceCandidates("04-10", []), /Ngày giao dịch không hợp lệ/);

  // --- Mở phiếu: chỉ ID đã thấy trong danh sách Chưa phát hành ------------------
  await api.openInvoiceCandidate(ID_699, "01000000699");
  assert.strictEqual(calls.opened.join(","), `${ID_699}:01000000699`);
  await assert.rejects(api.openInvoiceCandidate(ID_701, "01000000701"), /Chưa phát hành/,
    "Phiếu đã phát hành không được mở để sửa");
  await assert.rejects(api.openInvoiceCandidate(ID_699, "01000000700"), /không phải 01000000700/,
    "ID và số phiếu lệch nhau thì dừng");
  await assert.rejects(api.openInvoiceCandidate("ui-row-uid", "01000000699"), /Chưa phát hành/,
    "uid dòng lưới cũ không còn mở được");

  // Phiếu được phát hành trong lúc đó: lần tải sau không còn nó thì không mở nữa.
  const later = makeBox({ [UNISSUED]: [row(ID_699, "01000000699", 3586000)] });
  await later.api.findInvoiceCandidates("2026-10-04", []);
  vm.runInContext("fetchEInvoiceList = async () => ({ rows: [] });", later);
  await later.api.findInvoiceCandidates("2026-10-04", [], { forceRefresh: true });
  await assert.rejects(later.api.openInvoiceCandidate(ID_699, "01000000699"), /Chưa phát hành/);

  // --- Dò hóa đơn đã xuất khớp tiền ---------------------------------------------
  const issued = await api.findIssuedInvoiceByAmount("2026-10-04", 990000);
  assert(calls.list.includes(`2026-10-04#${ISSUED}`), "Phải hỏi server với Loại = Đã phát hành");
  assert.strictEqual(issued.invoiceStatus, "issued");
  assert.deepStrictEqual(issued.rows.map(item => item.invoiceNo), ["01000000701"], "Hóa đơn đã hủy bị loại");
  assert.deepStrictEqual(issued.matches.map(item => item.invoiceNo), ["01000000701"]);
  assert.strictEqual(issued.matches[0].soHoaDon, "120");
  assert.strictEqual((await api.findIssuedInvoiceByAmount("2026-10-04", 123)).matches.length, 0);

  // --- Giờ vào/ra từ form theo định dạng ô trên giao diện --------------------------
  assert.strictEqual(api.uiDateTimeText(new Date(2026, 6, 1, 19, 15).getTime()), "01/07/2026 19:15");
  assert.strictEqual(api.uiDateTimeText(0), "");

  // --- Cấu trúc --------------------------------------------------------------------
  // Mở theo ID đúng lời gọi website dùng khi nhấp đúp dòng ở màn Hóa đơn điện tử,
  // và không đóng hộ form người dùng đang mở.
  const openById = extract("openInvoiceById");
  assert.match(openById, /uiUtils\.ShowEditForm\(SALES_TABLE_ID, 0, recordId, "Loai=0&notitle=1&ModeQuanLy=30"/);
  assert.match(openById, /waitForInvoiceDetailClosed\(\)\)\.detailVisible\) \{\s*throw/);
  assert(!/closeInvoiceDetail/.test(openById), "openInvoiceById không được tự đóng form đang mở");
  // Đọc trọn phiếu cho đối soát lại: đầu phiếu + dòng hàng qua API, cùng dạng scan().
  const snapshot = extract("readInvoiceSnapshot");
  for (const field of ["ready: true", "currentGrand", "currentGoods", "currentHour", "roomId", "roomName", "checkIn", "checkOut", "items"]) {
    assert(snapshot.includes(field), `readInvoiceSnapshot thiếu ${field}`);
  }
  assert.match(snapshot, /readInvoiceItemsViaApi\(id\)/);
  assert.match(source, /detail\.action === "readInvoiceSnapshot"/);

  console.log("Danh sách phiếu qua API + mở theo ID: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
