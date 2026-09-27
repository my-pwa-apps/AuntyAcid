# Aunty Acid PWA — Engineering Backlog

## Ported from GarfieldApp 2026-09-27

Features and fixes from [GarfieldApp](https://github.com/my-pwa-apps/GarfieldApp) (July–September 2026) that apply to this app. Garfield-only work (Google Drive sync, Top 10 leaderboard, Spanish, vertical/rotated strips, source fallbacks, Workers) was not ported.

- [x] **Tap-highlight square on icon buttons (Android/iOS)** — `-webkit-tap-highlight-color` moved to the base interactive elements (GarfieldApp v1.0.9).
- [x] **Focus rings painting on touch devices** — ring only defined for `(hover: hover) and (pointer: fine)`; forced-colors outline kept (v1.0.8).
- [x] **Settings dialog accessibility** — `aria-modal`, Tab/Shift+Tab focus trap, focus returns to the opener.
- [x] **Service worker update model** — no `skipWaiting()` on install; "new version available" banner sends `SKIP_WAITING`; version shown in Settings via `GET_VERSION`; precache bypasses the HTTP cache.
- [x] **Bounded comic loading** — page lookups and image loads time out (12 s) with a Retry; failed loads retry automatically when the browser comes back online; offline indicator.
- [x] **Adjacent-only slide transition** — only neighbouring days throw out left/right, longer jumps morph; morph commits styles before transitioning so the blur always animates.
- [x] **Layout stability** — reserved comic/logo dimensions, decoded size written to the `<img>`, `fetchpriority="high"`, proxy preconnect.
- [x] **Sharing** — link travels in `text` when a file is attached (WhatsApp/Messages dropped the image), non-JPEG/PNG re-encoded on white for share previews, clipboard fallback copies image + link.
- [x] **Double-tap / double-click to favorite** with a heart burst over the comic.
- [x] **`og:image` extraction hardening** — any meta tag order, `property=` or `name=`, `&amp;` decoding.
- [x] **Search/social metadata** — removed `keywords`, `twitter:card` `summary` for the square icon, `og:image:type`, JSON-LD `EntertainmentApplication` / `@id` / `mainEntityOfPage`, real screenshots.
- [x] **Content-Security-Policy** meta tag.
- [x] **Wrong comic for dates without their own strip** — GoComics serves the *latest* comic (with `og:url` of that day) for unpublished/future dates, e.g. "today" in timezones ahead of US Eastern. The page date is now checked (`Core.resolveComicPage`, as GarfieldApp does via `og:url`/canonical): the strip is cached under the day it belongs to, jumps show that day, stepping skips the empty day, and the loose CDN fallback is only used on the requested day's page. The `imageUrls` cache is replaced by `imageUrlsV2` because old entries could hold such mappings.
- [x] **Manifest screenshots declared with wrong sizes/form factor** (1280x720 "wide" vs. actual 726x1300 portrait) — fixed, and `tests/assets.test.js` now guards precache/manifest/index references and PNG sizes.
- [ ] **Wide (desktop) install screenshot** — Chrome's richer desktop install dialog needs a `form_factor: "wide"` screenshot; none exists yet.
- [ ] **IndexNow** — GarfieldApp pings IndexNow after production deploys; would need a key file and a workflow here.

## Review 2026-09-24

Scope: full repository review (`app.js`, `index.html`, `main.css`, `sw.js`, `manifest.webmanifest`, static config, assets) plus runtime checks against a local server and the live CORS proxy / GoComics pages.

**Implementation status (2026-09-24):** 12 of 13 items resolved and verified (unit tests in 4 timezones + browser checks against the live proxy). Open: unreferenced image assets (needs a packaging decision).

### Critical

- [x] **Wrong comic displayed for ~half of all dates (image extraction picks a site-wide asset)**

  **Resolution (2026-09-24):** `Core.extractComicImageUrl()` now checks `og:image` (host-validated) first. Verified in the browser: First (2013-05-06) and 7 previously wrong dates show the `og:image` strip; unit tests cover the markup order.

  **Priority:** Critical  
  **Category:** Bug  
  **Confidence:** High  
  **Area:** Comic data flow — `extractComicImageUrl()`  
  **Affected files:** `app.js`  
  **Evidence:** Runtime sampling of 24 dates (2013–2026) through the app's proxy: on 13 of them the first `featureassets.gocomics.com/assets/…` URL in the page is `f98fbb20ac400135fdb0005056a9545d` (a 450×450 2017 Christmas strip present on every page), while the actual strip is at `og:image` (index 5 of 6 asset URLs). Examples: 2013/05/06, 2013/05/07, 2013/11/20, 2014/04/03, 2016/01/05, 2018/02/14, 2023/03/15, 2026/06/05. `og:image` matched the correct strip on every sampled date.  
  **Problem:** The extractor returns the first CDN match before checking `og:image`, so users see the same unrelated strip for many dates (including the very first comic). Because `showComic()` compares against `previousUrl`, consecutive affected dates also make Next appear to do nothing and trigger the `previousclicked` auto-skip.  
  **Impact:** Core purpose of the app (show the comic for a date) fails for a large share of the archive; favorites, sharing and preloading inherit the wrong image.  
  **Recommended solution:** Check `og:image` first (accept only `featureassets.gocomics.com` / `assets.amuniversal.com` hosts), then fall back to the existing patterns. Keep the function pure so it can be unit-tested with saved HTML fixtures.  
  **Regression considerations:** Current and recent dates (which already work) must keep working; legacy `amuniversal` URLs must still be accepted.  
  **Acceptance criteria:** For the sampled dates above, the displayed `#comic` `src` equals the page's `og:image`; 2013/05/06 no longer shows `f98fbb20…`.  
  **Validation:** Unit tests with HTML fixtures for "og first", "og later than site asset", legacy CDN, and no-match; manual check of First/Random/date picker.  
  **Estimated effort:** Small  
  **Business value:** High  
  **Technical debt reduction:** Low

### High

- [x] **Off-by-one day in UTC-negative timezones (date picker, start date) and fragile date handling**

  **Resolution (2026-09-24):** All dates go through `Core.parseYmd/toYmd/addDays/clampDate` (local midnight); `lastcomic` is stored as `YYYY-MM-DD` with legacy values still read; picker `max` refreshed on every state update. Tests pass under UTC, America/Los_Angeles, Europe/Amsterdam, Pacific/Auckland; legacy `lastcomic` migration verified in the browser.

  **Priority:** High  
  **Category:** Bug  
  **Confidence:** High  
  **Area:** Date navigation — `DateChange()`, `START_DATE`, `CompareDates()`, `lastcomic`  
  **Affected files:** `app.js`  
  **Evidence:** `DateChange()` uses `new Date($('DatePicker').value)`; `"YYYY-MM-DD"` parses as UTC midnight and `CompareDates()` then calls `setHours(0,0,0,0)` in local time. Reproduced with Node: selecting `2024-03-15` yields `2024/03/14` in `America/New_York` and `America/Los_Angeles` (correct in Europe/UTC). `START_DATE = new Date('2013-05-06')` is May 5 locally in the Americas, while `CompareDates()` uses `new Date('2013/05/06')` (local) and `FirstClick()` uses `Date.UTC(…,12)` — three conventions for the same date. `lastcomic` is stored as `Date.toString()` (implementation-defined parse). The picker `max` is only set once at startup.  
  **Problem:** US users (GoComics' main audience) get the previous day's comic when picking a date; date logic is inconsistent and scattered across global mutable `year/month/day`.  
  **Impact:** Visible wrong-comic behaviour for a large user segment; hard-to-reason-about code.  
  **Recommended solution:** Introduce small pure helpers (`parseYmd('YYYY-MM-DD' | 'YYYY/MM/DD') → local Date`, `toYmd(date)`, `addDays`) and use them everywhere; store `lastcomic` as `YYYY-MM-DD`; derive `START_DATE` via the helper; refresh picker `max` when navigating to "today". Accept the old `lastcomic` format on read for migration.  
  **Regression considerations:** Favorites format (`YYYY/MM/DD`) must remain unchanged; existing `lastcomic` values must still restore.  
  **Acceptance criteria:** Selecting any date in the picker shows that date in all timezones; First shows 2013-05-06 in all timezones.  
  **Validation:** Unit tests for helpers run under `TZ=America/Los_Angeles`, `UTC`, `Europe/Amsterdam`, `Pacific/Auckland`.  
  **Estimated effort:** Medium  
  **Business value:** High  
  **Technical debt reduction:** High

- [x] **Each navigation downloads ~1.5 MB of HTML; preloads are never reused**

  **Resolution (2026-09-24):** Date -> image URL cache (memory + capped `localStorage` `imageUrls`, today excluded) with in-flight de-duplication; `Addfav()` no longer refetches. Verified: Next to a preloaded neighbour issued only the new neighbour's preload; toggling a favorite issued 0 proxy requests.

  **Priority:** High  
  **Category:** Performance  
  **Confidence:** High  
  **Area:** `showComic()`, `preloadAdjacentComics()`, `Addfav()`  
  **Affected files:** `app.js`  
  **Evidence:** Measured GoComics pages via the proxy at 515–527 KB each; the proxy returns `Cache-Control: no-cache, no-store`. Browser trace of one Previous click: 3 proxy requests (current + both neighbours). `preloadAdjacentComics()` discards the extracted URL (only warms the image), so the next navigation fetches the same page again. `Addfav()` calls `showComic()`, refetching the page just to toggle a heart.  
  **Problem:** ~3× redundant HTML transfer per step and extra load on the shared proxy.  
  **Impact:** Slow navigation and data usage on mobile; proxy cost/rate-limit risk (shared with sibling apps).  
  **Recommended solution:** Keep a `Map<date, imageUrl>` (optionally persisted, capped, in `localStorage` — asset URLs are immutable). `showComic()` and preloading consult/populate it; deduplicate in-flight requests; `Addfav()` only updates favorites + icon + button states.  
  **Regression considerations:** Today's comic must still refresh (don't cache "today" indefinitely, or cache with short TTL).  
  **Acceptance criteria:** Navigating to a preloaded neighbour issues no new proxy request; toggling a favorite issues none.  
  **Validation:** Browser network trace; unit test for cache/dedupe helper.  
  **Estimated effort:** Small  
  **Business value:** High  
  **Technical debt reduction:** Medium

- [x] **Out-of-order responses can desync the displayed comic from the selected date**

  **Resolution (2026-09-24):** `loadSequence` guard: only the latest request updates the UI; duplicate load for `?action=random` removed. Verified with a 3 s delayed response for 2022-01-10 followed by 2022-01-11: 2022-01-11 is shown.

  **Priority:** High  
  **Category:** Reliability  
  **Confidence:** Medium  
  **Area:** `showComic()`  
  **Affected files:** `app.js`  
  **Evidence:** `showComic()` fires a new `fetch` per navigation with no `AbortController` or request token; whichever response resolves last wins and sets `pictureUrl`, `previousUrl`, the heart icon and button states, while `DatePicker`/`formattedComicDate`/`lastcomic` were set synchronously for the latest request. Rapid swipes/clicks are the normal usage pattern. `?action=random` also triggers two concurrent loads (`RandomClick()` inside `handleUrlParams()` then `showComic()` in `initApp()`). A deterministic repro was attempted but was confounded by the extraction bug above.  
  **Problem:** The image shown can belong to a different date than the picker/favorite state.  
  **Impact:** Users favorite or share the wrong comic.  
  **Recommended solution:** Track a request sequence id (or abort the previous request) and ignore stale responses; remove the duplicate load in `handleUrlParams()`.  
  **Regression considerations:** Animations and preload behaviour must remain.  
  **Acceptance criteria:** With one response artificially delayed, the final image always matches the picker date.  
  **Validation:** Playwright/route-delay test or unit test around the loader.  
  **Estimated effort:** Small  
  **Business value:** Medium  
  **Technical debt reduction:** Medium

- [x] **No automated tests or CI for the critical parsing and date logic**

  **Resolution (2026-09-24):** Pure logic moved to `core.js`; `tests/core.test.js` (15 `node:test` tests, no dependencies); `npm run check` / `npm test`; `.github/workflows/ci.yml` runs them in 4 timezones.

  **Priority:** High  
  **Category:** Testing  
  **Confidence:** High  
  **Area:** Repository tooling  
  **Affected files:** (new) `tests/`, `package.json` (optional), `.github/workflows/`  
  **Evidence:** No test files, `package.json`, lint config or CI workflows exist. The two most severe defects above live in small pure functions that tests would have caught.  
  **Problem:** Regressions in the scraper (which depends on third-party HTML) and date logic ship silently.  
  **Impact:** Recurrence of critical defects; GoComics markup changes go unnoticed.  
  **Recommended solution:** Move pure helpers (`extractComicImageUrl`, date helpers, favorites validation) into a small ES module or expose them for Node; add `node --test` tests with saved HTML fixtures (no dependencies needed); add a GitHub Action running `node --check` + tests on push.  
  **Regression considerations:** App must remain a no-build static site deployable by GitHub Pages.  
  **Acceptance criteria:** `node --test` runs locally and in CI and covers the Critical/High fixes.  
  **Validation:** CI green on a PR.  
  **Estimated effort:** Medium  
  **Business value:** Medium  
  **Technical debt reduction:** High

### Medium

- [x] **Failed loads leave the UI in a mismatched state with a generic error**

  **Resolution (2026-09-24):** State (`displayedDate`, `lastcomic`, picker) commits only on success and rolls back on failure; errors distinguish offline / HTTP status / no image / image failed to load / network and the toast offers Retry (the comic image must load before state is committed, so an evicted offline image or stale URL can't leave a broken image; stale URLs are forgotten). When today's strip isn't published yet, the app falls back to the previous day. Verified with a forced HTTP 500.

  **Priority:** Medium  
  **Category:** Reliability  
  **Confidence:** High  
  **Area:** `showComic()` error path  
  **Affected files:** `app.js`  
  **Evidence:** `DatePicker.value` and `localStorage.lastcomic` are updated before the fetch; on any failure only `showNotification('Could not load comic')` runs. Offline, upstream 403/5xx and "no image found" are indistinguishable; no retry.  
  **Problem:** After a failure the old image is shown under the new date, and a reload restores the failed date.  
  **Impact:** Confusing state; users can't tell whether to retry.  
  **Recommended solution:** Commit date/state only on success (or roll back on failure); differentiate offline (`navigator.onLine`/TypeError) vs HTTP errors; offer a retry action in the toast.  
  **Regression considerations:** Successful navigation unchanged.  
  **Acceptance criteria:** After a simulated failure the picker shows the date of the displayed comic and `lastcomic` is unchanged.  
  **Validation:** Playwright route that returns 500 / offline emulation.  
  **Estimated effort:** Small  
  **Business value:** Medium  
  **Technical debt reduction:** Low

- [x] **Swipe navigation fires while dragging the toolbar or interacting with the settings panel**

  **Resolution (2026-09-24):** Swipes starting on the toolbar, buttons, inputs, settings panel or toast, and multi-touch gestures, are ignored; swipe and keyboard go through `triggerNav()`, which respects disabled buttons. Verified with synthetic touch events (toolbar swipe ignored, comic swipe navigates).

  **Priority:** Medium  
  **Category:** Bug  
  **Confidence:** Medium  
  **Area:** `swipeDetection`, `makeDraggable()`  
  **Affected files:** `app.js`  
  **Evidence:** The swipe `touchend` listener is on `document.body` and checks neither the event target nor the toolbar's drag state; a quick vertical toolbar drag (>50 px, <500 ms) matches the vertical-swipe branch (`RandomClick`/`CurrentClick`). Swipes also bypass disabled button state (extra redundant fetches at the first/last comic) and multi-touch (pinch) isn't excluded.  
  **Problem:** Unintended navigation.  
  **Impact:** Annoying on mobile, the primary platform.  
  **Recommended solution:** Ignore swipes starting inside `#mainToolbar`, `.settings-panel`, the toast, or with `touches.length > 1`; respect the disabled state of the target button.  
  **Regression considerations:** Swiping on the comic must keep working.  
  **Acceptance criteria:** Dragging the toolbar never changes the comic.  
  **Validation:** Manual touch test / Playwright touch emulation.  
  **Estimated effort:** Small  
  **Business value:** Medium  
  **Technical debt reduction:** Low

- [x] **Favorites robustness: unvalidated import, crash on corrupt storage, favorites-mode edge cases**

  **Resolution (2026-09-24):** `Core.sanitizeFavorites()` validates import and stored favorites (skipped count reported); all storage JSON goes through `Core.safeJsonParse()`; favorites navigation uses `Core.favoriteNeighbors()`; removing the current favorite moves to the nearest remaining one or exits favorites mode; enabling favorites mode / restoring `lastcomic` snaps to the nearest favorite. Verified in the browser, including startup with corrupt `favs` / `toolbarPos` / `imageUrls`.

  **Priority:** Medium  
  **Category:** Data  
  **Confidence:** High  
  **Area:** Favorites — `handleImportFile()`, `getFavs()`, `Addfav()`, `initApp()`  
  **Affected files:** `app.js`  
  **Evidence:** Import merges any array values (non-strings, invalid dates, other formats) into `favs`; `new Date(badValue)` later yields `NaN/NaN/NaN` URLs. `getFavs()` and `toolbarPos` reads call `JSON.parse` without `try/catch` — corrupt values break startup. Un-favoriting the current comic while "Show only my favorites" is on leaves the user on a non-favorite where `PreviousClick()` does nothing (`indexOf` = -1); `lastcomic` can also restore a non-favorite into favorites mode.  
  **Problem:** User data can be polluted and the app can become unusable.  
  **Impact:** Loss of trust in favorites, the main persistence feature.  
  **Recommended solution:** Validate imported entries against `^\d{4}/\d{2}/\d{2}$` and the valid date range, report skipped count; wrap storage parsing in safe helpers with defaults; in favorites mode, after removing the current favorite move to the nearest remaining favorite (or exit favorites mode when empty and persist that).  
  **Regression considerations:** Existing export files and stored favorites must still import/load.  
  **Acceptance criteria:** Importing `{"favorites":["x",1,"2020/01/01"]}` adds only `2020/01/01`; corrupt `favs` in storage doesn't break startup.  
  **Validation:** Unit tests for the validator and safe parse; manual favorites-mode test.  
  **Estimated effort:** Small  
  **Business value:** Medium  
  **Technical debt reduction:** Medium

- [x] **Sharing: no deep link to the comic, no desktop fallback, brittle fallback logic**

  **Resolution (2026-09-24):** Shares `?date=YYYY-MM-DD` links (handled on load and then stripped from the address bar); image fetched via CORS for file sharing (3 s cap); falls back to link share, then clipboard. Verified share payload (title, deep link, JPEG file), clipboard fallback and deep-link opening.

  **Priority:** Medium  
  **Category:** Feature  
  **Confidence:** High  
  **Area:** `Share()`, `handleUrlParams()`  
  **Affected files:** `app.js`  
  **Evidence:** Shares always use `https://auntyacidapp.pages.dev` (no date); `handleUrlParams()` supports only `action=random` and `view=favorites`, so a shared comic can't be opened. When `navigator.share` is missing (most desktop browsers) the user only gets "Sharing not supported". The text fallback only triggers when `err.message` contains "failed", so timeouts and `NotAllowedError` (user activation can expire while awaiting the image) show "Failed to share". The image CDN serves `Access-Control-Allow-Origin: *`, so the proxy fallback is rarely needed.  
  **Problem:** Recipients can't see which comic was shared; desktop users can't share at all.  
  **Impact:** Lost organic growth and a core advertised feature underdelivers.  
  **Recommended solution:** Support `?date=YYYY-MM-DD` on load and include it in shared URLs; fall back to `navigator.clipboard.writeText(url)` when Web Share is unavailable; fall back to URL-only share for any non-`AbortError`.  
  **Regression considerations:** Existing `?action=random` / `?view=favorites` links keep working.  
  **Acceptance criteria:** Opening a shared link shows the shared date; desktop share copies the link and notifies.  
  **Validation:** Manual on Android + desktop Chrome/Firefox.  
  **Estimated effort:** Small  
  **Business value:** High  
  **Technical debt reduction:** Low

- [x] **"Works offline" is advertised but comics are never cached**

  **Resolution (2026-09-24):** Service worker caches up to 150 viewed comic images (`auntyacid-images-v1`, CORS responses only, kept across app versions); with the persisted URL map, previously viewed comics load offline. Verified: offline reload and offline navigation to a viewed date display the strip; uncached dates show an offline message.

  **Priority:** Medium  
  **Category:** Business Logic  
  **Confidence:** High  
  **Area:** Service worker / marketing copy  
  **Affected files:** `sw.js`, `index.html`  
  **Evidence:** `sw.js` returns early for all cross-origin requests (proxy and image CDN), so offline every navigation shows "Could not load comic". `index.html` meta/OG description and JSON-LD `featureList` claim offline reading.  
  **Problem:** Advertised capability doesn't exist.  
  **Impact:** User expectation mismatch; store-listing accuracy.  
  **Recommended solution:** Either cache the last N viewed/favorited comic images (runtime cache for `featureassets.gocomics.com`, CORS-enabled) together with the date→image-URL map, or remove the offline claims.  
  **Regression considerations:** Keep cache size bounded; don't cache proxy HTML.  
  **Acceptance criteria:** Offline, previously viewed comics/favorites display — or no offline claim remains.  
  **Validation:** DevTools offline emulation.  
  **Estimated effort:** Medium  
  **Business value:** Medium  
  **Technical debt reduction:** Low

- [x] **Accessibility gaps: settings dialog semantics, live region, toggle state, keyboard, motion**

  **Resolution (2026-09-24):** Settings is a labelled `role="dialog"` with focus moved in, Escape to close and focus returned; toast content is `role="status" aria-live="polite"`; favorite button exposes `aria-pressed` and a state-specific label; Left/Right/Home/End shortcuts; `prefers-reduced-motion` disables animations; comic `alt` includes the date; visible focus outlines. Verified via the accessibility tree and keyboard tests. Lighthouse audit not run.

  **Priority:** Medium  
  **Category:** Accessibility  
  **Confidence:** High  
  **Area:** `index.html`, `main.css`, `app.js`  
  **Affected files:** `index.html`, `main.css`, `app.js`  
  **Evidence:** Settings panel is `role="region"` with no focus move, focus return, or Escape handling; the toast has no `aria-live`/`role="status"`; the heart button's `aria-label` never changes and has no `aria-pressed`; no keyboard shortcuts for navigation (arrow keys); no `prefers-reduced-motion` rule for throw-out/blur animations; the comic `alt` never includes the date.  
  **Problem:** Screen-reader and keyboard users get little feedback; motion-sensitive users can't opt out.  
  **Impact:** Accessibility compliance and usability.  
  **Recommended solution:** `role="dialog" aria-modal="true"` + focus management + Escape; `role="status" aria-live="polite"` on the toast; `aria-pressed` on the favorite button; ArrowLeft/ArrowRight/Home/End shortcuts; `@media (prefers-reduced-motion: reduce)` disabling transitions; alt text "Aunty Acid comic for <date>".  
  **Regression considerations:** Visual design unchanged.  
  **Acceptance criteria:** Axe/Lighthouse a11y has no serious issues; app fully operable by keyboard.  
  **Validation:** Lighthouse accessibility audit; manual screen reader check.  
  **Estimated effort:** Small  
  **Business value:** Medium  
  **Technical debt reduction:** Low

### Low

- [x] **Code cleanup: dead code and small UI bugs**

  **Resolution (2026-09-24):** Removed unused `overrides`, `previousclicked` (replaced by a bounded same-image skip in both directions) and duplicated preload code; date button uses `try { showPicker() } catch { click() }` and is disabled with the picker; toast timer is cleared between messages.

  **Priority:** Low  
  **Category:** Cleanup  
  **Confidence:** High  
  **Area:** `app.js`  
  **Affected files:** `app.js`  
  **Evidence:** Unused `overrides` in `clampToolbarInView()`; `previousclicked` skip-on-same-image only works for one step and is a workaround for the extraction bug; `datePicker.showPicker?.() || datePicker.click()` always calls both (showPicker returns `undefined`) and `showPicker()` throws `InvalidStateError` when the picker is disabled in favorites mode while `DatePickerBtn` stays enabled; `showNotification()` doesn't clear a previous timeout, so a new toast can be hidden early; duplicate preload code blocks.  
  **Problem:** Noise and minor misbehaviour.  
  **Impact:** Maintainability.  
  **Recommended solution:** Remove dead code; after fixing extraction, remove or rework `previousclicked`; use `try { showPicker() } catch { click() }` and disable `DatePickerBtn` alongside the input; track and clear the toast timer; dedupe preload into one helper.  
  **Regression considerations:** Toolbar behaviour unchanged.  
  **Acceptance criteria:** No unused variables; date button disabled in favorites mode; toasts stay for their full duration.  
  **Validation:** Manual smoke test.  
  **Estimated effort:** Small  
  **Business value:** Low  
  **Technical debt reduction:** Medium

- [ ] **99 unreferenced image assets (~2.5 MB) in the repository**

  **Priority:** Low  
  **Category:** Cleanup  
  **Confidence:** Medium  
  **Area:** Static assets  
  **Affected files:** `windows11/` (80 files), `ios/` (16), `android/maskable_icon_x512.png`, `android/maskable_icon_x682.png`, `aunty-acid-face.png`  
  **Evidence:** None of these paths are referenced by `index.html`, `manifest.webmanifest`, `sw.js` or `browserconfig.xml`; all 43 referenced assets exist.  
  **Problem:** Repo/deploy bloat and confusion about which icons are live.  
  **Impact:** Minor.  
  **Recommended solution:** Confirm they aren't needed for PWABuilder/Microsoft Store packaging, then delete or move them to a clearly named `store-assets/` folder.  
  **Regression considerations:** Keep every referenced icon.  
  **Acceptance criteria:** Every PNG in the deploy root is referenced (or documented as store-only).  
  **Validation:** Reference check script; Lighthouse PWA installability.  
  **Estimated effort:** Small  
  **Business value:** Low  
  **Technical debt reduction:** Low  
  **Status (2026-09-24):** Open — needs an owner decision on whether `windows11/` and the extra icon sizes are required for PWABuilder / Microsoft Store packaging before deleting.

- [x] **Documentation and developer setup are out of date**

  **Resolution (2026-09-24):** README rewritten (architecture, `npm start`/`check`/`test`, deploy, storage keys); copilot instructions updated (`core.js`, `v29`, date rules, tests); launch config points at `http://127.0.0.1:8000/` without `--disable-web-security`.

  **Priority:** Low  
  **Category:** Documentation  
  **Confidence:** High  
  **Area:** Docs / DX  
  **Affected files:** `README.md`, `.github/copilot-instructions.md`, `.vscode/launch.json`  
  **Evidence:** `README.md` contains only a title; `.github/copilot-instructions.md` shows `auntyacid-v27` while `sw.js` is `v28`; the only launch config opens `index.html` via `file://` with `--disable-web-security`, which doesn't exercise the service worker or real CORS behaviour.  
  **Problem:** No documented way to run, test or deploy locally.  
  **Impact:** Onboarding friction; debugging in a non-representative environment.  
  **Recommended solution:** README with purpose, local run (`npx serve .` or equivalent on `http://localhost`), test command, deploy notes (bump `CACHE_NAME`), data-source caveats; fix the version example; point the launch config at a local HTTP server.  
  **Regression considerations:** None.  
  **Acceptance criteria:** A new contributor can run and test the app from the README alone.  
  **Validation:** Follow the README on a clean machine.  
  **Estimated effort:** Small  
  **Business value:** Low  
  **Technical debt reduction:** Medium
