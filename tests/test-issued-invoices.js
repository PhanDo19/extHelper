const assert = require("assert");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const IssuedBook = require(path.join(__dirname, "..", "issued-invoices.js"));

function entry(overrides) {
  return {
    invoiceId: "11111111-1111-1111-1111-111111111111",
    invoiceNo: "HD0126060001",
    dateKey: "2026-06-01",
    issuedAt: "2026-06-01T10:00:00.000Z",
    grandTotal: 2068000,
    soHoaDon: "1194",
    soKyHieu: "1C26MVN",
    maCQThue: "M1-26-IYKKX-00000002781",
    items: [
      { code: "1000010", name: "HẠT DẺ", unit: "Gói", qty: 2, price: 100000, amount: 200000 },
      { code: "1500007", name: "Đĩa hoa quả to", unit: "Đĩa", qty: 1, price: 400000, amount: 400000 }
    ],
    ...overrides
  };
}

// Ghi sổ lần đầu.
let book = IssuedBook.record({ entries: [] }, entry());
assert.strictEqual(book.entries.length, 1);
assert.strictEqual(book.entries[0].items.length, 2);
assert.strictEqual(book.entries[0].soHoaDon, "1194");

// Phát hành lại/chạy lại lô không được cộng dồn: cùng invoiceId thì ghi đè.
book = IssuedBook.record(book, entry({ soHoaDon: "1195" }));
assert.strictEqual(book.entries.length, 1, "Cùng invoiceId phải ghi đè, không thêm dòng");
assert.strictEqual(book.entries[0].soHoaDon, "1195");
assert.strictEqual(book.entries[0].id, IssuedBook.findByInvoiceId(book, entry().invoiceId).id);

// Hóa đơn khác thì thêm mới.
book = IssuedBook.record(book, entry({
  invoiceId: "22222222-2222-2222-2222-222222222222",
  invoiceNo: "HD0126060002",
  dateKey: "2026-06-02",
  items: [{ code: "1000010", name: "HẠT DẺ", unit: "Gói", qty: 3, price: 100000, amount: 300000 }]
}));
assert.strictEqual(book.entries.length, 2);

// Nhiều dòng cùng mã trong một hóa đơn được gộp.
const mergedEntry = IssuedBook.normalizeEntry(entry({
  items: [
    { code: "1000010", name: "HẠT DẺ", qty: 2, amount: 200000 },
    { code: "1000010", name: "HẠT DẺ", qty: 5, amount: 500000 }
  ]
}));
assert.strictEqual(mergedEntry.items.length, 1);
assert.strictEqual(mergedEntry.items[0].qty, 7);
assert.strictEqual(mergedEntry.items[0].amount, 700000);

// Dòng số lượng 0 hoặc thiếu mã bị loại khỏi thống kê.
const filtered = IssuedBook.normalizeEntry(entry({
  items: [
    { code: "1000010", qty: 0 },
    { code: "", qty: 5 },
    { code: "1000025", qty: 1, amount: 1000 }
  ]
}));
assert.strictEqual(filtered.items.length, 1);
assert.strictEqual(filtered.items[0].code, "1000025");

assert.throws(() => IssuedBook.record({ entries: [] }, entry({ invoiceId: "" })), /Thiếu ID hóa đơn/);

// Xuất toàn bộ: cộng dồn số lượng theo mã hàng.
const full = IssuedBook.build({ book, exportedAt: "2026-06-03T00:00:00.000Z", extensionVersion: "1.15.0" });
assert.strictEqual(full.kind, "invoice-target-issued-invoices");
assert.strictEqual(full.schemaVersion, 1);
assert.strictEqual(full.summary.invoiceCount, 2);
const hatDe = full.items.find(item => item.code === "1000010");
assert.strictEqual(hatDe.qty, 5, "2 + 3 = 5 đơn vị HẠT DẺ");
assert.strictEqual(hatDe.invoiceCount, 2);
assert.strictEqual(full.summary.totalQty, 6);
assert.strictEqual(full.summary.invoicesWithoutItems, 0);

// Lọc theo khoảng ngày.
const oneDay = IssuedBook.build({ book, fromDate: "2026-06-02", toDate: "2026-06-02" });
assert.strictEqual(oneDay.summary.invoiceCount, 1);
assert.strictEqual(oneDay.items.find(item => item.code === "1000010").qty, 3);
assert.strictEqual(oneDay.range.fromDate, "2026-06-02");

