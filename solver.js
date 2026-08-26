(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceTargetSolver = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) [a, b] = [b, a % b];
    return a;
  }

  function gcdAll(values) {
    return values.reduce((result, value) => gcd(result, value), 0) || 1;
  }

  function deriveGoodsTarget(currentGoods, currentGrand, targetGrand, taxRate) {
    const currentHour = derivePreTax(currentGrand, taxRate) - Number(currentGoods || 0);
    return deriveInvoiceTargets(targetGrand, currentHour, taxRate).goodsTarget;
  }

  function derivePreTax(grandTotal, taxRate) {
    return inclusiveVatTargets(grandTotal, taxRate).preTaxTarget;
  }

  // Website tính VAT trên tiền hàng + tiền giờ rồi cộng VAT vào tổng. Khi đầu
  // vào là tổng sao kê đã gồm VAT, phải chia ngược cho 1 + thuế suất.
  function inclusiveVatTargets(grandTotal, taxRate) {
    const grand = Math.max(0, Math.round(Number(grandTotal) || 0));
    const rate = Math.max(0, Number(taxRate) || 0);
    if (!grand || !rate) {
      return {
        preTaxTarget: grand,
        vatTarget: 0,
        calculatedGrand: grand,
        grandReachable: grand > 0,
        reachableAlternatives: grand > 0 ? [grand] : []
      };
    }
    const estimate = Math.max(0, Math.round(grand / (1 + rate / 100)));
    const candidates = [];
    for (let preTax = Math.max(0, estimate - 8); preTax <= estimate + 8; preTax += 1) {
      const vat = Math.max(0, Math.round(preTax * rate / 100));
      const calculatedGrand = preTax + vat;
      candidates.push({
        preTaxTarget: preTax,
        vatTarget: vat,
        calculatedGrand,
        difference: calculatedGrand - grand
      });
    }
    candidates.sort((left, right) =>
      Math.abs(left.difference) - Math.abs(right.difference) ||
      Math.abs(left.preTaxTarget - estimate) - Math.abs(right.preTaxTarget - estimate) ||
      left.preTaxTarget - right.preTaxTarget
    );
    const best = candidates[0];
    const reachableAlternatives = [...new Set(candidates.map(item => item.calculatedGrand))]
      .sort((left, right) => Math.abs(left - grand) - Math.abs(right - grand) || left - right)
      .slice(0, 2);
    return {
      preTaxTarget: best.preTaxTarget,
      vatTarget: best.vatTarget,
      calculatedGrand: best.calculatedGrand,
      grandReachable: best.calculatedGrand === grand,
      reachableAlternatives
    };
  }

  function statementVat(grandTotal, taxRate) {
    return inclusiveVatTargets(grandTotal, taxRate).vatTarget;
  }

  function deriveInvoiceTargets(targetGrand, currentHour, taxRate) {
    const grand = Math.max(0, Math.round(Number(targetGrand) || 0));
    const inclusive = inclusiveVatTargets(grand, taxRate);
    return {
      preTaxTarget: inclusive.preTaxTarget,
      vatTarget: inclusive.vatTarget,
      grandReachable: inclusive.grandReachable,
      calculatedGrand: inclusive.calculatedGrand,
      reachableAlternatives: inclusive.reachableAlternatives,
      currentHour: Math.max(0, Math.round(Number(currentHour || 0))),
      goodsTarget: Math.max(0, Math.round(inclusive.preTaxTarget - Number(currentHour || 0)))
    };
  }

  function reconcileHourAmount(goodsAmount, preTaxTarget, roundedHourAmount) {
    const goods = Math.round(Number(goodsAmount) || 0);
    const preTax = Math.round(Number(preTaxTarget) || 0);
    const finalHourAmount = preTax - goods;
    const hourFromTime = roundedHourAmount == null
      ? finalHourAmount
      : Math.round(Number(roundedHourAmount) || 0);
    return {
      finalHourAmount,
      hourFromTime,
      hourAdjustment: finalHourAmount - hourFromTime
    };
  }

  const REALISTIC_MAX_BY_WEB_CODE = Object.freeze({
    "1000064": 2 // Hạt Mắc Ca hộp 500g
  });

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toUpperCase();
  }

  function recommendInvoiceLimit(stock) {
    const code = String(stock?.webCode || stock?.code || "");
    const explicit = Number(REALISTIC_MAX_BY_WEB_CODE[code]);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    if (stock?.availabilityMode === "per_invoice") {
      return Math.max(1, Math.floor(Number(stock.availableQty) || 1));
    }

    const name = normalizeSearchText(stock?.webName || stock?.name);
    const unit = normalizeSearchText(stock?.webUnit || stock?.unit);
    if (code.startsWith("15")) return 1;
    if (code.startsWith("13")) return 1;
    if (code.startsWith("14")) return 2;
    if (code.startsWith("11")) return name.includes("BIA") ? 12 : 6;
    if (code.startsWith("10")) {
      if (unit.includes("HOP")) return 2;
      if (unit.includes("GOI")) return 3;
      return 4;
    }
    return 4;
  }

  function scoreQuantities(qty, current, items, options) {
    const opts = options || {};
    let changedLines = 0;
    let changedUnits = 0;
    let totalUnits = 0;
    let activeLines = 0;
    let concentrationPenalty = 0;
    let selectionPenalty = 0;
    for (let i = 0; i < qty.length; i += 1) {
      if (qty[i] !== current[i]) changedLines += 1;
      changedUnits += Math.abs(qty[i] - current[i]);
      totalUnits += qty[i];
      if (qty[i] > 0) activeLines += 1;
      concentrationPenalty += Math.max(0, qty[i] - 1) ** 2;
      if (qty[i] > 0) selectionPenalty += Math.max(0, Number(items[i]?.selectionPenalty) || 0);
    }
    const preferredLineCount = Math.max(1, Math.round(Number(opts.preferredLineCount) || 4));
    const lineCountPenalty = Math.abs(activeLines - preferredLineCount);
    // concentrationWeight thấp => cho phép dồn nhiều số lượng vào một mã thay vì
    // luôn rải mỗi mã 1 cái. selectionWeight cao => mã vừa bị loại ở lần tính
    // trước thực sự bị đẩy ra, nếu không hình phạt tập trung sẽ lấn át và tính
    // lại cho ra đúng tổ hợp cũ.
    const concentrationWeight = Math.max(0, Number(opts.concentrationWeight ?? 10000));
    const selectionWeight = Math.max(0, Number(opts.selectionWeight ?? 100));
    // unitWeight > 0 nghĩa là ưu tiên phương án có tổng số lượng LỚN hơn (điểm
    // càng thấp càng tốt nên phải trừ đi). Mặc định giữ nguyên hành vi cũ là
    // cộng totalUnits, tức chuộng phương án ít hàng.
    const unitWeight = Number(opts.unitWeight ?? 0);
    const unitScore = unitWeight > 0 ? -totalUnits * unitWeight : totalUnits;
    return lineCountPenalty * 100000 +
      concentrationPenalty * concentrationWeight +
      selectionPenalty * selectionWeight +
      changedLines * 1000 +
      changedUnits * 10 +
      unitScore;
  }

  function solveQuantities(items, targetAmount, options) {
    const opts = Object.assign({
      maxQty: 99,
      tolerance: 5000,
      maxStates: 120000,
      maxActiveLines: Number.POSITIVE_INFINITY
    }, options || {});
    const usable = items.filter(item => Number(item.price) > 0);
    if (!usable.length) return { ok: false, reason: "Không có dòng hàng có đơn giá hợp lệ." };

    const prices = usable.map(item => Math.round(Number(item.price)));
    const current = usable.map(item => Math.max(0, Math.round(Number(item.qty) || 0)));
    // Scale by the common price unit (typically 5,000đ on this system). Including
    // a zero-tolerance sentinel would collapse the scale to 1 and make the DP
    // unnecessarily large in the browser.
    const scale = gcdAll(prices);
    const scaledPrices = prices.map(price => Math.max(1, Math.round(price / scale)));
    const scaledTarget = Math.max(0, Math.round(Number(targetAmount) / scale));
    const scaledTolerance = Math.max(0, Math.ceil(Number(opts.tolerance) / scale));
    const minGoodsAmount = Math.max(0, Math.round(Number(opts.minGoodsAmount) || 0));
    const maxGoodsAmount = Math.max(0, Math.round(Number(opts.maxGoodsAmount) || 0));
    const scaledMinGoods = Math.max(0, Math.ceil(minGoodsAmount / scale));
    const scaledPlanningTarget = Math.max(scaledTarget, scaledMinGoods);
    const requiredAmount = usable.reduce((sum, item, index) => sum + Math.max(0, Math.floor(Number(item.minQty) || 0)) * scaledPrices[index], 0);
    const maxAmount = Math.max(
      scaledPlanningTarget + scaledTolerance + Math.max(...scaledPrices),
      requiredAmount + Math.max(...scaledPrices)
    );

    let states = new Map([[0, []]]);
    for (let index = 0; index < usable.length; index += 1) {
      const next = new Map();
      const price = scaledPrices[index];
      for (const [amount, quantities] of states) {
        const itemLimit = Number.isFinite(Number(usable[index].maxQty)) ? Math.max(0, Math.floor(Number(usable[index].maxQty))) : opts.maxQty;
        const activeLinesUsed = quantities.reduce((sum, value) => sum + (Number(value) > 0 ? 1 : 0), 0);
        let groupRemaining = Number.POSITIVE_INFINITY;
        const group = usable[index].constraintGroup;
        const groupMax = Number(usable[index].constraintGroupMax);
        if (group && Number.isFinite(groupMax)) {
          let groupUsed = 0;
          for (let previousIndex = 0; previousIndex < index; previousIndex += 1) {
            if (usable[previousIndex].constraintGroup === group) groupUsed += Number(quantities[previousIndex] || 0);
          }
          groupRemaining = Math.max(0, Math.floor(groupMax - groupUsed));
        }
        const lower = Math.max(0, Math.floor(Number(usable[index].minQty) || 0));
        const upper = Math.min(opts.maxQty, itemLimit, groupRemaining, Math.floor((maxAmount - amount) / price));
        for (let qty = lower; qty <= upper; qty += 1) {
          if (qty > 0 && activeLinesUsed >= Number(opts.maxActiveLines)) continue;
          const newAmount = amount + qty * price;
          const candidate = quantities.concat(qty);
          const existing = next.get(newAmount);
          if (!existing || scoreQuantities(candidate, current.slice(0, candidate.length), usable.slice(0, candidate.length), opts) <
            scoreQuantities(existing, current.slice(0, existing.length), usable.slice(0, existing.length), opts)) {
            next.set(newAmount, candidate);
          }
        }
      }
      if (next.size > opts.maxStates) {
        const ranked = [...next.entries()].sort((a, b) => {
          const da = Math.abs(a[0] - scaledPlanningTarget);
          const db = Math.abs(b[0] - scaledPlanningTarget);
          return da - db ||
            scoreQuantities(a[1], current.slice(0, a[1].length), usable.slice(0, a[1].length), opts) -
            scoreQuantities(b[1], current.slice(0, b[1].length), usable.slice(0, b[1].length), opts);
        });
        states = new Map(ranked.slice(0, opts.maxStates));
      } else {
        states = next;
      }
    }

    // Hóa đơn thật hiếm khi dồn hết tiền vào một nhóm hàng. Đo mức lệch cơ cấu:
    // phần tiền vượt trần của nhóm lớn nhất, cộng phạt nếu quá ít nhóm.
    const maxGroupShare = Number(opts.maxGroupShare) || 0;
    const minGroupCount = Math.max(0, Math.round(Number(opts.minGroupCount) || 0));
    function groupImbalance(quantities, goodsAmount) {
      if ((!maxGroupShare && !minGroupCount) || goodsAmount <= 0) return 0;
      const totals = new Map();
      for (let index = 0; index < quantities.length; index += 1) {
        const qty = Number(quantities[index]) || 0;
        if (qty <= 0) continue;
        const group = String(usable[index].productGroup || "");
        if (!group) continue;
        totals.set(group, (totals.get(group) || 0) + qty * prices[index]);
      }
      if (!totals.size) return 0;
      let excess = 0;
      if (maxGroupShare > 0) {
        const cap = goodsAmount * maxGroupShare;
        for (const amount of totals.values()) excess += Math.max(0, amount - cap);
      }
      // Thiếu nhóm bị quy đổi thành tiền để so sánh cùng thang với phần vượt trần.
      const missingGroups = Math.max(0, minGroupCount - totals.size);
      return Math.round(excess + missingGroups * goodsAmount * 0.25);
    }

    // Số lượng tối thiểu theo NHÓM, đối xứng với constraintGroupMax ở trên.
    // "Ít nhất 3 bia" là ràng buộc trên tổng của mọi mã bia, không phải trên
    // một mã cụ thể, nên 2 Tiger + 1 Hà Nội vẫn hợp lệ.
    //
    // Phải kiểm tra ở vòng chấm điểm này chứ không phải trong vòng mở rộng DP:
    // tổng của một nhóm chỉ biết được khi đã duyệt hết mọi item của nhóm đó,
    // mà DP mở rộng theo từng item một.
    const groupMinimums = new Map();
    for (const item of usable) {
      const group = String(item.constraintGroup || "");
      const minimum = Math.max(0, Math.floor(Number(item.constraintGroupMin) || 0));
      if (!group || !minimum) continue;
      groupMinimums.set(group, Math.max(groupMinimums.get(group) || 0, minimum));
    }
    function groupShortfall(quantities) {
      if (!groupMinimums.size) return 0;
      const totals = new Map();
      for (let index = 0; index < quantities.length; index += 1) {
        const group = String(usable[index].constraintGroup || "");
        if (!group || !groupMinimums.has(group)) continue;
        totals.set(group, (totals.get(group) || 0) + (Number(quantities[index]) || 0));
      }
      let shortfall = 0;
      for (const [group, minimum] of groupMinimums) {
        shortfall += Math.max(0, minimum - (totals.get(group) || 0));
      }
      return shortfall;
    }

    let best = null;
    for (const [amount, quantities] of states) {
      const actual = amount * scale;
      const difference = actual - targetAmount;
      const hourStep = Math.max(0, Math.round(Number(opts.hourStep) || 0));
      const preTaxTarget = Math.max(0, Math.round(Number(opts.preTaxTarget) || 0));
      const requiredHour = hourStep && preTaxTarget ? preTaxTarget - actual : 0;
      const exactMinHourAmount = Math.max(0, Math.round(Number(opts.minHourAmount) || 0));
      const exactMaxHourAmount = Math.max(0, Math.round(Number(opts.maxHourAmount) || 0));
      // The baseline minimum is a planning preference and may shrink for a
      // small invoice. The maximum is the accounting safety cap and must not
      // be exceeded by a fallback combination.
      if (opts.enforceHourRange && hourStep && exactMaxHourAmount && requiredHour > exactMaxHourAmount) continue;
      if (opts.requireHourStepExact && hourStep && requiredHour < exactMinHourAmount) continue;
      if (opts.requireHourStepExact && hourStep && exactMaxHourAmount && requiredHour > exactMaxHourAmount) continue;
      if (opts.requireHourStepExact && hourStep && requiredHour >= 0 && requiredHour % hourStep !== 0) continue;
      const hourActual = hourStep && requiredHour >= 0 ? Math.max(0, Math.ceil(requiredHour / hourStep) * hourStep) : null;
      const preTaxDifference = hourActual == null ? null : actual + hourActual - preTaxTarget;
      const finalAbs = preTaxDifference == null ? Math.abs(difference) : Math.abs(preTaxDifference);
      const hourDeviation = hourActual == null ? 0 : Math.abs(hourActual - Number(opts.currentHour || 0));
      const quantityScore = scoreQuantities(quantities, current, usable, opts);
      // Hóa đơn phải luôn có Tiền giờ: tổ hợp nào ăn hết phần tiền giờ (hoặc để
      // lại quá ít) bị xếp sau, để solver ưu tiên phương án tiền hàng thấp hơn
      // và chừa đủ chỗ cho tiền giờ. Vẫn giữ lại làm phương án dự phòng nếu
      // không còn lựa chọn nào khác.
      const minHourAmount = Math.max(0, Math.round(Number(opts.minHourAmount) || 0));
      // requiredHour < 0 nghĩa là tiền hàng đã ăn hết phần trước VAT nên không
      // còn chỗ cho Tiền giờ. Trước đây hourActual = null làm hai mức phạt dưới
      // bị bỏ qua, khiến tổ hợp vỡ trần lại đạt hourRangeViolation = 0 và thắng
      // mọi phương án hợp lệ. Phần âm phải bị tính là thiếu hụt đúng bằng độ vỡ.
      const overshoot = hourStep && preTaxTarget && requiredHour < 0
        ? Math.abs(requiredHour)
        : 0;
      const hourShortfall = overshoot > 0
        ? minHourAmount + overshoot
        : (hourActual == null || !minHourAmount ? 0 : Math.max(0, minHourAmount - hourActual));
      const maxHourAmount = Math.max(0, Math.round(Number(opts.maxHourAmount) || 0));
      const hourExcess = hourActual == null || !maxHourAmount
        ? 0
        : Math.max(0, hourActual - maxHourAmount);
      const hourRangeViolation = hourShortfall + hourExcess;
      // Vượt maxGoodsAmount vẫn hợp lệ nhưng bị xếp sau: đây là sàn mềm giữ cho
      // tỷ lệ tiền giờ/tiền hàng gần với hóa đơn thật.
      const goodsExcess = maxGoodsAmount > 0 ? Math.max(0, actual - maxGoodsAmount) : 0;
      const goodsShortfall = Math.max(0, minGoodsAmount - actual) + goodsExcess;
      const imbalance = groupImbalance(quantities, actual);
      // Tổng phạt "mã vừa bị loại ở lần tính trước". Phải so sánh TRƯỚC cơ cấu
      // nhóm, nếu không nút Tính toán lại sẽ luôn trả về đúng tổ hợp cũ vì
      // imbalance lấn át hoàn toàn selectionPenalty nằm trong quantityScore.
      let rejection = 0;
      for (let i = 0; i < quantities.length; i += 1) {
        if (Number(quantities[i]) > 0) rejection += Math.max(0, Number(usable[i]?.selectionPenalty) || 0);
      }
      // Món hàng bắt buộc là ràng buộc nghiệp vụ cứng nhất: hóa đơn thiếu bia
      // hoặc thiếu khăn ướt là sai luật, trong khi lệch tiền giờ chỉ là kém đẹp.
      // Vì vậy nó được so sánh TRƯỚC mọi tiêu chí khác.
      const missingRequired = groupShortfall(quantities);
      // Thứ tự: món hàng bắt buộc trước, rồi tới ràng buộc cứng (giờ, tỷ lệ
      // hàng, khớp tuyệt đối), rồi né tổ hợp vừa bị bỏ, cơ cấu nhóm, cuối cùng
      // là các tiêu chí thẩm mỹ.
      // So sanh theo thu tu uu tien tu dinh xuong day: tieu chi dung truoc quyet
      // dinh truoc, chi khi hoa moi xet tieu chi sau. Truoc day day la mot chuoi
      // dieu kien long nhau; moi lan them tieu chi phai sua lai toan bo cac nhanh
      // phia sau, va sot mot nhanh la tieu chi moi bi bo qua trong im lang.
      const ranking = [
        missingRequired,      // mon hang bat buoc — rang buoc nghiep vu cung nhat
        hourRangeViolation,   // tien gio phai nam trong khoang cho phep
        goodsShortfall,       // ty le tien hang
        finalAbs,             // do lech so voi muc tieu
        hourDeviation,        // gan gio hien tai
        rejection,            // ne to hop vua bi bo
        imbalance,            // co cau nhom hang
        quantityScore         // tieu chi tham my
      ];
      const better = !best || ranking.some((value, index) => {
        for (let earlier = 0; earlier < index; earlier += 1) {
          if (ranking[earlier] !== best.ranking[earlier]) return false;
        }
        return value < best.ranking[index];
      });
      if (better) best = {
        ranking,
        missingRequired,
        actual,
        difference,
        quantities,
        finalAbs,
        hourDeviation,
        quantityScore,
        hourActual,
        hourDiscount: 0,
        preTaxDifference,
        hourShortfall,
        hourExcess,
        hourRangeViolation,
        goodsShortfall,
        imbalance,
        rejection
      };
    }
    if (!best) return { ok: false, reason: "Không tìm được phương án." };

    return {
      ok: Math.abs(best.difference) <= opts.tolerance,
      exact: best.difference === 0,
      target: targetAmount,
      actual: best.actual,
      difference: best.difference,
      hourActual: best.hourActual,
      hourShortfall: best.hourShortfall,
      hourExcess: best.hourExcess,
      hourRangeViolation: best.hourRangeViolation,
      goodsShortfall: best.goodsShortfall,
      groupImbalance: best.imbalance,
      hourDiscount: best.hourDiscount,
      preTaxDifference: best.preTaxDifference,
      scale,
      items: usable.map((item, index) => Object.assign({}, item, { newQty: best.quantities[index] }))
    };
  }

  return {
    gcd,
    gcdAll,
    derivePreTax,
    inclusiveVatTargets,
    statementVat,
    deriveInvoiceTargets,
    deriveGoodsTarget,
    reconcileHourAmount,
    recommendInvoiceLimit,
    solveQuantities
  };
});
