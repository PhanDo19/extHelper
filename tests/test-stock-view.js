// Màn Kho: mã đã xác nhận ánh xạ nhưng hết tồn không được hiện là "Chưa ánh xạ".
//
// Ca thật Linh Đàm 01/10/2026: màn Kho báo "Chưa ánh xạ tại Paris Linh Đàm: 17"
// trong khi màn Ánh xạ cho thấy cả 17 mã đều "Đã xác nhận" (BiaBudweiser330ml →
// 1100001, TC → 1500006…), chỉ là tồn 0. buildInventory chỉ lấy mã còn tồn nên
// các mã này rơi khỏi inventory và bị coi là chưa ánh xạ.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

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

require(path.join(__dirname, "..", "mapping-engine.js"));
const engine = globalThis.InvoiceMappingEngine;

const mapping = (stockCode, stockName, availableQty, webCode, webName, webPrice, status = "confirmed") => ({
  stockCode, stockName, stockUnit: "Bao", stockQty: availableQty, conversion: 1, availableQty, salePrice: webPrice,
  webCode, webName, webUnit: "bao", webPrice, webType: "Mặt hàng kiêm vật tư", webGroup: "", status
});
const mappingDataset = {
  tenant: "parislinhdam",
  mappings: [
    mapping("CAMELLEGEND", "Camel 1913 Legend The Smooth Story", 37, "1400018", "Thuốc lá điếu đầu lọc Camel 1913", 60000),
    mapping("TLĐC1913", "Camel 1913 Legend The Bold Story", 16, "1400018", "Thuốc lá điếu đầu lọc Camel 1913", 60000),
    // Hết tồn nhưng dùng chung mã web với hai dòng còn hàng ở trên.
    mapping("CAMEL1913", "Camel 1913 Legend The Bold Story", 0, "1400018", "Thuốc lá điếu đầu lọc Camel 1913", 60000),
    // Hết tồn, mã web không còn dòng kho nào có hàng.
    mapping("BiaBudweiser330ml", "Budweiser 11P 330ml 1X24 BOX cadillac", 0, "1100001", "Bia Budweiser 330ml", 55000),
    mapping("TC", "Hoa quả thập cẩm", 0, "1500006", "HOA QUẢ THẬP CẨM (Đĩa nhỏ)", 350000),
    // Thật sự chưa ánh xạ: chưa xác nhận mã web.
    mapping("KEOMOI", "Kẹo mới về", 12, "", "", 0, "review")
  ]
};
const sharedWarehouse = {
  items: mappingDataset.mappings.map(row => ({
    stockCode: row.stockCode, stockName: row.stockName, stockUnit: row.stockUnit,
    salePrice: row.salePrice, availableQty: row.availableQty
  }))
};
const inventory = engine.buildInventory(mappingDataset);
const inventoryBefore = JSON.stringify(inventory);

const box = { inventory, mappingDataset, sharedWarehouse, statementDataset: { transactions: [] } };
vm.createContext(box);
vm.runInContext(
  `${extractFunction("stockReservationByCode")}; ${extractFunction("stockViewRows")}; ${extractFunction("stockViewCounts")}; ` +
    "this.stockViewRows = stockViewRows; this.stockViewCounts = stockViewCounts;",
  box
);
const rows = box.stockViewRows();
const byWebCode = code => rows.find(row => row.webCode === code);

const unmapped = Array.from(rows.filter(row => row.needsMapping), row => row.stockCodes.join(","));
assert.deepStrictEqual(unmapped, ["KEOMOI"], `Chỉ mã chưa xác nhận mới là "Chưa ánh xạ", nhận: ${unmapped.join(" | ")}`);

const camel = byWebCode("1400018");
assert.ok(camel, "Mã web Camel 1913 phải có trên màn Kho");
assert.deepStrictEqual([...camel.stockCodes].sort(), ["CAMEL1913", "CAMELLEGEND", "TLĐC1913"],
  "Dòng kho hết hàng dùng chung mã web phải hiện trong Nguồn kho của mã đó");