// Hóa đơn chưa đọc được mặt hàng phải được đếm để cảnh báo trước khi hạch toán.
const withGap = IssuedBook.record(book, entry({
  invoiceId: "33333333-3333-3333-3333-333333333333",
  invoiceNo: "HD0126060003",
  dateKey: "2026-06-02",
  items: [],
  itemsError: "Khong tim thay dong hang trong chi tiet phieu."
}));
const gapExport = IssuedBook.build({ book: withGap });
assert.strictEqual(gapExport.summary.invoicesWithoutItems, 1);
assert.match(
  gapExport.invoices.find(item => item.invoiceNo === "HD0126060003").itemsError,
  /Khong tim thay dong hang/
);

// File xuất chỉ phục vụ hạch toán: không kèm sao kê, ánh xạ hay danh mục web.
const serialized = JSON.stringify(full);
assert.strictEqual(serialized.includes("statementDataset"), false);
assert.strictEqual(serialized.includes("mappings"), false);
assert.strictEqual(serialized.includes("availableQty"), false);

// Giao diện: phát hành nằm TRONG tab Giao dịch (sub-tab), không phải màn hình
// riêng; nút xuất hạch toán nằm ở tab Kho.
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
assert(contentSource.includes('id="it-einvoice-admin"'), "Missing e-invoice section");
// Điều hướng sang bước 5 nay dùng menu chuyển bước ở đầu panel; hàng sub-tab cũ
// đã bỏ vì trùng chức năng. Điều bắt buộc vẫn là section phát hành nằm chung
// màn Giao dịch (cùng dữ liệu sao kê), không tách thành màn hình riêng.
assert(!contentSource.includes('id="it-subtab-einvoice"'),
  "Hàng sub-tab cũ trùng với menu chuyển bước nên phải bỏ");
assert(contentSource.includes('data-screen="einvoice"'),
  "Menu chuyển bước phải có lối vào bước Phát hành");
assert(contentSource.includes('id="it-manage-einvoice"'),
  "Dashboard phải có lối tắt rõ ràng tới bước Phát hành hóa đơn");
assert(contentSource.includes('function openEInvoiceAdmin(dateKey)'),
  "Lối tắt phát hành phải mở đúng sub-tab Giao dịch, không tạo màn hình dữ liệu riêng");
// Section phát hành phải được render bên trong tab Giao dịch.
const statementAdminIndex = contentSource.indexOf("function renderStatementAdmin");
const subtabIndex = contentSource.indexOf('id="it-einvoice-admin"', statementAdminIndex);
assert(subtabIndex > statementAdminIndex && subtabIndex < contentSource.indexOf("function showStatementSubtab"),
  "Section phát hành phải nằm trong renderStatementAdmin");
assert.match(contentSource, /function showStatementSubtab\(name\)/);
const stockAdminIndex = contentSource.indexOf('id="it-stock-admin"');
assert(contentSource.indexOf('id="it-export-issued"', stockAdminIndex) > stockAdminIndex,
  "Nút xuất hạch toán phải nằm trong tab Kho");
assert.match(contentSource, /function issueSelectedEInvoices\(\)/);
assert.match(contentSource, /function exportIssuedInvoices\(\)/);
assert.match(contentSource, /function renderEInvoiceRows\(\)/);
// Ghi sổ ngay sau từng hóa đơn để lô dừng giữa chừng vẫn có số liệu.
assert.match(contentSource, /saveIssuedInvoices\(issuedInvoiceBook\)/);
// Số hóa đơn điện tử (SOHOADON) do máy chủ cấp tăng dần theo đúng thứ tự lời gọi
// phatHanhHoaDon đến, nên THỨ TỰ PHÁT HÀNH CHÍNH LÀ THỨ TỰ ĐÁNH SỐ.
//
// Bản trước chia lô làm hai giai đoạn nối tiếp: nhóm đã có mặt hàng trong sổ đối
// soát chạy thuần API với 2 luồng song song, rồi mới tới nhóm phải mở giao diện.
// Cách đó nhanh hơn nhưng làm rối số hóa đơn theo hai đường: hai luồng song song
// về đích theo độ trễ mạng chứ không theo thứ tự gửi, và việc tách giai đoạn xáo
// thứ tự theo tiêu chí "đã có mặt hàng hay chưa" — hoàn toàn không liên quan tới
// giờ giao dịch. Nghiệp vụ cần số hóa đơn liên tục theo giờ, kể cả khi xen kẽ với
// cơ sở còn lại, nên ở đây đổi tốc độ lấy thứ tự.
const issueRunner = contentSource.slice(
  contentSource.indexOf("const orderedTargets = sortTargetsForIssue(targets)"),
  contentSource.indexOf("} finally {", contentSource.indexOf("const orderedTargets = sortTargetsForIssue(targets)"))
);
assert(issueRunner, "Không tìm thấy phần chạy lô phát hành");
// Cả lô chạy MỘT luồng. Không được còn bất kỳ đường song song nào.
assert(!issueRunner.includes("Promise.all"),
  "Lô phát hành không được chạy song song: hai luồng sẽ trộn thứ tự cấp số hóa đơn");
