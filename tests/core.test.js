'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../core.js');

const SITE_ASSET = 'https://featureassets.gocomics.com/assets/f98fbb20ac400135fdb0005056a9545d';
const STRIP = 'https://featureassets.gocomics.com/assets/6b5cbd50940e0130342d001dd8b71c47';

// Mirrors the structure observed on live GoComics pages: og:image in <head>, and a site-wide
// asset that can appear in the body before the actual strip.
function page({ og = STRIP, bodyAssets = [SITE_ASSET, STRIP] } = {}) {
	return `<html><head><title>GoComics</title>
		${og ? `<meta property="og:image" content="${og}"/>` : ''}
		</head><body>${bodyAssets.map(src => `<img src="${src}">`).join('')}</body></html>`;
}

test('extractComicImageUrl prefers og:image over earlier site-wide assets', () => {
	assert.equal(Core.extractComicImageUrl(page()), STRIP);
});

test('extractComicImageUrl supports og:image with reversed attribute order', () => {
	const html = `<meta content="${STRIP}" property="og:image">${SITE_ASSET}`;
	assert.equal(Core.extractComicImageUrl(html), STRIP);
});

test('extractComicImageUrl ignores og:image on foreign hosts and falls back to the CDN', () => {
	const html = page({ og: 'https://example.com/share.png', bodyAssets: [STRIP] });
	assert.equal(Core.extractComicImageUrl(html), STRIP);
});

test('extractComicImageUrl falls back to legacy amuniversal assets', () => {
	const legacy = 'https://assets.amuniversal.com/0123456789abcdef';
	assert.equal(Core.extractComicImageUrl(page({ og: null, bodyAssets: [] }) + legacy), legacy);
});

test('extractComicImageUrl returns null when no comic is present', () => {
	assert.equal(Core.extractComicImageUrl('<html><body>403 Forbidden</body></html>'), null);
	assert.equal(Core.extractComicImageUrl(''), null);
	assert.equal(Core.extractComicImageUrl(undefined), null);
});

test('extractComicImageUrl accepts name="og:image", single quotes and escaped ampersands', () => {
	assert.equal(Core.extractComicImageUrl(`<meta name='og:image' content='${STRIP}'>${SITE_ASSET}`), STRIP);
	const escaped = `<meta property="og:image" content="${STRIP}?optimizer=image&amp;width=1400">`;
	assert.equal(Core.extractComicImageUrl(escaped), `${STRIP}?optimizer=image&width=1400`);
});

test('extractComicImageUrl skips a foreign og:image and uses a later valid one', () => {
	const html = `<meta property="og:image" content="https://example.com/x.png"><meta property="og:image" content="${STRIP}">${SITE_ASSET}`;
	assert.equal(Core.extractComicImageUrl(html), STRIP);
});

// Mirrors live GoComics markup: a date without its own strip (not yet published / future)
// serves the latest comic, with og:url and canonical pointing at that comic's date.
function datedPage(pageDate, { og = STRIP, canonical = true } = {}) {
	const url = `https://www.gocomics.com/aunty-acid/${pageDate}`;
	return `<html><head>${canonical ? `<link rel="canonical" href="${url}"/>` : ''}
		<meta property="og:url" content="${url}"/>
		${og ? `<meta property="og:image" content="${og}"/>` : ''}
		</head><body><img src="${SITE_ASSET}"><img src="${STRIP}"></body></html>`;
}

test('extractComicPageDate reads og:url, then the canonical link', () => {
	assert.equal(Core.extractComicPageDate(datedPage('2026/09/27')), '2026/09/27');
	const canonicalOnly = `<link href="https://www.gocomics.com/aunty-acid/2013/05/06" rel="canonical">`;
	assert.equal(Core.extractComicPageDate(canonicalOnly), '2013/05/06');
	assert.equal(Core.extractComicPageDate('<html><title>GoComics</title></html>'), null);
	assert.equal(Core.extractComicPageDate(`<meta property="og:url" content="https://www.gocomics.com/aunty-acid/2024/02/30">`), null);
});

test('resolveComicPage reports the day GoComics really served', () => {
	assert.deepEqual(Core.resolveComicPage(datedPage('2026/09/25'), '2026/09/25'), { url: STRIP, date: '2026/09/25' });
	// Requested 2026/09/28 before it was published: the page is for 2026/09/27
	assert.deepEqual(Core.resolveComicPage(datedPage('2026/09/27'), '2026/09/28'), { url: STRIP, date: '2026/09/27' });
	// Pages that don't say which day they are for are taken at face value
	assert.deepEqual(Core.resolveComicPage(page(), '2020/01/01'), { url: STRIP, date: '2020/01/01' });
});

test('resolveComicPage only trusts the loose CDN fallback on the requested day\'s page', () => {
	assert.deepEqual(Core.resolveComicPage(datedPage('2020/01/01', { og: null }), '2020/01/01'), { url: SITE_ASSET, date: '2020/01/01' });
	assert.equal(Core.resolveComicPage(datedPage('2020/01/02', { og: null }), '2020/01/01').url, null);
	// "No comic" pages (e.g. before the first strip) have neither og:url nor og:image
	assert.equal(Core.resolveComicPage(`<html><title>GoComics</title><img src="${SITE_ASSET}"></html>`, '2013/05/05').url, null);
	assert.equal(Core.resolveComicPage('', '2013/05/05').url, null);
});

