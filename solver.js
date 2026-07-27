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

  function scoreQuantities(qty, current) {
    let changedLines = 0;
    let changedUnits = 0;
    let totalUnits = 0;
    for (let i = 0; i < qty.length; i += 1) {
      if (qty[i] !== current[i]) changedLines += 1;
      changedUnits += Math.abs(qty[i] - current[i]);
      totalUnits += qty[i];
    }
    return changedLines * 1000000 + changedUnits * 1000 + totalUnits;
  }

  function solveQuantities(items, targetAmount, options) {
    const opts = Object.assign({ maxQty: 99, tolerance: 5000, maxStates: 120000 }, options || {});
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
    const requiredAmount = usable.reduce((sum, item, index) => sum + Math.max(0, Math.floor(Number(item.minQty) || 0)) * scaledPrices[index], 0);
    const maxAmount = Math.max(scaledTarget + scaledTolerance + Math.max(...scaledPrices), requiredAmount + Math.max(...scaledPrices));

    let states = new Map([[0, []]]);
    for (let index = 0; index < usable.length; index += 1) {
      const next = new Map();
      const price = scaledPrices[index];
      for (const [amount, quantities] of states) {
        const itemLimit = Number.isFinite(Number(usable[index].maxQty)) ? Math.max(0, Math.floor(Number(usable[index].maxQty))) : opts.maxQty;
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
          const newAmount = amount + qty * price;
          const candidate = quantities.concat(qty);
          const existing = next.get(newAmount);
          if (!existing || scoreQuantities(candidate, current.slice(0, candidate.length)) < scoreQuantities(existing, current.slice(0, existing.length))) {
            next.set(newAmount, candidate);
          }
        }
      }
      if (next.size > opts.maxStates) {
        const ranked = [...next.entries()].sort((a, b) => {
          const da = Math.abs(a[0] - scaledTarget);
          const db = Math.abs(b[0] - scaledTarget);
          return da - db || scoreQuantities(a[1], current.slice(0, a[1].length)) - scoreQuantities(b[1], current.slice(0, b[1].length));
        });
        states = new Map(ranked.slice(0, opts.maxStates));
      } else {
        states = next;
      }
    }

    let best = null;
    for (const [amount, quantities] of states) {
      const actual = amount * scale;
      const difference = actual - targetAmount;
      const hourStep = Math.max(0, Math.round(Number(opts.hourStep) || 0));
      const preTaxTarget = Math.max(0, Math.round(Number(opts.preTaxTarget) || 0));
      const requiredHour = hourStep && preTaxTarget ? preTaxTarget - actual : 0;
      // Time changes only produce quantized singing fees. Round upward so the
      // remaining few dong can be entered as a non-negative hourly discount.
      const hourActual = hourStep && requiredHour >= 0 ? Math.max(0, Math.ceil(requiredHour / hourStep) * hourStep) : null;
      const preTaxDifference = hourActual == null ? null : actual + hourActual - preTaxTarget;
      const hourDiscount = preTaxDifference == null ? 0 : Math.max(0, preTaxDifference);
      const finalAbs = preTaxDifference == null ? Math.abs(difference) : Math.abs(actual + hourActual - hourDiscount - preTaxTarget);
      const hourDeviation = hourActual == null ? 0 : Math.abs(hourActual - Number(opts.currentHour || 0));
      const quantityScore = scoreQuantities(quantities, current);
      const better = !best || finalAbs < best.finalAbs ||
        (finalAbs === best.finalAbs && hourDiscount < best.hourDiscount) ||
        (finalAbs === best.finalAbs && hourDiscount === best.hourDiscount && hourDeviation < best.hourDeviation) ||
        (finalAbs === best.finalAbs && hourDiscount === best.hourDiscount && hourDeviation === best.hourDeviation && quantityScore < best.quantityScore);
      if (better) best = { actual, difference, quantities, finalAbs, hourDeviation, quantityScore, hourActual, hourDiscount, preTaxDifference };
    }
    if (!best) return { ok: false, reason: "Không tìm được phương án." };

    return {
      ok: Math.abs(best.difference) <= opts.tolerance,
      exact: best.difference === 0,
      target: targetAmount,
      actual: best.actual,
      difference: best.difference,
      hourActual: best.hourActual,
      hourDiscount: best.hourDiscount,
      preTaxDifference: best.preTaxDifference,
      scale,
      items: usable.map((item, index) => Object.assign({}, item, { newQty: best.quantities[index] }))
    };
  }

  return { gcd, gcdAll, derivePreTax, deriveInvoiceTargets, deriveGoodsTarget, solveQuantities };
});
