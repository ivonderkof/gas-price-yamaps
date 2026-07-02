# Task 1 Report

## Scope completed

- Added `fuel-core.js` with the four required helpers on `globalThis.FuelCalcCore` and CommonJS export support for Node tests.
- Added `tests/fuel-core.test.js` using Node's built-in test runner.
- Added `package.json` with a minimal `test` script.
- Updated `manifest.json` to load `fuel-core.js` before `content.js`.
- Updated `content.js` to:
  - preserve explicit zero values from storage via `normalizeStoredNumber`
  - parse both kilometer and meter route distances via `extractDistanceKm`
  - calculate costs through the shared helper with explicit `fuelPrice` and `fuelConsumption`
  - keep zero-cost routes renderable instead of treating them as falsy

## TDD evidence

1. Wrote `tests/fuel-core.test.js` first.
2. Ran `node --test tests/fuel-core.test.js`.
3. Verified the expected red failure: `Cannot find module '../fuel-core.js'`.
4. Implemented the minimal helper module and content-script wiring.
5. Re-ran the same test file and got 4 passing tests.

## Verification run

- `node --test tests/fuel-core.test.js` — pass
- `node --check fuel-core.js` — pass
- `node --check content.js` — pass

## Self-review

- Kept the change dependency-free and bundler-free.
- Reused the existing content-script flow instead of introducing new abstractions.
- Left route-card selection logic in place and only replaced the parsing/calculation seam.
- Did not touch unrelated untracked `.superpowers/` or `docs/` content beyond this task report.

## Commit

- `fix: extract fuel helpers and support meter routes`
