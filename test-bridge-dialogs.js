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
  `${extractFunction("dialogControlText")};
   ${extractFunction("dialogControls")};
   ${extractFunction("isTransientQuantityDialog")};
   this.isTransientQuantityDialog = isTransientQuantityDialog;`,
  context
);

const button = text => ({ innerText: text, textContent: text, value: "" });
const inputButton = text => ({
  innerText: "",
  textContent: "",
  value: text,
  getAttribute(name) {
    return name === "value" ? text : "";
  }
});
const quantityDialog = {
  hidden: false,
  getAttribute() {
    return null;
  },
  querySelectorAll() {
    return [
      ...Array.from({ length: 10 }, (_, index) => inputButton(String(index))),
      inputButton("Hủy bỏ"),
      inputButton("Chấp nhận")
    ];
  }
};
const saveDialog = {
  hidden: false,
  getAttribute() {
    return null;
  },
  querySelectorAll() {
    return [button("Lưu in"), button("Lưu thoát"), button("Hủy bỏ")];
  }
};

if (!context.isTransientQuantityDialog(quantityDialog)) {
  throw new Error("Quantity keyboard dialog using input buttons was not detected.");
}
if (context.isTransientQuantityDialog(saveDialog)) {
  throw new Error("Invoice save dialog must never be auto-closed.");
}
if (!source.includes("[data-role='dialog'],.k-window-content,.k-content")) {
  throw new Error("Kendo dialog content fallback is missing.");
}
if (!source.includes("/^btnCancel_Click$/i")) {
  throw new Error("Generated ButtonJs cancel handler fallback is missing.");
}
if (!source.includes("dataSource.page(page)")) {
  throw new Error("Remote catalog page traversal fallback is missing.");
}
if (!source.includes("await closeTransientQuantityDialogs();\n      throw error;")) {
  throw new Error("Failed apply must close the transient keyboard.");
}

console.log("bridge transient quantity dialogs: OK");
