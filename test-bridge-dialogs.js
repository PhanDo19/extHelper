const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync("bridge.js", "utf8");

for (const alertGuard of [
  "function isKnownTransientKendoAlert(message)",
  "function installTransientKendoAlertGuard()",
  "__invoiceTargetKendoAlertGuardInstalled",
  "Reflect.apply(nativeAlert, window, [message])",
  "invoice-target-mvp:runtime-warning"
]) {
  if (!source.includes(alertGuard)) {
    throw new Error(`Missing persistent Kendo alert guard: ${alertGuard}`);
  }
}

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
  `${extractFunction("isKnownTransientKendoAlert")};
   ${extractFunction("dialogControlText")};
   ${extractFunction("dialogControls")};
   ${extractFunction("isTransientQuantityDialog")};
   this.isKnownTransientKendoAlert = isKnownTransientKendoAlert;
   this.isTransientQuantityDialog = isTransientQuantityDialog;`,
  context
);

if (!context.isKnownTransientKendoAlert(
  "Rất tiếc, không thể xử lý, chi tiết: Uncaught Error: Cannot call method 'value' of kendoDropDownList before it is initialized"
)) {
  throw new Error("Known asynchronous Kendo alert must be suppressed.");
}
if (context.isKnownTransientKendoAlert("Bạn có chắc muốn hủy hóa đơn?")) {
  throw new Error("Legitimate website alerts must pass through unchanged.");
}

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
for (const catalogFallback of [
  "function findLoadedProduct(found, code)",
  "tbody tr[data-uid]",
  "dataSource.getByUid(uid)",
  "const exact = () => findLoadedProduct(found, code)",
  "const pageDeadline = Date.now() + 2500"
]) {
  if (!source.includes(catalogFallback)) {
    throw new Error(`Robust product catalog lookup is missing: ${catalogFallback}`);
  }
}
const filterProductSource = extractFunction("filterProduct");
if (/actualSearchButton\.click|btnSearch_Click/.test(filterProductSource)) {
  throw new Error("Product resolution must not open the website's F3 keyboard dialog.");
}
if (!/await closeTransientQuantityDialogs\(\);\r?\n\s+throw error;/.test(source)) {
  throw new Error("Failed apply must close the transient keyboard.");
}
for (const closeGuard of [
  "function visibleInvoiceTotalInput()",
  "async function waitForInvoiceDetailClosed(",
  "closed: !state.detailVisible",
  'detail.action === "getInvoiceUiState"'
]) {
  if (!source.includes(closeGuard)) {
    throw new Error(`Missing invoice close guard: ${closeGuard}`);
  }
}
if (source.includes("jq(input).data(\"kendoDropDownList\")") &&
    source.includes("widget.value(saved.value);")) {
  throw new Error("Form-state restore must not call an uninitialized Kendo DropDownList.");
}
if (!source.includes("Kendo can expose a widget object before its input is initialized")) {
  throw new Error("Kendo initialization guard is missing.");
}
const normalizePaymentSource = extractFunction("normalizePaymentDialog");
for (const invariant of [
  "result.cash === grand",
  "result.customer === grand",
  "result.paid === grand",
  "result.change === 0"
]) {
  if (!normalizePaymentSource.includes(invariant)) {
    throw new Error(`Missing payment invariant: ${invariant}`);
  }
}
if (!source.includes('["LUU IN", "LUU THOAT"].includes(normalizedVietnameseText(dialogControlText(button)))')) {
  throw new Error("Official save controls must run the payment guard.");
}
if (!source.includes("event.stopImmediatePropagation()")) {
  throw new Error("Invalid payment values must block the official save action.");
}
if (!source.includes("paymentDialog?.contains(control)") ||
    source.includes('control.closest(".k-window,.k-dialog,[role=\'dialog\'],.ui-dialog,.modal")')) {
  throw new Error("Main Lưu HĐ/Thanh toán control must not be rejected by the form modal wrapper.");
}
for (const freshBootstrapInvariant of [
  "function officialSaveCancelControl(dialog)",
  "const initializedFormData = currentFormData({ allowBlankRecordId: true })",
  "await postCurrentInvoiceViaApi(expected)",
  "officialUiBootstrap: true"
]) {
  if (!source.includes(freshBootstrapInvariant)) {
    throw new Error(`Missing safe fresh-invoice bootstrap invariant: ${freshBootstrapInvariant}`);
  }
}
for (const requiredCapture of [
  "function installSaveRequestCapture()",
  "function shouldCaptureSaveRequest(method, url)",
  "/AddEdit/i.test(target.pathname)",
  "invoice-target-mvp:save-request-captured",
  "/^(authorization|cookie|proxy-authorization)$/i"
]) {
  if (!source.includes(requiredCapture)) {
    throw new Error(`Missing API capture guard: ${requiredCapture}`);
  }
}

console.log("bridge transient quantity dialogs: OK");
