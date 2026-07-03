(function initFuelCalcCore(root) {
  function normalizeStoredNumber(value, fallback) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeUiText(text) {
    return String(text || '')
      .replace(/\u202F/g, ' ')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractDistanceKm(text) {
    if (!text) return null;

    const cleaned = normalizeUiText(text);

    const kmMatch = cleaned.match(/(\d[\d\s.,]*)\s*км(?!\s*\/\s*ч)/i);
    if (kmMatch) {
      const numeric = kmMatch[1].replace(/\s+/g, '').replace(',', '.');
      const value = parseFloat(numeric);
      return Number.isFinite(value) ? value : null;
    }

    const meterMatch = cleaned.match(/(\d[\d\s.,]*)\s*м(?=$|[\s.,;:)])/i);
    if (meterMatch) {
      const numeric = meterMatch[1].replace(/\s+/g, '').replace(',', '.');
      const meters = parseFloat(numeric);
      return Number.isFinite(meters) ? meters / 1000 : null;
    }

    return null;
  }

  function extractTollCost(text) {
    if (!text) return null;

    const cleaned = normalizeUiText(text);
    const amountMatch = cleaned.match(/(\d[\d\s.,]*)\s*(₽|руб\.?)/i);
    if (!amountMatch) return null;

    const numeric = amountMatch[1].replace(/\s+/g, '').replace(',', '.');
    const value = parseFloat(numeric);
    return Number.isFinite(value) ? Math.round(value) : null;
  }

  function isPureDistanceText(text) {
    const normalized = normalizeUiText(text);
    return /^(\d[\d\s.,]*)\s*(км|м)$/i.test(normalized);
  }

  function scoreDistanceCandidateText(text) {
    const normalized = normalizeUiText(text);
    const distance = extractDistanceKm(normalized);

    if (distance === null) return -1;
    if (isPureDistanceText(normalized)) return 1000 + distance;

    return distance;
  }

  function calculateFuelCost(distanceKm, fuelPrice, fuelConsumption) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
    if (!Number.isFinite(fuelPrice) || fuelPrice < 0) return null;
    if (!Number.isFinite(fuelConsumption) || fuelConsumption < 0) return null;

    return Math.round(((distanceKm * fuelConsumption) / 100) * fuelPrice);
  }

  function formatCost(cost) {
    return `~${cost.toLocaleString('ru-RU')} ₽`;
  }

  function calculateRouteMetrics(distanceKm, fuelPrice, fuelConsumption, roundTrip = false, tollCost = 0) {
    if (!Number.isFinite(distanceKm) || distanceKm < 0) return null;
    if (!Number.isFinite(fuelPrice) || fuelPrice < 0) return null;
    if (!Number.isFinite(fuelConsumption) || fuelConsumption < 0) return null;
    if (!Number.isFinite(tollCost) || tollCost < 0) return null;

    const effectiveDistanceKm = roundTrip ? distanceKm * 2 : distanceKm;
    const liters = Number((((effectiveDistanceKm * fuelConsumption) / 100)).toFixed(1));
    const fuelCost = Math.round(liters * fuelPrice);
    const normalizedTollCost = Math.round(tollCost);
    const cost = fuelCost + normalizedTollCost;
    const costPerKm = effectiveDistanceKm > 0
      ? Number((cost / effectiveDistanceKm).toFixed(1))
      : 0;

    return {
      distanceKm,
      effectiveDistanceKm,
      liters,
      fuelCost,
      tollCost: normalizedTollCost,
      cost,
      costPerKm,
    };
  }

  function formatLiters(liters) {
    return `${liters.toLocaleString('ru-RU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} л`;
  }

  function formatCostPerKm(costPerKm) {
    return `${costPerKm.toLocaleString('ru-RU', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    })} ₽/км`;
  }

  function buildRouteCostLines(metrics) {
    if (!metrics) return null;

    return {
      line1: `бензин ${formatCost(metrics.fuelCost)}`,
      line2: `итог ${formatCost(metrics.cost)}`,
      split: true,
    };
  }

  function resolveSettingsButtonPosition(anchorRect, fallbackRect, options = {}) {
    const buttonSize = Number.isFinite(options.buttonSize) ? options.buttonSize : 44;
    const gap = Number.isFinite(options.gap) ? options.gap : 8;

    const hasVisibleAnchor = Boolean(
      anchorRect
      && Number.isFinite(anchorRect.left)
      && Number.isFinite(anchorRect.top)
      && anchorRect.width > 0
      && anchorRect.height > 0
    );

    if (!hasVisibleAnchor) {
      return {
        mode: 'fallback',
        top: fallbackRect.top,
        right: fallbackRect.right,
      };
    }

    return {
      mode: 'anchored',
      top: Math.round(anchorRect.top + ((anchorRect.height - buttonSize) / 2)),
      left: Math.round(anchorRect.left + anchorRect.width + gap),
    };
  }

  function resolveSettingsPanelPosition(buttonRect, fallbackRect, options = {}) {
    const panelWidth = Number.isFinite(options.panelWidth) ? options.panelWidth : 320;
    const panelHeight = Number.isFinite(options.panelHeight) ? options.panelHeight : 260;
    const gap = Number.isFinite(options.gap) ? options.gap : 12;
    const viewportWidth = Number.isFinite(options.viewportWidth) ? options.viewportWidth : 1280;
    const viewportHeight = Number.isFinite(options.viewportHeight) ? options.viewportHeight : 720;

    const hasVisibleButton = Boolean(
      buttonRect
      && Number.isFinite(buttonRect.left)
      && Number.isFinite(buttonRect.top)
      && buttonRect.width > 0
      && buttonRect.height > 0
    );

    if (!hasVisibleButton) {
      return {
        mode: 'fallback',
        top: fallbackRect.top,
        right: fallbackRect.right,
      };
    }

    let left = Math.round(buttonRect.left + buttonRect.width + gap);
    if (left + panelWidth > viewportWidth - gap) {
      left = Math.round(buttonRect.left - panelWidth - gap);
    }

    left = Math.max(gap, left);

    const maxTop = Math.max(gap, viewportHeight - panelHeight - gap);
    const top = Math.max(gap, Math.min(Math.round(buttonRect.top), maxTop));

    return {
      mode: 'anchored',
      top,
      left,
    };
  }

  const api = {
    normalizeStoredNumber,
    extractDistanceKm,
    extractTollCost,
    calculateFuelCost,
    calculateRouteMetrics,
    buildRouteCostLines,
    formatCost,
    formatLiters,
    formatCostPerKm,
    normalizeUiText,
    isPureDistanceText,
    scoreDistanceCandidateText,
    resolveSettingsButtonPosition,
    resolveSettingsPanelPosition,
  };
  root.FuelCalcCore = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
