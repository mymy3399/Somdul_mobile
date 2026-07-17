const EXPENSE_CATEGORIES = [
  "อาหาร", "เดินทาง/น้ำมัน", "ที่พัก/ค่าเช่า", "สาธารณูปโภค", "ช้อปปิ้ง",
  "สุขภาพ", "บันเทิง", "การศึกษา", "ผ่อนชำระ", "อื่นๆ",
];
const INCOME_CATEGORIES = ["เงินเดือน", "โบนัส", "รายได้เสริม", "ดอกเบี้ย/เงินปันผล", "ชำระหนี้คืน", "อื่นๆ"];

const PAYMENT_METHOD_LABEL = { cash: "เงินสด", transfer: "โอนเงิน", credit_card: "บัตรเครดิต" };
const REPAYMENT_TYPE_LABEL = {
  cash: "เงินสด (ก้อนเดียว)",
  monthly_installment: "ผ่อนรายเดือน",
  product_installment: "ผ่อนสินค้า",
};
const INSTANCE_STATUS_LABEL = { pending: "รอชำระ", paid: "จ่ายแล้ว", skipped: "ข้าม" };
const THEME_KEY = "expense-theme-v1";

const state = {
  user: null,
  page: "dashboard",
  creditCards: [],
  categoriesCache: {},
  appLoaded: false,
};

const PIN_KEY = "expense-pin-hash-v1";
const LOCK_AFTER_MS = 5 * 60 * 1000;
let hiddenAt = null;

function esc(v) {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ---------------- Toast ----------------
function toast(message, type = "info") {
  const host = document.getElementById("toastHost");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// ---------------- Modal ----------------
function openModal(html) {
  const host = document.getElementById("modalHost");
  host.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${html}</div></div>`;
  document.getElementById("modalBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "modalBackdrop") closeModal();
  });
}
function closeModal() {
  document.getElementById("modalHost").innerHTML = "";
}

// ---------------- Theme ----------------
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY) || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}
function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
}

// ---------------- PIN lock (device-local privacy screen) ----------------
// NOTE: this only gates the UI on this device/browser — it is not encryption
// and does not protect the data itself (clearing site storage bypasses it).
async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasPinSet() {
  return !!localStorage.getItem(PIN_KEY);
}

async function verifyPin(pin) {
  return (await sha256Hex(pin)) === localStorage.getItem(PIN_KEY);
}

function showLockScreen() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("app").classList.remove("visible");
  const lockScreen = document.getElementById("lockScreen");
  lockScreen.style.display = "flex";
  document.getElementById("pinUnlockError").textContent = "";
  const input = document.getElementById("pinUnlockInput");
  input.value = "";
  setTimeout(() => input.focus(), 50);
}

async function onPinUnlockSubmit(e) {
  e.preventDefault();
  const pin = document.getElementById("pinUnlockInput").value;
  const errorEl = document.getElementById("pinUnlockError");
  if (await verifyPin(pin)) {
    document.getElementById("lockScreen").style.display = "none";
    if (!state.appLoaded) {
      await showApp();
    } else {
      document.getElementById("app").classList.add("visible");
    }
  } else {
    errorEl.textContent = "รหัส PIN ไม่ถูกต้อง";
  }
}

function setupVisibilityLock() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (hasPinSet() && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER_MS) {
      showLockScreen();
    }
  });
}

function openPinSettingsModal() {
  const isSet = hasPinSet();
  openModal(`
    <h3>${isSet ? "จัดการรหัส PIN" : "ตั้งรหัส PIN ล็อกหน้าจอ"}</h3>
    <p style="color:var(--text-dim);font-size:0.8rem;">
      รหัส PIN นี้ล็อกหน้าจอแอปบนอุปกรณ์นี้เท่านั้น ไม่ได้เข้ารหัสข้อมูล — ถ้าลืมรหัสให้ล้างข้อมูลเว็บไซต์ของเบราว์เซอร์เพื่อรีเซ็ต
    </p>
    <form id="pinSettingsForm">
      ${isSet ? `
      <div class="field">
        <label>รหัส PIN ปัจจุบัน</label>
        <input id="pinCurrent" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" required />
      </div>` : ""}
      <div class="field">
        <label>รหัส PIN ใหม่ (4-6 หลัก)${isSet ? " — เว้นว่างเพื่อลบรหัส PIN" : ""}</label>
        <input id="pinNew" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ${isSet ? "" : "required"} />
      </div>
      <div class="field">
        <label>ยืนยันรหัส PIN ใหม่</label>
        <input id="pinConfirm" type="password" inputmode="numeric" pattern="[0-9]*" autocomplete="off" ${isSet ? "" : "required"} />
      </div>
      <div class="form-error" id="pinSettingsError"></div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);
  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("pinSettingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("pinSettingsError");
    if (isSet) {
      const current = document.getElementById("pinCurrent").value;
      if (!(await verifyPin(current))) {
        errorEl.textContent = "รหัส PIN ปัจจุบันไม่ถูกต้อง";
        return;
      }
    }
    const pinNew = document.getElementById("pinNew").value;
    const pinConfirm = document.getElementById("pinConfirm").value;
    if (!pinNew) {
      localStorage.removeItem(PIN_KEY);
      toast("ปิดการล็อกด้วย PIN แล้ว", "info");
      closeModal();
      return;
    }
    if (!/^[0-9]{4,6}$/.test(pinNew)) {
      errorEl.textContent = "รหัส PIN ต้องเป็นตัวเลข 4-6 หลัก";
      return;
    }
    if (pinNew !== pinConfirm) {
      errorEl.textContent = "รหัส PIN ยืนยันไม่ตรงกัน";
      return;
    }
    localStorage.setItem(PIN_KEY, await sha256Hex(pinNew));
    toast("ตั้งรหัส PIN แล้ว", "success");
    closeModal();
  });
}

// ---------------- Push notifications ----------------
async function registerServiceWorkerIfSupported() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("sw.js");
  } catch (_) {
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function updateNotifyButton() {
  const btn = document.getElementById("notifyToggleBtn");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    btn.style.display = "none";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    btn.innerHTML = sub
      ? '🔕<span class="btn-label"> ปิดแจ้งเตือน</span>'
      : '🔔<span class="btn-label"> แจ้งเตือน</span>';
    btn.title = sub ? "ปิดการแจ้งเตือน" : "เปิดการแจ้งเตือน";
  } catch (_) {
    /* leave default */
  }
}

