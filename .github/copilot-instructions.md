# Aunty Acid PWA - AI Coding Instructions

## Project Overview
A Progressive Web App for browsing Aunty Acid comic strips from GoComics. Deployed to Cloudflare Pages at `auntyacidapp.pages.dev`. Part of a family of comic apps (shares patterns with GarfieldApp, DirkJanApp).

## Architecture

### Core Files (in repository root)
- `index.html` - Single-page app with toolbar, settings panel, notification toast
- `core.js` - Pure, DOM-free helpers (exposed as `window.AuntyAcidCore` / CommonJS for tests): `extractComicImageUrl`, local-date helpers (`parseYmd`, `toYmd`, `addDays`, `clampDate`), `sanitizeFavorites`, `safeJsonParse`, `favoriteNeighbors`
- `app.js` - Application logic: navigation, loading, favorites, sharing, swipe/keyboard, draggable toolbar
- `main.css` - Pink/purple themed styles with CSS custom properties
- `sw.js` - Service worker: stale-while-revalidate app shell + navigation fallback + bounded cache of comic images (`auntyacid-images-v1`)
- `manifest.webmanifest` - PWA manifest (uses relative paths `./` for cross-platform compatibility)
- `tests/` - `node:test` unit tests for `core.js` (`npm test`); CI runs them in several timezones

### Comic Data Flow
1. User navigates (buttons/swipe/keyboard/date picker) -> `showComic(date, direction)`
2. `getComicImageUrl(ymd)` returns a cached URL or fetches the GoComics page via the CORS proxy (in-flight requests are deduplicated)
3. `Core.extractComicImageUrl()` reads `og:image` first (pages also embed unrelated site-wide assets), then falls back to CDN patterns
4. Only the latest request may update the screen (`loadSequence`); state (`displayedDate`, `lastcomic`) is committed on success, failures roll back and offer Retry
5. Comic displayed with animations: `'next'`/`'previous'` (throw-out), `'morph'` (blur), or `null` (instant)
6. Adjacent comics preloaded via `preloadAdjacentComics()` (populates the same URL cache)

### Dates
Never use `new Date('YYYY-MM-DD')` (UTC, shifts the day west of Greenwich). Use `Core.parseYmd()` / `Core.toYmd()`; all app dates are local midnight.

### Key Constants
```javascript
const START_DATE = Core.parseYmd('2013-05-06');  // First Aunty Acid comic
const CORS_PROXY = 'https://corsproxy.garfieldapp.workers.dev/cors-proxy?';
```

## Code Patterns

### DOM Helper
Use `$()` for getElementById: `$('comic')`, `$('DatePicker')`, `$('mainToolbar')`, etc.

### LocalStorage Keys
- `favs` - JSON array of favorite dates (format: "YYYY/MM/DD")
- `lastcomic` - Last viewed comic date ("YYYY-MM-DD"; legacy `Date.toString()` values are still read)
- `imageUrls` - JSON object of date ("YYYY/MM/DD") -> comic image URL (capped, today excluded)
- `stat` - Swipe enabled ("true"/"false")
- `showfavs` - Show only favorites mode ("true"/"false")
- `lastdate` - Remember last comic setting
- `toolbarPos` - JSON object `{top, left, belowComic?, offsetFromComic?}`
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

## Service Worker
Bump `CACHE_NAME` version in `sw.js` when deploying changes (add new app files to `PRECACHE_ASSETS`):
```javascript
const CACHE_NAME = 'auntyacid-v29';  // Increment version number
```

## Testing
- `npm start` - local server on http://127.0.0.1:8000
- `npm run check` - syntax check; `npm test` - unit tests for `core.js`
- Put new pure logic in `core.js` and cover it in `tests/`

## PWA Manifest
Use relative paths (`./`) for all URLs to ensure cross-platform compatibility (Android & Windows):
```json
"start_url": ".",
"scope": ".",
"icons": [{ "src": "./manifest-icon-192.maskable.png", ... }]
```

## Deployment
- Hosted on Cloudflare Pages at `auntyacidapp.pages.dev`
- Push to main branch triggers auto-deploy
- No build step required (static files)

## Related Projects
Reference `https://github.com/my-pwa-apps/GarfieldApp` for shared patterns
