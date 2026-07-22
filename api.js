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

const API_BASE = "/api";

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
    const res = await fetch(`${API_BASE}/notifications/dismiss`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ notif_id: notifId })
    });
    if (!res.ok) throw new Error("ไม่สามารถบันทึกการอ่านแล้วได้");
}

// ----------------------------------------------------
// BUDGETS CRUD ACTIONS
// ----------------------------------------------------
async function apiSaveBudget(category, monthly_limit) {
    const res = await fetch(`${API_BASE}/budgets`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ category, monthly_limit: Number(monthly_limit) })
    });
    if (!res.ok) throw new Error("ไม่สามารถบันทึกงบประมาณได้");
    await apiFetchAllData();
}

async function apiDeleteBudget(budgetId) {
    const res = await fetch(`${API_BASE}/budgets/${budgetId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบงบประมาณได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// CATEGORIES CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateCategory(name, tx_type, icon, color) {
    const res = await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, tx_type, icon, color })
    });
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มหมวดหมู่ได้");
    await apiFetchAllData();
}

async function apiUpdateCategory(categoryId, name, tx_type, icon, color) {
    const res = await fetch(`${API_BASE}/categories/${categoryId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, tx_type, icon, color })
    });
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขหมวดหมู่ได้");
    await apiFetchAllData();
}

async function apiDeleteCategory(categoryId) {
    const res = await fetch(`${API_BASE}/categories/${categoryId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบหมวดหมู่ได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// QUICK TEMPLATES CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateQuickTemplate(label, description, category_key) {
    const res = await fetch(`${API_BASE}/quick-templates`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ label, description, category_key })
    });
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มรายการลัดได้");
    await apiFetchAllData();
}

async function apiUpdateQuickTemplate(templateId, label, description, category_key) {
    const res = await fetch(`${API_BASE}/quick-templates/${templateId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ label, description, category_key })
    });
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขรายการลัดได้");
    await apiFetchAllData();
}

async function apiDeleteQuickTemplate(templateId) {
    const res = await fetch(`${API_BASE}/quick-templates/${templateId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
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

    } catch (e) {
        console.error("Failed to sync application data", e);
    }
}

// ----------------------------------------------------
// WALLETS CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateWallet(wallet_name, wallet_type, balance) {
    const res = await fetch(`${API_BASE}/wallets`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_name, wallet_type, balance: Number(balance) })
    });
    if (!res.ok) throw new Error("ไม่สามารถสร้างบัญชีได้");
    await apiFetchAllData();
}

async function apiUpdateWallet(walletId, wallet_name, wallet_type, balance) {
    const res = await fetch(`${API_BASE}/wallets/${walletId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_name, wallet_type, balance: Number(balance) })
    });
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขบัญชีได้");
    await apiFetchAllData();
}

