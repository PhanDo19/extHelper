"use strict";

// Mỗi cơ sở có bộ mã web riêng và mã hai bên KHÔNG trùng nhau. Nếu một cơ sở
// nạp nhầm danh mục hoặc ánh xạ của cơ sở khác thì phương án lập ra sẽ sai mã
// hàng, mà chỉ phát hiện sau khi phiếu đã lưu. Test này khóa lại đường dây từ
// TENANT_REGISTRY → file dữ liệu → manifest.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const scripts = manifest.content_scripts.flatMap(item => item.js || []);

// Đọc TENANT_REGISTRY từ chính content.js thay vì chép lại danh sách ở đây —
// chép lại thì test vẫn xanh khi registry và thực tế đã lệch nhau.
const registrySource = content.slice(
  content.indexOf("const TENANT_REGISTRY = {"),
  content.indexOf("const TENANT_LABELS =")
);
assert(registrySource, "Không tìm thấy TENANT_REGISTRY trong content.js");
const registry = new Function(`${registrySource}; return TENANT_REGISTRY;`)();

const slugs = Object.keys(registry);
assert(slugs.includes("pariskimgiang") && slugs.includes("parislinhdam") && slugs.includes("parisnhon"),
  "Registry phải có đủ ba cơ sở đang chạy");

for (const [slug, config] of Object.entries(registry)) {
  for (const field of ["label", "fileLabel", "catalogGlobal", "catalogSource", "mappingGlobal"]) {
    assert(config[field], `Cơ sở ${slug} thiếu trường ${field}`);
  }
}

// Nhãn tên file đi vào allowlist tải xuống của background, nên không được trùng
// hoặc chứa ký tự lạ.
const fileLabels = slugs.map(slug => registry[slug].fileLabel);
assert.strictEqual(new Set(fileLabels).size, fileLabels.length, "fileLabel bị trùng giữa các cơ sở");
for (const label of fileLabels) {
  assert(/^[A-Za-z]+$/.test(label), `fileLabel "${label}" phải chỉ gồm chữ cái để khớp allowlist`);
}
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
for (const label of fileLabels) {
  assert(background.includes(label), `background.js chưa cho phép tải file của cơ sở ${label}`);
}

// Biến toàn cục mà registry trỏ tới phải thực sự tồn tại, và phải được manifest
// nạp TRƯỚC content.js — nạp sau thì content.js đọc ra undefined.
const dataFiles = scripts.filter(name => /^(web-catalog|inventory-data|mapping)-?.*\.js$/.test(name));
for (const name of dataFiles) require(path.join(root, name));

for (const [slug, config] of Object.entries(registry)) {
  const catalog = globalThis[config.catalogGlobal];
  assert(catalog, `Thiếu danh mục web ${config.catalogGlobal} cho cơ sở ${slug}`);
  assert(Array.isArray(catalog.items) && catalog.items.length,
    `Danh mục web của ${slug} rỗng`);

  const mapping = globalThis[config.mappingGlobal];
  assert(mapping, `Thiếu ánh xạ ${config.mappingGlobal} cho cơ sở ${slug}`);
  assert(Array.isArray(mapping.mappings), `Ánh xạ của ${slug} sai cấu trúc`);

  const owner = scripts.find(name => {
    try {
      return fs.readFileSync(path.join(root, name), "utf8").includes(`root.${config.catalogGlobal} =`);
    } catch (_) { return false; }
  });
  assert(owner, `Không file nào trong manifest định nghĩa ${config.catalogGlobal}`);
  assert(scripts.indexOf(owner) < scripts.indexOf("content.js"),
    `${owner} phải được nạp trước content.js`);
}

// Mã web không được trùng giữa các cơ sở: trùng thì một ánh xạ sai vẫn "tra
// thấy" mã ở cơ sở khác và lỗi đi lọt qua mọi kiểm tra.
const codesByTenant = new Map();
for (const [slug, config] of Object.entries(registry)) {
  codesByTenant.set(slug, new Set(globalThis[config.catalogGlobal].items.map(item => String(item.webCode))));
}
const nhon = codesByTenant.get("parisnhon");
for (const other of ["pariskimgiang", "parislinhdam"]) {
  const shared = [...nhon].filter(code => codesByTenant.get(other).has(code));
  assert.strictEqual(shared.length, 0,
    `Mã web trùng giữa parisnhon và ${other}: ${shared.slice(0, 5).join(", ")}`);
}

// Ánh xạ phải trỏ đúng vào danh mục của CHÍNH cơ sở đó.
for (const [slug, config] of Object.entries(registry)) {
  const codes = codesByTenant.get(slug);
  const mapping = globalThis[config.mappingGlobal];
  if (!mapping.mappings.length) continue;
  assert.strictEqual(String(mapping.tenant || slug), slug,
    `Ánh xạ của ${slug} khai báo sai tenant`);
  for (const row of mapping.mappings) {
    const code = String(row.webCode || "").trim();
    if (!code) continue;
    assert(codes.has(code),
      `Ánh xạ ${slug} trỏ tới mã web ${code} không có trong danh mục của chính cơ sở này`);
  }
}

// Spec: "Không tự xác nhận ánh xạ mới. Việc trùng giá chỉ là tín hiệu, không đủ
// để kết luận hai sản phẩm là một." Ánh xạ sinh tự động phải để kế toán duyệt.
const nhonMapping = globalThis[registry.parisnhon.mappingGlobal];
assert.strictEqual(nhonMapping.mappings.filter(row => row.status === "confirmed").length, 0,
  "Ánh xạ sinh tự động không được có dòng nào ở trạng thái confirmed");
for (const row of nhonMapping.mappings) {
  assert(["review", "unmatched"].includes(row.status),
    `Trạng thái lạ "${row.status}" ở dòng ${row.stockCode}`);
  assert(row.reviewNote, `Dòng ${row.stockCode} thiếu ghi chú để kế toán rà`);
  if (row.status === "unmatched") {
    assert(!row.webCode, `Dòng unmatched ${row.stockCode} không được có mã web`);
  }
}

// Cơ sở lạ phải dừng hẳn thay vì chạy với dữ liệu mặc định của cơ sở khác.
assert(/if \(!tenantConfig\) \{[\s\S]{0,400}return;/.test(content),
  "init() phải dừng khi cơ sở không có trong registry");

console.log("Tenant registry tests passed");
