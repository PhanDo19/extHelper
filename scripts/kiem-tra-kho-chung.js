// KIỂM TRA KHO CHUNG Kim Giang + Linh Đàm (CHỈ ĐỌC, không ghi gì).
// Trả lời: Kim Giang có đang thấy đúng kho chung mà Linh Đàm vừa trừ không?
//
// Cách dùng:
//   1. Ở trang banhang (cơ sở nào cũng được), F12 -> tab Console.
//   2. Ô chọn ngữ cảnh ở góc trên bên trái Console (đang ghi "top"): chọn
//      "Khớp tổng tiền hóa đơn - MVP". Không chọn thì sẽ báo thiếu chrome.storage.
//   3. Dán toàn bộ file -> Enter. Chép toàn bộ kết quả gửi lại.
(async () => {
  if (!globalThis.chrome?.storage?.local) {
    console.error('Chưa chọn đúng ngữ cảnh: ở ô "top" góc trên Console, chọn "Khớp tổng tiền hóa đơn - MVP" rồi dán lại.');
    return;
  }
  const all = await chrome.storage.local.get(null);
  const qty = value => Math.max(0, Math.floor(Number(value) || 0));
  const time = value => value ? new Date(value).toLocaleString("vi-VN") : "—";
  const stockRows = dataset => (dataset?.mappings || []).filter(row => row.availabilityMode !== "per_invoice");
  const units = rows => rows.reduce((sum, row) => sum + qty(row.availableQty), 0);

  const warehouse = all.invoiceTargetSharedWarehouseV1;
  const tenants = [
    { label: "Kim Giang", slug: "pariskimgiang", suffix: "" },
    { label: "Linh Đàm", slug: "parislinhdam", suffix: "__parislinhdam" }
  ];

  console.log("%c===== KHO CHUNG Kim Giang + Linh Đàm =====", "font-weight:bold");
  if (!warehouse) console.warn("Không có bản ghi kho chung.");
  else {
    console.log({
      "Đã khởi tạo": Boolean(warehouse.initialized),
      "Nguồn": warehouse.source || "—",
      "Cập nhật lúc": time(warehouse.updatedAt),
      "Số mã": (warehouse.items || []).length,
      "Tổng đơn vị còn": units(warehouse.items || [])
    });
    const recent = (warehouse.ledger || []).slice(-12).reverse();
    if (recent.length) {
      console.log("12 lần thay đổi kho chung gần nhất (mới nhất trước):");
      console.table(recent.map(entry => ({
        "Lúc": time(entry.at), "Loại": entry.type, "Cơ sở": entry.tenant || "—",
        "Phiếu": String(entry.invoiceNo || "").slice(0, 40), "Số mã đổi": (entry.changes || []).length
      })));
    }
  }

  const byCode = new Map((warehouse?.items || []).map(item => [String(item.stockCode), qty(item.availableQty)]));
  const summary = [];
  for (const tenant of tenants) {
    const mapping = all[`invoiceTargetMappingDataset${tenant.suffix}`];
    const ledger = all[`invoiceTargetVerificationLedger${tenant.suffix}`];
    const meta = all[`invoiceTargetStockStateMeta${tenant.suffix}`];
    const rows = stockRows(mapping);
    const lastVerified = (ledger?.entries || []).map(entry => entry.verifiedAt || "").sort().at(-1) || "";
    const lastInWarehouse = (warehouse?.ledger || [])
      .filter(entry => entry.tenant === tenant.slug && entry.type === "invoice")
      .map(entry => entry.at || "").sort().at(-1) || "";
    const differ = rows.filter(row => byCode.has(String(row.stockCode)) && qty(row.availableQty) !== byCode.get(String(row.stockCode)));
    summary.push({ tenant, rows, differ, lastVerified, lastInWarehouse });
    console.log(`%c----- ${tenant.label} -----`, "font-weight:bold");
    console.log({
      "Số dòng kho trong ánh xạ": rows.length,
      "Tổng đơn vị theo ánh xạ": units(rows),
      "Nguồn ánh xạ": mapping?.source || "—",
      "Nhập trạng thái tồn riêng (JSON) lúc": meta?.importedAt ? `${time(meta.importedAt)} (${meta.sourceFile || ""})` : "chưa",
      "Phiếu đối soát gần nhất": time(lastVerified),
      "Lần trừ kho chung gần nhất của cơ sở này": time(lastInWarehouse),
      "Số mã lệch với kho chung": differ.length
    });
    if (differ.length) {
      console.table(differ.slice(0, 15).map(row => ({
        "Mã kho": row.stockCode, "Tên": row.stockName, "Theo ánh xạ": qty(row.availableQty), "Kho chung": byCode.get(String(row.stockCode))
      })));
    }
  }

  console.log("%c===== KẾT LUẬN =====", "font-weight:bold");
  const linhDam = summary.find(item => item.tenant.slug === "parislinhdam");
  const kimGiang = summary.find(item => item.tenant.slug === "pariskimgiang");
  if (!warehouse?.initialized) {
    console.warn("Kho chung CHƯA KHỞI TẠO: mỗi cơ sở đang trừ vào tồn riêng của mình, nên hàng Linh Đàm đã dùng không trừ sang Kim Giang.");
  } else if (linhDam.lastVerified && linhDam.lastVerified > (linhDam.lastInWarehouse || "")) {
    console.warn(`Linh Đàm có phiếu đối soát lúc ${time(linhDam.lastVerified)} nhưng lần trừ kho chung gần nhất của Linh Đàm là ${time(linhDam.lastInWarehouse)}: ` +
      "có phiếu Linh Đàm chưa trừ vào kho chung.");
  } else if (kimGiang.differ.length) {
    console.warn(`Kim Giang còn ${kimGiang.differ.length} mã khác kho chung: tab Kim Giang đang giữ số cũ. F5 tab Kim Giang (sau khi đã đăng nhập Kim Giang) rồi xem lại.`);
  } else {
    console.log("Kim Giang đang khớp kho chung. Nếu màn hình vẫn hiện số cũ thì F5 tab Kim Giang.");
  }
})();
