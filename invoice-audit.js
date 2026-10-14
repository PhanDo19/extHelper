(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceStatementAudit = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Rà soát sao kê ↔ phiếu trên website (chỉ đọc). Mỗi giao dịch doanh thu phải
  // có ĐÚNG MỘT phiếu trên website, đúng ngày, đúng tổng, chưa bị hủy. Đã có ca
  // giao dịch "Đã xử lý" mà phiếu không còn trên website — các bước khác không
  // thấy được vì chỉ nhìn những phiếu đang có trong danh sách.
  //
  // severity "error": phải xử lý trước khi phát hành/hạch toán.
  // severity "info": để biết (phiếu trên web không thuộc giao dịch nào).

  // Giao dịch người dùng đã loại khỏi doanh thu.
  const IGNORED_STATUSES = new Set(["skipped", "ignored"]);
  const STATUS_LABELS = {
    pending: "Chờ xử lý",
    review: "Cần kiểm tra",
    batch_ready: "Đã Accept (chưa Lưu API)",
    planned: "Chờ đối soát",
    already_issued: "Đã có HĐ khớp (chưa xác nhận)",
    needs_new_invoice: "Cần tạo phiếu",
    lookup_error: "Lỗi dò phiếu",
    error: "Lỗi"
  };
  const KIND_ORDER = ["missing_on_web", "cancelled", "duplicate_link", "done_no_invoice",
    "date_mismatch", "amount_mismatch", "unfinished", "web_unlinked"];

  const text = value => String(value == null ? "" : value).trim();
  const money = value => Math.round(Number(value) || 0);
  const viMoney = value => new Intl.NumberFormat("vi-VN").format(money(value));
  const viDate = dateKey => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(dateKey));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : text(dateKey);
  };
  const inRange = (dateKey, fromDate, toDate) =>
    Boolean(dateKey) && (!fromDate || dateKey >= fromDate) && (!toDate || dateKey <= toDate);

  // transactions: TOÀN BỘ sao kê của cơ sở (để biết phiếu nào đã gắn, kể cả gắn
  //   với giao dịch ngoài khoảng); chỉ giao dịch trong khoảng mới được rà.
  // webRows: phiếu trên website trong khoảng ({ invoiceNo, dateKey, grandTotal,
  //   issued, cancelled, soHoaDon }).
  // expectedGrand(transaction): tổng phiếu phải có (mức "Lập ở" hợp lệ hoặc sao kê).
  function audit(options) {
    const fromDate = text(options?.fromDate);
    const toDate = text(options?.toDate);
    const tolerance = Math.max(0, money(options?.tolerance ?? 1));
    const expectedGrand = typeof options?.expectedGrand === "function"
      ? options.expectedGrand
      : transaction => money(transaction?.credit);
    const all = (options?.transactions || []).filter(item => money(item?.credit) > 0);
    const revenue = all.filter(item =>
      inRange(text(item.transactionDate), fromDate, toDate) && !IGNORED_STATUSES.has(item.status));
    const webRows = (options?.webRows || []).filter(row => inRange(text(row.dateKey), fromDate, toDate));
    const webByNo = new Map();
    for (const row of webRows) {
      const no = text(row.invoiceNo);
      if (!no) continue;
      // Cùng mã mà có bản chưa hủy thì lấy bản đó.
      if (!webByNo.has(no) || (webByNo.get(no).cancelled && !row.cancelled)) webByNo.set(no, row);
    }
    const linkedAnywhere = new Set(all.map(item => text(item.invoiceNo)).filter(Boolean));
    const problems = [];
    const push = (kind, severity, fields) => problems.push({ kind, severity, ...fields });

    // Một phiếu chỉ được thuộc một giao dịch.
    const doneByNo = new Map();
    for (const item of revenue) {
      const no = text(item.invoiceNo);
      if (item.status !== "done" || !no) continue;
      doneByNo.set(no, [...(doneByNo.get(no) || []), item]);
    }
    for (const [no, items] of doneByNo) {
      if (items.length < 2) continue;
      push("duplicate_link", "error", {
        dateKey: text(items[0].transactionDate),
        amount: money(items[0].credit),
        invoiceNo: no,
        transactionIds: items.map(item => String(item.id)),
        detail: `Phiếu ${no} được gắn cho ${items.length} giao dịch (` +
          items.map(item => `${viDate(item.transactionDate)} · ${viMoney(item.credit)}đ`).join("; ") + ")",
        hint: "Một giao dịch phải có phiếu riêng: Đặt lại các giao dịch thừa rồi lập lại."
      });
    }

    for (const item of revenue) {
      const dateKey = text(item.transactionDate);
      const amount = money(item.credit);
      const no = text(item.invoiceNo);
      const base = { dateKey, amount, invoiceNo: no, transactionId: String(item.id) };
      if (item.status !== "done") {
        push("unfinished", "error", {
          ...base,
          detail: `Giao dịch ${STATUS_LABELS[item.status] || item.status} — chưa có phiếu đã lưu và đối soát.`,
          hint: item.status === "review"
            ? "Ở màn Giao dịch bấm Là doanh thu (hoặc Bỏ qua nếu không phải doanh thu)."
            : item.status === "already_issued"
              ? "Ở Batch Review bấm Xác nhận đã có HĐ nếu đúng phiếu đó."
              : "Chạy Batch Review → Accept → Lưu API cho ngày này."
        });
        continue;
      }
      if (!no) {
        push("done_no_invoice", "error", {
          ...base,
          detail: "Đã đánh dấu xử lý nhưng không gắn số phiếu.",
          hint: "Đặt lại giao dịch rồi lập lại để gắn đúng phiếu."
        });
        continue;
      }
      const row = webByNo.get(no);
      if (!row) {
        push("missing_on_web", "error", {
          ...base,
          detail: `Phiếu ${no} không còn trên website trong khoảng rà soát (bị xóa hoặc đổi sang ngày khác).`,
          hint: "Tìm phiếu trên website; nếu đã mất thì Hoàn kho & lập lại giao dịch."
        });
        continue;
      }
      if (row.cancelled) {
        push("cancelled", "error", {
          ...base,
          detail: `Phiếu ${no} đã bị hủy trên website.`,
          hint: "Lập phiếu thay thế cho giao dịch này."
        });
        continue;
      }
      if (text(row.dateKey) !== dateKey) {
        push("date_mismatch", "error", {
          ...base,
          detail: `Phiếu ${no} ngày ${viDate(row.dateKey)}, giao dịch ngày ${viDate(dateKey)}.`,
          hint: "Sửa ngày phiếu hoặc gắn lại đúng phiếu."
        });
      }
      const expected = money(expectedGrand(item)) || amount;
      const difference = money(row.grandTotal) - expected;
      if (Math.abs(difference) > tolerance) {
        push("amount_mismatch", "error", {
          ...base,
          detail: `Phiếu ${no} tổng ${viMoney(row.grandTotal)}đ, phải là ${viMoney(expected)}đ ` +
            `(lệch ${difference > 0 ? "+" : ""}${viMoney(difference)}đ).`,
          hint: "Phiếu bị sửa ngoài extension: Hoàn kho & lập lại, hoặc sửa lại phiếu."
        });
      }
    }

    // Phiếu trên web không thuộc giao dịch nào: phiếu nhân viên tự lập, hoặc
    // phiếu tạo dở khi mất phản hồi (dễ bị tính trùng doanh thu).
    for (const row of webRows) {
      const no = text(row.invoiceNo);
      if (!no || row.cancelled || linkedAnywhere.has(no)) continue;
      push("web_unlinked", "info", {
        dateKey: text(row.dateKey),
        amount: money(row.grandTotal),
        invoiceNo: no,
        detail: row.issued
          ? `Phiếu ${no} đã phát hành (Số ${text(row.soHoaDon) || "?"}) nhưng không thuộc giao dịch sao kê nào.`
          : `Phiếu ${no} chưa phát hành, không thuộc giao dịch sao kê nào.`,
        hint: row.issued
          ? "Kiểm tra doanh thu này có trong sao kê/danh sách số tiền không."
          : "Phiếu nhân viên tự lập hoặc phiếu tạo dở; kiểm tra trước khi phát hành để không trùng doanh thu."
      });
    }

    problems.sort((left, right) =>
      (left.severity === "error" ? 0 : 1) - (right.severity === "error" ? 0 : 1) ||
      left.dateKey.localeCompare(right.dateKey) ||
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
      left.amount - right.amount);

    // Tóm tắt theo ngày để thấy ngay ngày nào thiếu/thừa phiếu.
    const days = new Map();
    const day = key => {
      if (!days.has(key)) days.set(key, { dateKey: key, transactions: 0, matched: 0, webInvoices: 0, issued: 0, errors: 0 });
      return days.get(key);
    };
    for (const item of revenue) day(text(item.transactionDate)).transactions += 1;
    for (const row of webRows) {
      if (row.cancelled) continue;
      const entry = day(text(row.dateKey));
      entry.webInvoices += 1;
      if (row.issued) entry.issued += 1;
    }
    for (const problem of problems) if (problem.severity === "error") day(problem.dateKey).errors += 1;
    const okIds = new Set(revenue.map(item => String(item.id)));
    for (const problem of problems) {
      if (problem.severity === "error" && problem.transactionId) okIds.delete(problem.transactionId);
      for (const id of problem.transactionIds || []) okIds.delete(id);
    }
    for (const item of revenue) if (okIds.has(String(item.id))) day(text(item.transactionDate)).matched += 1;

    const errors = problems.filter(problem => problem.severity === "error");
    return {
      fromDate,
      toDate,
      revenueCount: revenue.length,
      matchedCount: okIds.size,
      webInvoiceCount: webRows.filter(row => !row.cancelled).length,
      errorCount: errors.length,
      infoCount: problems.length - errors.length,
      problems,
      days: [...days.values()].sort((left, right) => left.dateKey.localeCompare(right.dateKey))
    };
  }

  return { audit, IGNORED_STATUSES, STATUS_LABELS };
});
