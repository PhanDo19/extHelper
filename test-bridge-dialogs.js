const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("bridge.js", "utf8");

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

const context = {};
vm.createContext(context);
vm.runInContext(
  `${extractFunction("isTransientQuantityDialog")}; this.isTransientQuantityDialog = isTransientQuantityDialog;`,
  context
);

const button = text => ({ innerText: text, textContent: text });
const quantityDialog = {
  querySelectorAll() {
    return [
      ...Array.from({ length: 25 }, (_, index) => button(String(index))),
      button("Hủy bỏ"),
      button("Chấp nhận")
    ];
  }
};
const saveDialog = {
  querySelectorAll() {
    return [button("Lưu in"), button("Lưu thoát"), button("Hủy bỏ")];
  }
};

if (!context.isTransientQuantityDialog(quantityDialog)) {
  throw new Error("Quantity keyboard dialog was not detected.");
}
if (context.isTransientQuantityDialog(saveDialog)) {
  throw new Error("Invoice save dialog must never be auto-closed.");
}

console.log("bridge transient quantity dialogs: OK");
