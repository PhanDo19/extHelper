const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("content.js", "utf8");

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

const sandbox = { structuredClone };
vm.createContext(sandbox);
vm.runInContext(`${extractFunction("reserveBatchStock")}; this.reserveBatchStock = reserveBatchStock;`, sandbox);

const inventory = [
  { webCode: "A", availableQty: 10, availabilityMode: "stock" },
  { webCode: "B", availableQty: 1, availabilityMode: "per_invoice" }
];

const afterFirst = sandbox.reserveBatchStock(inventory, [
  { code: "A", qty: 4 },
  { code: "B", qty: 1 }
]);
const afterSecond = sandbox.reserveBatchStock(afterFirst, [{ code: "A", qty: 3 }]);

if (inventory[0].availableQty !== 10) throw new Error("Hàm đã làm thay đổi tồn gốc.");
if (afterFirst[0].availableQty !== 6) throw new Error("Không giữ chỗ tồn cho hóa đơn đầu.");
if (afterSecond[0].availableQty !== 3) throw new Error("Không trừ tồn cộng dồn cho hóa đơn sau.");
if (afterSecond[1].availableQty !== 1) throw new Error("Mặt hàng per_invoice không được trừ cộng dồn.");

console.log("batch review stock reservation: OK");
