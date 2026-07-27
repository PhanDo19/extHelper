const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("content.js", "utf8");

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Missing ${name}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${name}`);
}

const context = { structuredClone };
vm.createContext(context);
vm.runInContext(`${extractFunction("verifySnapshotAgainstPlan")}
${extractFunction("deductVerifiedStock")}
this.verifySnapshotAgainstPlan = verifySnapshotAgainstPlan;
this.deductVerifiedStock = deductVerifiedStock;`, context);

const plan = {
  invoiceNo: "HD1",
  invoiceDateKey: "2026-06-30",
  goods: 1555000,
  hour: 605909,
  tax: 216091,
  taxRate: 10,
  grand: 2377000,
  items: [
    { code: "1500007", qty: 1, price: 450000 },
    { code: "1000045", qty: 17, price: 65000 }
  ]
};

const scan = {
  ready: true,
  invoiceNo: "HD1",
  invoiceDateKey: "2026-06-30",
  currentGoods: 1555000,
  currentHour: 605909,
  currentTax: 216091,
  taxRate: 10,
  currentGrand: 2377000,
  items: [
    { code: "1500007", qty: 1, price: 450000 },
    { code: "1000045", qty: 17, price: 65000 }
  ]
};

if (context.verifySnapshotAgainstPlan(scan, plan).length) throw new Error("Valid saved invoice rejected");
if (!context.verifySnapshotAgainstPlan({ ...scan, currentGrand: 1 }, plan).length) throw new Error("Invalid total accepted");

const dataset = {
  mappings: [
    { status: "confirmed", webCode: "1000045", availableQty: 10, availabilityMode: "stock" },
    { status: "confirmed", webCode: "1000045", availableQty: 65, availabilityMode: "stock" },
    { status: "confirmed", webCode: "1500007", availableQty: 1, availabilityMode: "per_invoice" }
  ]
};
const deducted = context.deductVerifiedStock(dataset, plan.items);
const stockLeft = deducted.mappings
  .filter(row => row.webCode === "1000045")
  .reduce((sum, row) => sum + row.availableQty, 0);
if (stockLeft !== 58) throw new Error(`Expected 58 remaining, got ${stockLeft}`);
if (deducted.mappings[2].availableQty !== 1) throw new Error("Per-invoice item was deducted");
if (dataset.mappings[0].availableQty !== 10) throw new Error("Original dataset mutated");

console.log("post-save verification: OK");
