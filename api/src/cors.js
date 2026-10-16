// CORS: which websites may call this API from a browser.
//
// Browsers block a page on one address (calendar.taraskoval.ca) from reading
// responses from another (api.taraskoval.ca) unless the API says it's allowed.
// We allow only our own site(s), listed in ALLOWED_ORIGINS, and allow cookies
// ("credentials") so signing in works. Every other website is refused.
const allowed = new Set(
  (process.env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean),
);

export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && allowed.has(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    });
    // The browser's "may I?" check before PATCH/DELETE/JSON requests.
    if (req.method === 'OPTIONS') {
      res.set({
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      });
      return res.status(204).end();
    }
  }
  next();
}
