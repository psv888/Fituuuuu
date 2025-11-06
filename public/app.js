import { OAUTH_CONFIG } from '/config.js';

const { useState, useEffect, useMemo } = React;

// PKCE helpers
async function generateCodeVerifier() {
	const random = crypto.getRandomValues(new Uint8Array(32));
	return base64UrlEncode(random);
}

async function generateCodeChallenge(codeVerifier) {
	const encoder = new TextEncoder();
	const data = encoder.encode(codeVerifier);
	const digest = await crypto.subtle.digest('SHA-256', data);
	return base64UrlEncode(new Uint8Array(digest));
}

function base64UrlEncode(bytes) {
	let str = '';
	for (let i = 0; i < bytes.length; i++) {
		str += String.fromCharCode(bytes[i]);
	}
	return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomState() {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return base64UrlEncode(bytes);
}

function buildAuthorizeUrl({
	authorizeEndpoint,
	clientId,
	redirectUri,
	scope,
	codeChallenge,
	state,
}) {
	const url = new URL(authorizeEndpoint);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('redirect_uri', redirectUri);
	url.searchParams.set('scope', scope);
	url.searchParams.set('code_challenge', codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	url.searchParams.set('state', state);
	return url.toString();
}

async function exchangeCodeForToken({ redirectUri, code, codeVerifier }) {
	const res = await fetch('/oauth/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Token request failed: ${res.status} ${text}`);
	}
	return res.json();
}

function useQueryParams() {
	return useMemo(() => new URLSearchParams(window.location.search), [window.location.search]);
}

function App() {
	const [accessToken, setAccessToken] = useState(null);
	const [error, setError] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isFetchingSteps, setIsFetchingSteps] = useState(false);
	const [todaySteps, setTodaySteps] = useState(null);
	const params = useQueryParams();

	useEffect(() => {
		const code = params.get('code');
		const returnedState = params.get('state');
		if (!code) return;

		const storedState = sessionStorage.getItem('oauth_state');
		const codeVerifier = sessionStorage.getItem('pkce_code_verifier');
		if (!codeVerifier) {
			setError('Missing PKCE code_verifier in session. Please try logging in again.');
			return;
		}
		if (!storedState || storedState !== returnedState) {
			setError('State mismatch. Possible CSRF or stale session.');
			return;
		}

		setIsLoading(true);
			exchangeCodeForToken({
			redirectUri: OAUTH_CONFIG.REDIRECT_URI,
			code,
			codeVerifier,
		})
				.then((tokens) => {
					const at = tokens.access_token || null;
					setAccessToken(at);
					// Auto-fetch steps using the fresh token immediately to avoid state timing issues
					if (at) {
						fetchTodaySteps(at).catch(() => {});
					}
				})
			.catch((e) => setError(e.message))
			.finally(() => setIsLoading(false));
	}, [params]);

	function handleLoginClick() {
		if (!OAUTH_CONFIG.AUTHORIZATION_ENDPOINT || !OAUTH_CONFIG.TOKEN_ENDPOINT || !OAUTH_CONFIG.CLIENT_ID) {
			setError('Please configure AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT, and CLIENT_ID in config.js');
			return;
		}
		setError(null);
		(async () => {
			const codeVerifier = await generateCodeVerifier();
			sessionStorage.setItem('pkce_code_verifier', codeVerifier);
			const codeChallenge = await generateCodeChallenge(codeVerifier);
			const state = randomState();
			sessionStorage.setItem('oauth_state', state);
			const url = buildAuthorizeUrl({
				authorizeEndpoint: OAUTH_CONFIG.AUTHORIZATION_ENDPOINT,
				clientId: OAUTH_CONFIG.CLIENT_ID,
				redirectUri: OAUTH_CONFIG.REDIRECT_URI,
				scope: OAUTH_CONFIG.SCOPE,
				codeChallenge,
				state,
			});
			window.location.assign(url);
		})();
	}

	function handleReset() {
		setAccessToken(null);
		setTodaySteps(null);
		setError(null);
		const url = new URL(window.location.href);
		url.search = '';
		window.history.replaceState({}, '', url.toString());
		sessionStorage.removeItem('pkce_code_verifier');
		sessionStorage.removeItem('oauth_state');
	}

	function getTodayBoundsMillis() {
		const now = new Date();
		const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
		const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
		return { startTimeMillis: start.getTime(), endTimeMillis: end.getTime() };
	}

async function fetchTodaySteps(tokenOverride) {
		const token = tokenOverride || accessToken;
		if (!token) {
			setError('No access token. Please log in first.');
			return;
		}
		setError(null);
		setIsFetchingSteps(true);
		setTodaySteps(null);
		try {
			const { startTimeMillis, endTimeMillis } = getTodayBoundsMillis();
			const body = {
				aggregateBy: [ { dataTypeName: 'com.google.step_count.delta' } ],
				bucketByTime: { durationMillis: 86400000 },
				startTimeMillis,
				endTimeMillis
			};
			const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json;encoding=utf-8',
					'Authorization': `Bearer ${token}`,
				},
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const txt = await res.text();
				throw new Error(`Google Fit error ${res.status}: ${txt}`);
			}
			const data = await res.json();
			let steps = 0;
			if (Array.isArray(data.bucket)) {
				for (const bucket of data.bucket) {
					if (!Array.isArray(bucket.dataset)) continue;
					for (const dataset of bucket.dataset) {
						if (!Array.isArray(dataset.point)) continue;
						for (const point of dataset.point) {
							const val = point && Array.isArray(point.value) && point.value[0];
							if (val && typeof val.intVal === 'number') steps += val.intVal;
						}
					}
				}
			}
			setTodaySteps(steps);
		} catch (e) {
			setError(e.message);
		} finally {
			setIsFetchingSteps(false);
		}
	}

	return React.createElement(
		'div',
		{ className: 'container' },
		[
			React.createElement('h1', { key: 't', className: 'title' }, 'Google Fit — Today\'s Activity'),
			React.createElement('p', { key: 's', className: 'subtitle' }, 'Sign in, then view today\'s steps in a clean dashboard.'),

			React.createElement(
				'div',
				{ key: 'cfg', className: 'note' },
				`Configured Redirect URI: ${OAUTH_CONFIG.REDIRECT_URI}`
			),

			React.createElement(
				'div',
				{ key: 'actions', style: { display: 'flex', gap: 8, marginTop: 12 } },
				[
					React.createElement(
						'button',
						{ key: 'login', className: 'btn', disabled: isLoading, onClick: handleLoginClick },
						isLoading ? 'Redirecting…' : 'Login with OAuth 2.0'
					),
					React.createElement(
						'button',
						{ key: 'reset', className: 'btn secondary', onClick: handleReset },
						'Reset'
					),
					React.createElement(
						'button',
						{ key: 'steps', className: 'btn', disabled: !accessToken || isFetchingSteps, onClick: fetchTodaySteps },
						isFetchingSteps ? 'Fetching steps…' : 'Get today\'s steps'
					),
				]
			),

			error && React.createElement('div', { key: 'err', className: 'token', style: { borderColor: '#ff6b6b' } }, `Error: ${error}`),

			(accessToken || todaySteps !== null) && React.createElement(
				'div',
				{ key: 'dash', className: 'dashboard' },
				[
					React.createElement(
						'div',
						{ key: 'card-steps', className: 'card' },
						[
							React.createElement('div', { key: 'ic', className: 'card-icon' }, '👣'),
							React.createElement(
								'div',
								{ key: 'ct', className: 'card-content' },
								[
									React.createElement('div', { key: 'ttl', className: 'card-title' }, 'Today\'s Steps'),
									React.createElement('div', { key: 'val', className: 'card-value' }, todaySteps !== null ? String(todaySteps) : '—'),
								]
							)
						]
					),
				]
			),
		]
	);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));


