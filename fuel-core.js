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

  const api = {
    normalizeStoredNumber,
    extractDistanceKm,
    calculateFuelCost,
    formatCost,
    normalizeUiText,
    isPureDistanceText,
    scoreDistanceCandidateText,
    resolveSettingsButtonPosition,
  };
  root.FuelCalcCore = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(globalThis);