assert(!/apiOnly|needsUi/.test(issueRunner),
  "Không được phân nhóm lại theo nguồn mặt hàng: việc đó xáo thứ tự theo tiêu chí không liên quan giờ giao dịch");
assert.match(issueRunner, /for \(const row of orderedTargets\) await processTarget\(row\);/,
  "Cả lô chạy tuần tự đúng một vòng theo thứ tự đã sắp");

// Thứ tự phát hành phải bám giờ giao dịch trong sao kê, không bám invoiceNo:
// phiếu tạo mới nhận số cuối dải nên invoiceNo lộn xộn, còn requestedAt thì không.
assert.match(contentSource, /function sortTargetsForIssue\(rows\)/,
  "Phải có hàm sắp thứ tự phát hành riêng để test được");
const sortFn = contentSource.slice(
  contentSource.indexOf("function issueOrderKey(row)"),
  contentSource.indexOf("async function issueSelectedEInvoices(")
);
assert(sortFn.includes("dateKey") && sortFn.includes("requestedAt"),
  "Sắp theo ngày rồi tới giờ giao dịch thật");
// Giờ giao dịch phải tra ngược từ sao kê qua mã phiếu; bản thân dòng hóa đơn
// trên website không mang dấu thời gian chuyển tiền.
assert(sortFn.includes("statementTransactionsForInvoiceNo"),
  "Giờ giao dịch lấy từ sao kê đã liên kết, không phải từ dòng hóa đơn");
// invoiceNo chỉ được làm chốt phụ: phiếu tạo mới nhận số cuối dải nên nếu sắp
// theo invoiceNo trước thì thứ tự nghiệp vụ trong ngày sẽ sai.
assert(sortFn.indexOf("requestedAt") < sortFn.indexOf("localeCompare(String(right?.invoiceNo"),
  "invoiceNo chỉ là chốt phụ, không được ưu tiên trước giờ giao dịch");

// Hộp thoại xác nhận phải nêu đúng thứ tự sẽ chạy, không phải thứ tự dòng trong
// bảng — người dùng cần thấy trước dải số hóa đơn sắp được cấp.
const confirmBlock = contentSource.slice(
  contentSource.indexOf("const confirmed = window.confirm("),
  contentSource.indexOf("if (!confirmed)")
);
assert(confirmBlock.includes("orderedTargets") && !confirmBlock.includes("targets[0]"),
  "Hộp thoại phải liệt kê theo orderedTargets, không dùng thứ tự bảng");

// Hạn chờ phát hành phải tách theo đường chạy: thuần API thì ngắn, phải mở giao
// diện thì giữ dài vì còn chuỗi polling Kendo.
assert.match(contentSource, /action === "issueEInvoice" \? issueTimeoutMs\(payload\)/,
  "issueEInvoice phải lấy hạn chờ theo payload");
assert.match(contentSource, /return payload\?\.knownItems\?\.length \? ISSUE_TIMEOUT_FAST_MS : ISSUE_TIMEOUT_UI_MS;/,
  "Có sẵn mặt hàng mới được dùng hạn chờ ngắn");
assert.match(contentSource, /ISSUE_TIMEOUT_UI_MS = 90000/, "Đường phải mở giao diện vẫn giữ 90s");
// Hạn chờ ngắn chỉ an toàn vì quá hạn KHÔNG kết luận là chưa phát hành:
// confirmIssuedAfterFailure đọc lại trạng thái thật từ server rồi mới ghi sổ.
assert.match(contentSource, /async function confirmIssuedAfterFailure\(row\)/,
  "Phải còn bước đọc lại trạng thái thật sau khi một phiếu báo lỗi");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
assert.match(bridgeSource, /HoaDonDienTu\/\$\{action\}/);
assert(bridgeSource.includes('postEInvoiceApi("kiemTraThongTin?is_ajax=1"'), "Missing kiemTraThongTin call");
assert(bridgeSource.includes('postEInvoiceApi("phatHanhHoaDon?is_ajax=1"'), "Missing phatHanhHoaDon call");
assert(bridgeSource.includes('detail.action === "issueEInvoice"'), "issueEInvoice not dispatched");
assert(bridgeSource.includes('detail.action === "fetchEInvoiceList"'), "fetchEInvoiceList not dispatched");

