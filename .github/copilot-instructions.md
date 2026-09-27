# Aunty Acid PWA - AI Coding Instructions

## Project Overview
A Progressive Web App for browsing Aunty Acid comic strips from GoComics. Deployed to GitHub Pages at `https://my-pwa-apps.github.io/auntyacidapp/`. Part of a family of comic apps (shares patterns with GarfieldApp, DirkJanApp).

## Architecture

### Core Files (in repository root)
- `index.html` - Single-page app with toolbar, settings panel, notification toast
- `core.js` - Pure, DOM-free helpers (exposed as `window.AuntyAcidCore` / CommonJS for tests): `extractComicImageUrl`, `resolveComicPage`, `extractComicPageDate`, local-date helpers (`parseYmd`, `toYmd`, `addDays`, `clampDate`, `adjacentDirection`), `sanitizeFavorites`, `safeJsonParse`, `favoriteNeighbors`
- `app.js` - Application logic: navigation, loading, favorites (incl. double-tap), sharing, swipe/keyboard, draggable toolbar, SW update banner, offline indicator
- `main.css` - Pink/purple themed styles with CSS custom properties
- `sw.js` - Service worker: stale-while-revalidate app shell + navigation fallback + bounded cache of comic images (`auntyacid-images-v1`); waits for the user to accept updates (`SKIP_WAITING`), answers `GET_VERSION`
- `manifest.webmanifest` - PWA manifest (uses relative paths `./` for cross-platform compatibility)
- `tests/` - `node:test` unit tests for `core.js` plus asset/manifest checks (`npm test`); CI runs them in several timezones

### Comic Data Flow
1. User navigates (buttons/swipe/keyboard/date picker) -> `showComic(date, direction)`
2. `getComicImageUrl(ymd)` returns a cached URL or fetches the GoComics page via the CORS proxy (in-flight requests are deduplicated; bounded by `PAGE_LOOKUP_TIMEOUT_MS`)
3. `Core.resolveComicPage(html, ymd)` reads `og:image` (pages also embed unrelated site-wide assets) and the page's own date from `og:url`/canonical. Dates without a strip (not yet published, future) are served the **latest** comic, so a page whose date differs from the requested one is a `'redirect'` error: its URL is cached under the day it belongs to, and `showComic` follows it (jumps, or when it lies in the direction of travel) or steps past the empty day. The loose CDN-pattern fallback is only trusted on the requested day's own page
4. Only the latest request may update the screen (`loadSequence`); state (`displayedDate`, `lastcomic`) is committed on success, failures roll back and offer Retry (also retried automatically on the `online` event)
5. Comic displayed with animations: adjacent days (`Core.adjacentDirection`) throw out left/right, any other jump uses `'morph'` (blur), first load is instant; the decoded size is written to the `<img>` width/height to avoid layout shift
6. Adjacent comics preloaded via `preloadAdjacentComics()` (populates the same URL cache)

### Dates
Never use `new Date('YYYY-MM-DD')` (UTC, shifts the day west of Greenwich). Use `Core.parseYmd()` / `Core.toYmd()`; all app dates are local midnight.

### Key Constants
```javascript
const START_DATE = Core.parseYmd('2013-05-06');  // First Aunty Acid comic
const CORS_PROXY = 'https://auntyacid-corsproxy.garfieldapp.workers.dev/?';  // target URL must be encodeURIComponent()-ed
```

## Code Patterns

### DOM Helper
Use `$()` for getElementById: `$('comic')`, `$('DatePicker')`, `$('mainToolbar')`, etc.

### LocalStorage Keys
- `favs` - JSON array of favorite dates (format: "YYYY/MM/DD")
- `lastcomic` - Last viewed comic date ("YYYY-MM-DD"; legacy `Date.toString()` values are still read)
- `imageUrlsV2` - JSON object of date ("YYYY/MM/DD") -> comic image URL (capped, today excluded; the old `imageUrls` key is deleted on startup because it could hold redirected days)
- `stat` - Swipe enabled ("true"/"false")
- `showfavs` - Show only favorites mode ("true"/"false")
- `lastdate` - Remember last comic setting
- `toolbarPos` - JSON object `{top, left, belowComic?, offsetFromComic?}` (`top` in document coordinates: the fixed toolbar is shifted on scroll so it moves with the page)
- `toolbarOptimal` - Toolbar in auto-centered mode ("true")

