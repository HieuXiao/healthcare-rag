// API client tập trung cho web app RAG.
// Mặc định rỗng = gọi cùng origin (/api/...): dev đi qua proxy của Vite, Docker đi qua nginx.
// Chỉ set VITE_API_BASE_URL khi backend nằm ở domain khác.
const rawBase = import.meta.env.VITE_API_BASE_URL ?? '';
export const API_BASE_URL = rawBase.replace('0.0.0.0', '127.0.0.1');

const TOKEN_KEY = 'medrag-token';

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}
export function setToken(t) {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function handle(res) {
  if (!res.ok) {
    let detail = `Lỗi ${res.status}`;
    try { const j = await res.json(); detail = j.detail || detail; } catch { /* ignore */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  // ---- auth ----
  register: (body) => fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  login: (body) => fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(handle),
  me: () => fetch(`${API_BASE_URL}/api/auth/me`, { headers: authHeaders() }).then(handle),
  updateProfile: (body) => fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
  }).then(handle),

  // ---- meta ----
  models: () => fetch(`${API_BASE_URL}/api/models`).then(handle),

  // ---- conversations ----
  listConversations: () => fetch(`${API_BASE_URL}/api/conversations`, { headers: authHeaders() }).then(handle),
  createConversation: () => fetch(`${API_BASE_URL}/api/conversations`, {
    method: 'POST', headers: authHeaders(),
  }).then(handle),
  getConversation: (id) => fetch(`${API_BASE_URL}/api/conversations/${id}`, { headers: authHeaders() }).then(handle),
  renameConversation: (id, title) => fetch(`${API_BASE_URL}/api/conversations/${id}`, {
    method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ title }),
  }).then(handle),
  deleteConversation: (id) => fetch(`${API_BASE_URL}/api/conversations/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  }).then(handle),

  // ---- documents ----
  listDocuments: () => fetch(`${API_BASE_URL}/api/documents`, { headers: authHeaders() }).then(handle),
  uploadDocument: (file, note = '') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('note', note);
    return fetch(`${API_BASE_URL}/api/documents/upload`, { method: 'POST', headers: authHeaders(), body: fd }).then(handle);
  },
  toggleDocument: (id) => fetch(`${API_BASE_URL}/api/documents/${id}/toggle`, {
    method: 'PUT', headers: authHeaders(),
  }).then(handle),
  deleteDocument: (id) => fetch(`${API_BASE_URL}/api/documents/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  }).then(handle),

  // ---- admin ----
  adminDocuments: () => fetch(`${API_BASE_URL}/api/admin/documents`, { headers: authHeaders() }).then(handle),
  adminUploadDocument: (file, note = '') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('note', note);
    return fetch(`${API_BASE_URL}/api/admin/documents/upload`, { method: 'POST', headers: authHeaders(), body: fd }).then(handle);
  },
  adminToggleDocument: (id) => fetch(`${API_BASE_URL}/api/admin/documents/${id}/toggle`, {
    method: 'PUT', headers: authHeaders(),
  }).then(handle),
  adminDeleteDocument: (id) => fetch(`${API_BASE_URL}/api/admin/documents/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  }).then(handle),
  adminUsers: () => fetch(`${API_BASE_URL}/api/admin/users`, { headers: authHeaders() }).then(handle),
  adminActivity: () => fetch(`${API_BASE_URL}/api/admin/activity`, { headers: authHeaders() }).then(handle),
};

// SSE streaming chat. onEvent(event). Returns when stream ends.
export async function streamChat({ message, model, conversation_id }, onEvent) {
  const res = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, model, conversation_id }),
  });
  if (!res.ok || !res.body) {
    let detail = `Lỗi ${res.status}`;
    try { const j = await res.json(); detail = j.detail || detail; } catch { /* ignore */ }
    const err = new Error(detail); err.status = res.status; throw err;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const line = chunk.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try { onEvent(JSON.parse(payload)); } catch { /* ignore bad chunk */ }
    }
  }
}
