// api.js - Modular API Communication Layer for Somdul

// Reactive State - Shared with app.js
const state = {
    wallets: [],
    creditCards: [],
    recurringPayments: [],
    debtors: [],
    transactions: [],
    currentUser: null, // Holds logged-in user profile
    activeTab: "home",
    currentTxType: "EXPENSE",
    dismissedNotifications: [],
    budgets: [],
    monthlyTrend: []
};

// When running inside the Capacitor Android shell (mobile/), the app is
// loaded from a native WebView origin, not the FastAPI server's origin — so
// a relative "/api" path resolves nowhere. window.Capacitor is injected by
// the native runtime automatically (no import needed) and is absent in the
// browser/PWA, where the relative path is correct since the frontend is
// served by the same FastAPI process as the API.
const NATIVE_DEFAULT_API_ORIGIN = "https://sd.praj.uk";
const API_BASE = (window.Capacitor?.isNativePlatform?.() ? NATIVE_DEFAULT_API_ORIGIN : "") + "/api";

function cleanUUID(id) {
    if (!id || typeof id !== "string") return null;
    const trimmed = id.trim();
    const lenientRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return lenientRegex.test(trimmed) ? trimmed : null;
}

function getErrorMessage(err, defaultMsg) {
    if (err && err.detail) {
        if (Array.isArray(err.detail)) {
            return err.detail.map(d => d.msg).join(", ");
        }
        if (typeof err.detail === "string") {
            return err.detail;
        }
    }
    return defaultMsg;
}

// ----------------------------------------------------
// AUTHENTICATION UTILITIES
// ----------------------------------------------------
function getAuthHeaders() {
    const token = localStorage.getItem("somdul_jwt_token");
    return token ? { "Authorization": `Bearer ${token}` } : {};
}

function getJsonHeaders() {
    return {
        "Content-Type": "application/json",
        ...getAuthHeaders()
    };
}

// ----------------------------------------------------
// OFFLINE QUEUEING
// ----------------------------------------------------
// A sentinel returned by queueableFetch() when a mutation couldn't reach the
// network and was queued in IndexedDB instead. Every apiCreate.../apiUpdate.../
// apiDelete.../apiPay... function checks for this and returns early instead
// of treating it as a normal response — the caller (app.js) sees the same
// "await apiXxx(...) resolved, now re-render" shape either way.
const OFFLINE_QUEUED = Symbol("offline-queued");

// Wraps fetch() for a mutation: on a real network failure (offline, DNS
// down, etc. — a rejected fetch(), not an HTTP error status) the call is
// queued in IndexedDB under `opName`/`opArgs` and OFFLINE_QUEUED is returned
// instead of throwing, so a create/edit/delete made offline doesn't crash
// the UI — it just applies once connectivity returns and syncPendingOps()
// replays it against the real endpoint.
// Set by syncPendingOps() while it's replaying a queued op, so a network
// failure mid-replay throws (letting the drain loop stop cleanly) instead of
// queueing a second, duplicate copy of the same op.
let _isReplaying = false;

async function queueableFetch(url, options, opName, opArgs) {
    try {
        return await fetch(url, options);
    } catch (networkErr) {
        if (_isReplaying) throw networkErr;
        await dbQueueOp(opName, opArgs);
        return OFFLINE_QUEUED;
    }
}

// Replays queued offline mutations in the order they were made, by calling
// the same top-level apiXxx function again with its original arguments.
// Stops (without dropping the remaining queue) the moment something is
// still unreachable, so it can pick back up on the next online/interval
// trigger. A queued op that now fails for a real reason (e.g. 404 because
// the record was deleted from another device in the meantime) is dropped
// after logging, since retrying it would never succeed.
let _syncingPendingOps = false;
async function syncPendingOps() {
    if (_syncingPendingOps) return;
    _syncingPendingOps = true;
    try {
        const ops = await dbListPendingOps();
        for (const op of ops) {
            const fn = window[op.fn];
            if (typeof fn !== "function") {
                await dbRemovePendingOp(op.opId);
                continue;
            }
            _isReplaying = true;
            try {
                await fn(...op.args);
                await dbRemovePendingOp(op.opId);
            } catch (err) {
                if (err instanceof TypeError) {
                    // Still offline — stop draining, retry later.
                    break;
                }
                console.error(`Dropping queued offline action ${op.fn} — it failed to replay`, err);
                await dbRemovePendingOp(op.opId);
            } finally {
                _isReplaying = false;
            }
        }
    } finally {
        _syncingPendingOps = false;
    }
    await apiFetchAllData();
}

