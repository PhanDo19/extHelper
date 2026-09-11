const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Writer = require(path.join(__dirname, "..", "xlsx-writer.js"));

function readEntry(zip, name) {
  const buffer = Buffer.from(zip);
  const target = Buffer.from(name, "utf8");
  let offset = 0;
  while (offset < buffer.length - 4) {
    if (buffer.readUInt32LE(offset) === 0x04034b50) {
      const nameLength = buffer.readUInt16LE(offset + 26);
      const extraLength = buffer.readUInt16LE(offset + 28);
      const size = buffer.readUInt32LE(offset + 18);
      const entryName = buffer.slice(offset + 30, offset + 30 + nameLength);
      const start = offset + 30 + nameLength + extraLength;
      if (entryName.equals(target)) return buffer.slice(start, start + size).toString("utf8");
      offset = start + size;
    } else offset += 1;
  }
  throw new Error(`Missing ${name}`);
}

const formulaBook = Writer.build([{
  name: "Ánh xạ",
  columns: [{ header: "Mã web" }, { header: "Tên web" }],
  rows: [["1001", { formula: "IFERROR(VLOOKUP(A2,'Mặt hàng web'!$A:$D,2,FALSE),\"\")", value: "Bánh quy" }]]
}]);
const sheet = readEntry(formulaBook, "xl/worksheets/sheet1.xml");
assert.match(sheet, /<c r="B2" t="str"><f>IFERROR\(VLOOKUP\(A2,&apos;Mặt hàng web&apos;!\$A:\$D,2,FALSE\),&quot;&quot;\)<\/f><v>Bánh quy<\/v><\/c>/);
const workbookXml = readEntry(formulaBook, "xl/workbook.xml");
assert.match(workbookXml, /fullCalcOnLoad="1"/);
assert(workbookXml.indexOf("<sheets>") < workbookXml.indexOf("<calcPr "),
  "calcPr must follow sheets according to the Excel workbook XML schema");

const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
for (const invariant of [
  'async function exportMapping()', 'name: "Ánh xạ"', 'name: "Mặt hàng web"',
  'VLOOKUP(E${excelRow}', 'InvoiceXlsxReader.parseMappingWorkbook(file)',
  'accept=".xlsx,.json,application/json"'
]) assert(content.includes(invariant), `Missing mapping workbook invariant: ${invariant}`);

const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
assert.match(background, /invoice-mapping-\(ParisKimGiang\|ParisLinhDam\|ParisNhon\)/);
console.log("Mapping workbook export/import: OK");
