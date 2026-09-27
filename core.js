// Pure, DOM-free helpers shared by app.js and the Node test suite.
(function (root, factory) {
	const api = factory();
	if (typeof module === 'object' && module.exports) {
		module.exports = api;
	} else {
		root.AuntyAcidCore = api;
	}
})(typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const COMIC_IMAGE_HOSTS = ['featureassets.gocomics.com', 'assets.amuniversal.com'];
	const YMD_PATTERN = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;

	/**
	 * Parse "YYYY-MM-DD" or "YYYY/MM/DD" into a Date at local midnight.
	 * Avoids `new Date('YYYY-MM-DD')`, which is UTC and shifts the day west of Greenwich.
	 * @returns {Date|null}
	 */
	function parseYmd(value) {
		if (typeof value !== 'string') return null;
		const match = value.trim().match(YMD_PATTERN);
		if (!match) return null;
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const date = new Date(year, month - 1, day);
		if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
			return null;
		}
		return date;
	}

	/** Format a Date's local calendar day as "YYYY/MM/DD" (or with a custom separator). */
	function toYmd(date, separator = '/') {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}${separator}${m}${separator}${d}`;
	}

	function startOfDay(date) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate());
	}

	function addDays(date, days) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
	}

	function sameDay(a, b) {
		return !!a && !!b && toYmd(a) === toYmd(b);
	}

	/**
	 * 'next' / 'previous' when `target` is the calendar day right after / before `current`,
	 * otherwise null. Only adjacent comics slide; longer jumps use the morph transition.
	 */
	function adjacentDirection(current, target) {
		if (!current || !target) return null;
		if (sameDay(addDays(current, 1), target)) return 'next';
		if (sameDay(addDays(current, -1), target)) return 'previous';
		return null;
	}

	function clampDate(date, min, max) {
		if (date < min) return startOfDay(min);
		if (date > max) return startOfDay(max);
		return startOfDay(date);
	}

	/**
	 * Parse a stored "last comic" value. Accepts the current "YYYY-MM-DD" format and the
	 * legacy `Date.prototype.toString()` format written by older versions.
	 * @returns {Date|null}
	 */
	function parseStoredDate(value) {
		if (typeof value !== 'string' || !value) return null;
		const ymd = parseYmd(value);
		if (ymd) return ymd;
		const legacy = new Date(value);
		return Number.isNaN(legacy.getTime()) ? null : startOfDay(legacy);
	}

	function isComicImageUrl(url) {
		try {
			const parsed = new URL(url);
			return parsed.protocol === 'https:' && COMIC_IMAGE_HOSTS.includes(parsed.hostname);
		} catch {
			return false;
		}
	}

	/**
	 * Extract the comic strip image URL from a GoComics comic page.
	 * `og:image` is checked first: every page also embeds unrelated site-wide assets
	 * (e.g. a 2017 holiday strip) that can precede the actual strip in the markup.
	 * @returns {string|null}
	 */
	function extractComicImageUrl(html) {
		if (typeof html !== 'string' || !html) return null;
		return extractOgImage(html) || extractCdnImage(html);
	}

	function metaContent(html, key) {
		const keyPattern = new RegExp(`(?:property|name)\\s*=\\s*(["'])${key.replace(/[.:]/g, '\\$&')}\\1`, 'i');
		const values = [];
		// Accept property= or name=, either attribute order, and HTML-escaped ampersands.
		for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
			if (!keyPattern.test(tag)) continue;
			const content = tag.match(/content\s*=\s*(["'])(.*?)\1/i);
			if (content) values.push(content[2].trim().replace(/&amp;/gi, '&'));
		}
		return values;
	}

	function extractOgImage(html) {
		return metaContent(html, 'og:image').find(isComicImageUrl) || null;
	}

	function extractCdnImage(html) {
		let match = html.match(/https:\/\/featureassets\.gocomics\.com\/assets\/[a-f0-9]+/);
		if (match) return match[0];
		match = html.match(/https:\/\/assets\.amuniversal\.com\/[a-f0-9]+/);
		return match ? match[0] : null;
	}

	/**
	 * The date ("YYYY/MM/DD") a GoComics page is actually for, from og:url or the canonical link.
	 * Dates without their own strip (not yet published, future) serve the latest comic instead.
	 * @returns {string|null}
	 */
	function extractComicPageDate(html) {
		if (typeof html !== 'string' || !html) return null;
		const canonical = html.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i);
		const candidates = [
			...metaContent(html, 'og:url'),
			...(canonical ? [(canonical[0].match(/href\s*=\s*(["'])(.*?)\1/i) || [])[2]] : [])
		];
		for (const url of candidates) {
			const match = typeof url === 'string' && url.match(/\/(\d{4})\/(\d{2})\/(\d{2})(?:[/?#]|$)/);
			if (match && parseYmd(`${match[1]}/${match[2]}/${match[3]}`)) return `${match[1]}/${match[2]}/${match[3]}`;
		}
		return null;
	}

	/**
	 * Resolve a GoComics page fetched for `requestedYmd` ("YYYY/MM/DD").
	 * `date` is the day the page is really for (defaults to the requested day when the page
	 * doesn't say). The loose CDN fallback is only trusted on a page for the requested day,
	 * because other pages (e.g. "no comic" pages) embed unrelated site-wide strips.
	 * @returns {{url: string|null, date: string}}
	 */
	function resolveComicPage(html, requestedYmd) {
		if (typeof html !== 'string' || !html) return { url: null, date: requestedYmd };
		const pageDate = extractComicPageDate(html);
		const url = extractOgImage(html) || (pageDate === requestedYmd ? extractCdnImage(html) : null);
		return { url, date: pageDate || requestedYmd };
	}

	function isValidFavorite(value, minDate, maxDate) {
		if (typeof value !== 'string' || !/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return false;
		const date = parseYmd(value);
		if (!date) return false;
		if (minDate && date < startOfDay(minDate)) return false;
		if (maxDate && date > startOfDay(maxDate)) return false;
		return true;
	}

	/**
	 * Keep only valid, in-range "YYYY/MM/DD" favorites; dedupe and sort.
	 * @returns {{favorites: string[], rejected: number}}
	 */
	function sanitizeFavorites(values, minDate, maxDate) {
		if (!Array.isArray(values)) return { favorites: [], rejected: 0 };
		const valid = new Set();
		let rejected = 0;
		for (const value of values) {
			if (isValidFavorite(value, minDate, maxDate)) {
				valid.add(value);
			} else {
				rejected++;
			}
		}
		return { favorites: [...valid].sort(), rejected };
	}

	function safeJsonParse(text, fallback) {
		if (typeof text !== 'string') return fallback;
		try {
			const value = JSON.parse(text);
			return value === null || value === undefined ? fallback : value;
		} catch {
			return fallback;
		}
	}

	/**
	 * Navigation targets within a sorted favorites list, relative to any date
	 * (the date does not need to be a favorite itself).
	 */
	function favoriteNeighbors(favorites, date) {
		const key = toYmd(date);
		let previous = null;
		let next = null;
		for (const fav of favorites) {
			if (fav < key) previous = fav;
			else if (fav > key && next === null) next = fav;
		}
		return { previous, next };
	}

	return {
		parseYmd,
		toYmd,
		startOfDay,
		addDays,
		sameDay,
		adjacentDirection,
		clampDate,
		parseStoredDate,
		isComicImageUrl,
		extractComicImageUrl,
		extractComicPageDate,
		resolveComicPage,
		isValidFavorite,
		sanitizeFavorites,
		safeJsonParse,
		favoriteNeighbors
	};
});
