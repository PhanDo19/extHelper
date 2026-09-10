const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const css = fs.readFileSync(path.join(root, "content.css"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

assert.equal(manifest.version, "1.24.2");
for (const fn of ["accountingCloseSnapshot", "renderAccountingCloseStatus", "accountingReportSheets", "exportAccountingReport"]) {
  assert(content.includes(`function ${fn}(`) || content.includes(`async function ${fn}(`), `Missing ${fn}`);
}
for (const id of ["it-accounting-close-check", "it-accounting-export", "it-accounting-close-status"]) {
  assert.equal((content.match(new RegExp(`id=\\"${id}\\"`, "g")) || []).length, 1, `${id} must exist once`);
}
for (const sheet of ["Tong quan", "Giao dich", "Ton dong"]) {
  assert(content.includes(`name: "${sheet}"`), `Missing report sheet ${sheet}`);
}
assert(content.includes("InvoiceXlsxWriter.build(report.sheets)"), "Report must use the XLSX writer");
assert(content.includes("state.open.length === 0"), "Close readiness must block open transactions");
assert(content.includes("state.unissued.length === 0"), "Close readiness must block unissued invoices");
assert(content.includes("mappingPending === 0"), "Close readiness must validate mappings");
assert(content.includes("sharedWarehouse.initialized"), "Close readiness must validate physical stock");
assert(css.includes(".it-accounting-close-status"), "Missing close status styles");
assert(css.includes(".it-accounting-check-list"), "Missing close checklist styles");
console.log("Accounting close and report tests passed.");
