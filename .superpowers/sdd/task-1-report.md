# Task 1 Report

## Scope
- Added pure helper: `globalThis.FuelCalcCore.resolveSettingsButtonPosition`
- Updated tests in `tests/fuel-core.test.js` with 3 new cases for anchored/fallback positioning
- No runtime files other than `fuel-core.js` and `tests/fuel-core.test.js` were modified

## RED phase
- Command: `node --test tests/fuel-core.test.js`
- Result: expected fail (`TypeError: resolveSettingsButtonPosition is not a function`)
- Failing tests: all 3 new `resolveSettingsButtonPosition` cases

## GREEN phase
- Implemented `resolveSettingsButtonPosition` in `fuel-core.js`
- Added helper to `api` export
- Added defaults `buttonSize=44`, `gap=8`
- Anchor checks:
  - exists
  - `left`/`top` numeric
  - `width`/`height` > 0
- Returns:
  - `{ mode: 'anchored', top: round(anchorRect.top + (height - buttonSize) / 2), left: round(anchorRect.left + width + gap) }`
  - `{ mode: 'fallback', top: fallbackRect.top, right: fallbackRect.right }`

## Verification
- `node --test tests/fuel-core.test.js` passed (10/10)
- `node --check fuel-core.js` passed (no output)
- `node --check content.js` passed (no output)
- `npm test` passed
