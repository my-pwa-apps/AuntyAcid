'use strict';

// Deploy guard: every file the app, service worker, manifest and tile config reference must exist,
// and declared PNG sizes must match the real files (browsers silently drop mismatched entries).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (ref) => fs.existsSync(path.join(root, ref.split(/[?#]/)[0]));

function pngSize(ref) {
	const buffer = fs.readFileSync(path.join(root, ref));
	assert.equal(buffer.toString('ascii', 1, 4), 'PNG', `${ref} is not a PNG`);
	return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

test('service worker precache assets exist', () => {
	const list = read('sw.js').match(/PRECACHE_ASSETS\s*=\s*\[([\s\S]*?)\]/);
	assert.ok(list, 'PRECACHE_ASSETS not found');
	const assets = [...list[1].matchAll(/'([^']+)'/g)].map(match => match[1]).filter(asset => asset !== './');
	assert.ok(assets.length > 0);
	for (const asset of assets) assert.ok(exists(asset), `missing precache asset ${asset}`);
});

test('every local script, stylesheet, icon and image in index.html exists', () => {
	const html = read('index.html');
	const refs = [...html.matchAll(/\b(?:src|href)="(\.\/[^"]+)"/g)].map(match => match[1]);
	assert.ok(refs.length > 0);
	for (const ref of refs) assert.ok(exists(ref), `index.html references missing ${ref}`);
});

test('every script and stylesheet index.html loads is precached', () => {
	const precache = read('sw.js');
	const html = read('index.html');
	for (const [, ref] of html.matchAll(/<(?:script|link rel="stylesheet")[^>]*\b(?:src|href)="(\.\/[^"]+)"/g)) {
		assert.ok(precache.includes(`'${ref}'`), `${ref} is loaded by index.html but not precached`);
	}
});

test('manifest icons and screenshots exist with the declared sizes', () => {
	const manifest = JSON.parse(read('manifest.webmanifest'));
	for (const entry of [...manifest.icons, ...(manifest.screenshots || [])]) {
		assert.ok(exists(entry.src), `manifest references missing ${entry.src}`);
		if (entry.type === 'image/png' && entry.sizes) {
			assert.equal(pngSize(entry.src), entry.sizes, `${entry.src} declared size`);
		}
	}
	for (const shot of manifest.screenshots || []) {
		const [width, height] = shot.sizes.split('x').map(Number);
		assert.equal(shot.form_factor, width > height ? 'wide' : 'narrow', `${shot.src} form_factor`);
	}
});

test('browserconfig tile images exist', () => {
	for (const [, ref] of read('browserconfig.xml').matchAll(/src="([^"]+)"/g)) {
		assert.ok(exists(ref), `browserconfig.xml references missing ${ref}`);
	}
});
