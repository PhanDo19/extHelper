const fs = require("fs");
const vm = require("vm");
const path = require("path");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

function extractFunction(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Không tìm thấy ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Không đọc hết ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  `${extractFunction("verifySaveResponse")}; this.verifySaveResponse = verifySaveResponse;`,
  sandbox
);

const RECORD_ID = "79e29d2e-cc7a-4e46-921c-06a1e3b1b455";
const successBody = JSON.stringify({
  code: 1,
  message: null,
  strData: null,
  Tag: {
    detail: {},
    ID: RECORD_ID,
    LASTSAVEID: "5ecca06d-6a5c-4e24-b622-3f0857053871"
  },
  Tag2: null,
  decData: 0.0,
  tableData: null
});

const expectThrow = (label, run, expectedFragment) => {
  let thrown = null;
  try { run(); } catch (error) { thrown = error; }
  if (!thrown) throw new Error(`${label}: đáng lẽ phải chặn nhưng lại cho qua.`);
  if (expectedFragment && !thrown.message.includes(expectedFragment)) {
    throw new Error(`${label}: thông báo lỗi không nêu đúng lý do — ${thrown.message}`);
  }
};

// Response thành công thật của website phải được chấp nhận.
const ok = sandbox.verifySaveResponse(successBody, RECORD_ID);
if (ok.savedRecordId !== RECORD_ID) throw new Error("Phải trả về ID phiếu đã lưu từ Tag.ID.");
if (ok.lastSaveId !== "5ecca06d-6a5c-4e24-b622-3f0857053871") {
  throw new Error("Phải trả về LASTSAVEID để đối chiếu sau này.");
}
// So khớp ID không phân biệt hoa thường vì GUID có thể trả về khác kiểu chữ.
if (sandbox.verifySaveResponse(successBody, RECORD_ID.toUpperCase()).savedRecordId !== RECORD_ID) {
  throw new Error("So khớp ID phiếu phải bỏ qua hoa/thường.");
}
// Không truyền ID kỳ vọng thì vẫn chấp nhận, chỉ cần code = 1 và có Tag.ID.
if (sandbox.verifySaveResponse(successBody, "").savedRecordId !== RECORD_ID) {
  throw new Error("Thiếu ID kỳ vọng thì vẫn phải chấp nhận response thành công.");
}

// HTTP 200 kèm code khác 1 là website từ chối — phải chặn, kèm message gốc.
expectThrow(
  "code khác 1",
  () => sandbox.verifySaveResponse(
    JSON.stringify({ code: 0, message: "Phiếu đã bị khóa", Tag: null }),
    RECORD_ID
  ),
  "Phiếu đã bị khóa"
);
expectThrow(
  "code khác 1 không có message",
  () => sandbox.verifySaveResponse(JSON.stringify({ code: -1, message: null, Tag: null }), RECORD_ID),
  "code -1"
);
expectThrow(
  "LASTSAVEID cũ",
  () => sandbox.verifySaveResponse(
    JSON.stringify({ code: 0, message: "HÓA ĐƠN ĐÃ THAY ĐỔI VUI LÒNG THỰC HIỆN LẠI", Tag: "9999" }),
    RECORD_ID
  ),
  "LASTSAVEID da cu"
);
// Một số lỗi trả mô tả trong strData thay vì message.
expectThrow(
  "lỗi nằm trong strData",
  () => sandbox.verifySaveResponse(
    JSON.stringify({ code: 0, message: null, strData: "Hết tồn kho", Tag: null }),
    RECORD_ID
  ),
  "Hết tồn kho"
);
// Báo thành công nhưng không có ID thì không được coi là đã ghi.
expectThrow(
  "thiếu Tag.ID",
  () => sandbox.verifySaveResponse(JSON.stringify({ code: 1, Tag: { LASTSAVEID: "x" } }), RECORD_ID),
  "khong tra ve ID"
);
// Ghi nhầm sang phiếu khác là lỗi nặng nhất, phải chặn.
expectThrow(
  "lưu nhầm phiếu",
  () => sandbox.verifySaveResponse(
    JSON.stringify({ code: 1, Tag: { ID: "11111111-2222-3333-4444-555555555555" } }),
    RECORD_ID
  ),
  "luu nham phieu"
);
// Session hết hạn thường trả HTML đăng nhập với HTTP 200.
expectThrow(
  "body không phải JSON",
  () => sandbox.verifySaveResponse("<html><body>Login</body></html>", RECORD_ID),
  "khong doc duoc"
);
expectThrow("body rỗng", () => sandbox.verifySaveResponse("", RECORD_ID), "khong doc duoc");

console.log("API save response verification: OK");
