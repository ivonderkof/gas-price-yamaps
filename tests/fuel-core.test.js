const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeStoredNumber,
  extractDistanceKm,
  calculateFuelCost,
  formatCost,
  normalizeUiText,
  scoreDistanceCandidateText,
  isPureDistanceText,
} = require('../fuel-core.js');

test('normalizeStoredNumber keeps explicit zero values', () => {
  assert.equal(normalizeStoredNumber(0, 50), 0);
  assert.equal(normalizeStoredNumber('0', 8), 0);
  assert.equal(normalizeStoredNumber(undefined, 50), 50);
});

test('extractDistanceKm parses kilometers and meters', () => {
  assert.equal(extractDistanceKm('9 100 км'), 9100);
  assert.equal(extractDistanceKm('9,5 км'), 9.5);
  assert.equal(extractDistanceKm('850 м'), 0.85);
  assert.equal(extractDistanceKm('1 250 м'), 1.25);
  assert.equal(extractDistanceKm('Построить маршрут'), null);
});

test('calculateFuelCost accepts zero price and rounds the result', () => {
  assert.equal(calculateFuelCost(10, 0, 8), 0);
  assert.equal(calculateFuelCost(12.5, 50, 8), 50);
});

test('formatCost formats rubles for ru-RU', () => {
  assert.match(formatCost(1234), /^~1(?: |\u00A0|\u202F)234 ₽$/);
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
