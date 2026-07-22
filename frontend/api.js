// When served by the FastAPI backend itself (web/PWA), a relative "/api" is
// correct. Packaged native builds (Capacitor) load the frontend from a local
// asset origin instead, so they need an absolute backend URL — this default
// is only used there and can be overridden at runtime (see setApiOrigin).
const NATIVE_DEFAULT_API_ORIGIN = "https://sd.praj.uk";
const API_ORIGIN_KEY = "expense-api-origin-v1";
const TOKEN_KEY = "expense-token-v1";

let _token = localStorage.getItem(TOKEN_KEY) || null;

class APIError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function isNativePlatform() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function getApiOrigin() {
  const stored = localStorage.getItem(API_ORIGIN_KEY);
  if (stored) return stored.replace(/\/$/, "");
  return isNativePlatform() ? NATIVE_DEFAULT_API_ORIGIN : "";
}

function setApiOrigin(url) {
  const trimmed = (url || "").trim().replace(/\/$/, "");
  if (trimmed) localStorage.setItem(API_ORIGIN_KEY, trimmed);
  else localStorage.removeItem(API_ORIGIN_KEY);
}

function setToken(token) {
  _token = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function getToken() {
  return _token;
}

async function _call(method, path, body, isForm) {
  const headers = {};
  if (_token) headers["Authorization"] = `Bearer ${_token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let resp;
  try {
    resp = await fetch(`${getApiOrigin()}/api${path}`, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    throw new APIError("Backend unreachable", 0);
  }

  if (resp.status === 401) {
    setToken(null);
    throw new APIError("Unauthorized", 401);
  }

  if (!resp.ok) {
    let detail = resp.statusText;
    try {
      const data = await resp.json();
      detail = data.detail || detail;
    } catch (_) {}
    throw new APIError(detail, resp.status);
  }

  if (resp.status === 204) return null;
  return resp.json();
}

const auth = {
  async login(username, password) {
    const form = new URLSearchParams();
    form.set("username", username);
    form.set("password", password);
    const data = await _call("POST", "/auth/token", form, true);
    setToken(data.access_token);
    return data.user;
  },
  async me() {
    return _call("GET", "/auth/me");
  },
  logout() {
    setToken(null);
  },
};

const transactions = {
  list: (params = {}) => _call("GET", `/transactions${qs(params)}`),
  create: (payload) => _call("POST", "/transactions", payload),
  update: (id, payload) => _call("PUT", `/transactions/${id}`, payload),
  remove: (id) => _call("DELETE", `/transactions/${id}`),
  summary: (period) => _call("GET", `/transactions/summary${qs({ period })}`),
  trend: (months) => _call("GET", `/transactions/trend${qs({ months })}`),
  async exportCsv(params = {}) {
    const headers = {};
    if (_token) headers["Authorization"] = `Bearer ${_token}`;
    const resp = await fetch(`${getApiOrigin()}/api/transactions/export/csv${qs(params)}`, { headers });
    if (!resp.ok) throw new APIError("ส่งออกไฟล์ไม่สำเร็จ", resp.status);
    const blob = await resp.blob();
    const disposition = resp.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : "transactions.csv";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

const creditCards = {
  list: () => _call("GET", "/credit-cards"),
  create: (payload) => _call("POST", "/credit-cards", payload),
  update: (id, payload) => _call("PUT", `/credit-cards/${id}`, payload),
  remove: (id) => _call("DELETE", `/credit-cards/${id}`),
  summary: (id) => _call("GET", `/credit-cards/${id}/summary`),
};

const recurringBills = {
  list: () => _call("GET", "/recurring-bills"),
  create: (payload) => _call("POST", "/recurring-bills", payload),
  update: (id, payload) => _call("PUT", `/recurring-bills/${id}`, payload),
  remove: (id) => _call("DELETE", `/recurring-bills/${id}`),
  generate: () => _call("POST", "/recurring-bills/generate"),
  instances: (status) => _call("GET", `/recurring-bills/instances${qs({ status })}`),
  pay: (id) => _call("POST", `/recurring-bills/instances/${id}/pay`),
  skip: (id) => _call("POST", `/recurring-bills/instances/${id}/skip`),
};

const loans = {
  list: (status) => _call("GET", `/loans${qs({ status })}`),
  create: (payload) => _call("POST", "/loans", payload),
  update: (id, payload) => _call("PUT", `/loans/${id}`, payload),
  remove: (id) => _call("DELETE", `/loans/${id}`),
  payments: (id) => _call("GET", `/loans/${id}/payments`),
  addPayment: (id, payload) => _call("POST", `/loans/${id}/payments`, payload),
};

const dashboard = {
  summary: () => _call("GET", "/dashboard/summary"),
};

const budgets = {
  list: () => _call("GET", "/budgets"),
  create: (payload) => _call("POST", "/budgets", payload),
  update: (id, payload) => _call("PUT", `/budgets/${id}`, payload),
  remove: (id) => _call("DELETE", `/budgets/${id}`),
};

const push = {
  vapidPublicKey: () => _call("GET", "/push/vapid-public-key"),
  subscribe: (subscription) => _call("POST", "/push/subscribe", subscription),
  unsubscribe: (endpoint) => _call("POST", "/push/unsubscribe", { endpoint }),
  test: () => _call("POST", "/push/test"),
};

function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries).toString();
}

async function checkHealth() {
  try {
    const resp = await fetch(`${getApiOrigin()}/health`);
    return resp.ok;
  } catch (_) {
    return false;
  }
}

window.api = {
  auth,
  transactions,
  creditCards,
  recurringBills,
  loans,
  dashboard,
  budgets,
  push,
  checkHealth,
  getToken,
  getApiOrigin,
  setApiOrigin,
  isNativePlatform,
  NATIVE_DEFAULT_API_ORIGIN,
  APIError,
};