test('adjacentDirection only reports neighbouring calendar days', () => {
	const day = Core.parseYmd('2024-03-31');
	assert.equal(Core.adjacentDirection(day, Core.parseYmd('2024-04-01')), 'next');
	assert.equal(Core.adjacentDirection(day, Core.parseYmd('2024-03-30')), 'previous');
	assert.equal(Core.adjacentDirection(day, Core.parseYmd('2024-04-02')), null);
	assert.equal(Core.adjacentDirection(day, day), null);
	assert.equal(Core.adjacentDirection(null, day), null);
	// Across DST changes in either hemisphere
	assert.equal(Core.adjacentDirection(Core.parseYmd('2024-03-09'), Core.parseYmd('2024-03-10')), 'next');
	assert.equal(Core.adjacentDirection(Core.parseYmd('2024-04-07'), Core.parseYmd('2024-04-06')), 'previous');
});

test('parseYmd returns the same local calendar day for both separators', () => {
	for (const input of ['2024-03-15', '2024/03/15']) {
		const date = Core.parseYmd(input);
		assert.equal(date.getFullYear(), 2024);
		assert.equal(date.getMonth(), 2);
		assert.equal(date.getDate(), 15);
		assert.equal(date.getHours(), 0);
	}
});

test('parseYmd rejects malformed and impossible dates', () => {
	for (const input of ['2024-02-30', '2024-13-01', '24-03-15', 'Fri Mar 15 2024', '', null, 42]) {
		assert.equal(Core.parseYmd(input), null, String(input));
	}
});

test('toYmd round-trips parseYmd', () => {
	assert.equal(Core.toYmd(Core.parseYmd('2013-05-06')), '2013/05/06');
	assert.equal(Core.toYmd(Core.parseYmd('2013/05/06'), '-'), '2013-05-06');
});

test('addDays crosses month, year and DST boundaries by calendar day', () => {
	assert.equal(Core.toYmd(Core.addDays(Core.parseYmd('2024-02-28'), 1)), '2024/02/29');
	assert.equal(Core.toYmd(Core.addDays(Core.parseYmd('2023-12-31'), 1)), '2024/01/01');
	assert.equal(Core.toYmd(Core.addDays(Core.parseYmd('2024-03-31'), -1)), '2024/03/30');
	assert.equal(Core.toYmd(Core.addDays(Core.parseYmd('2024-11-03'), 1)), '2024/11/04');
	assert.equal(Core.toYmd(Core.addDays(Core.parseYmd('2024-10-27'), 1)), '2024/10/28');
});

test('clampDate keeps dates within bounds', () => {
	const min = Core.parseYmd('2013-05-06');
	const max = Core.parseYmd('2024-01-01');
	assert.equal(Core.toYmd(Core.clampDate(Core.parseYmd('2013-05-05'), min, max)), '2013/05/06');
	assert.equal(Core.toYmd(Core.clampDate(Core.parseYmd('2030-01-01'), min, max)), '2024/01/01');
	assert.equal(Core.toYmd(Core.clampDate(Core.parseYmd('2020-06-15'), min, max)), '2020/06/15');
});

test('parseStoredDate reads new and legacy lastcomic formats', () => {
	assert.equal(Core.toYmd(Core.parseStoredDate('2024-03-15')), '2024/03/15');
	const legacy = new Date(2024, 2, 15, 14, 0, 0).toString();
	assert.equal(Core.toYmd(Core.parseStoredDate(legacy)), '2024/03/15');
	assert.equal(Core.parseStoredDate('garbage'), null);
	assert.equal(Core.parseStoredDate(null), null);
});

test('sanitizeFavorites keeps valid in-range dates, dedupes and sorts', () => {
	const min = Core.parseYmd('2013-05-06');
	const max = Core.parseYmd('2024-01-01');
	const result = Core.sanitizeFavorites(
		['2020/01/02', 'x', 1, null, { a: 1 }, '2020/01/02', '2019/12/31', '2013/05/05', '2030/01/01', '2020-01-03', '2020/02/30'],
		min,
		max
	);
	assert.deepEqual(result.favorites, ['2019/12/31', '2020/01/02']);
	assert.equal(result.rejected, 8);
	assert.deepEqual(Core.sanitizeFavorites('nope', min, max), { favorites: [], rejected: 0 });
});

test('safeJsonParse falls back on corrupt or empty input', () => {
	assert.deepEqual(Core.safeJsonParse('["a"]', []), ['a']);
	assert.deepEqual(Core.safeJsonParse('{bad', []), []);
	assert.deepEqual(Core.safeJsonParse(null, []), []);
	assert.deepEqual(Core.safeJsonParse('null', []), []);
});

test('favoriteNeighbors works whether or not the date is itself a favorite', () => {
	const favs = ['2014/01/01', '2016/06/15', '2020/03/03'];
	assert.deepEqual(Core.favoriteNeighbors(favs, Core.parseYmd('2016-06-15')), { previous: '2014/01/01', next: '2020/03/03' });
	assert.deepEqual(Core.favoriteNeighbors(favs, Core.parseYmd('2018-01-01')), { previous: '2016/06/15', next: '2020/03/03' });
	assert.deepEqual(Core.favoriteNeighbors(favs, Core.parseYmd('2014-01-01')), { previous: null, next: '2016/06/15' });
	assert.deepEqual(Core.favoriteNeighbors(favs, Core.parseYmd('2021-01-01')), { previous: '2020/03/03', next: null });
});

test('isComicImageUrl only accepts https comic CDN hosts', () => {
	assert.equal(Core.isComicImageUrl(STRIP), true);
	assert.equal(Core.isComicImageUrl('http://featureassets.gocomics.com/assets/abc'), false);
	assert.equal(Core.isComicImageUrl('https://evil.example/featureassets.gocomics.com'), false);
	assert.equal(Core.isComicImageUrl('not a url'), false);
});
