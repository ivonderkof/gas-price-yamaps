const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeStoredNumber,
  extractDistanceKm,
  calculateFuelCost,
  formatCost,
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