if (typeof window !== "undefined") {
    window.addEventListener("online", () => {
        syncPendingOps().then(() => window.refreshAppUI?.());
    });
}

// ----------------------------------------------------
// AUTH & SESSION ACTIONS
// ----------------------------------------------------
async function apiFetchMe() {
    const token = localStorage.getItem("somdul_jwt_token");
    if (!token) return null;
    
    try {
        const res = await fetch(`${API_BASE}/auth/me`, {
            headers: getAuthHeaders()
        });
        if (res.ok) {
            state.currentUser = await res.json();
            return state.currentUser;
        } else {
            apiLogout();
            return null;
        }
    } catch (e) {
        console.error("Failed to fetch user profiles", e);
        // Network unreachable (not a rejected/expired token, which is the
        // res.ok === false branch above) — trust the last-known profile
        // cached in IndexedDB so a fully offline cold start still lets a
        // previously-logged-in user into the app instead of bouncing them
        // to the login screen.
        const cached = await dbLoadCache();
        if (cached.currentUser) {
            state.currentUser = cached.currentUser;
            return state.currentUser;
        }
        return null;
    }
}

async function apiRegister(name, email, password) {
    const res = await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "การลงทะเบียนล้มเหลว"));
    }
    
    // Auto login after registration
    return await apiLogin(email, password);
}

async function apiLogin(email, password) {
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);
    
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "อีเมลหรือรหัสผ่านไม่ถูกต้อง"));
    }
    
    const data = await res.json();
    localStorage.setItem("somdul_jwt_token", data.access_token);
    state.currentUser = data.user;
    await apiFetchAllData();
    return data.user;
}

function apiLogout() {
    localStorage.removeItem("somdul_jwt_token");
    state.currentUser = null;
    state.wallets = [];
    state.creditCards = [];
    state.recurringPayments = [];
    state.debtors = [];
    state.transactions = [];
    state.dismissedNotifications = [];
    state.budgets = [];
    CATEGORIES = {};
    QUICK_TEMPLATES = [{ text: '✍️ เขียนคำอธิบายเอง (Custom)', value: 'CUSTOM', description: '', category: '' }];
}

async function apiDismissNotification(notifId) {
    const res = await queueableFetch(`${API_BASE}/notifications/dismiss`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ notif_id: notifId })
    }, "apiDismissNotification", [notifId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถบันทึกการอ่านแล้วได้");
}

// ----------------------------------------------------
// BUDGETS CRUD ACTIONS
// ----------------------------------------------------
async function apiSaveBudget(category, monthly_limit) {
    const res = await queueableFetch(`${API_BASE}/budgets`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ category, monthly_limit: Number(monthly_limit) })
    }, "apiSaveBudget", [category, monthly_limit]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถบันทึกงบประมาณได้");
    await apiFetchAllData();
}

async function apiDeleteBudget(budgetId) {
    const res = await queueableFetch(`${API_BASE}/budgets/${budgetId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteBudget", [budgetId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบงบประมาณได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// CATEGORIES CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateCategory(name, tx_type, icon, color) {
    const res = await queueableFetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, tx_type, icon, color })
    }, "apiCreateCategory", [name, tx_type, icon, color]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มหมวดหมู่ได้");
    await apiFetchAllData();
}

async function apiUpdateCategory(categoryId, name, tx_type, icon, color) {
    const res = await queueableFetch(`${API_BASE}/categories/${categoryId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, tx_type, icon, color })
    }, "apiUpdateCategory", [categoryId, name, tx_type, icon, color]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขหมวดหมู่ได้");
    await apiFetchAllData();
}

async function apiDeleteCategory(categoryId) {
    const res = await queueableFetch(`${API_BASE}/categories/${categoryId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteCategory", [categoryId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบหมวดหมู่ได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// QUICK TEMPLATES CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateQuickTemplate(label, description, category_key) {
    const res = await queueableFetch(`${API_BASE}/quick-templates`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ label, description, category_key })
    }, "apiCreateQuickTemplate", [label, description, category_key]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มรายการลัดได้");
    await apiFetchAllData();
}

async function apiUpdateQuickTemplate(templateId, label, description, category_key) {
    const res = await queueableFetch(`${API_BASE}/quick-templates/${templateId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ label, description, category_key })
    }, "apiUpdateQuickTemplate", [templateId, label, description, category_key]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขรายการลัดได้");
    await apiFetchAllData();
}

