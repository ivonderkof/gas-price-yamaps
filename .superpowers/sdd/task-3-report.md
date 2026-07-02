# Task 3 Report: Separate button refresh from route refresh and harden observers

## Scope

- Repository: `C:/Users/user/YandexDisk/proj/chrome_gas_ext`
- Requested code scope: `content.js` only
- Runtime/package/release changes: none
- Unrelated worktree changes left untouched: `README.md`, `docs/`, `AGENTS.md`, `.superpowers/` artifacts

## Observer flow before the edit

- A single `observer` handled route-card refresh, button repositioning, and button recreation together.
- The same mutation batch could both schedule route badge work and reschedule the settings button.
- SPA URL changes separately removed route badges, rescheduled route refresh, rescheduled button positioning, and recreated missing UI nodes inline.
- Cleanup only disconnected the single route/UI observer plus `spaObserver`.

This meant route updates and settings-button availability were coupled through one broad DOM path.

## What changed

### `content.js`

- Replaced the old single `observer` state with:
  - `routeObserver`
  - `uiObserver`
- Added the exact helper from the brief:

```js
function refreshExtensionUi() {
  createSettingsButton();
  createSettingsPanel();
  scheduleButtonPositionUpdate(0);
}
```

- Kept route badge refresh inside `routeObserver` only:
  - scans added nodes
  - ignores extension nodes (`fuel-cost-display`, settings button, settings panel)
  - collects direct and parent route cards
  - calls `scheduleRouteUpdate(routeCardsToRefresh, DEBOUNCE_MS)` only when needed
- Added a dedicated `uiObserver` on `document.body` that:
  - watches `childList`, `subtree`, and attributes `class`, `style`, `aria-hidden`
  - repositions the button when the Yandex sidebar anchor or sidebar container changes
  - recreates UI only when the settings button, settings panel, or anchor subtree is removed
- Updated `init()` to:
  - call `refreshExtensionUi()` up front
  - start `routeObserver` on `getRoutePanelRoot() || document.body`
  - start `uiObserver` on `document.body`
  - keep the initial delayed `updateAllRoutes()` pass, then call `refreshExtensionUi()`
- Updated the SPA URL-change observer to match the brief:
  - remove existing `.fuel-cost-display` nodes
  - call `refreshExtensionUi()`
  - rebind route input listeners
  - call `scheduleUpdate(INITIAL_UPDATE_DELAY_MS)`
- Updated `cleanupObservers()` to disconnect and null:
  - `routeObserver`
  - `uiObserver`
  - `spaObserver`
  - and to clear `updateTimeout`, `routeUpdateTimeout`, `buttonPositionTimeout`, and `pendingRouteCards`

## Why this is the minimal fix

- Route badge work stays in the existing route-card pipeline instead of adding new badge logic.
- Button/panel recovery is centralized in one helper instead of being duplicated across init, mutation, and SPA branches.
- No new files, dependencies, bundler changes, or release-package changes were introduced.
- `content.js` remains the only DOM integration surface.

## Verification run

### Automated checks

Ran successfully:

- `npm test`
- `node --check content.js`
- `node --check fuel-core.js`
- `git diff --check`

`npm test` result:

- 10 tests passed
- 0 failed

## Manual verification status

Not executed in this environment. The task brief's browser checks still need to be run manually in Chrome against live Yandex Maps DOM:

1. Build a route and verify one badge per route card.
2. Change route endpoints and verify badge updates without duplicates.
3. Collapse and reopen the left sidebar without URL navigation and verify the `⛽` button falls back and re-anchors.
4. Switch between route mode and non-route mode and verify button repositioning is independent from badge refresh.
5. Remove the settings panel DOM node manually during route changes and verify it is recreated only when actually removed.

## Commit

Created:

- `27a636c refactor: split button refresh from route refresh`

## Concerns

- Manual browser verification is still pending, so the observer split is verified by static checks and existing automated tests, not by a live Chrome session against current Yandex Maps behavior.

## Fix pass after review

### Findings addressed

- High: `routeObserver` no longer binds to a one-time route-panel root. It now observes `document.body`, so route badge refresh still sees mutations after Yandex replaces the route panel subtree.
- Medium: the one-time outside-click handler no longer closes over the first local `panel`. It now dereferences `settingsPanel` at click time, so recreated panels still close correctly.

### Additional verification run

Re-ran successfully after the fix pass:

- `npm test`
- `node --check content.js`
- `node --check fuel-core.js`
- `git diff --check`

`npm test` result after the fix pass:

- 10 tests passed
- 0 failed

### Fix-pass commit

- Recorded in the session git history for this follow-up fix pass.
