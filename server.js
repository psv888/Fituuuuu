const http = require('http');
const fs = require('fs');
const path = require('path');

// Lightweight .env loader (avoids extra dependencies)
function loadEnvFile(envPath) {
	try {
		const content = fs.readFileSync(envPath, 'utf8');
		content.split(/\r?\n/).forEach((line) => {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) return;
			const eq = trimmed.indexOf('=');
			if (eq === -1) return;
			const key = trimmed.slice(0, eq).trim();
			const value = trimmed.slice(eq + 1).trim().replace(/^"|"$/g, '');
			if (!(key in process.env)) {
				process.env[key] = value;
			}
		});
	} catch (_) {
		// ignore if .env not present
	}
}

loadEnvFile(path.join(__dirname, '.env'));

// Built-in fetch is available in Node 18+. If not, please upgrade Node.

const TOKEN_ENDPOINT = process.env.GOOGLE_TOKEN_ENDPOINT || 'https://oauth2.googleapis.com/token';
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

const publicDir = path.join(__dirname, 'public');
const port = process.env.PORT || 3001;

function getContentType(filePath) {
	const ext = path.extname(filePath).toLowerCase();
	switch (ext) {
		case '.html': return 'text/html; charset=utf-8';
		case '.js': return 'application/javascript; charset=utf-8';
		case '.css': return 'text/css; charset=utf-8';
		case '.json': return 'application/json; charset=utf-8';
		case '.png': return 'image/png';
		case '.jpg':
		case '.jpeg': return 'image/jpeg';
		case '.svg': return 'image/svg+xml';
		default: return 'application/octet-stream';
	}
}

const server = http.createServer(async (req, res) => {
	// Simple CORS for same-origin XHR; adjust if needed
	res.setHeader('Access-Control-Allow-Origin', 'http://localhost:' + (process.env.PORT || 3001));
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	// Normalize pathname for routing
	const urlObj = new URL(req.url, `http://localhost:${port}`);
	const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';

	// Token exchange endpoint to keep client_secret on the server
	if ((pathname === '/oauth/token') && req.method === 'POST') {
		try {
			let body = '';
			req.on('data', (chunk) => { body += chunk; });
			await new Promise((resolve) => req.on('end', resolve));

			const { code, redirect_uri, code_verifier } = JSON.parse(body || '{}');
			if (!code || !redirect_uri || !code_verifier) {
				res.writeHead(400, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'invalid_request', error_description: 'Missing code, redirect_uri, or code_verifier' }));
				return;
			}
			if (!CLIENT_ID || !CLIENT_SECRET) {
				res.writeHead(500, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ error: 'server_config', error_description: 'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET env vars' }));
				return;
			}

			const form = new URLSearchParams();
			form.set('grant_type', 'authorization_code');
			form.set('code', code);
			form.set('client_id', CLIENT_ID);
			form.set('client_secret', CLIENT_SECRET);
			form.set('redirect_uri', redirect_uri);
			form.set('code_verifier', code_verifier);

			const tokenRes = await fetch(TOKEN_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: form.toString(),
			});
			const text = await tokenRes.text();
			if (!tokenRes.ok) {
				res.writeHead(tokenRes.status, { 'Content-Type': 'application/json' });
				try {
					res.end(text);
				} catch (_) {
					res.end(JSON.stringify({ error: 'token_error', error_description: text }));
				}
				return;
			}
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(text);
			return;
		} catch (e) {
			res.writeHead(500, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ error: 'server_error', error_description: e.message }));
			return;
		}
	}
	let requestPath = pathname === '/' ? '/' : urlObj.pathname;
	if (requestPath === '/') {
		requestPath = '/index.html';
	}
	const filePath = path.join(publicDir, path.normalize(requestPath));

	fs.stat(filePath, (err, stats) => {
		if (err || !stats.isFile()) {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
			res.end('Not found');
			return;
		}
		const contentType = getContentType(filePath);
		res.writeHead(200, { 'Content-Type': contentType });
		fs.createReadStream(filePath).pipe(res);
	});
});

server.listen(port, () => {
	console.log(`Server running at http://localhost:${port}`);
});