async function apiDeleteQuickTemplate(templateId) {
    const res = await queueableFetch(`${API_BASE}/quick-templates/${templateId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteQuickTemplate", [templateId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบรายการลัดได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// REPORTS: MONTHLY TREND & CSV EXPORT
// ----------------------------------------------------
async function apiFetchMonthlyTrend() {
    const res = await fetch(`${API_BASE}/transactions/summary/monthly?months=6`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถโหลดข้อมูลแนวโน้มรายเดือนได้");
    const data = await res.json();
    state.monthlyTrend = data.map(m => ({
        month: m.month,
        income: Number(m.income),
        expense: Number(m.expense)
    }));
    return state.monthlyTrend;
}

async function apiExportTransactionsCSV() {
    const res = await fetch(`${API_BASE}/transactions/export`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถส่งออกข้อมูลได้");

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `somdul-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

async function apiUpdateProfile(name, email) {
    const res = await fetch(`${API_BASE}/auth/profile`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, email })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถแก้ไขข้อมูลส่วนตัวได้"));
    }
    
    const user = await res.json();
    state.currentUser = user;
    return user;
}

async function apiUpdatePromptPay(promptpayAccount, promptpayQrData) {
    const body = {};
    if (promptpayAccount !== undefined) body.promptpay_account = promptpayAccount;
    if (promptpayQrData !== undefined) body.promptpay_qr_data = promptpayQrData;

    const res = await fetch(`${API_BASE}/auth/promptpay`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถบันทึกข้อมูลพร้อมเพย์ได้"));
    }

    const user = await res.json();
    state.currentUser = user;
    return user;
}

async function apiChangePassword(oldPassword, newPassword) {
    const res = await fetch(`${API_BASE}/auth/password`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถเปลี่ยนรหัสผ่านได้"));
    }
    
    return await res.json();
}

