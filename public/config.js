// Fill these with your OAuth 2.0 provider details.
// For Google, you would set:
// - AUTHORIZATION_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth'
// - TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token'
// - CLIENT_ID: 'YOUR_GOOGLE_OAUTH_CLIENT_ID'
// - REDIRECT_URI: 'http://localhost:3000/' (ensure this is whitelisted)
// - SCOPE: e.g. 'openid profile email https://www.googleapis.com/auth/fitness.activity.read'

export const OAUTH_CONFIG = {
	AUTHORIZATION_ENDPOINT: 'https://accounts.google.com/o/oauth2/v2/auth',
	TOKEN_ENDPOINT: 'https://oauth2.googleapis.com/token', // not used on client when backend exchange is enabled
	CLIENT_ID: '88270120327-n3keglhq3jgntq77t7curhas0b8m9n6k.apps.googleusercontent.com',
	REDIRECT_URI: 'http://localhost:3001/',
	SCOPE: 'openid profile email https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.body.read',
};


