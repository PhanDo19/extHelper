const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("bridge.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Cannot extract ${name}`);
}

const warehouseId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const currentRows = [{
  ID: "11111111-2222-4333-8444-555555555555",
  DMATHANGID: "old-product",
  DMATHANG_CODE: "1500007",
  TENHANG: "Hoa qua",
  DDONVITINHID: "old-unit",
  DDONVITINH_NAME: "dia",
  DKHOHANGID: warehouseId,
  SLXUATCHUAQUYDOI: 1,
  DONGIA: 400000,
  THANHTIEN: 400000,
  NGAYTHUCHIEN: "2026-06-18 00:00:00",
  uid: "kendo-only"
}];
const products = new Map([
  ["1500007", { ID: "product-fruit", NAME: "HOA QUA THAP CAM", DDONVITINHID: "unit-dish", DDONVITINH_NAME: "dia", GIABAN: 400000 }],
  ["1100011", { ID: "product-birdnest", NAME: "NUOC YEN", DDONVITINHID: "unit-bottle", DDONVITINH_NAME: "chai", GIABAN: 90000 }]
]);
const sandbox = {
  cloneJson: value => JSON.parse(JSON.stringify(value)),
  liveDetailRows: () => currentRows
};
vm.createContext(sandbox);
vm.runInContext(`${extractFunction("existingInvoiceApiDetailRows")}; this.buildRows = existingInvoiceApiDetailRows;`, sandbox);

const rows = sandbox.buildRows([
  { code: "1500007", qty: 1, price: 400000 },
  { code: "1100011", qty: 4, price: 90000 }
], products, warehouseId);

if (rows.length !== 2) throw new Error("Direct API payload must contain both accepted products.");
if (rows[0].ID !== currentRows[0].ID) throw new Error("Existing matching row ID must be preserved.");
if (rows[1].ID !== null || rows[1].DMATHANGID !== "product-birdnest") {
  throw new Error("Missing UI product 1100011 must be built from the API catalog as a new detail row.");
}
if (rows[1].SLXUATCHUAQUYDOI !== 4 || rows[1].THANHTIEN !== 360000 || "uid" in rows[1]) {
  throw new Error("New API detail row has incorrect quantity, total or Kendo-only state.");
}

console.log("existing invoice API detail rows: OK");