// ----------------------------------------------------
// SYNC ALL DATA ACTION
// ----------------------------------------------------
async function apiFetchAllData() {
    const token = localStorage.getItem("somdul_jwt_token");
    if (!token) return;
    
    const headers = getAuthHeaders();
    
    try {
        const [walletsRes, cardsRes, recRes, debtorsRes, txRes, dismissedRes, budgetsRes, categoriesRes, templatesRes] = await Promise.all([
            fetch(`${API_BASE}/wallets`, { headers }),
            fetch(`${API_BASE}/credit-cards`, { headers }),
            fetch(`${API_BASE}/recurring-payments`, { headers }),
            fetch(`${API_BASE}/debtors`, { headers }),
            fetch(`${API_BASE}/transactions`, { headers }),
            fetch(`${API_BASE}/notifications/dismissed`, { headers }),
            fetch(`${API_BASE}/budgets`, { headers }),
            fetch(`${API_BASE}/categories`, { headers }),
            fetch(`${API_BASE}/quick-templates`, { headers })
        ]);

        if (walletsRes.status === 401) {
            apiLogout();
            return;
        }

        if (!walletsRes.ok || !cardsRes.ok || !recRes.ok || !debtorsRes.ok || !txRes.ok || !dismissedRes.ok || !budgetsRes.ok || !categoriesRes.ok || !templatesRes.ok) {
            throw new Error("ล้มเหลวในการดึงข้อมูลจากเซิร์ฟเวอร์");
        }
        
        // 1. Wallets mapping
        const walletsData = await walletsRes.json();
        state.wallets = walletsData.map(w => ({
            id: w.id,
            name: w.wallet_name,
            type: w.wallet_type,
            balance: Number(w.balance)
        }));
        
        // 2. Credit Cards mapping
        const cardsData = await cardsRes.json();
        state.creditCards = cardsData.map(c => ({
            id: c.id,
            name: c.card_name,
            limit: Number(c.credit_limit),
            balance: Number(c.current_balance),
            billingDay: Number(c.billing_cycle_day),
            dueDay: Number(c.due_day)
        }));
        
        // 3. Recurring Payments mapping
        const recData = await recRes.json();
        state.recurringPayments = recData.map(r => ({
            id: r.id,
            name: r.name,
            amount: Number(r.amount),
            dueDay: Number(r.due_day),
            status: r.status
        }));
        
        // 4. Debtors mapping (Flattening debtor debts structure)
        const debtorsData = await debtorsRes.json();
        const flatDebts = [];
        debtorsData.forEach(debtor => {
            debtor.debts.forEach(debt => {
                flatDebts.push({
                    id: debt.id,
                    debtorId: debtor.id,
                    name: debtor.debtor_name,
                    contactInfo: debtor.contact_info,
                    type: debt.debt_type,
                    cardId: debt.credit_card_id,
                    totalAmount: Number(debt.total_amount),
                    remainingAmount: Number(debt.remaining_amount),
                    totalInstallments: Number(debt.total_installments),
                    remainingInstallments: Number(debt.remaining_installments),
                    dueDay: Number(debt.due_day),
                    dueDate: debt.due_date || null,
                    interestType: debt.interest_type || null,
                    interestValue: debt.interest_value !== null && debt.interest_value !== undefined ? Number(debt.interest_value) : null,
                    memo: debt.memo,
                    status: debt.status,
                    createdAt: debt.created_at
                });
            });
        });
        state.debtors = flatDebts;
        
        // 5. Transactions mapping
        const txData = await txRes.json();
        state.transactions = txData.map(t => ({
            id: t.id,
            type: t.tx_type,
            desc: t.description,
            category: t.category,
            amount: Number(t.amount),
            walletId: t.wallet_id || t.credit_card_id,
            date: formatTxDate(t.created_at)
        }));

        // 6. Dismissed notification ids (server-persisted "read" state)
        state.dismissedNotifications = await dismissedRes.json();

        // 7. Budgets mapping
        const budgetsData = await budgetsRes.json();
        state.budgets = budgetsData.map(b => ({
            id: b.id,
            category: b.category,
            monthlyLimit: Number(b.monthly_limit),
            spentThisMonth: Number(b.spent_this_month)
        }));

        // 8. Categories — populates the global CATEGORIES lookup (declared in
        // app.js) that render/populate functions throughout the app read from.
        const categoriesData = await categoriesRes.json();
        const newCategories = {};
        categoriesData.forEach(c => {
            newCategories[c.key] = {
                id: c.id,
                name: c.name,
                icon: c.icon,
                color: `bg-${c.color}-500`,
                textColor: `text-${c.color}-600`,
                txType: c.tx_type
            };
        });
        CATEGORIES = newCategories;

        // 9. Quick templates — populates the global QUICK_TEMPLATES list,
        // keeping the permanent frontend-only "CUSTOM" sentinel entry first.
        const templatesData = await templatesRes.json();
        QUICK_TEMPLATES = [
            { text: '✍️ เขียนคำอธิบายเอง (Custom)', value: 'CUSTOM', description: '', category: '' },
            ...templatesData.map(t => ({
                text: t.label,
                value: t.id,
                description: t.description,
                category: t.category_key
            }))
        ];

        // Successful pull — mirror it into IndexedDB so the app has real
        // data to boot from next time there's no network at all, and so a
        // second device's changes show up here once they're re-fetched.
        await dbSaveCache({
            wallets: state.wallets,
            creditCards: state.creditCards,
            recurringPayments: state.recurringPayments,
            debtors: state.debtors,
            transactions: state.transactions,
            dismissedNotifications: state.dismissedNotifications,
            budgets: state.budgets,
            currentUser: state.currentUser,
            categories: CATEGORIES,
            quickTemplates: QUICK_TEMPLATES
        });
        await dbSetMeta("lastSyncAt", new Date().toISOString());

    } catch (e) {
        console.error("Failed to sync application data", e);
        // Offline (or the server is unreachable) — fall back to whatever we
        // last cached so the app still shows real data instead of a blank
        // screen. Any edits made from here on queue in IndexedDB and replay
        // once syncPendingOps() can reach the server again.
        const cached = await dbLoadCache();
        if (cached.wallets) {
            state.wallets = cached.wallets;
            state.creditCards = cached.creditCards || [];
            state.recurringPayments = cached.recurringPayments || [];
            state.debtors = cached.debtors || [];
            state.transactions = cached.transactions || [];
            state.dismissedNotifications = cached.dismissedNotifications || [];
            state.budgets = cached.budgets || [];
            state.currentUser = cached.currentUser || state.currentUser;
            CATEGORIES = cached.categories || {};
            QUICK_TEMPLATES = cached.quickTemplates || QUICK_TEMPLATES;
        }
    }
}

