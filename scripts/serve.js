// Minimal static file server for local testing: `npm start` -> http://127.0.0.1:8000
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT) || 8000;
const types = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.webmanifest': 'application/manifest+json',
	'.xml': 'application/xml',
	'.txt': 'text/plain; charset=utf-8',
	'.png': 'image/png',
	'.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
	let urlPath;
	try {
		urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	} catch {
		res.writeHead(400);
		return res.end('Bad request');
	}
	if (urlPath.endsWith('/')) urlPath += 'index.html';

	const file = path.resolve(root, '.' + urlPath);
	if (!file.startsWith(root + path.sep)) {
		res.writeHead(403);
		return res.end('Forbidden');
	}

	fs.stat(file, (err, stat) => {
		if (err || !stat.isFile()) {
			res.writeHead(404);
			return res.end('Not found');
		}
		res.writeHead(200, {
			'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
			'Cache-Control': 'no-cache'
		});
		fs.createReadStream(file).pipe(res);
	});
}).listen(port, '127.0.0.1', () => {
	console.log(`Aunty Acid test server: http://127.0.0.1:${port}`);
});
