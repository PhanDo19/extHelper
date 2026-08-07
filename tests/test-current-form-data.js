const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "bridge.js"), "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
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

const SALES_TABLE_ID = source.match(/const SALES_TABLE_ID = "([^"]+)";/)?.[1];
if (!SALES_TABLE_ID) throw new Error("Không đọc được SALES_TABLE_ID.");

const activeId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const staleId = "11111111-2222-4333-8444-555555555555";
const makeFormData = (id, name, lastSaveId = "99999999-8888-4777-8666-555555555555") => ({
  _AddEditTableID: SALES_TABLE_ID,
  _RecordID: id,
  mapper: {
    ID: id,
    Maps: [
      { Field: "NAME", Value: name },
      { Field: "LASTSAVEID", Value: lastSaveId }
    ]
  }
});

const staleJson = JSON.stringify(makeFormData(staleId, "HD-CU"));
const sandbox = {
  SALES_TABLE_ID,
  window: { formData: makeFormData(activeId, "") },
  document: {
    scripts: [{ textContent: `var formData = new DataTransferJs(${staleJson}); new AddEdit_JsClient();` }]
  },
  suffixInput: () => ({ value: "Tự động" }),
  extractJsonObject: () => makeFormData(staleId, "HD-CU")
};
vm.createContext(sandbox);
vm.runInContext(
  `${extractFunction("isGuid")}; ` +
  `${extractFunction("formDataRecordId")}; ${extractFunction("formDataField")}; ` +
  `${extractFunction("currentFormData")}; this.currentFormData = currentFormData;`,
  sandbox
);

if (sandbox.currentFormData()._RecordID !== activeId) {
  throw new Error("Phiếu mới phải ưu tiên window.formData đang hoạt động, không lấy formData cũ trong script.");
}

sandbox.window.formData = makeFormData("", "Tá»± Ä‘á»™ng", "");
sandbox.document.scripts = [{ textContent: `var formData = new DataTransferJs(${staleJson}); new AddEdit_JsClient();` }];
if (sandbox.currentFormData({ allowBlankRecordId: true })._RecordID !== "") {
  throw new Error("Form phiáº¿u má»›i ID rá»—ng pháº£i Ä‘Æ°á»£c chuyá»ƒn sang luá»“ng lÆ°u chÃ­nh thá»©c cá»§a website.");
}

console.log("current formData selection: OK");