// phatHanhHoaDon gửi đúng tham số website của cơ sở đang mở gửi: giao diện mới
// (Nhơn 10/2026) phatHanhHoaDon(id, kyHieu) với kyHieu rỗng khi form tắt
// ChonKyHieu; giao diện cũ (Linh Đàm, đọc 05/10/2026) phatHanhHoaDon(id).
assert.match(bridgeSource, /postEInvoiceApi\("phatHanhHoaDon\?is_ajax=1", phatHanhHoaDonPayload\(id\)\)/,
  "phatHanhHoaDon phải gửi tham số theo hàm service của chính trang");
assert.match(bridgeSource, /const EINVOICE_DEFAULT_KY_HIEU = "";/);
{
  // Trang không nạp HoaDonDienTu_Service.
  const payloadBox = { window: {} };
  vm.createContext(payloadBox);
  vm.runInContext(`const EINVOICE_DEFAULT_KY_HIEU = "";\n${(() => {
    const text = bridgeSource.replace(/\r\n/g, "\n");
    const start = text.indexOf("function phatHanhHoaDonPayload(");
    return text.slice(start, text.indexOf("\n  }\n", start) + 4);
  })()}\nthis.payload = phatHanhHoaDonPayload;`, payloadBox);
  // Hàm service thật đọc trên hai trang (giữ nguyên tên tham số).
  const nhon = { phatHanhHoaDon: new Function("id", "kyHieu", "onFinish", "WebServiceBase.CallWebMethod(this, arguments, onFinish, null);") };
  const linhDam = { phatHanhHoaDon: new Function("id", "onFinish", "WebServiceBase.CallWebMethod(this, arguments, onFinish, null);") };
  assert.deepStrictEqual({ ...payloadBox.payload("id-1", nhon) }, { id: "id-1", kyHieu: "" }, "Nhơn: gửi kèm kyHieu rỗng");
  assert.deepStrictEqual({ ...payloadBox.payload("id-1", linhDam) }, { id: "id-1" }, "Linh Đàm: chỉ gửi id như website");
  // Trang không nạp service: giữ cách của giao diện mới.
  assert.deepStrictEqual({ ...payloadBox.payload("id-1", undefined) }, { id: "id-1", kyHieu: "" });
}
// LayDuLieu: đủ các ô lọc như source_ParameterMap của website. Loại mặc định Tất
// cả (0) cho màn Phát hành vì Check/Đồng bộ sổ cần cả phiếu đã phát hành; tìm phiếu
// để lập phương án truyền Chưa phát hành (2), dò hóa đơn đã xuất truyền 1.
const listFetch = bridgeSource.slice(
  bridgeSource.indexOf("async function fetchEInvoiceList"),
  bridgeSource.indexOf("async function readInvoiceItemsViaApi"));
for (const field of ["DXEID", "DNHANVIENID", "DKHACHHANGID", "DNHOMMATHANGID", "DKHOXUATID", "DHANGSANXUATID"]) {
  assert(listFetch.includes(`${field}: ""`), `LayDuLieu thiếu ô lọc ${field}`);
}
assert.match(listFetch, /const status = options\?\.status \?\? EINVOICE_STATUS_ALL;/);
assert.match(listFetch, /TRANGTHAI: status,/);
assert.match(bridgeSource, /const EINVOICE_STATUS_ALL = 0;/);
assert.match(bridgeSource, /const EINVOICE_STATUS_ISSUED = 1;/);
assert.match(bridgeSource, /const EINVOICE_STATUS_UNISSUED = 2;/);

// Mặt hàng đọc qua API màn hình Hóa đơn điện tử dùng cho lưới chi tiết:
// TDONHANG0Ae/LayDuLieuChiTiet { ID, STABLEDESCID = bảng Bán hàng }. Chỉ đọc.
const readViaApi = bridgeSource.slice(
  bridgeSource.indexOf("async function readInvoiceItemsViaApi"),
  bridgeSource.indexOf("async function readInvoiceItemsViaUi"));
