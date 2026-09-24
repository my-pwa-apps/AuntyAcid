# Aunty Acid Comics PWA

A progressive web app for reading [Aunty Acid](https://www.gocomics.com/aunty-acid) comic strips by Ged Backland, hosted at **https://auntyacidapp.pages.dev**.

Features: date navigation (first / previous / random / date picker / next / latest), swipe and keyboard navigation, favorites with import/export, favorites-only browsing, sharing with deep links (`?date=YYYY-MM-DD`), and offline viewing of comics you have already opened.

## How it works

The app is a static site with no build step:

| File | Purpose |
| --- | --- |
| `index.html` | Single page: toolbar, comic, settings panel, toast |
| `core.js` | Pure helpers (image-URL extraction, local-date handling, favorites validation). Shared by the app and the tests. |
| `app.js` | UI logic: navigation, loading, favorites, sharing, swipe, draggable toolbar |
| `main.css` | Styles |
| `sw.js` | Service worker: app-shell caching and a bounded cache of viewed comic images |
| `manifest.webmanifest` | PWA manifest |

For each date the app fetches the GoComics comic page through the CORS proxy (`corsproxy.garfieldapp.workers.dev`) and reads the strip URL from the page's `og:image` tag. Resolved image URLs are cached in `localStorage` (`imageUrls`), so revisiting a date doesn't hit the proxy again.

## Local development

Requires Node.js 22 or newer (no npm dependencies).

```sh
npm start        # serves the app on http://127.0.0.1:8000
npm run check    # syntax-check core.js, app.js and sw.js
npm test         # unit tests for core.js (node:test)
```

Serve over `http://127.0.0.1` rather than opening `index.html` from disk; service workers and CORS only behave realistically over HTTP. The VS Code "Launch Edge" configuration expects `npm start` to be running.

Date logic is tested in several timezones in CI; to reproduce locally, set `TZ` (for example `TZ=America/Los_Angeles npm test`).

## Deployment

Pushing to `main` deploys to Cloudflare Pages (static files, no build command). When changing any cached file, bump `CACHE_NAME` in `sw.js` so installed clients pick up the new version. CI (`.github/workflows/ci.yml`) runs the checks and tests on every push and pull request.

## Data and storage

`localStorage` keys: `favs` (array of `YYYY/MM/DD`), `lastcomic` (`YYYY-MM-DD`), `imageUrls` (date → image URL), `stat` (swipe), `showfavs`, `lastdate`, `toolbarPos`, `toolbarOptimal`.

Comics are © Ged Backland, distributed by GoComics. This app is an unofficial reader.
