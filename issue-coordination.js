(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceIssueCoordination = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Điều phối phát hành giữa các cơ sở.
  //
  // Số hóa đơn điện tử là dải dùng chung của mọi cơ sở, nhưng extension chạy
  // trong tab của MỘT cơ sở và mọi dữ liệu nghiệp vụ đều tách theo tenantKey().
  // Module này giữ đúng ba thứ phải dùng chung để các cơ sở không giẫm chân nhau:
  //
  //   1. dãy thứ tự — cơ sở nào phát hành trước trong cùng một ngày;
  //   2. sao kê đối chiếu — biết TRƯỚC cơ sở khác ngày đó có bao nhiêu giao dịch;
  //   3. chốt tiến độ — biết SAU khi họ đã phát hành tới đâu.
  //
  // Cả ba đều là dữ liệu rất mỏng: không mang phương án, phiếu hay tồn kho.

  const KIND = "invoice-target-issue-coordination";
  const SCHEMA_VERSION = 1;
  const TENANTS = Object.freeze(["parislinhdam", "pariskimgiang", "parisnhon"]);
  // Thu tu phat hanh mac dinh. Voi hai co so thi mot co "ai di truoc" la du,
  // nhung tu ba co so tro len phai la MOT DAY THU TU day du: chi biet ai dau
  // tien khong noi len co so thu hai va thu ba xep the nao.
  const DEFAULT_TENANT_ORDER = Object.freeze(["parislinhdam", "pariskimgiang", "parisnhon"]);

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
      // Thứ tự này phải dùng chung. Để trong uiSession thì mỗi cơ sở đọc một giá
      // trị khác nhau (uiSession lưu theo tenantKey) và ai cũng có thể tưởng mình
      // đi trước — hỏng đúng thứ cần thống nhất.
      tenantOrder: [...DEFAULT_TENANT_ORDER],
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
    result.tenantOrder = normalizeOrder(source.tenantOrder, source.firstTenant);
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

  // Chuan hoa day thu tu: bo ma la, bo trung, va bo sung co so con thieu theo
  // thu tu mac dinh de day luon phu het TENANTS.
  //
  // legacyFirstTenant lo cac ban ghi ghi truoc khi co day thu tu (chi co
  // firstTenant): dua co so do len dau, phan con lai giu thu tu mac dinh.
  function normalizeOrder(value, legacyFirstTenant) {
    const seen = new Set();
    const order = [];
    for (const item of Array.isArray(value) ? value : []) {
      const slug = normalizeTenant(item);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);
      order.push(slug);
    }
    if (!order.length) {
      const legacy = normalizeTenant(legacyFirstTenant);
      if (legacy) {
        order.push(legacy);
        seen.add(legacy);
      }
    }
    for (const slug of DEFAULT_TENANT_ORDER) {
      if (!seen.has(slug)) order.push(slug);
    }
    return order;
  }

  // Cac co so phai phat hanh TRUOC co so nay trong cung mot ngay.
  function tenantsBefore(state, tenant) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    const index = next.tenantOrder.indexOf(slug);
    return index <= 0 ? [] : next.tenantOrder.slice(0, index);
  }

  // Cac co so phat hanh SAU co so nay.
  function tenantsAfter(state, tenant) {
    const next = normalize(state);
    const slug = normalizeTenant(tenant);
    const index = next.tenantOrder.indexOf(slug);
    return index < 0 ? [] : next.tenantOrder.slice(index + 1);
  }

  function setTenantOrder(state, order) {
    const next = normalize(state);
    next.tenantOrder = normalizeOrder(order);
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
    const warnings = [];
    if (!slug || !day) {
      return { warnings, goesFirst: true, pendingBefore: [], nextTenants: [], orderIndex: -1 };
    }

    const before = tenantsBefore(next, slug);
    const after = tenantsAfter(next, slug);
    const orderIndex = next.tenantOrder.indexOf(slug);
    const goesFirst = orderIndex === 0;

    // Mọi cơ sở đứng trước trong dãy đều phải xong ngày này trước. Với ba cơ sở
    // trở lên, chỉ kiểm "cơ sở kia" là không đủ: Nhơn đứng thứ ba phải chờ CẢ
    // Linh Đàm lẫn Kim Giang, bỏ sót một bên là số hóa đơn chèn vào giữa dải.
    const pendingBefore = [];
    const unknownBefore = [];
    for (const earlier of before) {
      const cursor = next.cursors[day]?.[earlier] || null;
      if (cursor?.status === "done") continue;
      if (!hasStatement(next, earlier)) {
        unknownBefore.push(earlier);
        continue;
      }
      const summary = next.statements[earlier]?.days?.[day] || null;
      // Cơ sở đứng trước không có giao dịch nào ngày đó thì không phải chờ.
      if (summary && summary.count > 0) pendingBefore.push({ tenant: earlier, count: summary.count });
    }
    if (unknownBefore.length) {
      warnings.push({
        code: "missing_other_statement",
        text: `Chưa import sao kê của ${unknownBefore.join(", ")} nên không xác minh được ` +
          `họ đã phát hành ngày ${day} chưa. Theo thứ tự cấu hình, các cơ sở này phát hành trước.`
      });
    }
    if (pendingBefore.length) {
      warnings.push({
        code: "other_should_go_first",
        text: "Theo thứ tự cấu hình, các cơ sở sau phát hành trước và ngày " + day + " vẫn còn việc: " +
          pendingBefore.map(item => `${item.tenant} (${item.count} giao dịch)`).join(", ") + "."
      });
    }

    // Các cơ sở dùng chung một domain nên cookie phiên ghi đè nhau: đăng nhập cơ
    // sở này đá cơ sở kia ra màn hình login. Vì vậy KHÔNG thể có hai lô chạy
    // đồng thời, và chốt còn kẹt ở "running" nghĩa là lô trước bị đứt giữa
    // chừng — đóng tab, mất mạng, hoặc hết phiên. Đó mới là điều đáng cảnh báo:
    // một phần hóa đơn có thể đã được cấp số mà chưa vào sổ.
    const interrupted = TENANTS.filter(item =>
      item !== slug && next.cursors[day]?.[item]?.status === "running");
    if (interrupted.length) {
      warnings.push({
        code: "other_interrupted",
        text: `Lô phát hành của ${interrupted.join(", ")} ngày ${day} chưa chạy xong (dừng giữa chừng). ` +
          "Kiểm tra bên đó đã phát hành tới số nào trước khi chạy tiếp, tránh bỏ sót hoặc trùng."
      });
    }
    // Chính cơ sở này cũng có thể có lô đứt dở — cùng lý do, và còn sát sườn hơn.
    if (next.cursors[day]?.[slug]?.status === "running") {
      warnings.push({
        code: "self_interrupted",
        text: `Lô phát hành của chính cơ sở này ngày ${day} lần trước chưa chạy xong. ` +
          "Kiểm tra lại danh sách để không phát hành trùng."
      });
    }

    // Cơ sở nào đã vượt sang ngày sau thì số cấp bây giờ sẽ chèn ngược vào dải
    // đã dùng. Xét mọi cơ sở khác, không riêng cơ sở đứng trước.
    const ahead = [];
    for (const item of TENANTS) {
      if (item === slug) continue;
      const latest = latestIssuedDate(next, item);
      if (latest && latest > day) ahead.push(`${item} (tới ${latest})`);
    }
    if (ahead.length) {
      warnings.push({
        code: "other_ahead",
        text: `${ahead.join(", ")} đã phát hành sang ngày sau ngày ${day} của lô này. ` +
          "Số cấp bây giờ sẽ chèn ngược vào dải đã dùng."
      });
    }

    return {
      warnings,
      goesFirst,
      orderIndex,
      // Cơ sở đứng trước còn việc chưa phát hành ngày này.
      pendingBefore,
      // Cơ sở đứng sau, dùng để nhắc chuyển tiếp sau khi chạy xong.
      nextTenants: after
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
    DEFAULT_TENANT_ORDER,
    empty,
    normalize,
    normalizeOrder,
    tenantsBefore,
    tenantsAfter,
    setTenantOrder,
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
