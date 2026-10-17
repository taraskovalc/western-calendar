// Talking to the Slotted API (accounts). Everything else on the page works
// without it, so every failure here is handled gracefully.
// When testing on your own computer (localhost), talk to the API running there.
export const API_URL = location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://api.taraskoval.ca';

export class ApiUnavailable extends Error {}
export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(path, { method = 'GET', body } = {}) {
  let response;
  try {
    response = await fetch(API_URL + path, {
      method,
      credentials: 'include',  // send the sign-in cookie
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiUnavailable('Accounts are not available right now.');
  }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    // 401 = the sign-in has ended (expired, or signed out on another device).
    // A wrong password at login or account deletion also answers 401; those aren't sign-outs.
    if (response.status === 401 && path !== '/auth/login' && path !== '/auth/account') {
      window.dispatchEvent(new Event('slotted:signed-out'));
    }
    const message = data?.error ?? data?.errors?.map(e => e.message).join(' ') ?? 'Something went wrong.';
    throw new ApiError(response.status, message);
  }
  return data;
}
