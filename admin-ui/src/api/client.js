/**
 * Shared API Client for Admin UI
 * Uses cookie-only authentication (credentials: 'include').
 */

export async function apiFetch(url, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'include'
  };

  const res = await fetch(url, fetchOptions);
  return res;
}