assert.match(readViaApi, /"TDONHANG0Ae\/LayDuLieuChiTiet\?is_ajax=1"/);
assert.match(readViaApi, /\{ ID: recordId, STABLEDESCID: SALES_TABLE_ID \}/);
assert.match(readViaApi, /Number\(body\?\.code\) !== 1/, "code != 1 là lỗi, không coi là phiếu rỗng");
// API trước; mở phiếu qua giao diện chỉ là dự phòng khi API lỗi và trang mở
// phiếu theo ID được.
const readItems = bridgeSource.slice(
  bridgeSource.indexOf("async function readInvoiceItems("),
  bridgeSource.indexOf("function eInvoiceFailureReason"));
assert(readItems.indexOf("readInvoiceItemsViaApi") < readItems.indexOf("readInvoiceItemsViaUi"),
  "Phải thử API trước giao diện");
assert.match(readItems, /detail\?\.canReadItems === false \|\| !canOpenInvoiceById\(\)/);

// Đường dự phòng mở phiếu theo ID như website (openInvoiceById) rồi scan lưới
// Kendo, KHÔNG fetch HTML trang AddEdit để tìm dòng hàng.
assert.match(bridgeSource, /async function readInvoiceItemsViaUi/);
assert.match(bridgeSource, /await openInvoiceById\(detail\?\.id, wanted\);/);
assert.match(bridgeSource, /snapshot = scan\(\)/);
assert(!/AddEdit\?TableID=\$\{SALES_TABLE_ID\}/.test(bridgeSource),
  "Không được quay lại cách fetch HTML AddEdit để đọc dòng hàng");

// Ràng buộc "chưa xuất hóa đơn" của luồng lập phương án phải được giữ nguyên:
// chỉ mở ID đã thấy trong danh sách Chưa phát hành. Luồng chỉ-đọc gọi thẳng
// openInvoiceById chứ không nới lỏng ràng buộc này.
const openCandidate = bridgeSource.slice(
  bridgeSource.indexOf("async function openInvoiceCandidate"),
  bridgeSource.indexOf("async function openInvoiceById"));
assert.match(openCandidate, /const known = unissuedInvoiceIds\.get\(id\);/);
assert.match(openCandidate, /Chỉ được tự mở phiếu lấy từ danh sách "Chưa phát hành"/);

// Mở phiếu để đọc thì phải luôn đóng lại, kể cả khi đọc lỗi.
const readViaUi = bridgeSource.slice(
  bridgeSource.indexOf("async function readInvoiceItemsViaUi"),
  bridgeSource.indexOf("async function readInvoiceItems("));