async function onNotifyToggle() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    toast("อุปกรณ์นี้ไม่รองรับการแจ้งเตือนแบบ push", "warning");
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    try {
      await api.push.unsubscribe(existing.endpoint);
    } catch (_) {}
    await existing.unsubscribe();
    toast("ปิดการแจ้งเตือนแล้ว", "info");
    await updateNotifyButton();
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("ไม่ได้รับอนุญาตให้แจ้งเตือน", "warning");
    return;
  }

  try {
    const { key } = await api.push.vapidPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    const subJson = sub.toJSON();
    await api.push.subscribe({ endpoint: subJson.endpoint, keys: subJson.keys });
    toast("เปิดการแจ้งเตือนแล้ว 🔔 จะเตือนก่อนถึงกำหนดจ่ายรายจ่ายประจำ", "success");
  } catch (err) {
    toast("เปิดการแจ้งเตือนไม่สำเร็จ: " + err.message, "error");
  }
  await updateNotifyButton();
}

// ---------------- Auth / boot ----------------
async function boot() {
  initTheme();
  document.getElementById("loginForm").addEventListener("submit", onLoginSubmit);
  document.getElementById("pinUnlockForm").addEventListener("submit", onPinUnlockSubmit);
  document.getElementById("logoutBtn").addEventListener("click", onLogout);
  document.getElementById("themeToggleBtn").addEventListener("click", toggleTheme);
  document.getElementById("pinLockBtn").addEventListener("click", openPinSettingsModal);
  document.getElementById("notifyToggleBtn").addEventListener("click", onNotifyToggle);
  document.getElementById("sideNav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-page]");
    if (btn) navigate(btn.dataset.page);
  });
  registerServiceWorkerIfSupported();
  setupVisibilityLock();

  if (api.getToken()) {
    try {
      state.user = await api.auth.me();
      if (hasPinSet()) {
        showLockScreen();
      } else {
        await showApp();
      }
      return;
    } catch (_) {
      // fall through to login
    }
  }
  showLogin();
}

function showLogin() {
  document.getElementById("loginScreen").style.display = "flex";
  document.getElementById("app").classList.remove("visible");
}

async function showApp() {
  document.getElementById("loginScreen").style.display = "none";
  document.getElementById("app").classList.add("visible");
  document.getElementById("currentUserLabel").textContent = `👤 ${state.user.display_name || state.user.username}`;
  try {
    state.creditCards = await api.creditCards.list();
  } catch (_) {
    state.creditCards = [];
  }
  state.appLoaded = true;
  updateNotifyButton();
  await navigate("dashboard");
}

