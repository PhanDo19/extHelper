const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("api-template.js", "utf8");
const context = { URL, URLSearchParams };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const payload = {
  mapper: {
    DataSource: [{
      TONGCONG: 2520000,
      TIENMAT: "2520000.00",
      KHACHDUA: "2520000.00",
      TIENTHANHTOAN: "2520000.00",
      TRALAI: "0.00",
      detail: [{ DMATHANGID: "x", DONGIA: 400000, SLXUAT: 1 }]
    }]
  }
};
const template = {
  method: "POST",
  url: "http://banhang.thuanvietsoft.com/pariskimgiang/AddEdit?TableID=x",
  status: 200,
  bodyType: "urlencoded",
  body: new URLSearchParams({ data: JSON.stringify(payload) }).toString()
};

const result = context.InvoiceApiTemplate.analyze(template);
if (!result.ready) throw new Error(`Valid template rejected: ${result.reasons.join(",")}`);
if (result.payment.grand !== 2520000 || result.payment.change !== 0) {
  throw new Error("Payment fields were parsed incorrectly.");
}

const bad = JSON.parse(JSON.stringify(template));
bad.body = new URLSearchParams({
  data: JSON.stringify({
    ...payload,
    mapper: {
      DataSource: [{
        ...payload.mapper.DataSource[0],
        TIENMAT: "2695000.00",
        KHACHDUA: "2695000.00",
        TRALAI: "175000.00"
      }]
    }
  })
}).toString();
const badResult = context.InvoiceApiTemplate.analyze(bad);
if (badResult.ready || !badResult.reasons.includes("payment-values-not-equal")) {
  throw new Error("Mismatched cash must block Batch API readiness.");
}

const officialPayloadShape = {
  mode: 2,
  clientMap: {
    TableID: "d56b4b85-68c8-44c1-947d-9f3899e55a7c",
    ID: "79e29d2e-cc7a-4f48-9cd8-13fb89ef94ca",
    Maps: [
      { Field: "NAME", Value: "HD0126060036" },
      { Field: "SOHD", Value: "" },
      { Field: "TIENHANG", Value: 1705000 },
      { Field: "TIENGIO", Value: 585909 },
      { Field: "TIENTHUE", Value: 229091 },
      { Field: "TONGCONG", Value: 2520000 },
      { Field: "TIENMAT", Value: 2520000 },
      { Field: "KHACHDUA", Value: 2520000 },
      { Field: "TIENTHANHTOAN", Value: 2520000 },
      { Field: "TRALAI", Value: 0 }
    ],
    Grids: [{
      Name: "detail",
      Data: [{ DMATHANG_CODE: "1500007", DONGIA: 400000, SLXUAT: 1 }]
    }],
    CustomPostTable: [{
      Name: "LoaiQuy",
      Data: [
        { truong: "TRALAI", value: 0 },
        { truong: "TIENTHANHTOAN", value: 2520000 },
        { truong: "KHACHDUA", value: 2520000 },
        { truong: "TIENMAT", value: 2520000 }
      ]
    }]
  }
};
const officialTemplate = {
  method: "POST",
  url: "http://banhang.thuanvietsoft.com/pariskimgiang/AddEdit/DoSave?is_ajax=1",
  status: 200,
  bodyType: "text",
  body: JSON.stringify(officialPayloadShape)
};
const officialResult = context.InvoiceApiTemplate.analyze(officialTemplate);
if (!officialResult.ready || officialResult.payment.grand !== 2520000) {
  throw new Error(`Official DoSave shape rejected: ${officialResult.reasons.join(",")}`);
}

console.log("API template analysis: OK");
