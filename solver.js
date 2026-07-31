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
    const multiplier = 1 + Number(taxRate || 0) / 100;
    return Math.max(0, Math.round(Number(grandTotal || 0) / multiplier));
  }

  function deriveInvoiceTargets(targetGrand, currentHour, taxRate) {
    const preTaxTarget = derivePreTax(targetGrand, taxRate);
    const vatTarget = Math.max(0, Math.round(Number(targetGrand || 0) - preTaxTarget));
    return {
      preTaxTarget,
      vatTarget,
      currentHour: Math.max(0, Math.round(Number(currentHour || 0))),
      goodsTarget: Math.max(0, Math.round(preTaxTarget - Number(currentHour || 0)))
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

    let best = null;
    for (const [amount, quantities] of states) {
      const actual = amount * scale;
      const difference = actual - targetAmount;
      const hourStep = Math.max(0, Math.round(Number(opts.hourStep) || 0));
      const preTaxTarget = Math.max(0, Math.round(Number(opts.preTaxTarget) || 0));
      const requiredHour = hourStep && preTaxTarget ? preTaxTarget - actual : 0;
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
      const hourShortfall = hourActual == null || !minHourAmount
        ? 0
        : Math.max(0, minHourAmount - hourActual);
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
      // Thứ tự: ràng buộc cứng (giờ, tỷ lệ hàng, khớp tuyệt đối) trước, rồi tới
      // né tổ hợp vừa bị bỏ, cơ cấu nhóm, cuối cùng là các tiêu chí thẩm mỹ.
      const better = !best ||
        hourShortfall < best.hourShortfall ||
        (hourShortfall === best.hourShortfall && goodsShortfall < best.goodsShortfall) ||
        (hourShortfall === best.hourShortfall && goodsShortfall === best.goodsShortfall && finalAbs < best.finalAbs) ||
        (hourShortfall === best.hourShortfall && goodsShortfall === best.goodsShortfall &&
          finalAbs === best.finalAbs && rejection < best.rejection) ||
        (hourShortfall === best.hourShortfall && goodsShortfall === best.goodsShortfall &&
          finalAbs === best.finalAbs && rejection === best.rejection && imbalance < best.imbalance) ||
        (hourShortfall === best.hourShortfall && goodsShortfall === best.goodsShortfall &&
          finalAbs === best.finalAbs && rejection === best.rejection && imbalance === best.imbalance &&
          hourDeviation < best.hourDeviation) ||
        (hourShortfall === best.hourShortfall && goodsShortfall === best.goodsShortfall && finalAbs === best.finalAbs &&
          rejection === best.rejection && imbalance === best.imbalance &&
          hourDeviation === best.hourDeviation && quantityScore < best.quantityScore);
      if (better) best = {
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
    deriveInvoiceTargets,
    deriveGoodsTarget,
    reconcileHourAmount,
    recommendInvoiceLimit,
    solveQuantities
  };
});
