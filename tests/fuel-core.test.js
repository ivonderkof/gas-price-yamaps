const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
  scoreDistanceCandidateText,
  isPureDistanceText,
  resolveSettingsButtonPosition,
  resolveSettingsPanelPosition,
} = require('../fuel-core.js');

test('normalizeStoredNumber keeps explicit zero values', () => {
  assert.equal(normalizeStoredNumber(0, 50), 0);
  assert.equal(normalizeStoredNumber('0', 8), 0);
  assert.equal(normalizeStoredNumber(undefined, 50), 50);
});

test('extractDistanceKm parses kilometers and meters', () => {
  assert.equal(extractDistanceKm('9 100 км'), 9100);
  assert.equal(extractDistanceKm('9,5 км'), 9.5);
  assert.equal(extractDistanceKm('9 км·25 мин'), 9);
  assert.equal(extractDistanceKm('850 м'), 0.85);
  assert.equal(extractDistanceKm('1 250 м'), 1.25);
  assert.equal(extractDistanceKm('60 км/ч'), null);
  assert.equal(extractDistanceKm('60 км / ч'), null);
  assert.equal(extractDistanceKm('Построить маршрут'), null);
});

test('extractTollCost parses ruble amounts from route text', () => {
  assert.equal(extractTollCost('Платная дорога 1 290 ₽'), 1290);
  assert.equal(extractTollCost('Маршрут через М-11, платный участок 300 руб.'), 300);
  assert.equal(extractTollCost('Бесплатный маршрут 12 км'), null);
});

test('calculateFuelCost accepts zero price and rounds the result', () => {
  assert.equal(calculateFuelCost(10, 0, 8), 0);
  assert.equal(calculateFuelCost(12.5, 50, 8), 50);
});

test('calculateRouteMetrics returns liters, total cost, and cost per km', () => {
  assert.deepEqual(
    calculateRouteMetrics(12.5, 50, 8, false),
    {
      distanceKm: 12.5,
      effectiveDistanceKm: 12.5,
      liters: 1,
      fuelCost: 50,
      tollCost: 0,
      cost: 50,
      costPerKm: 4,
    }
  );
});

test('calculateRouteMetrics adds toll cost to the total route price', () => {
  assert.deepEqual(
    calculateRouteMetrics(100, 50, 8, false, 300),
    {
      distanceKm: 100,
      effectiveDistanceKm: 100,
      liters: 8,
      fuelCost: 400,
      tollCost: 300,
      cost: 700,
      costPerKm: 7,
    }
  );
});

test('calculateRouteMetrics doubles distance and fuel for round trip', () => {
  assert.deepEqual(
    calculateRouteMetrics(12.5, 50, 8, true),
    {
      distanceKm: 12.5,
      effectiveDistanceKm: 25,
      liters: 2,
      fuelCost: 100,
      tollCost: 0,
      cost: 100,
      costPerKm: 4,
    }
  );
});

test('buildRouteCostLines splits gasoline and total when toll is included', () => {
  assert.deepEqual(
    buildRouteCostLines({
      liters: 8,
      fuelCost: 400,
      tollCost: 300,
      cost: 700,
      costPerKm: 7,
    }),
    {
      line1: 'бензин ~400 ₽',
      line2: 'итог ~700 ₽',
      split: true,
    }
  );
});

test('buildRouteCostLines still splits gasoline and total when there is no toll', () => {
  assert.deepEqual(
    buildRouteCostLines({
      liters: 1,
      fuelCost: 50,
      tollCost: 0,
      cost: 50,
      costPerKm: 4,
    }),
    {
      line1: 'бензин ~50 ₽',
      line2: 'итог ~50 ₽',
      split: true,
    }
  );
});

test('formatCost formats rubles for ru-RU', () => {
  assert.match(formatCost(1234), /^~1(?: |\u00A0|\u202F)234 ₽$/);
});

test('formatLiters and formatCostPerKm format compact route metrics', () => {
  assert.equal(formatLiters(1), '1,0 л');
  assert.equal(formatCostPerKm(4), '4,0 ₽/км');
});

test('normalizeUiText collapses thin and non-breaking spaces', () => {
  assert.equal(normalizeUiText('9\u202F100 км'), '9 100 км');
  assert.equal(normalizeUiText('850\u00A0м'), '850 м');
});

test('isPureDistanceText accepts plain distances and rejects aggregate route text', () => {
  assert.equal(isPureDistanceText('9,5 км'), true);
  assert.equal(isPureDistanceText('850 м'), true);
  assert.equal(isPureDistanceText('Маршрут 9,5 км, 25 мин'), false);
  assert.equal(isPureDistanceText('Через 850 м поверните направо'), false);
});

test('scoreDistanceCandidateText prefers pure distance labels and rejects noise', () => {
  assert.ok(scoreDistanceCandidateText('9,5 км') > scoreDistanceCandidateText('Маршрут 9,5 км, 25 мин'));
  assert.ok(scoreDistanceCandidateText('850 м') > scoreDistanceCandidateText('Через 850 м поверните направо'));
  assert.equal(scoreDistanceCandidateText('Настройки расчёта топлива'), -1);
});

test('resolveSettingsButtonPosition anchors next to the sidebar toggle', () => {
  assert.deepEqual(
    resolveSettingsButtonPosition(
      { left: 428, top: 16, width: 24, height: 32 },
      { top: 100, right: 20 },
      { buttonSize: 44, gap: 8 }
    ),
    { mode: 'anchored', top: 10, left: 460 }
  );
});

test('resolveSettingsButtonPosition falls back when anchor is missing', () => {
  assert.deepEqual(
    resolveSettingsButtonPosition(null, { top: 100, right: 20 }, { buttonSize: 44, gap: 8 }),
    { mode: 'fallback', top: 100, right: 20 }
  );
});

test('resolveSettingsButtonPosition falls back when anchor rect is zero-sized', () => {
  assert.deepEqual(
    resolveSettingsButtonPosition(
      { left: 428, top: 16, width: 0, height: 0 },
      { top: 100, right: 20 },
      { buttonSize: 44, gap: 8 }
    ),
    { mode: 'fallback', top: 100, right: 20 }
  );
});

test('resolveSettingsPanelPosition opens to the right of the button when there is space', () => {
  assert.deepEqual(
    resolveSettingsPanelPosition(
      { left: 460, top: 10, width: 44, height: 44 },
      { top: 150, right: 20 },
      { panelWidth: 320, panelHeight: 260, gap: 12, viewportWidth: 1280, viewportHeight: 720 }
    ),
    { mode: 'anchored', top: 12, left: 516 }
  );
});

test('resolveSettingsPanelPosition flips to the left when the right side overflows', () => {
  assert.deepEqual(
    resolveSettingsPanelPosition(
      { left: 1180, top: 120, width: 44, height: 44 },
      { top: 150, right: 20 },
      { panelWidth: 320, panelHeight: 260, gap: 12, viewportWidth: 1280, viewportHeight: 720 }
    ),
    { mode: 'anchored', top: 120, left: 848 }
  );
});