assert.match(readViaUi, /finally\s*\{[\s\S]*closeInvoiceDetail\(\)/);
// Đọc nhầm phiếu khác thì phải dừng, không được ghi số liệu sai.
assert.match(readViaUi, /openedNo !== wanted/);

// Mặt hàng ưu tiên lấy từ sổ đối soát (đã kiểm tra khi trừ tồn) nên không phụ
// thuộc màn hình đang mở. Chỉ hóa đơn thiếu trong sổ mới phải đọc từ website.
assert.match(contentSource, /function ledgerItemsForInvoiceNo\(invoiceNo\)/);
assert.match(contentSource, /knownItems: ledgerItems \|\| null/);
const issueFlow = contentSource.slice(
  contentSource.indexOf("async function issueSelectedEInvoices"),
  contentSource.indexOf("async function exportIssuedInvoices"));
assert.match(issueFlow, /withoutLedger/);
// Phiếu thiếu trong sổ HOẶC sổ lệch web (bị sửa ngoài extension) đều phải đọc
// mặt hàng từ website.
assert.match(issueFlow, /const staleTargets = await checkLedgerFreshness\(/);
assert.match(issueFlow, /const needsWebItems = withoutLedger\.length \+ staleTargets\.length;/);
// Đọc qua API nên KHÔNG tự chuyển trang trước khi phát hành: rời màn hình giữa
// chừng làm lô hỏng (ở Paris Nhơn "Bán hàng" là sơ đồ phòng, không có danh sách).
assert(!issueFlow.includes("ensureInvoiceListScreen"),
  "Phát hành không được tự điều hướng sang danh sách Bán hàng");
assert.match(issueFlow, /needsWebItems\s*\?\s*await request\("hasInvoiceList"\)/);
assert.match(issueFlow, /const ledgerItems = stale \? null : ledgerItemsForInvoiceNo\(row\.invoiceNo\);/,
  "Sổ lệch web thì không được gửi mặt hàng của sổ cho bước phát hành");
assert.match(issueFlow, /resyncLedgerFromWebItems\(row\.invoiceNo, result\.items/,
  "Phát hành xong phiếu lệch sổ phải cập nhật sổ đối soát và tồn kho theo web");

// Bridge phải dùng knownItems trước, chỉ đọc lại khi không có.
const issueBridge = bridgeSource.slice(
  bridgeSource.indexOf("async function issueEInvoice"),
  bridgeSource.indexOf("async function saveCurrentInvoiceViaApi"));
assert.match(issueBridge, /Array\.isArray\(detail\?\.knownItems\)/);
assert.match(issueBridge, /if \(!items\.length\)/);
assert.match(issueBridge, /items = await readInvoiceItems\(detail\);/);

// Phản hồi phát hành thành công thật từ website: Tag là CHUỖI HTML để đổ vào
// hộp thoại, không phải object. Trích xuất theo nhãn phải ra đủ 5 trường.
function evalBridgeFunction(...names) {
  const scope = {};
  for (const name of names) {
    const start = bridgeSource.indexOf(`function ${name}`);
    assert(start >= 0, `Không tìm thấy ${name} trong bridge.js`);
    let depth = 0;
    for (let index = start; index < bridgeSource.length; index += 1) {
      if (bridgeSource[index] === "{") depth += 1;
      else if (bridgeSource[index] === "}" && --depth === 0) {
        scope[name] = bridgeSource.slice(start, index + 1);
        break;
      }
    }
  }
  return new Function(`${Object.values(scope).join("\n")}\nreturn { ${names.join(", ")} };`)();
}

const { parseIssuedInvoiceTagHtml } = evalBridgeFunction("normalizedVietnameseText", "parseIssuedInvoiceTagHtml");
const realTag = "Số HĐ: 2036</br>Mã CQT: M1-26-IYKKX-00000003946</br>Ký hiệu: 1C26MVN</br>" +
  "Mã tra cứu: F8AB4E204A0D2CF9</br>Link tra cứu: https://tracuuhoadon.minvoice.com.vn</br>";
const parsedTag = parseIssuedInvoiceTagHtml(realTag);
assert.strictEqual(parsedTag.SOHOADON, "2036");
assert.strictEqual(parsedTag.MACQTHUE, "M1-26-IYKKX-00000003946");
assert.strictEqual(parsedTag.SOKYHIEU, "1C26MVN");
assert.strictEqual(parsedTag.MATRACUU, "F8AB4E204A0D2CF9");
// Link bị cắt ở dấu ":" đầu tiên nên phải lấy lại nguyên URL.
assert.strictEqual(parsedTag.LINKTRACUU, "https://tracuuhoadon.minvoice.com.vn");

// Đổi thứ tự dòng và dùng <br> thay </br> vẫn phải đọc đúng.
const reordered = parseIssuedInvoiceTagHtml("Ký hiệu: 1C26MVN<br>Số HĐ: 77<br>Mã CQT: M1-X");
assert.strictEqual(reordered.SOHOADON, "77");
assert.strictEqual(reordered.SOKYHIEU, "1C26MVN");
assert.strictEqual(reordered.MACQTHUE, "M1-X");

// Tag rỗng/không đúng dạng không được ném lỗi, để luồng phát hành rơi về bước
// đọc lại danh sách thay vì báo thành công mơ hồ.
assert.strictEqual(parseIssuedInvoiceTagHtml("").SOHOADON, "");
assert.strictEqual(parseIssuedInvoiceTagHtml(null).SOHOADON, "");

const { parseEInvoiceCheckTagHtml } = evalBridgeFunction("normalizedVietnameseText", "parseEInvoiceCheckTagHtml");
const checkedMetadata = parseEInvoiceCheckTagHtml(
  "Người mua: Khách lẻ - Không lấy hóa đơn</br>Địa chỉ: Khách không cung cấp thông tin</br>Thanh toán: TM/CK</br>"
);
assert.strictEqual(checkedMetadata.buyer, "Khách lẻ - Không lấy hóa đơn");
assert.strictEqual(checkedMetadata.address, "Khách không cung cấp thông tin");
assert.strictEqual(checkedMetadata.paymentMethod, "TM/CK");

// Tag dạng chuỗi phải được nhận diện trước khi đọc INVOICEDATA.
assert.match(bridgeSource, /typeof rawTag === "string"[\s\S]{0,80}parseIssuedInvoiceTagHtml/);

// kiemTraThongTin thật: cùng dạng code/message, Tag là HTML xem trước thông tin
// người mua. Khách lẻ để trống toàn bộ trường vẫn là hợp lệ (code 1) và KHÔNG
// được chặn — nếu chặn thì mọi hóa đơn khách lẻ đều không phát hành được.
const { eInvoiceFailureReason } = evalBridgeFunction("eInvoiceFailureReason");
const realCheckBody = {
  code: 1, message: null, strData: null,
  Tag: "Người mua: </br>Đơn vị: </br>Địa chỉ: </br>Điện thoại: </br>Mã số thuế: </br>" +
    "Ngân hàng: </br>Số tài khoản: </br>Thanh toán: TM</br>",
  Tag2: null, decData: 0.0, tableData: null
};
assert.strictEqual(eInvoiceFailureReason(realCheckBody, ""), "",
  "kiemTraThongTin code=1 phải đi tiếp, kể cả khi thông tin người mua để trống");

// Các dạng từ chối phải nêu đúng lý do của server.
assert.strictEqual(
  eInvoiceFailureReason({ code: 0, message: "Hóa đơn đã được phát hành" }, ""),
  "Hóa đơn đã được phát hành");
assert.strictEqual(eInvoiceFailureReason({ code: 0, message: null, strData: "Chữ ký số hết hạn" }, ""),
  "Chữ ký số hết hạn");
assert.match(eInvoiceFailureReason({ code: -1 }, ""), /code -1/);
assert.match(eInvoiceFailureReason(null, "<html>timeout</html>"), /khong doc duoc/);

// Bridge (MAIN world) trả kết quả về content script (isolated world) qua
// CustomEvent nên detail bị structured-clone. Giá trị không clone được làm
// dispatchEvent NÉM -> trước đây lỗi đó xảy ra ngay trong khối try nên không có
// phản hồi nào và bảng điều khiển treo mãi ở "đang phát hành".
const { plainClone } = evalBridgeFunction("plainClone");
const kendoLikeRow = { code: "1000010", qty: 2, set() {}, parent() {} };
assert.throws(() => structuredClone({ items: [kendoLikeRow] }), /could not be cloned|DataCloneError/);
const cleaned = plainClone({ items: [kendoLikeRow], httpStatus: 200 });
assert.deepStrictEqual(cleaned, { items: [{ code: "1000010", qty: 2 }], httpStatus: 200 });
structuredClone(cleaned); // không được ném
// Cấu trúc vòng phải trả null thay vì treo, để còn gửi được thông báo lỗi.
const circular = { a: 1 };
circular.self = circular;
assert.strictEqual(plainClone(circular), null);
assert.strictEqual(plainClone("text"), "text");
assert.strictEqual(plainClone(null), null);

// Mọi phản hồi phải đi qua respond(); dispatch không được nằm trong khối try
// của handler, và luôn có nhánh dự phòng khi vẫn không gửi được.
assert.match(bridgeSource, /function respond\(payload\)/);
// Trả lời theo mã yêu cầu (requestId), không theo detail.id mà ID phiếu có thể đè
// (xem test-request-bus.js).
assert.match(bridgeSource, /const replyId = detail\.requestId \|\| detail\.id;/);
assert.match(bridgeSource, /respond\(\{ id: replyId, ok: true, result \}\)/);
assert.match(bridgeSource, /respond\(\{ id: replyId, ok: false/);
const respondFn = bridgeSource.slice(bridgeSource.indexOf("function respond(payload)"));
assert.match(respondFn.slice(0, 900), /catch \(error\)[\s\S]{0,300}dispatchEvent/,
  "respond phải có nhánh dự phòng khi dispatchEvent thất bại");

// Mất phản hồi không đồng nghĩa chưa phát hành: phải đọc lại trạng thái thật.
assert.match(contentSource, /async function confirmIssuedAfterFailure\(row\)/);
assert.match(issueFlow, /confirmIssuedAfterFailure\(row\)/);
assert.match(issueFlow, /ĐÃ phát hành/);
// Nút phải luôn được mở khóa lại.
assert.match(issueFlow, /finally\s*\{[\s\S]{0,200}issuingInProgress = false/);

// Chỉ hiện hóa đơn thuộc danh sách giao dịch; phiếu ngoài giao dịch phải chủ
// động bật mới thấy và phải được nêu rõ trong hộp thoại xác nhận.
function evalContentFunction(...names) {
  const parts = names.map(name => {
    const start = contentSource.indexOf(`function ${name}`);
    assert(start >= 0, `Không tìm thấy ${name} trong content.js`);
    let depth = 0;
    for (let index = start; index < contentSource.length; index += 1) {
      if (contentSource[index] === "{") depth += 1;
      else if (contentSource[index] === "}" && --depth === 0) {
        return contentSource.slice(start, index + 1);
      }
    }
    return "";
  });
  // lookupIndex là state cache ở cấp module của content.js; cấp cho đoạn eval
  // một bản rỗng để hàm dựng index chạy được ngoài ngữ cảnh content script.
  return new Function("statementDataset",
    `const lookupIndex = { ledgerSource: null, ledger: null, catalogSource: null, catalog: null, statementSource: null, statement: null };\n` +
    `${parts.join("\n")}\nreturn { ${names.join(", ")} };`);
}

// statementInvoiceNos đọc qua index dựng lười, nên phải nạp kèm hàm dựng index.
const linkage = evalContentFunction("statementTransactionIndex", "statementInvoiceNos", "isStatementInvoice")({
  transactions: [
    { id: 1, invoiceNo: "HD0126060001" },
    { id: 2, invoiceNo: "", pendingPlan: { invoiceNo: "HD0126060002" } },
    { id: 3, invoiceNo: "", batchApprovedPlan: { invoiceNo: "HD0126060003" } },
    { id: 4, invoiceNo: "" }
  ]
});
const linkedNos = linkage.statementInvoiceNos();
assert.strictEqual(linkedNos.size, 3, "Phải gom số phiếu từ cả 3 nguồn liên kết");
assert.strictEqual(linkage.isStatementInvoice({ invoiceNo: "HD0126060002" }, linkedNos), true);
assert.strictEqual(linkage.isStatementInvoice({ invoiceNo: "HD0126060005" }, linkedNos), false);
assert.strictEqual(linkage.isStatementInvoice({ invoiceNo: "" }, linkedNos), false);

assert.match(contentSource, /showEInvoicesOutsideStatement\s*\?\s*eInvoiceRows\s*:\s*eInvoiceRows\.filter/);
assert(contentSource.includes('id="it-einvoice-show-outside"'), "Thiếu ô bật xem phiếu ngoài giao dịch");
// Chỉ được chọn trong số dòng đang hiện, tránh phát hành nhầm dòng đã bị ẩn.
assert.match(contentSource, /const selectable = new Set\(\s*visibleRows\s*\.filter/);
// Đối chiếu được tính một lần cho mỗi dòng rồi tra lại qua matchByRowId, nhưng
// điều kiện chọn vẫn phải là: chưa phát hành, chưa hủy, và khớp sao kê.
assert.match(contentSource, /!row\.issued && !row\.cancelled && matchByRowId\.get\(row\.id\)\.valid/,
  "Chỉ phiếu khớp mã, ngày và tổng tiền sao kê mới được chọn phát hành");
assert.match(contentSource, /const matchByRowId = new Map\(visibleRows\.map\(row => \[row\.id, statementInvoiceMatch\(row\)\]\)\)/,
  "matchByRowId phải được dựng từ chính statementInvoiceMatch cho mọi dòng đang hiện");
assert.match(issueFlow, /KHÔNG thuộc danh sách giao dịch/);

// Hóa đơn đã phát hành trên website nhưng chưa vào sổ hạch toán phải ghi bổ sung
// được (phát hành tay, hoặc lần trước mất phản hồi).
assert.match(contentSource, /async function syncIssuedInvoices\(\)/);
assert(contentSource.includes('id="it-sync-issued"'), "Thiếu nút đồng bộ hóa đơn đã phát hành");

// Dòng thật của LayDuLieuChiTiet (Paris Nhơn 04/10/2026). Tiền giờ không nằm ở
// đây; số lượng/giá là số, mã giữ nguyên số 0 đứng đầu.
const { eInvoiceDetailItem } = evalBridgeFunction("eInvoiceDetailItem");
assert.deepStrictEqual(eInvoiceDetailItem({
  DMATHANG_CODE: "0000045", DMATHANG_NAME: "Bia Tiger lon", SOLUONG: 17, DDONVITINH_NAME: "Lon",
  DONGIA: 50000, TILEGIAMGIA: 0, TIENGIAMGIA: 0, THANHTIEN: 850000, NOTE: "", KHUYENMAI: 0
}), { code: "0000045", name: "Bia Tiger lon", unit: "Lon", qty: 17, price: 50000, amount: 850000 });
assert.deepStrictEqual(eInvoiceDetailItem({ DMATHANG_CODE: " 0000014 ", SOLUONG: "4", DONGIA: "5000.00" }),
  { code: "0000014", name: "", unit: "", qty: 4, price: 5000, amount: 20000 });

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
assert(manifest.content_scripts.some(script => (script.js || []).includes("issued-invoices.js")),
  "issued-invoices.js chưa được nạp trong manifest");

console.log("Issued invoice book + phát hành hóa đơn: OK");