### Favorites Pattern
```javascript
const getFavs = () => Core.sanitizeFavorites(Core.safeJsonParse(localStorage.getItem('favs'), []), START_DATE, null).favorites;
const setFavs = (favs) => localStorage.setItem('favs', JSON.stringify(favs));
```
Always parse stored JSON with `Core.safeJsonParse()` so corrupt storage can't break startup.

### Notification Toast
```javascript
showNotification('Message here', 3000);  // duration in ms, 0 = persistent
showNotification('Failed', 6000, { label: 'Retry', handler: retryFn });  // optional action button
hideNotification();
```

### Event Listeners
Use optional chaining with addEventListener in DOMContentLoaded:
```javascript
$('buttonId')?.addEventListener('click', handlerFunction);
```

### Draggable Toolbar System
Toolbar uses snap-to-optimal positioning between header and comic:
- `initializeToolbar()` - Sets up position from localStorage or calculates optimal
- `makeDraggable()` - Vertical-only drag with snap zones
- `clampToolbarInView()` - Keeps toolbar visible after resize/comic load

## CSS Conventions

### Theme Colors (Pink/Purple)
```css
--primary-color: #9b59b6;      /* Purple */
--primary-light: #ffc0cb;       /* Pink */
--primary-gradient: linear-gradient(135deg, #ffc0cb 0%, #ff69b4 100%);
```

### Component Classes
- `.toolbar` / `.toolbar-button` - Floating draggable navigation bar with SVG icons
- `.settings-panel` / `.settings-panel.visible` - Modal settings panel
- `.notification-toast` / `.notification-toast.show` - Toast messages
- `.icon-button` - Circular action buttons (settings, favorite, share)
- `.comic-outgoing`, `.throw-out-left/right`, `.fade-in-new` - Comic transition animations
- `.update-banner`, `.offline-indicator`, `.fav-burst` - Update prompt, offline pill, double-tap heart

### Focus & Touch
- `--focus-ring` / `--focus-outline` are `none` by default and only set under `@media (hover: hover) and (pointer: fine)`, so programmatic focus moves never paint rings on touch devices; forced-colors mode keeps a `Highlight` outline
- `-webkit-tap-highlight-color: transparent` lives on the base interactive elements (not in `:focus` rules)
- The CSP meta tag uses `style-src 'self'`: never add inline `style="..."` attributes or `<style>` blocks (setting `element.style.*` from JS is fine)

## Service Worker
Bump `CACHE_NAME` version in `sw.js` when deploying changes (add new app files to `PRECACHE_ASSETS`; `tests/assets.test.js` checks they exist):
```javascript
const CACHE_NAME = 'auntyacid-v32';  // Increment version number
```
Install does not call `skipWaiting()`: open pages show a "new version" banner and send `SKIP_WAITING` when the user taps Refresh (then reload on `controllerchange`). Settings shows the active version via `GET_VERSION`.

## Testing
- `npm start` - local server on http://127.0.0.1:8000
- `npm run check` - syntax check; `npm test` - unit tests for `core.js` and asset/manifest checks
- Put new pure logic in `core.js` and cover it in `tests/`

## PWA Manifest
Use relative paths (`./`) for all URLs to ensure cross-platform compatibility (Android & Windows):
```json
"start_url": ".",
"scope": ".",
"icons": [{ "src": "./manifest-icon-192.maskable.png", ... }]
```

## Deployment
- Hosted on GitHub Pages at `https://my-pwa-apps.github.io/auntyacidapp/`
- Static files served by GitHub Pages
- No build step required (static files)

## Related Projects
Reference `https://github.com/my-pwa-apps/GarfieldApp` for shared patterns
