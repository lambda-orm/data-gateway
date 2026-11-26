// the answer of the identity provider (docs/OIDC_LOGIN.md §2): to the window of the IDE that opened this one, only if it
// is of this same origin (the CSP of the IDE allows no inline script); then this window closes
if (window.opener && window.opener !== window) {
	window.opener.postMessage({ type: 'lambdaorm-oidc', search: window.location.search }, window.location.origin)
	window.close()
}