async function onLoginSubmit(e) {
  e.preventDefault();
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorEl = document.getElementById("loginError");
  errorEl.textContent = "";
  try {
    state.user = await api.auth.login(username, password);
    await showApp();
  } catch (err) {
    errorEl.textContent = err.status === 0 ? "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" : "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  }
}

function onLogout() {
  api.auth.logout();
  state.user = null;
  showLogin();
}

// ---------------- Navigation ----------------
async function navigate(page) {
  state.page = page;
  document.querySelectorAll("#sideNav button").forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  const content = document.getElementById("pageContent");
  content.innerHTML = `<div class="empty-state"><div class="spinner"></div>กำลังโหลด...</div>`;
  try {
    if (page === "dashboard") await renderDashboard();
    else if (page === "transactions") await renderTransactions();
    else if (page === "recurring") await renderRecurring();
    else if (page === "creditCards") await renderCreditCards();
    else if (page === "loans") await renderLoans();
    else if (page === "budgets") await renderBudgets();
  } catch (err) {
    content.innerHTML = `<div class="empty-state">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message)}</div>`;
  }
  content.classList.remove("page-fade");
  void content.offsetWidth;
  content.classList.add("page-fade");
}

function creditCardOptions(selectedId) {
  return state.creditCards
    .map((c) => `<option value="${c.id}" ${String(c.id) === String(selectedId) ? "selected" : ""}>${esc(c.name)}</option>`)
    .join("");
}

// ================= Dashboard =================
function kpiCard(icon, label, value, valueClass = "") {
  return `
    <div class="kpi-card">
      <div class="kpi-icon ${valueClass}">${icon}</div>
      <div>
        <div class="label">${esc(label)}</div>
        <div class="value ${valueClass}">${value}</div>
      </div>
    </div>`;
}

function monthShortLabel(period) {
  const [y, m] = period.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("th-TH", { month: "short" });
}

function renderTrendChart(trend) {
  if (!trend.length) return "";
  const max = Math.max(1, ...trend.flatMap((t) => [t.total_income, t.total_expense]));
  return `
    <div class="panel">
      <h3>แนวโน้มรายรับ-รายจ่าย ${trend.length} เดือนล่าสุด</h3>
      <div class="trend-legend">
        <span><i class="dot income"></i>รายรับ</span>
        <span><i class="dot expense"></i>รายจ่าย</span>
      </div>
      <div class="trend-chart">
        ${trend.map((t) => `
          <div class="trend-col">
            <div class="trend-bars">
              <div class="trend-bar income" style="height:${(t.total_income / max) * 100}%" title="รายรับ ${esc(t.period)}: ฿${fmtMoney(t.total_income)}"></div>
              <div class="trend-bar expense" style="height:${(t.total_expense / max) * 100}%" title="รายจ่าย ${esc(t.period)}: ฿${fmtMoney(t.total_expense)}"></div>
            </div>
            <div class="trend-label">${esc(monthShortLabel(t.period))}</div>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderCategoryBars(byCategory) {
  const entries = Object.entries(byCategory || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const max = entries[0][1];
  return `
    <div class="panel">
      <h3>รายจ่ายตามหมวดหมู่เดือนนี้</h3>
      <div class="cat-bars">
        ${entries.map(([category, amount]) => `
          <div class="cat-bar-row">
            <div class="cat-bar-label">${esc(category)}</div>
            <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${max > 0 ? (amount / max) * 100 : 0}%"></div></div>
            <div class="cat-bar-value">฿${fmtMoney(amount)}</div>
          </div>`).join("")}
      </div>
    </div>`;
}

async function renderDashboard() {
  await api.recurringBills.generate();
  const [summary, pendingInstances, txnSummary, trend] = await Promise.all([
    api.dashboard.summary(),
    api.recurringBills.instances("pending"),
    api.transactions.summary(),
    api.transactions.trend(6),
  ]);

  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="main-header"><h2>ภาพรวมเดือน ${esc(summary.period)}</h2></div>
    <div class="kpi-grid">
      ${kpiCard("💰", "รายรับเดือนนี้", `฿${fmtMoney(summary.total_income)}`, "positive")}
      ${kpiCard("💸", "รายจ่ายเดือนนี้", `฿${fmtMoney(summary.total_expense)}`, "negative")}
      ${kpiCard("🧮", "คงเหลือ", `฿${fmtMoney(summary.balance)}`, summary.balance >= 0 ? "positive" : "negative")}
      ${kpiCard("⏰", "รายจ่ายประจำรอชำระ", `${summary.pending_bills_count} รายการ (฿${fmtMoney(summary.pending_bills_amount)})`, "warning")}
      ${kpiCard("💳", "ยอดบัตรเครดิตเดือนนี้", `฿${fmtMoney(summary.credit_card_outstanding)}`, "")}
      ${kpiCard("🤝", "ยอดลูกหนี้คงค้าง", `฿${fmtMoney(summary.loans_outstanding)}`, "")}
    </div>

    ${renderTrendChart(trend)}
    ${renderCategoryBars(txnSummary.by_category)}

    ${pendingInstances.length ? `
    <div class="panel">
      <h3>⏰ รายจ่ายประจำที่ถึงกำหนด</h3>
      <table>
        <thead><tr><th>รายการ</th><th>ครบกำหนด</th><th>จำนวนเงิน</th><th></th></tr></thead>
        <tbody>
          ${pendingInstances.map((i) => `
            <tr>
              <td data-label="รายการ">${esc(i.bill_name)}</td>
              <td data-label="ครบกำหนด">${fmtDate(i.due_date)}</td>
              <td class="amount-expense" data-label="จำนวนเงิน">฿${fmtMoney(i.amount)}</td>
              <td class="actions-cell">
                <button class="small primary" data-action="pay-instance" data-id="${i.id}">จ่ายแล้ว</button>
                <button class="small ghost" data-action="skip-instance" data-id="${i.id}">ข้าม</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <div class="panel">
      <h3>รายการล่าสุด</h3>
      ${renderTxnTable(summary.recent_transactions, false)}
    </div>
  `;

  content.onclick = onDashboardClick;
}

async function onDashboardClick(e) {
  const payBtn = e.target.closest('[data-action="pay-instance"]');
  const skipBtn = e.target.closest('[data-action="skip-instance"]');
  if (payBtn) {
    try {
      await api.recurringBills.pay(payBtn.dataset.id);
      toast("บันทึกการจ่ายเรียบร้อย", "success");
      await navigate("dashboard");
    } catch (err) {
      toast(err.message, "error");
    }
  } else if (skipBtn) {
    try {
      await api.recurringBills.skip(skipBtn.dataset.id);
      toast("ข้ามรายการนี้แล้ว", "info");
      await navigate("dashboard");
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function renderTxnTable(txns, withActions = true) {
  if (!txns.length) return `<div class="empty-state"><span class="empty-icon">📭</span>ยังไม่มีรายการ</div>`;
  return `
    <table>
      <thead>
        <tr><th>วันที่</th><th>ประเภท</th><th>หมวดหมู่</th><th>รายละเอียด</th><th>ช่องทาง</th><th>จำนวนเงิน</th>${withActions ? "<th></th>" : ""}</tr>
      </thead>
      <tbody>
        ${txns.map((t) => `
          <tr>
            <td data-label="วันที่">${fmtDate(t.txn_date)}</td>
            <td data-label="ประเภท">${t.type === "income" ? "รายรับ" : "รายจ่าย"}</td>
            <td data-label="หมวดหมู่">${esc(t.category)}</td>
            <td data-label="รายละเอียด">${esc(t.description) || "-"}</td>
            <td data-label="ช่องทาง">${esc(PAYMENT_METHOD_LABEL[t.payment_method] || t.payment_method)}</td>
            <td class="${t.type === "income" ? "amount-income" : "amount-expense"}" data-label="จำนวนเงิน">${t.type === "income" ? "+" : "-"}฿${fmtMoney(t.amount)}</td>
            ${withActions ? `
            <td class="actions-cell">
              <button class="small" data-action="edit-txn" data-id="${t.id}">แก้ไข</button>
              <button class="small danger" data-action="delete-txn" data-id="${t.id}">ลบ</button>
            </td>` : ""}
          </tr>`).join("")}
      </tbody>
    </table>`;
}

// ================= Transactions =================
let txnFilter = { type: "", q: "", date_from: "", date_to: "" };
let txnSearchFocused = false;

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function buildTxnParams() {
  const params = {};
  if (txnFilter.type) params.type = txnFilter.type;
  if (txnFilter.q) params.q = txnFilter.q;
  if (txnFilter.date_from) params.date_from = txnFilter.date_from;
  if (txnFilter.date_to) params.date_to = txnFilter.date_to;
  return params;
}

async function renderTransactions() {
  const txns = await api.transactions.list(buildTxnParams());
  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="main-header">
      <h2>รายรับ-รายจ่าย</h2>
      <div class="actions-cell">
        <button data-action="export-csv">⬇ CSV</button>
        <button class="primary" data-action="add-txn">+ เพิ่มรายการ</button>
      </div>
    </div>
    <div class="tag-row">
      <button data-filter="" class="${txnFilter.type === "" ? "active" : ""}">ทั้งหมด</button>
      <button data-filter="income" class="${txnFilter.type === "income" ? "active" : ""}">รายรับ</button>
      <button data-filter="expense" class="${txnFilter.type === "expense" ? "active" : ""}">รายจ่าย</button>
    </div>
    <div class="panel">
      <div class="field-row">
        <div class="field">
          <label>ค้นหา</label>
          <input id="txnSearchInput" value="${esc(txnFilter.q)}" placeholder="ค้นหาหมวดหมู่ / รายละเอียด" />
        </div>
        <div class="field">
          <label>จากวันที่</label>
          <input id="txnDateFrom" type="date" value="${esc(txnFilter.date_from)}" />
        </div>
        <div class="field">
          <label>ถึงวันที่</label>
          <input id="txnDateTo" type="date" value="${esc(txnFilter.date_to)}" />
        </div>
      </div>
    </div>
    <div class="panel">${renderTxnTable(txns, true)}</div>
  `;
  content.onclick = onTransactionsClick;

  const searchInput = document.getElementById("txnSearchInput");
  searchInput.addEventListener("input", debounce((e) => {
    txnFilter.q = e.target.value;
    renderTransactions();
  }, 400));
  searchInput.addEventListener("focus", () => { txnSearchFocused = true; });
  searchInput.addEventListener("blur", () => { txnSearchFocused = false; });
  if (txnSearchFocused) {
    searchInput.focus();
    searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
  }
  document.getElementById("txnDateFrom").addEventListener("change", (e) => {
    txnFilter.date_from = e.target.value;
    renderTransactions();
  });
  document.getElementById("txnDateTo").addEventListener("change", (e) => {
    txnFilter.date_to = e.target.value;
    renderTransactions();
  });
}

async function onTransactionsClick(e) {
  const filterBtn = e.target.closest("[data-filter]");
  if (filterBtn) {
    txnFilter.type = filterBtn.dataset.filter;
    await renderTransactions();
    return;
  }
  if (e.target.closest('[data-action="add-txn"]')) {
    openTxnModal();
    return;
  }
  if (e.target.closest('[data-action="export-csv"]')) {
    try {
      await api.transactions.exportCsv(buildTxnParams());
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }
  const editBtn = e.target.closest('[data-action="edit-txn"]');
  if (editBtn) {
    const txns = await api.transactions.list();
    const txn = txns.find((t) => String(t.id) === editBtn.dataset.id);
    openTxnModal(txn);
    return;
  }
  const delBtn = e.target.closest('[data-action="delete-txn"]');
  if (delBtn) {
    if (!confirm("ลบรายการนี้หรือไม่?")) return;
    try {
      await api.transactions.remove(delBtn.dataset.id);
      toast("ลบรายการแล้ว", "success");
      await renderTransactions();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function openTxnModal(txn = null) {
  const isEdit = !!txn;
  const type = txn ? txn.type : "expense";
  openModal(`
    <h3>${isEdit ? "แก้ไขรายการ" : "เพิ่มรายการรายรับ-รายจ่าย"}</h3>
    <form id="txnForm">
      <div class="field">
        <label>ประเภท</label>
        <select id="txnType">
          <option value="expense" ${type === "expense" ? "selected" : ""}>รายจ่าย</option>
          <option value="income" ${type === "income" ? "selected" : ""}>รายรับ</option>
        </select>
      </div>
      <div class="field-row">
        <div class="field">
          <label>จำนวนเงิน</label>
          <input id="txnAmount" type="number" step="0.01" min="0.01" value="${txn ? txn.amount : ""}" required />
        </div>
        <div class="field">
          <label>วันที่</label>
          <input id="txnDate" type="date" value="${txn ? txn.txn_date : todayISO()}" required />
        </div>
      </div>
      <div class="field">
        <label>หมวดหมู่</label>
        <input id="txnCategory" list="categoryOptions" value="${esc(txn ? txn.category : "")}" required />
        <datalist id="categoryOptions">
          ${(type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map((c) => `<option value="${esc(c)}">`).join("")}
        </datalist>
      </div>
      <div class="field">
        <label>ช่องทางการชำระ</label>
        <select id="txnMethod">
          <option value="cash" ${txn?.payment_method === "cash" ? "selected" : ""}>เงินสด</option>
          <option value="transfer" ${txn?.payment_method === "transfer" ? "selected" : ""}>โอนเงิน</option>
          <option value="credit_card" ${txn?.payment_method === "credit_card" ? "selected" : ""}>บัตรเครดิต</option>
        </select>
      </div>
      <div class="field" id="txnCardField" style="display:${txn?.payment_method === "credit_card" ? "block" : "none"}">
        <label>บัตรเครดิต</label>
        <select id="txnCardId">${creditCardOptions(txn ? txn.credit_card_id : null)}</select>
      </div>
      <div class="field">
        <label>รายละเอียด</label>
        <input id="txnDescription" value="${esc(txn ? txn.description : "")}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);

  document.getElementById("txnType").addEventListener("change", (e) => {
    const cats = e.target.value === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    document.getElementById("categoryOptions").innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join("");
  });
  document.getElementById("txnMethod").addEventListener("change", (e) => {
    document.getElementById("txnCardField").style.display = e.target.value === "credit_card" ? "block" : "none";
  });
  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("txnForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      type: document.getElementById("txnType").value,
      amount: parseFloat(document.getElementById("txnAmount").value),
      category: document.getElementById("txnCategory").value.trim(),
      payment_method: document.getElementById("txnMethod").value,
      credit_card_id: document.getElementById("txnMethod").value === "credit_card"
        ? parseInt(document.getElementById("txnCardId").value, 10) || null
        : null,
      description: document.getElementById("txnDescription").value.trim(),
      txn_date: document.getElementById("txnDate").value,
    };
    try {
      if (isEdit) await api.transactions.update(txn.id, payload);
      else await api.transactions.create(payload);
      toast("บันทึกสำเร็จ", "success");
      closeModal();
      await navigate(state.page === "dashboard" ? "dashboard" : "transactions");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ================= Recurring bills =================
async function renderRecurring() {
  await api.recurringBills.generate();
  const [bills, instances] = await Promise.all([
    api.recurringBills.list(),
    api.recurringBills.instances(),
  ]);
  const pending = instances.filter((i) => i.status === "pending");
  const history = instances.filter((i) => i.status !== "pending");

  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="main-header">
      <h2>รายจ่ายประจำเดือน</h2>
      <button class="primary" data-action="add-bill">+ เพิ่มรายการประจำ</button>
    </div>

    ${pending.length ? `
    <div class="panel">
      <h3>⏰ รอชำระ</h3>
      <table>
        <thead><tr><th>รายการ</th><th>งวด</th><th>ครบกำหนด</th><th>จำนวนเงิน</th><th></th></tr></thead>
        <tbody>
          ${pending.map((i) => `
            <tr>
              <td data-label="รายการ">${esc(i.bill_name)}</td>
              <td data-label="งวด">${esc(i.period)}</td>
              <td data-label="ครบกำหนด">${fmtDate(i.due_date)}</td>
              <td class="amount-expense" data-label="จำนวนเงิน">฿${fmtMoney(i.amount)}</td>
              <td class="actions-cell">
                <button class="small primary" data-action="pay-instance" data-id="${i.id}">จ่ายแล้ว</button>
                <button class="small ghost" data-action="skip-instance" data-id="${i.id}">ข้าม</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}

    <div class="panel">
      <h3>รายการที่ตั้งไว้</h3>
      ${bills.length ? `
      <table>
        <thead><tr><th>ชื่อ</th><th>หมวดหมู่</th><th>จำนวนเงิน</th><th>ทุกวันที่</th><th>ช่องทาง</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>
          ${bills.map((b) => `
            <tr>
              <td data-label="ชื่อ">${esc(b.name)}</td>
              <td data-label="หมวดหมู่">${esc(b.category)}</td>
              <td data-label="จำนวนเงิน">฿${fmtMoney(b.amount)}</td>
              <td data-label="ทุกวันที่">${b.due_day}</td>
              <td data-label="ช่องทาง">${esc(PAYMENT_METHOD_LABEL[b.payment_method] || b.payment_method)}</td>
              <td data-label="สถานะ">${b.is_active ? "🟢 ใช้งาน" : "⚪ หยุดใช้งาน"}</td>
              <td class="actions-cell">
                <button class="small" data-action="edit-bill" data-id="${b.id}">แก้ไข</button>
                <button class="small danger" data-action="delete-bill" data-id="${b.id}">ลบ</button>
              </td>
            </tr>`).join("")}
        </tbody>
      </table>` : `<div class="empty-state"><span class="empty-icon">🔁</span>ยังไม่มีรายจ่ายประจำ</div>`}
    </div>

    ${history.length ? `
    <div class="panel">
      <h3>ประวัติ</h3>
      <table>
        <thead><tr><th>รายการ</th><th>งวด</th><th>จำนวนเงิน</th><th>สถานะ</th><th>วันที่จ่าย</th></tr></thead>
        <tbody>
          ${history.map((i) => `
            <tr>
              <td data-label="รายการ">${esc(i.bill_name)}</td>
              <td data-label="งวด">${esc(i.period)}</td>
              <td data-label="จำนวนเงิน">฿${fmtMoney(i.amount)}</td>
              <td data-label="สถานะ"><span class="badge ${i.status}">${INSTANCE_STATUS_LABEL[i.status]}</span></td>
              <td data-label="วันที่จ่าย">${fmtDate(i.paid_date)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>` : ""}
  `;

  content.onclick = onRecurringClick;
}

async function onRecurringClick(e) {
  if (e.target.closest('[data-action="add-bill"]')) return openBillModal();

  const editBtn = e.target.closest('[data-action="edit-bill"]');
  if (editBtn) {
    const bills = await api.recurringBills.list();
    return openBillModal(bills.find((b) => String(b.id) === editBtn.dataset.id));
  }

  const delBtn = e.target.closest('[data-action="delete-bill"]');
  if (delBtn) {
    if (!confirm("ลบรายจ่ายประจำนี้หรือไม่? (ประวัติที่บันทึกไว้จะถูกลบด้วย)")) return;
    try {
      await api.recurringBills.remove(delBtn.dataset.id);
      toast("ลบแล้ว", "success");
      await renderRecurring();
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }

  const payBtn = e.target.closest('[data-action="pay-instance"]');
  if (payBtn) {
    try {
      await api.recurringBills.pay(payBtn.dataset.id);
      toast("บันทึกการจ่ายเรียบร้อย", "success");
      await renderRecurring();
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }

  const skipBtn = e.target.closest('[data-action="skip-instance"]');
  if (skipBtn) {
    try {
      await api.recurringBills.skip(skipBtn.dataset.id);
      toast("ข้ามรายการนี้แล้ว", "info");
      await renderRecurring();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function openBillModal(bill = null) {
  const isEdit = !!bill;
  openModal(`
    <h3>${isEdit ? "แก้ไขรายจ่ายประจำ" : "เพิ่มรายจ่ายประจำเดือน"}</h3>
    <form id="billForm">
      <div class="field">
        <label>ชื่อรายการ</label>
        <input id="billName" value="${esc(bill ? bill.name : "")}" required placeholder="เช่น ค่าเน็ตบ้าน, ค่าเช่า" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>จำนวนเงิน</label>
          <input id="billAmount" type="number" step="0.01" min="0.01" value="${bill ? bill.amount : ""}" required />
        </div>
        <div class="field">
          <label>ตัดทุกวันที่ (1-31)</label>
          <input id="billDueDay" type="number" min="1" max="31" value="${bill ? bill.due_day : ""}" required />
        </div>
      </div>
      <div class="field">
        <label>หมวดหมู่</label>
        <input id="billCategory" list="billCategoryOptions" value="${esc(bill ? bill.category : "")}" required />
        <datalist id="billCategoryOptions">${EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label>ช่องทางการชำระ</label>
        <select id="billMethod">
          <option value="cash" ${bill?.payment_method === "cash" ? "selected" : ""}>เงินสด</option>
          <option value="transfer" ${bill?.payment_method === "transfer" ? "selected" : ""}>โอนเงิน</option>
          <option value="credit_card" ${bill?.payment_method === "credit_card" ? "selected" : ""}>บัตรเครดิต</option>
        </select>
      </div>
      <div class="field" id="billCardField" style="display:${bill?.payment_method === "credit_card" ? "block" : "none"}">
        <label>บัตรเครดิต</label>
        <select id="billCardId">${creditCardOptions(bill ? bill.credit_card_id : null)}</select>
      </div>
      ${isEdit ? `
      <div class="field">
        <label><input type="checkbox" id="billActive" style="width:auto" ${bill.is_active ? "checked" : ""} /> ใช้งานอยู่</label>
      </div>` : ""}
      <div class="field">
        <label>หมายเหตุ</label>
        <input id="billNotes" value="${esc(bill ? bill.notes : "")}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);

  document.getElementById("billMethod").addEventListener("change", (e) => {
    document.getElementById("billCardField").style.display = e.target.value === "credit_card" ? "block" : "none";
  });
  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("billForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const method = document.getElementById("billMethod").value;
    const payload = {
      name: document.getElementById("billName").value.trim(),
      category: document.getElementById("billCategory").value.trim(),
      amount: parseFloat(document.getElementById("billAmount").value),
      due_day: parseInt(document.getElementById("billDueDay").value, 10),
      payment_method: method,
      credit_card_id: method === "credit_card" ? parseInt(document.getElementById("billCardId").value, 10) || null : null,
      notes: document.getElementById("billNotes").value.trim(),
    };
    if (isEdit) payload.is_active = document.getElementById("billActive").checked;
    try {
      if (isEdit) await api.recurringBills.update(bill.id, payload);
      else await api.recurringBills.create(payload);
      toast("บันทึกสำเร็จ", "success");
      closeModal();
      await renderRecurring();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ================= Credit cards =================
async function renderCreditCards() {
  const cards = await api.creditCards.list();
  state.creditCards = cards;
  const summaries = await Promise.all(cards.map((c) => api.creditCards.summary(c.id).catch(() => null)));

  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="main-header">
      <h2>บัตรเครดิต</h2>
      <button class="primary" data-action="add-card">+ เพิ่มบัตร</button>
    </div>
    ${cards.length ? `<div class="cc-grid">
      ${cards.map((c, idx) => {
        const s = summaries[idx];
        return `
        <div class="cc-tile" style="background: linear-gradient(135deg, ${esc(c.color)}, #0f1115);">
          <div class="cc-actions">
            <button data-action="edit-card" data-id="${c.id}">✎</button>
            <button data-action="delete-card" data-id="${c.id}">🗑</button>
          </div>
          <div>
            <div class="cc-name">${esc(c.name)}</div>
            <div class="cc-bank">${esc(c.bank)}</div>
          </div>
          <div>
            <div class="cc-number">•••• ${esc(c.last4 || "----")}</div>
            <div class="cc-spend">
              รอบนี้ใช้ไป ฿${fmtMoney(s ? s.cycle_spend : 0)}
              ${c.credit_limit ? ` / วงเงิน ฿${fmtMoney(c.credit_limit)}` : ""}
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>` : `<div class="empty-state"><span class="empty-icon">💳</span>ยังไม่มีบัตรเครดิต</div>`}
  `;

  content.onclick = onCreditCardsClick;
}

async function onCreditCardsClick(e) {
  if (e.target.closest('[data-action="add-card"]')) return openCardModal();

  const editBtn = e.target.closest('[data-action="edit-card"]');
  if (editBtn) {
    const card = state.creditCards.find((c) => String(c.id) === editBtn.dataset.id);
    return openCardModal(card);
  }

  const delBtn = e.target.closest('[data-action="delete-card"]');
  if (delBtn) {
    if (!confirm("ลบบัตรนี้หรือไม่?")) return;
    try {
      await api.creditCards.remove(delBtn.dataset.id);
      toast("ลบบัตรแล้ว", "success");
      await renderCreditCards();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function openCardModal(card = null) {
  const isEdit = !!card;
  openModal(`
    <h3>${isEdit ? "แก้ไขบัตรเครดิต" : "เพิ่มบัตรเครดิต"}</h3>
    <form id="cardForm">
      <div class="field">
        <label>ชื่อบัตร</label>
        <input id="cardName" value="${esc(card ? card.name : "")}" required placeholder="เช่น KBank Platinum" />
      </div>
      <div class="field-row">
        <div class="field">
          <label>ธนาคาร</label>
          <input id="cardBank" value="${esc(card ? card.bank : "")}" />
        </div>
        <div class="field">
          <label>เลข 4 ตัวท้าย</label>
          <input id="cardLast4" maxlength="4" value="${esc(card ? card.last4 : "")}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>วงเงิน</label>
          <input id="cardLimit" type="number" step="0.01" min="0" value="${card && card.credit_limit != null ? card.credit_limit : ""}" />
        </div>
        <div class="field">
          <label>สีบัตร</label>
          <input id="cardColor" type="color" value="${card ? card.color : "#6366f1"}" />
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>วันสรุปยอด (statement day)</label>
          <input id="cardStatementDay" type="number" min="1" max="31" value="${card && card.statement_day != null ? card.statement_day : ""}" />
        </div>
        <div class="field">
          <label>วันครบกำหนดชำระ</label>
          <input id="cardDueDay" type="number" min="1" max="31" value="${card && card.due_day != null ? card.due_day : ""}" />
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);

  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("cardForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      name: document.getElementById("cardName").value.trim(),
      bank: document.getElementById("cardBank").value.trim(),
      last4: document.getElementById("cardLast4").value.trim(),
      credit_limit: document.getElementById("cardLimit").value ? parseFloat(document.getElementById("cardLimit").value) : null,
      statement_day: document.getElementById("cardStatementDay").value ? parseInt(document.getElementById("cardStatementDay").value, 10) : null,
      due_day: document.getElementById("cardDueDay").value ? parseInt(document.getElementById("cardDueDay").value, 10) : null,
      color: document.getElementById("cardColor").value,
    };
    if (isEdit) payload.is_active = true;
    try {
      if (isEdit) await api.creditCards.update(card.id, payload);
      else await api.creditCards.create(payload);
      toast("บันทึกสำเร็จ", "success");
      closeModal();
      await renderCreditCards();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ================= Loans / debtors =================
async function renderLoans() {
  const loans = await api.loans.list();
  const content = document.getElementById("pageContent");
  const activeLoans = loans.filter((l) => l.status === "active");
  const completedLoans = loans.filter((l) => l.status === "completed");
  const totalOutstanding = activeLoans.reduce((sum, l) => sum + l.remaining_balance, 0);

  content.innerHTML = `
    <div class="main-header">
      <h2>ยืมเงิน / ลูกหนี้</h2>
      <button class="primary" data-action="add-loan">+ บันทึกการให้ยืมเงิน</button>
    </div>
    <div class="kpi-grid">
      ${kpiCard("🧑‍🤝‍🧑", "ลูกหนี้ที่ยังค้างอยู่", `${activeLoans.length} ราย`, "")}
      ${kpiCard("⚠️", "ยอดคงค้างรวม", `฿${fmtMoney(totalOutstanding)}`, "warning")}
    </div>

    <div class="panel">
      <h3>กำลังค้างชำระ</h3>
      ${activeLoans.length ? activeLoans.map(renderLoanCard).join("") : `<div class="empty-state"><span class="empty-icon">🤝</span>ไม่มีลูกหนี้ค้างชำระ</div>`}
    </div>

    ${completedLoans.length ? `
    <div class="panel">
      <h3>ชำระครบแล้ว</h3>
      ${completedLoans.map(renderLoanCard).join("")}
    </div>` : ""}
  `;

  content.onclick = onLoansClick;
}

function renderLoanCard(loan) {
  const pct = loan.principal_amount > 0 ? Math.min(100, (loan.paid_total / loan.principal_amount) * 100) : 0;
  return `
    <div class="panel" style="margin-bottom:0.8rem; background: var(--bg-elevated);">
      <div class="main-header" style="margin-bottom:0.5rem;">
        <div>
          <strong>${esc(loan.borrower_name)}</strong>
          <span class="badge ${loan.status}">${loan.status === "active" ? "ค้างชำระ" : "ชำระครบ"}</span>
          <div style="color:var(--text-dim); font-size:0.8rem; margin-top:0.2rem;">
            ${esc(REPAYMENT_TYPE_LABEL[loan.repayment_type])}
            ${loan.item_description ? ` — ${esc(loan.item_description)}` : ""}
            · ให้ยืมเมื่อ ${fmtDate(loan.loan_date)}
            ${loan.installment_amount ? ` · งวดละ ฿${fmtMoney(loan.installment_amount)}${loan.installment_count ? ` (${loan.installment_count} งวด)` : ""}` : ""}
          </div>
        </div>
        <div class="actions-cell">
          ${loan.status === "active" ? `<button class="small primary" data-action="pay-loan" data-id="${loan.id}">รับชำระ</button>` : ""}
          <button class="small" data-action="edit-loan" data-id="${loan.id}">แก้ไข</button>
          <button class="small danger" data-action="delete-loan" data-id="${loan.id}">ลบ</button>
        </div>
      </div>
      <div style="font-size:0.88rem;">
        ให้ยืม ฿${fmtMoney(loan.principal_amount)} · รับคืนแล้ว ฿${fmtMoney(loan.paid_total)} · คงเหลือ <strong>฿${fmtMoney(loan.remaining_balance)}</strong>
      </div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
    </div>
  `;
}

async function onLoansClick(e) {
  if (e.target.closest('[data-action="add-loan"]')) return openLoanModal();

  const editBtn = e.target.closest('[data-action="edit-loan"]');
  if (editBtn) {
    const loans = await api.loans.list();
    return openLoanModal(loans.find((l) => String(l.id) === editBtn.dataset.id));
  }

  const delBtn = e.target.closest('[data-action="delete-loan"]');
  if (delBtn) {
    if (!confirm("ลบรายการยืมเงินนี้หรือไม่? (ประวัติการชำระจะถูกลบด้วย)")) return;
    try {
      await api.loans.remove(delBtn.dataset.id);
      toast("ลบแล้ว", "success");
      await renderLoans();
    } catch (err) {
      toast(err.message, "error");
    }
    return;
  }

  const payBtn = e.target.closest('[data-action="pay-loan"]');
  if (payBtn) {
    const loans = await api.loans.list();
    return openLoanPaymentModal(loans.find((l) => String(l.id) === payBtn.dataset.id));
  }
}

function openLoanModal(loan = null) {
  const isEdit = !!loan;
  openModal(`
    <h3>${isEdit ? "แก้ไขรายการยืมเงิน" : "บันทึกการให้ยืมเงิน"}</h3>
    <form id="loanForm">
      <div class="field">
        <label>ชื่อผู้ยืม (ลูกหนี้)</label>
        <input id="loanBorrower" value="${esc(loan ? loan.borrower_name : "")}" required />
      </div>
      <div class="field-row">
        <div class="field">
          <label>จำนวนเงินที่ให้ยืม</label>
          <input id="loanPrincipal" type="number" step="0.01" min="0.01" value="${loan ? loan.principal_amount : ""}" required />
        </div>
        <div class="field">
          <label>วันที่ให้ยืม</label>
          <input id="loanDate" type="date" value="${loan ? loan.loan_date : todayISO()}" required />
        </div>
      </div>
      <div class="field">
        <label>รูปแบบการคืนเงิน</label>
        <select id="loanType">
          <option value="cash" ${loan?.repayment_type === "cash" ? "selected" : ""}>เงินสด (ก้อนเดียว)</option>
          <option value="monthly_installment" ${loan?.repayment_type === "monthly_installment" ? "selected" : ""}>ผ่อนรายเดือน</option>
          <option value="product_installment" ${loan?.repayment_type === "product_installment" ? "selected" : ""}>ผ่อนสินค้า</option>
        </select>
      </div>
      <div class="field" id="loanItemField" style="display:${loan?.repayment_type === "product_installment" ? "block" : "none"}">
        <label>รายละเอียดสินค้า</label>
        <input id="loanItem" value="${esc(loan ? loan.item_description : "")}" placeholder="เช่น มือถือ iPhone" />
      </div>
      <div class="field-row" id="loanInstallmentFields" style="display:${loan && loan.repayment_type !== "cash" ? "flex" : "none"}">
        <div class="field">
          <label>ยอดผ่อนต่องวด</label>
          <input id="loanInstallmentAmount" type="number" step="0.01" min="0" value="${loan && loan.installment_amount != null ? loan.installment_amount : ""}" />
        </div>
        <div class="field">
          <label>จำนวนงวด</label>
          <input id="loanInstallmentCount" type="number" min="1" value="${loan && loan.installment_count != null ? loan.installment_count : ""}" />
        </div>
        <div class="field">
          <label>ครบกำหนดทุกวันที่</label>
          <input id="loanDueDay" type="number" min="1" max="31" value="${loan && loan.due_day != null ? loan.due_day : ""}" />
        </div>
      </div>
      <div class="field">
        <label>หมายเหตุ</label>
        <input id="loanNotes" value="${esc(loan ? loan.notes : "")}" />
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);

  document.getElementById("loanType").addEventListener("change", (e) => {
    document.getElementById("loanItemField").style.display = e.target.value === "product_installment" ? "block" : "none";
    document.getElementById("loanInstallmentFields").style.display = e.target.value === "cash" ? "none" : "flex";
  });
  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("loanForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const repaymentType = document.getElementById("loanType").value;
    const payload = {
      borrower_name: document.getElementById("loanBorrower").value.trim(),
      principal_amount: parseFloat(document.getElementById("loanPrincipal").value),
      loan_date: document.getElementById("loanDate").value,
      repayment_type: repaymentType,
      item_description: repaymentType === "product_installment" ? document.getElementById("loanItem").value.trim() : "",
      installment_amount: repaymentType !== "cash" && document.getElementById("loanInstallmentAmount").value
        ? parseFloat(document.getElementById("loanInstallmentAmount").value) : null,
      installment_count: repaymentType !== "cash" && document.getElementById("loanInstallmentCount").value
        ? parseInt(document.getElementById("loanInstallmentCount").value, 10) : null,
      due_day: repaymentType !== "cash" && document.getElementById("loanDueDay").value
        ? parseInt(document.getElementById("loanDueDay").value, 10) : null,
      notes: document.getElementById("loanNotes").value.trim(),
    };
    try {
      if (isEdit) await api.loans.update(loan.id, payload);
      else await api.loans.create(payload);
      toast("บันทึกสำเร็จ", "success");
      closeModal();
      await renderLoans();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

function openLoanPaymentModal(loan) {
  openModal(`
    <h3>รับชำระจาก ${esc(loan.borrower_name)}</h3>
    <p style="color:var(--text-dim); font-size:0.85rem;">คงเหลือ ฿${fmtMoney(loan.remaining_balance)}</p>
    <form id="loanPaymentForm">
      <div class="field-row">
        <div class="field">
          <label>จำนวนเงินที่รับ</label>
          <input id="paymentAmount" type="number" step="0.01" min="0.01" max="${loan.remaining_balance}" value="${loan.installment_amount || loan.remaining_balance}" required />
        </div>
        <div class="field">
          <label>วันที่รับชำระ</label>
          <input id="paymentDate" type="date" value="${todayISO()}" required />
        </div>
      </div>
      <div class="field">
        <label>หมายเหตุ</label>
        <input id="paymentNotes" placeholder="เช่น งวดที่ 2" />
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึกการรับชำระ</button>
      </div>
    </form>
  `);

  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("loanPaymentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      amount: parseFloat(document.getElementById("paymentAmount").value),
      payment_date: document.getElementById("paymentDate").value,
      notes: document.getElementById("paymentNotes").value.trim(),
    };
    try {
      await api.loans.addPayment(loan.id, payload);
      toast("บันทึกการรับชำระแล้ว", "success");
      closeModal();
      await renderLoans();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// ================= Budgets =================
async function renderBudgets() {
  const budgets = await api.budgets.list();
  const content = document.getElementById("pageContent");
  content.innerHTML = `
    <div class="main-header">
      <h2>งบประมาณรายเดือน</h2>
      <button class="primary" data-action="add-budget">+ เพิ่มงบประมาณ</button>
    </div>
    <div class="panel">
      ${budgets.length ? budgets.map(renderBudgetRow).join("") : `<div class="empty-state"><span class="empty-icon">🎯</span>ยังไม่มีงบประมาณ ตั้งวงเงินต่อหมวดหมู่เพื่อให้ระบบเตือนเมื่อใกล้เกินงบ</div>`}
    </div>
  `;
  content.onclick = onBudgetsClick;
}

function renderBudgetRow(b) {
  const pct = b.monthly_limit > 0 ? Math.min(100, (b.spent / b.monthly_limit) * 100) : 0;
  const over = b.spent > b.monthly_limit;
  const near = !over && pct >= 80;
  const barColor = over ? "var(--danger)" : near ? "var(--warning)" : "var(--accent-2)";
  return `
    <div class="budget-row">
      <div class="main-header" style="margin-bottom: 0.35rem;">
        <div>
          <strong>${esc(b.category)}</strong>
          <div style="font-size: 0.8rem; color: var(--text-dim);">
            ฿${fmtMoney(b.spent)} / ฿${fmtMoney(b.monthly_limit)}
            ${over ? ' <span class="badge over">เกินงบ</span>' : near ? ' <span class="badge pending">ใกล้ถึงงบ</span>' : ""}
          </div>
        </div>
        <div class="actions-cell">
          <button class="small" data-action="edit-budget" data-id="${b.id}">แก้ไข</button>
          <button class="small danger" data-action="delete-budget" data-id="${b.id}">ลบ</button>
        </div>
      </div>
      <div class="progress-bar"><div style="width:${pct}%;background:${barColor}"></div></div>
    </div>`;
}

async function onBudgetsClick(e) {
  if (e.target.closest('[data-action="add-budget"]')) return openBudgetModal();

  const editBtn = e.target.closest('[data-action="edit-budget"]');
  if (editBtn) {
    const budgets = await api.budgets.list();
    return openBudgetModal(budgets.find((b) => String(b.id) === editBtn.dataset.id));
  }

  const delBtn = e.target.closest('[data-action="delete-budget"]');
  if (delBtn) {
    if (!confirm("ลบงบประมาณนี้หรือไม่?")) return;
    try {
      await api.budgets.remove(delBtn.dataset.id);
      toast("ลบแล้ว", "success");
      await renderBudgets();
    } catch (err) {
      toast(err.message, "error");
    }
  }
}

function openBudgetModal(budget = null) {
  const isEdit = !!budget;
  openModal(`
    <h3>${isEdit ? "แก้ไขงบประมาณ" : "เพิ่มงบประมาณ"}</h3>
    <form id="budgetForm">
      <div class="field">
        <label>หมวดหมู่</label>
        <input id="budgetCategory" list="budgetCategoryOptions" value="${esc(budget ? budget.category : "")}" required />
        <datalist id="budgetCategoryOptions">${EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label>วงเงินต่อเดือน</label>
        <input id="budgetLimit" type="number" step="0.01" min="0.01" value="${budget ? budget.monthly_limit : ""}" required />
      </div>
      <div class="modal-footer">
        <button type="button" class="ghost" data-action="close-modal">ยกเลิก</button>
        <button type="submit" class="primary">บันทึก</button>
      </div>
    </form>
  `);

  document.getElementById("modalHost").onclick = (e) => {
    if (e.target.closest('[data-action="close-modal"]')) closeModal();
  };
  document.getElementById("budgetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      category: document.getElementById("budgetCategory").value.trim(),
      monthly_limit: parseFloat(document.getElementById("budgetLimit").value),
    };
    try {
      if (isEdit) await api.budgets.update(budget.id, payload);
      else await api.budgets.create(payload);
      toast("บันทึกสำเร็จ", "success");
      closeModal();
      await renderBudgets();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

document.addEventListener("DOMContentLoaded", boot);
