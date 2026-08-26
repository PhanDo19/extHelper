const assert = require("assert");
const path = require("path");
const fs = require("fs");
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
assert(contentSource.includes('function openEInvoiceAdmin()'),
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
assert.match(contentSource, /present: await ensureInvoiceListScreen\(\)/);
assert.match(contentSource, /Chưa mở được danh sách Bán hàng để đọc mặt hàng/);
assert.match(contentSource, /function exportIssuedInvoices\(\)/);
assert.match(contentSource, /function renderEInvoiceRows\(\)/);
// Ghi sổ ngay sau từng hóa đơn để lô dừng giữa chừng vẫn có số liệu.
assert.match(contentSource, /saveIssuedInvoices\(issuedInvoiceBook\)/);
// Lô phát hành tách hai giai đoạn NỐI TIẾP: nhóm có sẵn mặt hàng chạy thuần API
// nên song song được, nhóm thiếu mặt hàng phải mở/đóng form trên danh sách Bán
// hàng nên bắt buộc tuần tự. Hai nhóm không được chồng lấn, nếu không sẽ có
// luồng chạm vào DOM trong khi luồng khác đang mở phiếu và đọc nhầm số liệu.
const issueRunner = contentSource.slice(
  contentSource.indexOf("const apiOnly = targets.filter"),
  contentSource.indexOf("} finally {", contentSource.indexOf("const apiOnly = targets.filter"))
);
assert(issueRunner, "Không tìm thấy phần chạy lô phát hành");
assert.match(issueRunner, /const apiOnly = targets\.filter\(row => Boolean\(ledgerItemsForInvoiceNo\(row\.invoiceNo\)\)\)/,
  "Nhóm chạy song song chỉ gồm phiếu đã có sẵn mặt hàng trong sổ đối soát");
assert.match(issueRunner, /const needsUi = targets\.filter\(row => !ledgerItemsForInvoiceNo\(row\.invoiceNo\)\)/,
  "Nhóm phải mở giao diện là phần còn lại");
// Song song chỉ áp cho apiOnly, và trần vẫn là 2 luồng.
assert.match(issueRunner, /Math\.min\(2, apiOnly\.length\)/,
  "Chỉ nhóm thuần API mới chạy song song, tối đa 2 luồng");
// needsUi phải nằm sau Promise.all, tức giai đoạn 2 chỉ bắt đầu khi giai đoạn 1 xong.
assert(issueRunner.indexOf("Promise.all") < issueRunner.indexOf("for (const row of needsUi)"),
  "Giai đoạn mở giao diện phải chạy sau khi nhóm song song kết thúc");
// Từ chỗ needsUi bắt đầu chạy trở đi không được còn Promise.all nào.
const needsUiPhase = issueRunner.slice(issueRunner.indexOf("for (const row of needsUi)"));
assert(!needsUiPhase.includes("Promise.all"),
  "Nhóm phải mở giao diện không được chạy song song");
assert.match(issueRunner, /for \(const row of needsUi\) await processTarget\(row\);/,
  "Nhóm phải mở giao diện chạy tuần tự từng phiếu");

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

// Đọc mặt hàng phải đi qua đúng đường extension đã dùng để mở phiếu (nhấp đúp
// trên danh sách Bán hàng rồi scan lưới Kendo), KHÔNG fetch HTML trang AddEdit —
// trang đó được dựng bằng script client nên HTML thô không có sẵn dòng hàng.
assert.match(bridgeSource, /async function readInvoiceItemsViaUi/);
assert.match(bridgeSource, /openInvoiceRowForReading\(found\.row/);
assert.match(bridgeSource, /snapshot = scan\(\)/);
assert(!/AddEdit\?TableID=\$\{SALES_TABLE_ID\}/.test(bridgeSource),
  "Không được quay lại cách fetch HTML AddEdit để đọc dòng hàng");

// Ràng buộc "Chưa xuất hóa đơn" của luồng lập phương án phải được giữ nguyên;
// luồng chỉ-đọc dùng hàm tách riêng chứ không nới lỏng ràng buộc này.
const openCandidate = bridgeSource.slice(
  bridgeSource.indexOf("async function openInvoiceCandidate"),
  bridgeSource.indexOf("async function openInvoiceRowForReading"));
assert.match(openCandidate, /Chưa xuất hóa đơn/);
assert.match(openCandidate, /Chỉ được tự mở khi bộ lọc/);

// Mở phiếu để đọc thì phải luôn đóng lại, kể cả khi đọc lỗi.
const readViaUi = bridgeSource.slice(
  bridgeSource.indexOf("async function readInvoiceItemsViaUi"),
  bridgeSource.indexOf("async function readInvoiceItems("));
assert.match(readViaUi, /finally\s*\{[\s\S]*closeInvoiceDetail\(\)/);
// Đọc nhầm phiếu khác thì phải dừng, không được ghi số liệu sai.
assert.match(readViaUi, /openedNo !== wanted/);

// Mặt hàng ưu tiên lấy từ sổ đối soát (đã kiểm tra khi trừ tồn) nên không phụ
// thuộc màn hình đang mở. Chỉ hóa đơn thiếu trong sổ mới phải mở lại phiếu.
assert.match(contentSource, /function ledgerItemsForInvoiceNo\(invoiceNo\)/);
assert.match(contentSource, /knownItems: ledgerItems \|\| null/);
// Không được gọi bridge phát hành từ màn hình Mặt hàng. Với hóa đơn thiếu trong
// sổ, content script phải tự chuyển về danh sách Bán hàng trước khi chạy lô.
const issueFlow = contentSource.slice(
  contentSource.indexOf("async function issueSelectedEInvoices"),
  contentSource.indexOf("async function exportIssuedInvoices"));
assert.match(issueFlow, /withoutLedger/);
assert.match(issueFlow, /withoutLedger\.length\s*\?\s*\{ present: await ensureInvoiceListScreen\(\) \}/);
assert.match(issueFlow, /withoutLedger\.length && !listReady\.present/);

// Bridge phải dùng knownItems trước, chỉ đọc lại khi không có.
const issueBridge = bridgeSource.slice(
  bridgeSource.indexOf("async function issueEInvoice"),
  bridgeSource.indexOf("async function saveCurrentInvoiceViaApi"));
assert.match(issueBridge, /Array\.isArray\(detail\?\.knownItems\)/);
assert.match(issueBridge, /if \(!items\.length\)/);
assert.match(issueBridge, /detail\?\.canReadItems === false/);

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
assert.match(bridgeSource, /respond\(\{ id: detail\.id, ok: true, result \}\)/);
assert.match(bridgeSource, /respond\(\{ id: detail\.id, ok: false/);
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

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
assert(manifest.content_scripts.some(script => (script.js || []).includes("issued-invoices.js")),
  "issued-invoices.js chưa được nạp trong manifest");

console.log("Issued invoice book + phát hành hóa đơn: OK");
