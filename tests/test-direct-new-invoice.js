// Tạo phiếu mới không cần tab Bán hàng phụ (đọc form phòng bằng API) và chặn
// lập phiếu ở quầy BÁN LẺ (không lập được HĐĐT).
const fs = require("fs");
const vm = require("vm");
const path = require("path");
const assert = require("assert");

const bridgeSource = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");
const contentSource = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const paramsStart = source.indexOf("(", start);
  let parenDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") parenDepth += 1;
    if (source[index] === ")") parenDepth -= 1;
    if (parenDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

// Hàm top-level (thụt 2 dấu cách) kết thúc ở dòng "  }" đầu tiên. Dùng cho hàm
// có chuỗi chứa dấu ngoặc nhọn, nơi cách đếm ngoặc bị lệch.
function extractTopLevelFunction(source, name) {
  const text = source.replace(/\r\n/g, "\n");
  let start = text.indexOf(`\n  async function ${name}(`);
  if (start < 0) start = text.indexOf(`\n  function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const end = text.indexOf("\n  }\n", start);
  return text.slice(start + 1, end + 4);
}

function extractConst(source, name) {
  const match = new RegExp(`const ${name} = [^;]+;`).exec(source);
  if (!match) throw new Error(`Không tìm thấy hằng ${name}`);
  return match[0];
}

const SALES_TABLE_ID = /const SALES_TABLE_ID = "([^"]+)"/.exec(bridgeSource)[1];
const ROOM_ID = "11111111-2222-3333-4444-555555555555";
const AREA_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const WAREHOUSE_ID = "99999999-8888-7777-6666-555555555555";
const OTHER_ROOM_ID = "12121212-3434-5656-7878-909090909090";
const RUNNING_ID = "abababab-cdcd-efef-0101-232323232323";

// HTML giống form website trả về: có script khởi tạo form với DataTransferJs.
function roomFormHtml({ roomId = ROOM_ID, recordId = "", warehouseId = WAREHOUSE_ID } = {}) {
  const formData = {
    _AddEditTableID: SALES_TABLE_ID,
    _RecordID: recordId,
    mapper: {
      ID: recordId,
      Maps: [
        { Field: "DBANID", Value: roomId },
        { Field: "DKHUVUCID", Value: AREA_ID },
        { Field: "DKHOXUATID", Value: warehouseId },
        // Chuỗi có dấu ngoặc bên trong không được làm lệch bộ đọc JSON.
        { Field: "GHICHU", Value: "Phòng {VIP} \"mới\"" }
      ]
    }
  };
  return `<div class="dialog"><script>
    var client = new AddEdit_JsClient("frm");
    var data = new DataTransferJs(${JSON.stringify(formData)});
  </script></div>`;
}

function makeBridge(responder, roomMapRooms = []) {
  const calls = [];
  const box = {
    location: { origin: "https://banhang.example", pathname: "/parisnhon/BanHang" },
    URLSearchParams,
    calls,
    window: {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return responder(url, init);
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(
    `const SALES_TABLE_ID = ${JSON.stringify(SALES_TABLE_ID)};\n` +
    `let roomMapCapture = ${JSON.stringify({ rooms: roomMapRooms })};\n` +
    `${extractConst(bridgeSource, "FORM_DATA_MARKER")}\n` +
    [
      "shopBasePath", "extractJsonObject", "isGuid", "formDataRecordId", "mapObject", "isLoginRedirect",
      "roomTextKey", "isRetailRoomText", "mappedRoomById", "assertNotRetailRoom",
      "salesFormDataFromHtml", "formUnavailableError", "loadBlankRoomForm", "probeBlankRoomForm"
    ].map(name => extractTopLevelFunction(bridgeSource, name)).join("\n") +
    "\nthis.loadBlankRoomForm = loadBlankRoomForm; this.probeBlankRoomForm = probeBlankRoomForm;" +
    "\nthis.isRetailRoomText = isRetailRoomText; this.assertNotRetailRoom = assertNotRetailRoom;",
    box
  );
  return box;
}

const htmlResponse = (html, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  url: "https://banhang.example/parisnhon/AddEdit",
  text: async () => html
});

const vip21 = { id: ROOM_ID, areaId: AREA_ID, name: "VIP 21", areaName: "TẦNG 2", counter: 0 };

(async () => {
  // --- Bridge: đọc form phòng bằng API --------------------------------------
  const ok = makeBridge(() => htmlResponse(roomFormHtml()));
  const loaded = await ok.loadBlankRoomForm(vip21);
  assert.strictEqual(loaded.roomName, "VIP 21");
  assert.strictEqual(loaded.fieldCount, 4);
  const requested = new URL(ok.calls[0].url);
  assert.strictEqual(requested.pathname, "/parisnhon/AddEdit", "Phải gọi AddEdit của đúng cơ sở");
  assert.strictEqual(requested.searchParams.get("RecordID"), "", "RecordID rỗng: chỉ dựng form, không tạo bản ghi");
  assert.strictEqual(requested.searchParams.get("DBANID"), ROOM_ID);
  assert.strictEqual(requested.searchParams.get("DKHUVUCID"), AREA_ID);
  assert.strictEqual(requested.searchParams.get("TableID"), SALES_TABLE_ID);
  assert.strictEqual(ok.calls[0].init.method, "GET", "Đọc form chỉ được dùng GET");
  const probe = await ok.probeBlankRoomForm(vip21);
  assert.strictEqual(probe.recordIdBlank, true);
  assert.strictEqual(probe.warehouseId, WAREHOUSE_ID);

  // HTML không có form của đúng phòng → formUnavailable (được quay về tab phụ).
  const wrongRoom = makeBridge(() => htmlResponse(roomFormHtml({ roomId: OTHER_ROOM_ID })));
  await assert.rejects(wrongRoom.loadBlankRoomForm(vip21), error => error.formUnavailable === true);
  const noScript = makeBridge(() => htmlResponse("<div>Không có form</div>"));
  await assert.rejects(noScript.loadBlankRoomForm(vip21), error => error.formUnavailable === true);
  const httpError = makeBridge(() => htmlResponse("", 500));
  await assert.rejects(httpError.loadBlankRoomForm(vip21), error => error.formUnavailable === true);
  const network = makeBridge(() => { throw new Error("Failed to fetch"); });
  await assert.rejects(network.loadBlankRoomForm(vip21), error => error.formUnavailable === true);

  // Phòng đang có phiên chạy (form trả về đã có ID) → dừng, KHÔNG quay về tab
  // phụ: tạo phiếu lúc này là ghi đè phiếu của khách đang hát.
  const running = makeBridge(() => htmlResponse(roomFormHtml({ recordId: RUNNING_ID })));
  await assert.rejects(running.loadBlankRoomForm(vip21),
    error => /đang có phiên chạy/.test(error.message) && !error.formUnavailable);

  // Mất phiên đăng nhập → dừng hẳn, không quay về tab phụ.
  const login = makeBridge(() => ({
    ok: true, status: 200, url: "https://banhang.example/Account/Login", text: async () => "<form id='login'>"
  }));
  await assert.rejects(login.loadBlankRoomForm(vip21),
    error => /Phiên đăng nhập/.test(error.message) && !error.formUnavailable);

  // --- Bridge: không bao giờ tạo phiếu ở quầy BÁN LẺ ------------------------
  for (const name of ["BÁN LẺ", "BAN LE", "Bán lẻ 2", "KHU BÁN LẺ"]) {
    assert(ok.isRetailRoomText(name), `"${name}" là quầy bán lẻ`);
  }
  for (const name of ["VIP 21", "BANLE", "BAN LED", ""]) {
    assert(!ok.isRetailRoomText(name), `"${name}" không phải quầy bán lẻ`);
  }
  const retailCalls = makeBridge(() => htmlResponse(roomFormHtml()));
  for (const retailRoom of [
    { ...vip21, name: "BAN LE" },
    { ...vip21, areaName: "BÁN LẺ" },
    { ...vip21, counter: 1 }
  ]) {
    await assert.rejects(retailCalls.loadBlankRoomForm(retailRoom), /quầy BÁN LẺ/);
  }
  assert.strictEqual(retailCalls.calls.length, 0, "Phòng bán lẻ phải bị chặn trước khi gửi bất kỳ request nào");
  // Phiếu có sẵn / form đang mở: tra cờ quầy theo DBANID trong sơ đồ phòng.
  const mapped = makeBridge(() => htmlResponse(""), [{ id: ROOM_ID, name: "Quầy 1", areaName: "Sảnh", counter: 1 }]);
  assert.throws(() => mapped.assertNotRetailRoom({ roomId: ROOM_ID, roomName: "Quầy 1" }), /quầy BÁN LẺ/);
  assert.doesNotThrow(() => mapped.assertNotRetailRoom({ roomId: OTHER_ROOM_ID, roomName: "VIP 22" }));

  // Mọi đường ghi phiếu đều qua chốt bán lẻ.
  assert(extractFunction(bridgeSource, "postFreshInvoiceTwoStep").includes("assertNotRetailRoom({ roomId, roomName: roomLabel })"));
  assert(extractFunction(bridgeSource, "saveExistingInvoicePlanViaApi").includes("assertNotRetailRoom("));

  // Lỗi đọc form được gắn nhãn chưa-gửi + form-phòng để content quay về tab phụ.
  const wrapper = extractFunction(bridgeSource, "createAndPayFreshInvoiceViaApi");
  assert(wrapper.includes("expected?.room ? await loadBlankRoomForm(expected.room) : null"));
  assert(wrapper.includes("error?.formUnavailable ? NEW_INVOICE_FORM_UNAVAILABLE_TAG"));

  // --- Content: chọn luồng và quay về tab phụ -------------------------------
  const events = [];
  const flowBox = {
    DIRECT_NEW_INVOICE_ENABLED: true,
    directResult: null,
    events,
    setStatus: message => events.push(`status:${message.slice(0, 30)}`),
    saveNewBatchEntryDirect: async () => { events.push("direct"); return flowBox.directResult; },
    saveNewBatchEntryViaWorker: async () => { events.push("worker"); return { invoiceNo: "W1" }; }
  };
  vm.createContext(flowBox);
  vm.runInContext(`${extractFunction(contentSource, "saveNewBatchEntry")}; this.run = saveNewBatchEntry;`, flowBox);
  flowBox.directResult = { invoiceNo: "D1" };
  assert.strictEqual((await flowBox.run(0)).invoiceNo, "D1");
  assert.deepStrictEqual(events, ["direct"], "Luồng mới thành công thì không mở tab phụ");
  events.length = 0;
  flowBox.directResult = null;
  assert.strictEqual((await flowBox.run(0)).invoiceNo, "W1");
  assert(events[0] === "direct" && events[events.length - 1] === "worker",
    "Không đọc được form thì quay về tab phụ");
  events.length = 0;
  flowBox.DIRECT_NEW_INVOICE_ENABLED = false;
  await flowBox.run(0);
  assert.deepStrictEqual(events, ["worker"], "Tắt cờ thì đi thẳng tab phụ");

  // Luồng mới: chọn phòng từ sơ đồ (loại bán lẻ, đúng đơn giá), gửi kèm `room`,
  // lỗi không đọc được form thì trả null (chưa gửi gì) còn lỗi khác thì ném.
  const directSource = extractFunction(contentSource, "saveNewBatchEntryDirect");
  assert(directSource.includes("rankIdleRoomsFromMap(roomMap.rooms, bookings, plan.checkIn, plan.checkOut, plannedRate)"));
  assert(directSource.includes("submitNewInvoiceViaApi(transaction, plan, room)"));
  assert(/if \(error\?\.formUnavailable\) \{[\s\S]*?return null;/.test(directSource));
  assert(directSource.includes("verifyBatchSavedInvoice("), "Luồng mới phải đối soát ngay trên tab danh sách");
  const runAll = extractFunction(contentSource, "runAcceptedBatchApi");
  assert(runAll.includes("await saveNewBatchEntry(index)") && !runAll.includes("saveNewBatchEntryViaWorker"),
    "Lưu API hàng loạt phải ưu tiên luồng không cần tab phụ");

  // Lệnh ghi không được hết giờ sau 5 giây trong khi bridge vẫn đang gửi.
  const requestSource = extractFunction(contentSource, "request");
  assert(/\["createAndPayFreshInvoiceViaApi", "saveExistingInvoicePlanViaApi"\]\.includes\(action\) \? 90000/.test(requestSource));

  console.log("Tạo phiếu mới không cần tab phụ và chặn quầy BÁN LẺ: OK");
})().catch(error => {
  console.error(error);
  process.exit(1);
});
