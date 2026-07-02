# Task 2 Report

## What I changed

- Updated `content.js` only, per task ownership.
- Imported the existing Task 1 helper APIs from `FuelCalcCore`: `normalizeUiText`, `isPureDistanceText`, and `scoreDistanceCandidateText`.
- Replaced touched route selector literals with a centralized `DOM_RULES` object.
- Added `queryAll(selectors, root)` to de-duplicate multi-selector DOM queries.
- Added `findRouteCards(root)` with:
  - exact route-card lookup
  - fallback route-card lookup
  - derived route-card lookup from fallback distance nodes
- Reworked `findDistanceElement(routeCard)` to:
  - prefer exact distance selectors
  - fall back to route-like distance candidates
  - normalize candidate text
  - reject noisy candidates unless they are leaf-like
  - rank matches with `scoreDistanceCandidateText`
- Updated `updateAllRoutes()` to work from `findRouteCards()` instead of depending on the old exact distance selector path.
- Updated `addFuelCostToRoute()` to use the centralized detailed-route selectors and added quiet DOM diagnostics via `debugDom()` only when the route card text looks route-like but no usable distance element is found.
- Updated `getRoutePanelRoot()` and the main `MutationObserver` path to use the centralized route-card detection.

## Tests/checks run and results

- `npm test` — PASS
- `node --test tests/fuel-core.test.js` — PASS
- `node --check content.js` — PASS
- `node --check fuel-core.js` — PASS
- `git diff --check` — PASS

Manual smoke was not run in this environment.

## Files changed

- `C:\Users\user\YandexDisk\proj\chrome_gas_ext\.worktrees\yamaps-dom-hardening\content.js`

## Self-review findings

- No blocking issues found in the scoped diff.
- The fallback route-card path is intentionally conservative: it prefers the existing exact selectors first, then broadens only when needed.
- Diagnostics stay silent by default because `DEBUG_DOM_BREAKAGE` remains `false`.

## Concerns

- I did not edit `fuel-core.js` or `tests/fuel-core.test.js`, following the task context that Task 1 already completed the helper/test work.
- I could not run the manual Yandex Maps smoke check from this environment, so runtime validation against the live DOM still remains.

## Fix wave 2

- Fixed the important review finding in `content.js` by making `addFuelCostToRoute()` read `distanceEl.getAttribute('aria-label')` when `textContent` is empty.
- This keeps the cost calculation aligned with the same fallback source that `findDistanceElement()` already uses for aria-label-based distance candidates.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS

## Fix wave 3

- Tightened `findDistanceElement()` so fallback candidates first normalize `textContent`, then fall back to normalized `aria-label` when the primary text is empty or does not parse as a distance.
- Expanded the `debugDom('distance-not-found', ...)` selector context to include both exact and fallback distance selectors.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `node --check fuel-core.js` — PASS
- `git diff --check` — PASS

## Fix wave 4

- Filtered fallback route-card discovery through route-summary heuristics so generic `snippet-view` nodes do not get treated as route cards unless they actually look like route summaries.
- Restored the broader detailed-route exclusion by checking route-step content in parent panels and skipping non-summary detailed route items.
- Reused route-like text extraction for debug diagnostics so aria-label-only route content is visible when `DEBUG_DOM_BREAKAGE = true`.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS

## Fix wave 5

- Added the same route-summary guard to `addFuelCostToRoute()` so fallback `snippet-view` ancestors queued by the `MutationObserver` cannot receive a badge unless they still look like actual route summary cards.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS

## Fix wave 6

- Reused one `getDistanceText()` helper in both candidate selection and final cost parsing so aria-label-only distance nodes cannot be selected one way and parsed another.
- Moved the route-summary guard into `updateRouteCard()` before clearing existing badges, so broad fallback ancestors can no longer remove valid badges during observer refreshes.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS

## Fix wave 7

- Removed the broad `мин/ч` fallback heuristic and narrowed fallback route-card matching to route-specific class patterns only.
- Kept the exact route-card path unchanged and preserved the shared route-summary guard around fallback refreshes.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS

## Fix wave 8

- Restored `[class*="snippet-view"]` to the fallback selector set, but now only treat those nodes as route summaries when they still expose route-class hints in the node or its descendants.
- This keeps the requested generic snippet fallback without reopening the broad text-based false-positive path.

### Commands and results

- `npm test` — PASS
- `node --check content.js` — PASS
- `git diff --check` — PASS