// ----------------------------------------------------
// WALLETS CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateWallet(wallet_name, wallet_type, balance) {
    const res = await queueableFetch(`${API_BASE}/wallets`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_name, wallet_type, balance: Number(balance) })
    }, "apiCreateWallet", [wallet_name, wallet_type, balance]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถสร้างบัญชีได้");
    await apiFetchAllData();
}

async function apiUpdateWallet(walletId, wallet_name, wallet_type, balance) {
    const res = await queueableFetch(`${API_BASE}/wallets/${walletId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_name, wallet_type, balance: Number(balance) })
    }, "apiUpdateWallet", [walletId, wallet_name, wallet_type, balance]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขบัญชีได้");
    await apiFetchAllData();
}

async function apiDeleteWallet(walletId) {
    const res = await queueableFetch(`${API_BASE}/wallets/${walletId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteWallet", [walletId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบบัญชีได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// CREDIT CARD CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateCreditCard(card_name, billing_cycle_day, due_day, credit_limit, current_balance) {
    const res = await queueableFetch(`${API_BASE}/credit-cards`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({
            card_name,
            billing_cycle_day: Number(billing_cycle_day),
            due_day: Number(due_day),
            credit_limit: Number(credit_limit),
            current_balance: Number(current_balance)
        })
    }, "apiCreateCreditCard", [card_name, billing_cycle_day, due_day, credit_limit, current_balance]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiUpdateCreditCard(cardId, card_name, billing_cycle_day, due_day, credit_limit, current_balance) {
    const res = await queueableFetch(`${API_BASE}/credit-cards/${cardId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({
            card_name,
            billing_cycle_day: Number(billing_cycle_day),
            due_day: Number(due_day),
            credit_limit: Number(credit_limit),
            current_balance: Number(current_balance)
        })
    }, "apiUpdateCreditCard", [cardId, card_name, billing_cycle_day, due_day, credit_limit, current_balance]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiDeleteCreditCard(cardId) {
    const res = await queueableFetch(`${API_BASE}/credit-cards/${cardId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteCreditCard", [cardId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiPayCreditCard(cardId, walletId, amount) {
    const cleanedCardId = cleanUUID(cardId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedCardId) throw new Error("Invalid Card ID");

    const res = await queueableFetch(`${API_BASE}/credit-cards/${cleanedCardId}/pay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId, amount: Number(amount) })
    }, "apiPayCreditCard", [cardId, walletId, amount]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระยอดบัตรไม่สำเร็จ"));
    }
    await apiFetchAllData();
}

// ----------------------------------------------------
// DEBTORS & DEBTS ACTIONS
// ----------------------------------------------------
async function apiCreateDebt(debtorId, debtorName, contactInfo, debtType, cardId, walletId, amount, installments, dueDay, memo, dueDate, interestType, interestValue) {
    const payload = {
        debt_type: debtType,
        total_amount: Number(amount),
        total_installments: Number(installments),
        due_day: Number(dueDay),
        memo: memo
    };

    if (dueDate) payload.due_date = dueDate;
    if (interestType) {
        payload.interest_type = interestType;
        payload.interest_value = Number(interestValue) || 0;
    }

    const cleanedDebtorId = cleanUUID(debtorId);
    if (cleanedDebtorId) {
        payload.debtor_id = cleanedDebtorId;
    } else {
        payload.debtor_name = debtorName;
        payload.contact_info = contactInfo;
    }

    const cleanedCardId = cleanUUID(cardId);
    const cleanedWalletId = cleanUUID(walletId);
    if (cleanedCardId) payload.credit_card_id = cleanedCardId;
    if (cleanedWalletId) payload.wallet_id = cleanedWalletId;

    const res = await queueableFetch(`${API_BASE}/debtors/debts`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    }, "apiCreateDebt", [debtorId, debtorName, contactInfo, debtType, cardId, walletId, amount, installments, dueDay, memo, dueDate, interestType, interestValue]);
    if (res === OFFLINE_QUEUED) return;

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถเพิ่มลูกหนี้/หนี้สินได้"));
    }
    await apiFetchAllData();
}

async function apiUpdateDebt(debtId, { dueDay, dueDate, interestType, interestValue, memo } = {}) {
    const payload = {};
    if (dueDay !== undefined) payload.due_day = Number(dueDay);
    if (dueDate !== undefined) payload.due_date = dueDate || null;
    if (interestType !== undefined) payload.interest_type = interestType || null;
    if (interestValue !== undefined) payload.interest_value = interestValue === "" || interestValue === null ? null : Number(interestValue);
    if (memo !== undefined) payload.memo = memo;

    const res = await queueableFetch(`${API_BASE}/debtors/debts/${debtId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    }, "apiUpdateDebt", [debtId, { dueDay, dueDate, interestType, interestValue, memo }]);
    if (res === OFFLINE_QUEUED) return;

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถแก้ไขรายการหนี้ได้"));
    }
    await apiFetchAllData();
}

async function apiFetchDebtHistory(debtId) {
    const res = await fetch(`${API_BASE}/debtors/debts/${debtId}/history`, {
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถโหลดประวัติการแก้ไขได้");
    return await res.json();
}

async function apiRepayDebt(debtId, walletId, amount) {
    const cleanedDebtId = cleanUUID(debtId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedDebtId) throw new Error("Invalid Debt ID");

    const res = await queueableFetch(`${API_BASE}/debtors/debts/${cleanedDebtId}/repay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId, amount: Number(amount) })
    }, "apiRepayDebt", [debtId, walletId, amount]);
    if (res === OFFLINE_QUEUED) return;

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระคืนหนี้ไม่สำเร็จ"));
    }
    await apiFetchAllData();
}

async function apiDeleteDebt(debtId) {
    const res = await queueableFetch(`${API_BASE}/debtors/debts/${debtId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteDebt", [debtId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบรายการหนี้ได้");
    await apiFetchAllData();
}

async function apiResetDebtCycle(debtId) {
    const res = await queueableFetch(`${API_BASE}/debtors/debts/${debtId}/reset-cycle`, {
        method: "POST",
        headers: getAuthHeaders()
    }, "apiResetDebtCycle", [debtId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถเริ่มรอบเรียกเก็บเงินรอบใหม่ได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// GENERIC TRANSACTIONS ACTIONS
// ----------------------------------------------------
async function apiCreateTransaction(tx_type, description, category, amount, walletId, creditCardId) {
    const payload = {
        tx_type,
        description,
        category,
        amount: Number(amount)
    };
    
    const cleanedWalletId = cleanUUID(walletId);
    const cleanedCardId = cleanUUID(creditCardId);
    if (cleanedWalletId) payload.wallet_id = cleanedWalletId;
    if (cleanedCardId) payload.credit_card_id = cleanedCardId;
    
    const res = await queueableFetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    }, "apiCreateTransaction", [tx_type, description, category, amount, walletId, creditCardId]);
    if (res === OFFLINE_QUEUED) return;

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "บันทึกธุรกรรมล้มเหลว"));
    }
    await apiFetchAllData();
}

async function apiDeleteTransaction(txId) {
    const res = await queueableFetch(`${API_BASE}/transactions/${txId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteTransaction", [txId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบธุรกรรมได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// RECURRING SUBSCRIPTIONS ACTIONS
// ----------------------------------------------------
async function apiCreateRecurring(name, amount, due_day) {
    const res = await queueableFetch(`${API_BASE}/recurring-payments`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, amount: Number(amount), due_day: Number(due_day) })
    }, "apiCreateRecurring", [name, amount, due_day]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถสร้าง Subscription ได้");
    await apiFetchAllData();
}

async function apiDeleteRecurring(recId) {
    const res = await queueableFetch(`${API_BASE}/recurring-payments/${recId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    }, "apiDeleteRecurring", [recId]);
    if (res === OFFLINE_QUEUED) return;
    if (!res.ok) throw new Error("ไม่สามารถลบ Subscription ได้");
    await apiFetchAllData();
}

async function apiPayRecurring(recId, walletId) {
    const cleanedRecId = cleanUUID(recId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedRecId) throw new Error("Invalid Recurring ID");

    const res = await queueableFetch(`${API_BASE}/recurring-payments/${cleanedRecId}/pay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId })
    }, "apiPayRecurring", [recId, walletId]);
    if (res === OFFLINE_QUEUED) return;

    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระค่าบริการรายเดือนล้มเหลว"));
    }
    await apiFetchAllData();
}

// ----------------------------------------------------
// HELPER FUNCTIONS
// ----------------------------------------------------
function formatTxDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    
    const timeStr = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    
    if (date.toDateString() === now.toDateString()) {
        return `วันนี้ ${timeStr}`;
    } else {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return `เมื่อวาน ${timeStr}`;
        }
    }
    
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    return `${date.getDate()} ${thaiMonths[date.getMonth()]} ${date.getFullYear()}`;
}
