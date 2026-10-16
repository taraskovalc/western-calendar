// Talking to the Slotted API (accounts). Everything else on the page works
// without it, so every failure here is handled gracefully.
const API_URL = 'https://api.taraskoval.ca';

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
    const message = data?.error ?? data?.errors?.map(e => e.message).join(' ') ?? 'Something went wrong.';
    throw new ApiError(response.status, message);
  }
  return data;
}
