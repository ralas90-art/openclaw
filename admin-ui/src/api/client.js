/**
 * Shared API Client for Admin UI
 * Encapsulates HttpOnly cookies and Bearer token headers for all API calls.
 */

export function getSessionToken() {
  const token = sessionStorage.getItem('jarvis_session_token');
  if (token && typeof token === 'string' && token.startsWith('srv_sess_')) {
    return token;
  }
  return null;
}

export function setSessionToken(token) {
  if (token && typeof token === 'string' && token.startsWith('srv_sess_')) {
    sessionStorage.setItem('jarvis_session_token', token);
    return true;
  }
  console.warn('[ApiClient] Rejected session token missing srv_sess_ prefix');
  return false;
}

export function clearSessionToken() {
  sessionStorage.removeItem('jarvis_session_token');
  sessionStorage.removeItem('adminToken');
}

export async function apiFetch(url, options = {}) {
  const token = getSessionToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
    headers['x-admin-token'] = token;
  }

  const fetchOptions = {
    ...options,
    headers,
    credentials: 'same-origin'
  };

  const res = await fetch(url, fetchOptions);
  if (res.status === 401) {
    // If unauthorized, clear session token
    clearSessionToken();
  }
  return res;
}
