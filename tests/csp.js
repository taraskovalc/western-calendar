// The Content-Security-Policy that Cloudflare adds to slotted.taraskoval.ca
// (Transform Rule "Slotted security headers"). Keep the two identical.
// The sha256 is the inline theme script in web/index.html: editing that script
// changes the hash, so the new one must go here and in Cloudflare.
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'sha256-zTcUYJa/zNcEq916EUvAjI3/a9a8IVXLS4sSE+mJySc=' https://static.cloudflareinsights.com",
  "style-src 'self' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "img-src 'self' data:",
  "connect-src 'self' https://api.taraskoval.ca https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

// Serves only the local site, with the CSP header added to every page, so the
// tests fail if anything the policy blocks sneaks in. Returns the list of
// page errors and CSP violations, which should stay empty.
export async function localSiteWithCsp(page, baseURL) {
  // On localhost app.js calls the API at localhost:3000, so allow that here only.
  const policy = CSP.replace('connect-src', 'connect-src http://localhost:3000');
  await page.route('**/*', async route => {
    const request = route.request();
    if (!request.url().startsWith(baseURL)) return route.abort();  // no API, fonts or analytics
    if (request.resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': policy } });
  });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error' && msg.text().includes('Content Security Policy')) errors.push(msg.text()); });
  return errors;
}