async function apiDeleteWallet(walletId) {
    const res = await fetch(`${API_BASE}/wallets/${walletId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบบัญชีได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// CREDIT CARD CRUD ACTIONS
// ----------------------------------------------------
async function apiCreateCreditCard(card_name, billing_cycle_day, due_day, credit_limit, current_balance) {
    const res = await fetch(`${API_BASE}/credit-cards`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({
            card_name,
            billing_cycle_day: Number(billing_cycle_day),
            due_day: Number(due_day),
            credit_limit: Number(credit_limit),
            current_balance: Number(current_balance)
        })
    });
    if (!res.ok) throw new Error("ไม่สามารถเพิ่มบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiUpdateCreditCard(cardId, card_name, billing_cycle_day, due_day, credit_limit, current_balance) {
    const res = await fetch(`${API_BASE}/credit-cards/${cardId}`, {
        method: "PUT",
        headers: getJsonHeaders(),
        body: JSON.stringify({
            card_name,
            billing_cycle_day: Number(billing_cycle_day),
            due_day: Number(due_day),
            credit_limit: Number(credit_limit),
            current_balance: Number(current_balance)
        })
    });
    if (!res.ok) throw new Error("ไม่สามารถแก้ไขบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiDeleteCreditCard(cardId) {
    const res = await fetch(`${API_BASE}/credit-cards/${cardId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบบัตรเครดิตได้");
    await apiFetchAllData();
}

async function apiPayCreditCard(cardId, walletId, amount) {
    const cleanedCardId = cleanUUID(cardId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedCardId) throw new Error("Invalid Card ID");
    
    const res = await fetch(`${API_BASE}/credit-cards/${cleanedCardId}/pay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId, amount: Number(amount) })
    });
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระยอดบัตรไม่สำเร็จ"));
    }
    await apiFetchAllData();
}

// ----------------------------------------------------
// DEBTORS & DEBTS ACTIONS
// ----------------------------------------------------
async function apiCreateDebt(debtorId, debtorName, contactInfo, debtType, cardId, walletId, amount, installments, dueDay, memo) {
    const payload = {
        debt_type: debtType,
        total_amount: Number(amount),
        total_installments: Number(installments),
        due_day: Number(dueDay),
        memo: memo
    };
    
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
    
    const res = await fetch(`${API_BASE}/debtors/debts`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ไม่สามารถเพิ่มลูกหนี้/หนี้สินได้"));
    }
    await apiFetchAllData();
}

async function apiRepayDebt(debtId, walletId, amount) {
    const cleanedDebtId = cleanUUID(debtId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedDebtId) throw new Error("Invalid Debt ID");
    
    const res = await fetch(`${API_BASE}/debtors/debts/${cleanedDebtId}/repay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId, amount: Number(amount) })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระคืนหนี้ไม่สำเร็จ"));
    }
    await apiFetchAllData();
}

async function apiDeleteDebt(debtId) {
    const res = await fetch(`${API_BASE}/debtors/debts/${debtId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบรายการหนี้ได้");
    await apiFetchAllData();
}

async function apiResetDebtCycle(debtId) {
    const res = await fetch(`${API_BASE}/debtors/debts/${debtId}/reset-cycle`, {
        method: "POST",
        headers: getAuthHeaders()
    });
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
    
    const res = await fetch(`${API_BASE}/transactions`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "บันทึกธุรกรรมล้มเหลว"));
    }
    await apiFetchAllData();
}

async function apiDeleteTransaction(txId) {
    const res = await fetch(`${API_BASE}/transactions/${txId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบธุรกรรมได้");
    await apiFetchAllData();
}

// ----------------------------------------------------
// RECURRING SUBSCRIPTIONS ACTIONS
// ----------------------------------------------------
async function apiCreateRecurring(name, amount, due_day) {
    const res = await fetch(`${API_BASE}/recurring-payments`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ name, amount: Number(amount), due_day: Number(due_day) })
    });
    if (!res.ok) throw new Error("ไม่สามารถสร้าง Subscription ได้");
    await apiFetchAllData();
}

async function apiDeleteRecurring(recId) {
    const res = await fetch(`${API_BASE}/recurring-payments/${recId}`, {
        method: "DELETE",
        headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("ไม่สามารถลบ Subscription ได้");
    await apiFetchAllData();
}

async function apiPayRecurring(recId, walletId) {
    const cleanedRecId = cleanUUID(recId);
    const cleanedWalletId = cleanUUID(walletId);
    if (!cleanedRecId) throw new Error("Invalid Recurring ID");
    
    const res = await fetch(`${API_BASE}/recurring-payments/${cleanedRecId}/pay`, {
        method: "POST",
        headers: getJsonHeaders(),
        body: JSON.stringify({ wallet_id: cleanedWalletId })
    });
    
    if (!res.ok) {
        const err = await res.json();
        throw new Error(getErrorMessage(err, "ชำระค่าบริการรายเดือนล้มเหลว"));
    }
    await apiFetchAllData();
}

// ----------------------------------------------------
// DATABASE RESET / SEED
// ----------------------------------------------------
async function apiResetDatabase() {
    const res = await fetch(`${API_BASE}/auth/reset`, {
        method: "POST",
        headers: getAuthHeaders()
    });
    
    if (!res.ok) throw new Error("รีเซ็ตฐานข้อมูลล้มเหลว");
    
    // If successful, reload everything
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