assert.strictEqual(camel.recordedQty, 53, "Tồn của mã web không đổi khi gắn thêm nguồn kho đã hết");
assert.strictEqual(rows.filter(row => row.webCode === "1400018").length, 1, "Không tách thành hai dòng cùng mã web");

for (const [webCode, stockCode] of [["1100001", "BiaBudweiser330ml"], ["1500006", "TC"]]) {
  const row = byWebCode(webCode);
  assert.ok(row, `${stockCode} đã xác nhận → ${webCode} phải hiện với mã web, không phải "Chưa ánh xạ"`);
  assert.strictEqual(row.needsMapping, undefined);
  assert.deepStrictEqual([...row.stockCodes], [stockCode]);
  assert.strictEqual(row.recordedQty, 0);
  assert.strictEqual(row.allocatableQty, 0, `${stockCode} hết tồn phải tính vào "Đã hết"`);
}

// Màn Kho chỉ hiển thị: không được sửa inventory mà solver dùng để lập phương án.
assert.strictEqual(JSON.stringify(inventory), inventoryBefore, "stockViewRows không được sửa inventory");
assert.strictEqual(inventory.some(item => item.webCode === "1100001"), false);


// --- Ô KPI phải khớp số người dùng đối chiếu được -----------------------------
//
// Đúng 109 dòng ánh xạ Linh Đàm ngày 01/10/2026 (mã kho|mã web|tồn). Màn Ánh xạ
// đếm 109 dòng; màn Kho gộp theo mã web nên chỉ có 77 dòng, 61 mã còn hàng.
const linhDamRows = [
  "BANH XOP|1000039|433", "BANHKTC|1000030|496", "BANHPEANUT45G|1000038|247", "BANHQUECAY|1000051|643",
  "BANHQUETH|1000050|76", "Banhquyque|1000001|63", "BANHXOPKEM|1000038|3543", "BANHYAN2|1000052|12",
  "BANHYAN2coc|1000052|443", "Bia crystal330|1100025|371", "BiaBudweiser330ml|1100001|0",
  "BIACORONA thùng|1100002|9464", "BIM2BONUONG|1000056|130", "BIM2KHOAITAY|1000031|168",
  "BIM2PM|1000070|148", "BIM2VIMUOI|1000056|200", "bkm|1000074|5", "Bò Húc (redbull)|1100004|435",
  "BOKHOSOI40|1000073|0", "bomiengto60g|1000025|1904", "CAMEL1913|1400018|0", "CAMELBT|1400016|139",
  "CAMELCC|1400017|71", "CAMELLEGEND|1400018|37", "CAMELMELON|1400017|104", "CHANGA28G|1000053|222",
  "changacay80g|1000007|189", "CHANGARX|1000054|240", "COLLAGENTH|1100014|1056", "daheo|1000071|0",
  "DAUMIXHAT|1000055|506", "DOSIDAHEO|1000044|63", "DOSIQUAY|1000045|305", "DOSITOPMO|1000046|1600",
  "HATDECUOIRM|1000069|49", "HATDIEU|1000011|251", "Heineken Silver lon 250m|1100027|2594",
  "HEINEKENCTN250|1100027|6000", "Hotdog Ponnie|1100037|1076", "IONVIE350|1100031|1405", "KEOTHE|1000076|27",
  "KHANV1020|1000060|30747", "Khăn Ướt V10+|1000060|5000", "Khăn Ướt V11|1000060|11123",
  "Khăn ướt V12|1000060|11386", "KHOAILANGSAY|1000058|404", "KHOGALC|1000015|0", "Lavi thùng|1100023|1101",
  "LAVIE350TH|1100023|7680", "LAVIE500TH|1100038|1263", "MATSU|1100043|61", "mit90g|1000075|0",
  "mohonglam|1000026|0", "NUOCCAMTWISTER|1100040|0", "nuoccollagen|1100014|1356", "nuochacsam|1100005|116",
  "nuochongsam|1100041|191", "NUOCOFAN350|1100039|8696", "NUOCSTCMC|1100044|0", "NUOCSTCVQ|1100018|0",
  "NUOCYEN3VI|1000057|150", "PEPSI320|1100029|1730", "PHOMAI|1000072|0", "QUYDAU|1000001|132",
  "QUYKEM|1000001|88", "QUYPM|1000001|120", "QUYSOCOLA|1000001|33", "QUYSR|1000001|60", "QUYSUA|1000001|157",
  "QUYVIETQUAT|1000066|52", "RuouvangdoCL.|1100042|0", "RuouvangdoDHB.1|1300013|0", "saubaotu|1000067|0",
  "Snack Oishi|1000043|941", "Snack Pillows|1000034|75", "SNACKCOTDUACF|1000034|300", "SNACKDUA|1000043|288",
  "SNACKHAZE|1000034|140", "SNACKKHOAIMON|1000034|140", "SNACKSOCOLA|1000034|135", "SNACKSUADUA|1000034|140",
  "SNACKTOM|1000043|829", "SNACKTOM65|1000043|194", "SNACKVANI|1000034|140", "SWEAT350|1100019|1617",
  "TC|1500006|0", "TCTO|1500007|0", "THUCUONGSCC|1100033|283", "TIGERCOOL|1100020|158", "TL555SB|1400007|45",
  "TLBC|1000062|0", "TLCAMELTC|1400018|22", "TLDSLIM|1400012|41", "TLĐC1913|1400018|16",
  "TLĐCCAM|1400017|48", "TLĐCCC|1400015|8", "TLĐTL|1400010|402", "tradaosa|1100035|6",
  "TraWanglaoji|1100021|1247", "TRUNGALACO|1000059|948", "Xucxichheocaoboi|1000035|287",
  "XucxichRed|1000023|267", "XXBO40G|1000048|305", "XXHEO40G|1000012|272", "XXPONNIE|1000035|590",
  "XXPONNIESN|1100037|280", "XXPONNIEVIBAP|1100037|20", "YENMIXVI|1100026|740", "YENSANESTTH|1100012|2588"
];
const linhDamMappings = linhDamRows.map(line => {
  const [stockCode, webCode, qty] = line.split("|");
  return mapping(stockCode, stockCode, Number(qty), webCode, `Web ${webCode}`, 10000);
});
const linhDamBox = {
  mappingDataset: { tenant: "parislinhdam", mappings: linhDamMappings },
  inventory: engine.buildInventory({ tenant: "parislinhdam", mappings: linhDamMappings }),
  sharedWarehouse: { items: linhDamMappings.map(row => ({ stockCode: row.stockCode, stockName: row.stockName, availableQty: row.availableQty })) },
  statementDataset: { transactions: [] }
};
vm.createContext(linhDamBox);
vm.runInContext(
  `${extractFunction("stockReservationByCode")}; ${extractFunction("stockViewRows")}; ${extractFunction("stockViewCounts")}; ` +
    "this.counts = stockViewCounts(stockViewRows());",
  linhDamBox
);
assert.strictEqual(linhDamRows.length, 109);
assert.deepStrictEqual({ ...linhDamBox.counts }, {
  webCodes: 77, stockRows: 109, eligible: 61, held: 0, low: 0, out: 16, unmapped: 0
}, `KPI Linh Đàm: ${JSON.stringify(linhDamBox.counts)}`);
assert.strictEqual(linhDamBox.counts.eligible, linhDamBox.inventory.length, "Đủ điều kiện phải bằng số mã solver dùng được");

// Ca nhỏ ở trên: 3 mã web từ 5 dòng kho đã xác nhận, 1 còn hàng, 2 hết, 1 chưa ánh xạ.
assert.deepStrictEqual({ ...box.stockViewCounts(rows) }, {
  webCodes: 3, stockRows: 5, eligible: 1, held: 0, low: 0, out: 2, unmapped: 1
});

console.log("stock view: OK");
