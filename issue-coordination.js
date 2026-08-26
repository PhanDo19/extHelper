(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceIssueCoordination = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Điều phối phát hành giữa hai cơ sở.
  //
  // Số hóa đơn điện tử là dải dùng chung của cả Kim Giang lẫn Linh Đàm, nhưng
  // extension chạy trong tab của MỘT cơ sở và mọi dữ liệu nghiệp vụ đều tách
  // theo tenantKey(). Module này giữ đúng ba thứ phải dùng chung để hai tab
  // không giẫm chân nhau:
  //
  //   1. cờ thứ tự  — cơ sở nào phát hành trước trong cùng một ngày;
  //   2. sao kê đối chiếu — biết TRƯỚC cơ sở kia ngày đó có bao nhiêu giao dịch;
  //   3. chốt tiến độ — biết SAU khi họ đã phát hành tới đâu.
  //
  // Cả ba đều là dữ liệu rất mỏng: không mang phương án, phiếu hay tồn kho.

  const KIND = "invoice-target-issue-coordination";
  const SCHEMA_VERSION = 1;
  const TENANTS = Object.freeze(["parislinhdam", "pariskimgiang"]);
  const DEFAULT_FIRST_TENANT = "parislinhdam";

  const text = value => String(value == null ? "" : value).trim();
  const money = value => Math.max(0, Math.round(Number(value) || 0));

  function normalizeTenant(value) {
    const slug = text(value).toLowerCase();
    return TENANTS.includes(slug) ? slug : "";
  }

  function empty() {
    return {
      kind: KIND,
      schemaVersion: SCHEMA_VERSION,
      // Cờ này phải dùng chung. Để trong uiSession thì mỗi tab đọc một giá trị
      // khác nhau (uiSession lưu theo tenantKey) và cả hai bên đều có thể tưởng
      // mình đi trước — hỏng đúng thứ cần thống nhất.
      firstTenant: DEFAULT_FIRST_TENANT,
      // { [tenant]: { importedAt, days: { [dateKey]: { count, transactions } } } }
      //
      // Phải tách importedAt ra mức cơ sở, không nhét vào từng ngày: một sao kê
      // đã import nhưng không có giao dịch ngày D vẫn phải phân biệt được với
      // sao kê chưa import bao giờ. Hai trường hợp đó cần cảnh báo khác hẳn nhau.
      statements: {},
      // { [dateKey]: { [tenant]: { status, lastSoHoaDon, count, updatedAt } } }
      cursors: {}
    };
  }

  function normalize(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = empty();
    result.firstTenant = normalizeTenant(source.firstTenant) || DEFAULT_FIRST_TENANT;
    for (const tenant of TENANTS) {
      const entry = source.statements?.[tenant];
      if (!entry || typeof entry !== "object") continue;
      const days = {};
      for (const [dateKey, summary] of Object.entries(entry.days || {})) {
        const day = text(dateKey);
        if (!day) continue;
        const transactions = Array.isArray(summary?.transactions)
          ? summary.transactions
            .map(item => ({ at: text(item?.at), amount: money(item?.amount) }))
            .sort((left, right) => left.at.localeCompare(right.at))
          : [];
        days[day] = {
          count: Math.max(0, Math.round(Number(summary?.count) || transactions.length)),
          transactions
        };
      }
      result.statements[tenant] = { importedAt: text(entry.importedAt), days };
    }
    for (const [dateKey, byTenant] of Object.entries(source.cursors || {})) {
      const day = text(dateKey);
      if (!day || !byTenant || typeof byTenant !== "object") continue;
      for (const [tenant, cursor] of Object.entries(byTenant)) {
        const slug = normalizeTenant(tenant);
        if (!slug) continue;
        result.cursors[day] = result.cursors[day] || {};
        result.cursors[day][slug] = {
          status: cursor?.status === "running" ? "running" : "done",
          lastSoHoaDon: text(cursor?.lastSoHoaDon),
          count: Math.max(0, Math.round(Number(cursor?.count) || 0)),
          updatedAt: text(cursor?.updatedAt)
        };
      }
    }
    return result;
  }

  function otherTenant(tenant) {
    const slug = normalizeTenant(tenant);
    return TENANTS.find(item => item !== slug) || "";
  }

  function setFirstTenant(state, tenant) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    if (slug) next.firstTenant = slug;
    return next;
  }

  // Bảng tóm tắt trích từ sao kê vừa import. Chỉ giữ ngày, giờ và số tiền —
  // vừa đủ để cơ sở kia biết ngày đó có bao nhiêu việc, không hơn.
  function recordStatement(state, tenant, transactions, importedAt) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    if (!slug) return next;
    const stamp = text(importedAt) || new Date().toISOString();
    const days = {};
    for (const item of transactions || []) {
      const day = text(item?.transactionDate);
      if (!day || money(item?.credit) <= 0) continue;
      days[day] = days[day] || { count: 0, transactions: [] };
      days[day].count += 1;
      days[day].transactions.push({ at: text(item?.requestedAt), amount: money(item?.credit) });
    }
    for (const summary of Object.values(days)) {
      summary.transactions.sort((left, right) => left.at.localeCompare(right.at));
    }
    // Import lại thì thay hẳn, không cộng dồn: sao kê mới là nguồn sự thật.
    // importedAt được ghi kể cả khi không có giao dịch nào, để phân biệt
    // "đã import, ngày đó rỗng" với "chưa import bao giờ".
    next.statements[slug] = { importedAt: stamp, days };
    return next;
  }

  function hasStatement(state, tenant) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    return Boolean(slug && next.statements[slug]?.importedAt);
  }

  function statementSummary(state, tenant, dateKey) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    if (!slug) return null;
    return next.statements[slug]?.days?.[text(dateKey)] || null;
  }

  function markCursor(state, tenant, dateKey, cursor) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    const day = text(dateKey);
    if (!slug || !day) return next;
    next.cursors[day] = next.cursors[day] || {};
    next.cursors[day][slug] = {
      status: cursor?.status === "running" ? "running" : "done",
      lastSoHoaDon: text(cursor?.lastSoHoaDon),
      count: Math.max(0, Math.round(Number(cursor?.count) || 0)),
      updatedAt: text(cursor?.updatedAt) || new Date().toISOString()
    };
    return next;
  }

  function cursorFor(state, tenant, dateKey) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    return next.cursors[text(dateKey)]?.[slug] || null;
  }

  // Ngày lớn nhất mà một cơ sở đã phát hành xong.
  function latestIssuedDate(state, tenant) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    let latest = "";
    for (const [day, byTenant] of Object.entries(next.cursors)) {
      if (byTenant?.[slug]?.status !== "done") continue;
      if (!latest || day > latest) latest = day;
    }
    return latest;
  }

  // Toàn bộ cảnh báo chéo cơ sở cho một ngày. Tất cả đều là CHẶN MỀM: nêu rõ
  // trong hộp thoại xác nhận rồi để người dùng quyết định. Chặn cứng sẽ kẹt khi
  // một cơ sở không có hóa đơn nào trong ngày.
  function evaluate(state, tenant, dateKey) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    const day = text(dateKey);
    const other = otherTenant(slug);
    const warnings = [];
    if (!slug || !day) return { warnings, goesFirst: true, expectedOtherCount: null };

    const goesFirst = next.firstTenant === slug;
    const otherImported = hasStatement(next, other);
    const otherSummary = next.statements[other]?.days?.[day] || null;
    const otherCursor = next.cursors[day]?.[other] || null;
    const otherDone = otherCursor?.status === "done";

    if (!goesFirst) {
      if (!otherImported) {
        warnings.push({
          code: "missing_other_statement",
          text: `Chưa import sao kê của cơ sở kia nên không xác minh được họ đã phát hành ngày ${day} chưa. ` +
            "Theo cấu hình, cơ sở kia phát hành trước."
        });
      } else if (!otherDone && otherSummary && otherSummary.count > 0) {
        warnings.push({
          code: "other_should_go_first",
          text: `Theo cấu hình, cơ sở kia phát hành trước. Ngày ${day} họ có ${otherSummary.count} giao dịch ` +
            "nhưng chưa thấy chốt phát hành."
        });
      }
    }

    if (otherCursor?.status === "running") {
      warnings.push({
        code: "other_running",
        text: `Cơ sở kia đang phát hành dở ngày ${day}. Chạy cùng lúc sẽ trộn số hóa đơn.`
      });
    }

    const otherLatest = latestIssuedDate(next, other);
    if (otherLatest && otherLatest > day) {
      warnings.push({
        code: "other_ahead",
        text: `Cơ sở kia đã phát hành tới ngày ${otherLatest}, sau ngày ${day} của lô này. ` +
          "Số cấp bây giờ sẽ chèn ngược vào dải đã dùng."
      });
    }

    return {
      warnings,
      goesFirst,
      // null = chưa import sao kê (không biết); 0 = đã import, ngày đó họ không
      // có giao dịch nào. Hai thứ này phải phân biệt được ở phía gọi.
      expectedOtherCount: otherImported ? (otherSummary?.count || 0) : null,
      otherDone
    };
  }

  // Sau khi chạy xong một lô: số hóa đơn trong ngày có liên tục không. Đứt quãng
  // thường nghĩa là cơ sở kia đã chen vào giữa, hoặc có hóa đơn phát hành ngoài
  // extension.
  function checkContinuity(numbers) {
    const parsed = (numbers || [])
      .map(value => Number(String(value).replace(/\D/g, "")))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((left, right) => left - right);
    if (parsed.length < 2) return { ok: true, gaps: [], from: parsed[0] ?? null, to: parsed[0] ?? null };
    const gaps = [];
    for (let index = 1; index < parsed.length; index += 1) {
      const previous = parsed[index - 1];
      const current = parsed[index];
      if (current - previous > 1) gaps.push({ after: previous, before: current, missing: current - previous - 1 });
    }
    return { ok: !gaps.length, gaps, from: parsed[0], to: parsed[parsed.length - 1] };
  }

  return {
    KIND,
    SCHEMA_VERSION,
    TENANTS,
    DEFAULT_FIRST_TENANT,
    empty,
    normalize,
    otherTenant,
    setFirstTenant,
    recordStatement,
    hasStatement,
    statementSummary,
    markCursor,
    cursorFor,
    latestIssuedDate,
    evaluate,
    checkContinuity
  };
});
