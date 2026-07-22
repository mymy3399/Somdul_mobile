// app.js - Modular UI Rendering and Event Handlers Layer for Somdul

// ----------------------------------------------------
// FONT SIZE PREFERENCE
// ----------------------------------------------------
// Scales the root font-size, which cascades through every Tailwind text-*
// (and, since Tailwind's spacing scale is also rem-based, padding/sizing)
// class app-wide — including markup rendered dynamically by app.js. The
// initial application (so there's no flash/reflow on load) lives in an
// inline <script> in index.html's <head> instead of here, since this file
// is only fetched/run after the page has already been parsed and painted.
const FONT_SCALE_STORAGE_KEY = "somdul_font_scale";

// Debounces Chart.js's own ResizeObserver-driven redraws for both charts
// below — without this, any tiny, transient size change in a canvas's
// container (e.g. a scrollbar appearing/disappearing as list content
// changes height) triggers an immediate redraw, which reads as the chart
// twitching independently of the update('none') calls used elsewhere.
const CHART_RESIZE_DELAY = 100;

function syncFontSizeButtons() {
    const current = parseFloat(localStorage.getItem(FONT_SCALE_STORAGE_KEY)) || 112.5;
    document.querySelectorAll('#fontSizePicker [data-font-scale]').forEach(btn => {
        const isActive = Number(btn.dataset.fontScale) === current;
        btn.className = isActive
            ? "py-2 rounded-lg border-2 border-emerald-500 bg-emerald-50 text-emerald-700 text-center transition-colors"
            : "py-2 rounded-lg border border-slate-200 text-center transition-colors hover:bg-slate-100";
    });
}

function setFontSize(scale) {
    document.documentElement.style.fontSize = `${scale}%`;
    localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(scale));
    syncFontSizeButtons();
}

// ----------------------------------------------------
// PWA: SERVICE WORKER REGISTRATION
// ----------------------------------------------------
if ("serviceWorker" in navigator) {
    // Without this, a new service worker can finish installing and taking
    // control (skipWaiting + clients.claim in sw.js) while an already-open
    // tab keeps running the OLD app.js/index.html it loaded at page-load
    // time — shipped features can silently fail to appear until the user
    // thinks to manually reload. Force exactly one reload when that happens.
    let refreshingAfterSwUpdate = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshingAfterSwUpdate) return;
        refreshingAfterSwUpdate = true;
        window.location.reload();
    });

    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch(err => {
            console.warn("Service worker registration failed", err);
        });
    });
}

// ----------------------------------------------------
// UI INITIALIZATION & EVENT BINDINGS
// ----------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    // Load User Profile Session
    const user = await apiFetchMe();
    checkLoginSession();

    if (user) {
        await apiFetchAllData();
        refreshAppUI();
        // Replay anything queued from a previous offline session, then keep
        // pulling other devices' changes in the background while this tab
        // stays open (syncPendingOps() itself re-fetches at the end).
        syncPendingOps().then(refreshAppUI);
        setInterval(() => {
            if (navigator.onLine) syncPendingOps().then(refreshAppUI);
        }, 60000);
    }
});

// ----------------------------------------------------
// APP RENDER CONTROLS
// ----------------------------------------------------
function refreshAppUI() {
    if (!state.currentUser) return;
    
    calculateSummary();
    renderDashboardWallets();
    renderTransactions();
    renderDebtors();
    renderCreditCards();
    renderRecurring();
    updateNotificationBadge();
    updateOfflineSyncBadge();
}

// ----------------------------------------------------
// SUMMARY CALCULATIONS
// ----------------------------------------------------
let overviewChartInstance = null;
function renderOverviewChart(totalCash, totalDebts, totalCreditCards, totalRecurring) {
    const ctx = document.getElementById('overviewChart');
    if (!ctx) return;

    const total = totalCash + totalDebts + totalCreditCards + totalRecurring;
    const dataVals = total === 0 ? [1, 0, 0, 0] : [totalCash, totalDebts, totalCreditCards, totalRecurring];
    const dataColors = total === 0 ? ['#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b'] : ['#10b981', '#6366f1', '#f59e0b', '#ef4444'];
    const labels = total === 0 ? ['ยังไม่มีข้อมูล'] : ['เงินสดในกระเป๋า', 'ลูกหนี้ค้างชำระ', 'หนี้บัตรเครดิต', 'รายจ่ายรายเดือน'];

    // Update the existing chart in place instead of destroying/recreating it
    // — this function runs on every refreshAppUI() (every action, every tab
    // switch, the 60s background sync), and Chart.js replays its full entry
    // animation on every `new Chart()`, which read as the whole dashboard
    // "jumping"/reloading constantly rather than just refreshing numbers.
    if (overviewChartInstance) {
        overviewChartInstance.data.labels = labels;
        overviewChartInstance.data.datasets[0].data = dataVals;
        overviewChartInstance.data.datasets[0].backgroundColor = dataColors;
        overviewChartInstance.update('none');
        return;
    }

    overviewChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: dataVals,
                backgroundColor: dataColors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: CHART_RESIZE_DELAY,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 10,
                        font: {
                            size: 10,
                            family: 'Google Sans, Prompt, Outfit, sans-serif'
                        },
                        padding: 10
                    }
                },
                tooltip: {
                    callbacks: {
                        // Reads the chart's current data at hover-time rather
                        // than closing over `total` from creation time, since
                        // this chart instance is now reused/updated in place
                        // (see the update('none') branch above) instead of
                        // being recreated whenever the numbers change.
                        label: function(context) {
                            // labels collapses to a single "ยังไม่มีข้อมูล" entry
                            // exactly when there's nothing to show (see above).
                            if (context.chart.data.labels.length === 1) return ' ยังไม่มีข้อมูลในระบบ';
                            const value = context.raw || 0;
                            return ` ${context.label}: ฿${value.toLocaleString('th-TH')}`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

function calculateSummary() {
    const totalCash = state.wallets.reduce((sum, w) => sum + w.balance, 0);
    
    const totalRecurring = state.recurringPayments
        .filter(rec => rec.status === "WAITING")
        .reduce((sum, rec) => sum + rec.amount, 0);

    const totalCreditCards = state.creditCards.reduce((sum, cc) => sum + cc.balance, 0);

    const totalDebts = state.debtors
        .filter(d => d.status !== "PAID" && d.remainingAmount > 0)
        .reduce((sum, deb) => sum + deb.remainingAmount, 0);

    const safeToSpend = totalCash + totalDebts - totalCreditCards - totalRecurring;

    document.getElementById('displaySafeToSpend').innerText = `฿${safeToSpend.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('displayTotalCash').innerText = `฿${totalCash.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('displayTotalRecurring').innerText = `฿${totalRecurring.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('displayTotalCreditCards').innerText = `฿${totalCreditCards.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    document.getElementById('displayTotalDebts').innerText = `฿${totalDebts.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    renderOverviewChart(totalCash, totalDebts, totalCreditCards, totalRecurring);
    renderCategorySummary();
}

function renderCategorySummary() {
    const container = document.getElementById('categorySummaryContainer');
    if (!container) return;
    container.innerHTML = '';
    
    const categorySums = {};
    let totalExpense = 0;
    
    state.transactions.forEach(tx => {
        if (tx.type === 'EXPENSE') {
            const catKey = tx.category || 'OTHER_EXP';
            categorySums[catKey] = (categorySums[catKey] || 0) + tx.amount;
            totalExpense += tx.amount;
        }
    });
    
    const sortedCategories = Object.entries(categorySums).sort((a, b) => b[1] - a[1]);
    
    if (sortedCategories.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4 text-slate-400 text-xs">
                ยังไม่มีรายจ่ายบันทึกในรอบนี้
            </div>
        `;
        return;
    }
    
    sortedCategories.forEach(([catKey, amount]) => {
        const cat = CATEGORIES[catKey] || { name: 'อื่นๆ', color: 'bg-slate-400', textColor: 'text-slate-500', icon: 'fa-ellipsis' };
        const budget = (state.budgets || []).find(b => b.category === catKey);

        let percentage, barColor, rightLabel;
        if (budget && budget.monthlyLimit > 0) {
            const overBudget = amount > budget.monthlyLimit;
            percentage = Math.round((amount / budget.monthlyLimit) * 100);
            barColor = overBudget ? 'bg-rose-500' : cat.color;
            rightLabel = `
                <span class="font-semibold ${overBudget ? 'text-rose-600' : 'text-slate-800'}">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                <span class="${overBudget ? 'text-rose-400 font-semibold' : 'text-slate-400 font-light'} ml-1">/ ฿${budget.monthlyLimit.toLocaleString('th-TH')}${overBudget ? ' เกินงบ!' : ''}</span>
            `;
        } else {
            percentage = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
            barColor = cat.color;
            rightLabel = `
                <span class="font-semibold text-slate-800">฿${amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                <span class="text-slate-400 font-light ml-1">(${percentage}%)</span>
            `;
        }

        const html = `
            <div class="space-y-1">
                <div class="flex justify-between items-center text-xs">
                    <div class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full ${cat.color}"></span>
                        <span class="font-bold text-slate-700"><i class="fa-solid ${cat.icon} mr-1 text-[11px] text-slate-400"></i> ${cat.name}</span>
                    </div>
                    <div class="text-right">${rightLabel}</div>
                </div>
                <div class="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div class="h-full ${barColor} rounded-full transition-all" style="width: ${Math.min(percentage, 100)}%"></div>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });
}

function renderDashboardWallets() {
    const listContainer = document.getElementById('dashboardWalletList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    state.wallets.forEach(w => {
        let iconClass = 'fa-solid fa-money-bill-wave text-emerald-500';
        if (w.type === 'BANK_ACCOUNT' || w.type === 'BANK') iconClass = 'fa-solid fa-building-columns text-blue-500';
        if (w.type === 'E_WALLET') iconClass = 'fa-solid fa-mobile-screen-button text-indigo-500';
        
        const cardHTML = `
            <div class="bg-white rounded-2xl border border-slate-200/70 p-3 shadow-xs flex flex-col justify-between min-h-[75px] relative overflow-hidden">
                <div class="flex justify-between items-start">
                    <span class="text-[10px] text-slate-400 font-semibold uppercase truncate block w-[70%]">${w.name}</span>
                    <i class="${iconClass} text-xs"></i>
                </div>
                <span class="font-bold text-slate-800 text-[13px] block mt-1.5">฿${w.balance.toLocaleString('th-TH', { maximumFractionDigits: 2 })}</span>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', cardHTML);
    });
    
    if (state.wallets.length === 0) {
        listContainer.innerHTML = `<div class="col-span-3 text-center text-slate-400 text-xs py-4">ไม่มีบัญชี/กระเป๋าเงิน</div>`;
    }
}

let monthlyTrendChartInstance = null;
async function renderMonthlyTrendChart() {
    const ctx = document.getElementById('monthlyTrendChart');
    if (!ctx) return;

    try {
        await apiFetchMonthlyTrend();
    } catch (e) {
        console.error(e);
        return;
    }

    const labels = state.monthlyTrend.map(m => {
        const [y, mo] = m.month.split('-');
        return `${mo}/${y.slice(2)}`;
    });
    const income = state.monthlyTrend.map(m => m.income);
    const expense = state.monthlyTrend.map(m => m.expense);

    // Update in place rather than destroy+recreate, same reasoning as
    // renderOverviewChart — this tab can be revisited repeatedly and
    // shouldn't replay the bar-grow-in animation every single time.
    if (monthlyTrendChartInstance) {
        monthlyTrendChartInstance.data.labels = labels;
        monthlyTrendChartInstance.data.datasets[0].data = income;
        monthlyTrendChartInstance.data.datasets[1].data = expense;
        monthlyTrendChartInstance.update('none');
        return;
    }

    monthlyTrendChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: 'รายรับ', data: income, backgroundColor: '#10b981', borderRadius: 4 },
                { label: 'รายจ่าย', data: expense, backgroundColor: '#f43f5e', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            resizeDelay: CHART_RESIZE_DELAY,
            scales: {
                x: { grid: { display: false }, ticks: { font: { size: 9 } } },
                y: { ticks: { font: { size: 9 } }, beginAtZero: true }
            },
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10, family: 'Google Sans, Prompt, Outfit, sans-serif' }, padding: 10 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ฿${ctx.raw.toLocaleString('th-TH')}` } }
            }
        }
    });
}

async function exportTransactionsCSV() {
    try {
        await apiExportTransactionsCSV();
    } catch (err) {
        alertModal(err.message);
    }
}

// ----------------------------------------------------
// LIST / CARD VIEW MODE (shared by transactions, debtors, credit cards,
// recurring — each section persists its own choice under its own key, with
// a default matching how that page already looked before this toggle existed).
// ----------------------------------------------------
const VIEW_MODE_DEFAULTS = {
    transactions: 'list',
    debtors: 'card',
    cards: 'card',
    recurring: 'card'
};

function getViewMode(section) {
    const stored = localStorage.getItem(`somdul_${section}_view_mode`);
    return stored === 'list' || stored === 'card' ? stored : VIEW_MODE_DEFAULTS[section];
}

function setViewMode(section, mode, renderFn) {
    localStorage.setItem(`somdul_${section}_view_mode`, mode);
    updateViewModeButtons(section);
    renderFn();
}

function updateViewModeButtons(section) {
    const mode = getViewMode(section);
    const listBtn = document.getElementById(`${section}ViewModeListBtn`);
    const cardBtn = document.getElementById(`${section}ViewModeCardBtn`);
    if (!listBtn || !cardBtn) return;
    const activeClass = "px-2.5 py-1.5 rounded-md text-xs transition-colors bg-white text-emerald-600 shadow-sm";
    const inactiveClass = "px-2.5 py-1.5 rounded-md text-xs transition-colors text-slate-400 hover:text-slate-600";
    listBtn.className = mode === 'list' ? activeClass : inactiveClass;
    cardBtn.className = mode === 'card' ? activeClass : inactiveClass;
}

// Backwards-compatible aliases (transactions was the first page to get this).
function getTransactionViewMode() { return getViewMode('transactions'); }
function setTransactionViewMode(mode) { setViewMode('transactions', mode, renderTransactions); }

function renderTransactions() {
    const listContainer = document.getElementById('transactionHistory');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    updateViewModeButtons('transactions');

    const mode = getViewMode('transactions');
    listContainer.className = mode === 'card'
        ? "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
        : "bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-50 overflow-hidden shadow-sm";

    state.transactions.forEach((tx) => {
        const isExpense = tx.type === "EXPENSE";
        const cat = CATEGORIES[tx.category];
        const iconClass = cat ? `fa-solid ${cat.icon}` : (isExpense ? "fa-solid fa-arrow-up-right-from-square" : "fa-solid fa-arrow-down-left-and-arrow-up-right-to-side");
        const iconBg = cat ? `${cat.color}/10 ${cat.textColor}` : (isExpense ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600");
        const amountSign = isExpense ? "-" : "+";
        const amountColor = isExpense ? "text-rose-600" : "text-emerald-600";

        let sourceName = 'ไม่ระบุ';
        const wallet = state.wallets.find(w => w.id === tx.walletId);
        const card = state.creditCards.find(c => c.id === tx.walletId);

        if (wallet) {
            sourceName = wallet.name;
        } else if (card) {
            sourceName = `${card.name} (บัตรเครดิต)`;
        }

        const txHTML = mode === 'card' ? `
            <div onclick="showTransactionDetail('${tx.id}')" class="bg-white rounded-2xl border border-slate-200/70 shadow-sm p-5 cursor-pointer hover:border-emerald-200 hover:shadow-md transition-all">
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div class="w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center shrink-0">
                        <i class="${iconClass} text-sm"></i>
                    </div>
                    <span class="font-bold ${amountColor} text-base">${amountSign}฿${tx.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                </div>
                <h4 class="font-bold text-slate-800 text-sm mb-1">${tx.desc}</h4>
                <div class="flex items-center justify-between text-xs text-slate-400">
                    <span>${sourceName}</span>
                    ${cat ? `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-normal shrink-0">${cat.name}</span>` : ''}
                </div>
                <span class="text-[11px] text-slate-400 block mt-1.5 pt-1.5 border-t border-slate-100">${tx.date}</span>
            </div>
        ` : `
            <div onclick="showTransactionDetail('${tx.id}')" class="flex items-center justify-between p-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 ${iconBg} rounded-lg flex items-center justify-center shrink-0">
                        <i class="${iconClass} text-xs"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 flex items-center gap-1.5">
                            ${tx.desc}
                            ${cat ? `<span class="px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-normal shrink-0">${cat.name}</span>` : ''}
                        </h4>
                        <span class="text-[11px] text-slate-400 block mt-0.5">ผ่าน: ${sourceName} | ${tx.date}</span>
                    </div>
                </div>
                <span class="font-bold ${amountColor} text-sm">${amountSign}฿${tx.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', txHTML);
    });

    if (state.transactions.length === 0) {
        listContainer.className = "bg-white rounded-2xl border border-slate-200/70 shadow-sm";
        listContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                ไม่มีประวัติธุรกรรมในระบบ กดปุ่มจดบันทึกด้านบนเพื่อเพิ่มรายการแรกได้เลยครับ!
            </div>
        `;
    }
}

function renderDebtors() {
    const listContainer = document.getElementById('debtorList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    updateViewModeButtons('debtors');
    const mode = getViewMode('debtors');
    listContainer.className = mode === 'list'
        ? "bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-50 overflow-hidden shadow-sm"
        : "space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3";

    const activeDebtors = state.debtors.filter(d => d.status !== "PAID" && d.remainingAmount > 0);

    const debtorCountEl = document.getElementById('debtorCount');
    if (debtorCountEl) {
        debtorCountEl.innerText = `ทั้งหมด ${activeDebtors.length} คน`;
    }

    activeDebtors.forEach((debtor) => {
        const nextPaybackVal = getNextPaybackVal(debtor);
        
        let badgeHTML = '';
        let typeText = '';
        let badgeColor = '';
        
        if (debtor.type === 'CREDIT_CARD_INSTALLMENT') {
            const card = state.creditCards.find(c => c.id === debtor.cardId);
            typeText = 'ผ่อนแทนด้วยบัตรเครดิต';
            badgeColor = 'bg-blue-50 text-blue-700 border-blue-200';
            badgeHTML = `<span class="text-[11px] px-2 py-0.5 rounded-full border ${badgeColor}"><i class="fa-regular fa-credit-card mr-0.5"></i> ${card ? card.name : 'บัตรเครดิต'}</span>`;
        } else {
            typeText = 'ยืมเงินสดก้อนเดียว';
            badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
            badgeHTML = `<span class="text-[11px] px-2 py-0.5 rounded-full border ${badgeColor}"><i class="fa-solid fa-money-bill-wave mr-0.5"></i> เงินสด</span>`;
        }

        const dueLabel = debtor.dueDate ? `ครบกำหนด ${formatThaiDateOnly(debtor.dueDate)}` : `ดีลทุกวันที่ ${debtor.dueDay}`;
        const installmentText = debtor.totalInstallments > 1
            ? `${dueLabel} (เหลือ ${debtor.remainingInstallments} งวด)`
            : `${dueLabel} (ชำระก้อนเดียว)`;

        const itemHTML = mode === 'list' ? `
            <div onclick="showDebtorDetail('${debtor.id}')" class="flex items-center justify-between p-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors gap-2">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 ${badgeColor.includes('blue') ? 'bg-blue-50 text-blue-600' : 'bg-rose-50 text-rose-600'} rounded-lg flex items-center justify-center shrink-0">
                        <i class="fa-solid ${debtor.type === 'CREDIT_CARD_INSTALLMENT' ? 'fa-credit-card' : 'fa-money-bill-wave'} text-xs"></i>
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 truncate">${debtor.name}</h4>
                        <span class="text-[11px] text-slate-400 block mt-0.5 truncate">${installmentText}</span>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="font-bold text-rose-500 text-sm block">฿${debtor.remainingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    <button onclick="event.stopPropagation(); openReceivePaybackModal('${debtor.id}')" class="text-emerald-600 text-[11px] font-semibold hover:underline">รับชำระคืน</button>
                </div>
            </div>
        ` : `
            <div onclick="showDebtorDetail('${debtor.id}')" class="bg-white rounded-2xl border border-slate-200/70 p-5 shadow-sm relative overflow-hidden cursor-pointer hover:border-emerald-200 transition-colors">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h4 class="font-bold text-slate-800 text-sm">${debtor.name}</h4>
                        <p class="text-xs text-slate-400 mt-0.5 mb-1">${debtor.memo}</p>
                        <div class="flex flex-wrap gap-1 mt-1">
                            ${badgeHTML}
                            <span class="text-[11px] text-slate-400 self-center">${installmentText}</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-xs text-slate-400 block">ค้างสะสมทั้งหมด</span>
                        <span class="font-bold text-rose-500 text-sm">฿${debtor.remainingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>

                <div class="flex flex-wrap gap-2 justify-between items-center bg-slate-50 p-2.5 rounded-xl border border-slate-200/70 mt-3 text-xs">
                    <div class="whitespace-nowrap">
                        <span class="text-slate-400">งวดถัดไปที่ต้องคืน:</span>
                        <span class="font-semibold text-slate-700">฿${nextPaybackVal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div class="flex gap-1.5 flex-wrap ml-auto">
                        <button onclick="event.stopPropagation(); openShareSlip('${debtor.id}')" class="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold px-2.5 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0">
                            <i class="fa-regular fa-paper-plane"></i> แชร์สลิปทวง
                        </button>
                        <button onclick="event.stopPropagation(); openReceivePaybackModal('${debtor.id}')" class="bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1 whitespace-nowrap shrink-0">
                            <i class="fa-solid fa-check"></i> รับชำระคืน
                        </button>
                    </div>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (activeDebtors.length === 0) {
        listContainer.className = "bg-white rounded-2xl border border-slate-200/70 shadow-sm";
        listContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                <i class="fa-regular fa-folder-open text-3xl mb-2 text-slate-300 block"></i>
                ไม่มีรายการหนี้คงเหลือที่ต้องทวงถาม ยินดีด้วยครับ!
            </div>
        `;
    }
    renderTimeline();
}

function renderCreditCards() {
    const listContainer = document.getElementById('creditCardList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    updateViewModeButtons('cards');
    const mode = getViewMode('cards');
    listContainer.className = mode === 'list'
        ? "bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-50 overflow-hidden shadow-sm"
        : "space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3";

    state.creditCards.forEach((card) => {
        const availableLimit = card.limit - card.balance;
        const progressPercent = Math.min((card.balance / card.limit) * 100, 100);

        const itemHTML = mode === 'list' ? `
            <div onclick="showCardDetail('${card.id}')" class="flex items-center justify-between p-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors gap-2">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-9 h-6 bg-slate-800 text-white text-[10px] font-bold rounded-md flex items-center justify-center border border-slate-700 shrink-0">
                        CARD
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 truncate">${card.name}</h4>
                        <span class="text-[11px] text-slate-400 block mt-0.5 truncate">ครบกำหนดวันที่ ${card.dueDay} | ว่างใช้ได้ ฿${availableLimit.toLocaleString('th-TH')}</span>
                    </div>
                </div>
                <span class="font-bold text-slate-800 text-sm shrink-0">฿${card.balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
        ` : `
            <div onclick="showCardDetail('${card.id}')" class="bg-white rounded-2xl border border-slate-200/70 p-5 shadow-sm relative overflow-hidden cursor-pointer hover:border-blue-200 transition-colors">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center gap-2.5">
                        <div class="w-10 h-7 bg-slate-800 text-white text-[11px] font-bold rounded-md flex items-center justify-center border border-slate-700">
                            CARD
                        </div>
                        <div>
                            <h4 class="font-bold text-slate-800 text-xs">${card.name}</h4>
                            <span class="text-[11px] text-slate-400 block mt-0.5">ตัดรอบวันที่ ${card.billingDay} | ครบกำหนดจ่ายวันที่ ${card.dueDay} ของเดือน</span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[11px] text-slate-400 block">ยอดค้างชำระ</span>
                        <span class="font-bold text-slate-800 text-sm">฿${card.balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    </div>
                </div>

                <div class="space-y-1 text-xs">
                    <div class="flex justify-between text-[11px] text-slate-400">
                        <span>วงเงินรวม: ฿${card.limit.toLocaleString('th-TH')}</span>
                        <span>ว่างใช้ได้: ฿${availableLimit.toLocaleString('th-TH')}</span>
                    </div>
                    <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div class="bg-rose-500 h-full rounded-full transition-all" style="width: ${progressPercent}%"></div>
                    </div>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (state.creditCards.length === 0) {
        listContainer.className = "bg-white rounded-2xl border border-slate-200/70 shadow-sm";
        listContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                <i class="fa-regular fa-credit-card text-3xl mb-2 text-slate-300 block"></i>
                ไม่มีบัตรเครดิตในระบบ กดปุ่มเกียร์ตั้งค่าด้านบนเพื่อเพิ่มบัตรเครดิตใบแรกของคุณ!
            </div>
        `;
    }
}

function renderRecurring() {
    const listContainer = document.getElementById('recurringList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    updateViewModeButtons('recurring');
    const mode = getViewMode('recurring');
    listContainer.className = mode === 'list'
        ? "bg-white rounded-2xl border border-slate-200/70 divide-y divide-slate-50 overflow-hidden shadow-sm"
        : "space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-4 lg:grid-cols-3";

    const unpaidRecurring = state.recurringPayments.filter(rec => rec.status === "WAITING");
    document.getElementById('recurringCount').innerText = `ค้างชำระประจำ ${unpaidRecurring.length} รายการ`;

    state.recurringPayments.forEach((rec) => {
        const isPaid = rec.status === "PAID";
        const statusBadge = isPaid
            ? `<span class="bg-emerald-50 text-emerald-700 text-[11px] font-semibold px-2 py-0.5 rounded-md border border-emerald-100">จ่ายแล้วเดือนนี้</span>`
            : `<span class="bg-amber-50 text-amber-700 text-[11px] font-semibold px-2 py-0.5 rounded-md border border-amber-100">รอหักงวดถัดไป</span>`;

        const itemHTML = mode === 'list' ? `
            <div onclick="showRecurringDetail('${rec.id}')" class="flex items-center justify-between p-3 text-xs cursor-pointer hover:bg-slate-50 transition-colors gap-2">
                <div class="flex items-center gap-3 min-w-0">
                    <div class="w-8 h-8 ${isPaid ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'} rounded-lg flex items-center justify-center shrink-0">
                        <i class="fa-solid fa-rotate-right text-xs"></i>
                    </div>
                    <div class="min-w-0">
                        <h4 class="font-bold text-slate-800 truncate">${rec.name}</h4>
                        <span class="text-[11px] text-slate-400 block mt-0.5 truncate">ครบกำหนดวันที่ ${rec.dueDay} ของทุกเดือน</span>
                    </div>
                </div>
                <div class="text-right shrink-0">
                    <span class="font-bold text-slate-800 block text-sm">฿${rec.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    ${!isPaid ? `<button onclick="event.stopPropagation(); openPayRecurringModal('${rec.id}')" class="text-emerald-600 text-[11px] font-semibold hover:underline">ยืนยันจ่าย</button>` : ''}
                </div>
            </div>
        ` : `
            <div onclick="showRecurringDetail('${rec.id}')" class="bg-white rounded-2xl border border-slate-200/70 p-5 shadow-sm relative overflow-hidden flex justify-between items-center cursor-pointer hover:border-amber-200 transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 ${isPaid ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'} rounded-xl flex items-center justify-center">
                        <i class="fa-solid fa-rotate-right text-sm"></i>
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-800 text-xs">${rec.name}</h4>
                        <span class="text-[11px] text-slate-400 block mt-0.5">ครบกำหนดวันที่ ${rec.dueDay} ของทุกเดือน</span>
                        <div class="mt-1">${statusBadge}</div>
                    </div>
                </div>
                <div class="text-right">
                    <span class="font-bold text-slate-800 block text-sm">฿${rec.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                    ${!isPaid ? `
                    <button onclick="event.stopPropagation(); openPayRecurringModal('${rec.id}')" class="bg-gradient-to-b from-slate-800 to-slate-950 hover:from-slate-900 hover:to-black text-white font-semibold text-[11px] px-2.5 py-1 rounded-md transition-colors mt-1">
                        ยืนยันจ่าย
                    </button>` : ''}
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (state.recurringPayments.length === 0) {
        listContainer.className = "bg-white rounded-2xl border border-slate-200/70 shadow-sm";
        listContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                <i class="fa-regular fa-folder-open text-3xl mb-2 text-slate-300 block"></i>
                ไม่มีรายการบริการซ้ำๆ รายเดือนในระบบ
            </div>
        `;
    }
}

function renderTimeline() {
    const listContainer = document.getElementById('timelineTrackerContainer');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    const items = getTimelineItems();
    
    if (items.length === 0) {
        listContainer.innerHTML = `
            <div class="w-full text-center py-4 text-slate-400 text-xs self-center">
                <i class="fa-regular fa-calendar text-lg mb-1 block"></i>
                ไม่มีรายการสภาพคล่องครบกำหนดใน 30 วันข้างหน้า
            </div>
        `;
        return;
    }
    
    items.forEach(item => {
        let eventsHTML = '';
        let namesText = [];
        
        item.events.forEach(evt => {
            const isIncome = evt.type === 'INCOME';
            const badgeClass = isIncome 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                : 'bg-rose-50 text-rose-700 border-rose-100';
            const sign = isIncome ? '+' : '-';
            
            eventsHTML += `
                <div class="text-[10px] ${badgeClass} font-semibold py-0.5 px-1 rounded border truncate">
                    ${sign}฿${evt.amount.toLocaleString('th-TH')}
                </div>
            `;
            namesText.push(`${evt.name} (${evt.desc})`);
        });
        
        const cardHTML = `
            <div class="flex-shrink-0 w-28 bg-slate-50 border border-slate-200/70 rounded-xl p-2.5 text-center flex flex-col justify-between min-h-[105px] shadow-2xs hover:bg-slate-100 transition-colors">
                <div class="text-[11px] font-bold text-slate-500 uppercase border-b border-slate-200/40 pb-1 mb-1">${item.dateStr}</div>
                <div class="my-1 space-y-1">
                    ${eventsHTML}
                </div>
                <div class="text-[9px] text-slate-400 truncate mt-1" title="${namesText.join(', ')}">
                    ${item.events.map(e => e.name).join(' & ')}
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', cardHTML);
    });
}

function getTimelineItems() {
    const items = [];
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
        const targetDate = new Date(today);
        targetDate.setDate(today.getDate() + i);
        const day = targetDate.getDate();
        
        const dateStr = targetDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        const dayEvents = [];
        
        // 1. Debtors (Incoming - due on day)
        state.debtors.forEach(debtor => {
            if (debtor.status !== "PAID" && debtor.remainingAmount > 0 && debtor.dueDay === day) {
                const nextPaybackVal = getNextPaybackVal(debtor);
                dayEvents.push({
                    type: 'INCOME',
                    name: debtor.name,
                    amount: nextPaybackVal,
                    desc: debtor.memo
                });
            }
        });
        
        // 2. Credit Cards (Outgoing - due on day)
        state.creditCards.forEach(card => {
            if (card.balance > 0 && card.dueDay === day) {
                dayEvents.push({
                    type: 'EXPENSE',
                    name: card.name,
                    amount: card.balance,
                    desc: 'บิลบัตรเครดิต'
                });
            }
        });
        
        // 3. Recurring Payments (Outgoing - due on day)
        state.recurringPayments.forEach(rec => {
            if (rec.status === "WAITING" && rec.dueDay === day) {
                dayEvents.push({
                    type: 'EXPENSE',
                    name: rec.name,
                    amount: rec.amount,
                    desc: 'ค่าบริการรายเดือน'
                });
            }
        });
        
        if (dayEvents.length > 0) {
            items.push({
                dateStr: dateStr,
                day: day,
                events: dayEvents
            });
        }
    }
    return items;
}

function formatThaiDateOnly(dateStr) {
    const date = new Date(dateStr);
    const thaiMonths = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
    return `${date.getDate()} ${thaiMonths[date.getMonth()]} ${date.getFullYear()}`;
}

function getNextPaybackVal(debtor) {
    if (debtor.remainingInstallments <= 0) return 0;
    return Math.round(debtor.remainingAmount / debtor.remainingInstallments);
}

// ----------------------------------------------------
// NOTIFICATION SYSTEM CONTROLS
// ----------------------------------------------------
function updateNotificationBadge() {
    let count = 0;
    state.debtors.forEach(d => { if (d.status !== "PAID" && d.remainingAmount > 0 && !state.dismissedNotifications.includes(d.id)) count++; });
    state.creditCards.forEach(c => { if (c.balance > 0 && !state.dismissedNotifications.includes(c.id)) count++; });
    state.recurringPayments.forEach(r => { if (r.status === "WAITING" && !state.dismissedNotifications.includes(r.id)) count++; });
    
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (count > 0) {
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
}

// ----------------------------------------------------
// OFFLINE / SYNC STATUS BADGE
// ----------------------------------------------------
async function updateOfflineSyncBadge() {
    const badge = document.getElementById('offlineSyncBadge');
    if (!badge) return;

    const pending = await dbPendingCount();
    if (!navigator.onLine) {
        badge.textContent = pending > 0 ? `ออฟไลน์ · ค้าง ${pending}` : "ออฟไลน์";
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    } else if (pending > 0) {
        badge.textContent = `กำลังซิงก์ ${pending} รายการ`;
        badge.classList.remove('hidden');
        badge.classList.add('flex');
    } else {
        badge.classList.add('hidden');
        badge.classList.remove('flex');
    }
}

window.addEventListener('online', updateOfflineSyncBadge);
window.addEventListener('offline', updateOfflineSyncBadge);

function openNotificationModal() {
    renderNotifications();
    document.getElementById('notificationModal').classList.remove('hidden');
    const badge = document.getElementById('notificationBadge');
    if (badge) badge.classList.add('hidden');
}

function closeNotificationModal() {
    document.getElementById('notificationModal').classList.add('hidden');
}

function renderNotifications() {
    const listContainer = document.getElementById('notificationList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    let count = 0;

    state.debtors.forEach(d => {
        if (d.status !== "PAID" && d.remainingAmount > 0 && !state.dismissedNotifications.includes(d.id)) {
            const nextPaybackVal = getNextPaybackVal(d);
            const html = `
                <div class="flex items-start justify-between gap-3 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100 text-xs">
                    <div class="flex items-start gap-3">
                        <div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-arrow-down-long"></i>
                        </div>
                        <div>
                            <span class="font-bold text-slate-800">ลูกหนี้ค้างชำระคืนเรา</span>
                            <p class="text-slate-500 text-xs mt-0.5">${d.name} ต้องโอนคืนยอดงวดถัดไป ฿${nextPaybackVal.toLocaleString('th-TH')} (ดีลวันที่ ${d.dueDay})</p>
                        </div>
                    </div>
                    <button onclick="dismissNotification('${d.id}')" class="w-6 h-6 rounded-full bg-white hover:bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0" title="อ่านแล้ว">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', html);
            count++;
        }
    });
    
    state.creditCards.forEach(c => {
        if (c.balance > 0 && !state.dismissedNotifications.includes(c.id)) {
            const html = `
                <div class="flex items-start justify-between gap-3 p-3 bg-rose-50/50 rounded-xl border border-rose-100 text-xs">
                    <div class="flex items-start gap-3">
                        <div class="w-8 h-8 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-credit-card"></i>
                        </div>
                        <div>
                            <span class="font-bold text-slate-800">บิลบัตรเครดิตรอจ่าย</span>
                            <p class="text-slate-500 text-xs mt-0.5">บัตร ${c.name} มียอดค้างรอเคลียร์ ฿${c.balance.toLocaleString('th-TH')} (กำหนดชำระวันที่ ${c.dueDay})</p>
                        </div>
                    </div>
                    <button onclick="dismissNotification('${c.id}')" class="w-6 h-6 rounded-full bg-white hover:bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0" title="อ่านแล้ว">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', html);
            count++;
        }
    });
    
    state.recurringPayments.forEach(r => {
        if (r.status === "WAITING" && !state.dismissedNotifications.includes(r.id)) {
            const html = `
                <div class="flex items-start justify-between gap-3 p-3 bg-amber-50/50 rounded-xl border border-amber-100 text-xs">
                    <div class="flex items-start gap-3">
                        <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                            <i class="fa-solid fa-rotate-right"></i>
                        </div>
                        <div>
                            <span class="font-bold text-slate-800">ค่าบริการรายเดือน (Subscription)</span>
                            <p class="text-slate-500 text-xs mt-0.5">รายการ ${r.name} ยอด ฿${r.amount.toLocaleString('th-TH')} (ดีลกำหนดจ่ายวันที่ ${r.dueDay})</p>
                        </div>
                    </div>
                    <button onclick="dismissNotification('${r.id}')" class="w-6 h-6 rounded-full bg-white hover:bg-slate-100 border border-slate-200/70 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors shrink-0" title="อ่านแล้ว">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                </div>
            `;
            listContainer.insertAdjacentHTML('beforeend', html);
            count++;
        }
    });
    
    if (count === 0) {
        listContainer.innerHTML = `
            <div class="text-center py-8 text-slate-400 text-xs">
                ไม่มีการแจ้งเตือนใหม่ในขณะนี้
            </div>
        `;
    }

    const clearAllBtn = document.getElementById('clearAllNotificationsBtn');
    if (clearAllBtn) clearAllBtn.classList.toggle('hidden', count === 0);
}

function dismissNotification(id) {
    if (!state.dismissedNotifications.includes(id)) {
        state.dismissedNotifications.push(id);
        renderNotifications();
        updateNotificationBadge();
        apiDismissNotification(id).catch(err => console.error("Failed to persist dismissal", err));
    }
}

function clearAllNotifications() {
    const ids = [];
    state.debtors.forEach(d => { if (d.status !== "PAID" && d.remainingAmount > 0 && !state.dismissedNotifications.includes(d.id)) ids.push(d.id); });
    state.creditCards.forEach(c => { if (c.balance > 0 && !state.dismissedNotifications.includes(c.id)) ids.push(c.id); });
    state.recurringPayments.forEach(r => { if (r.status === "WAITING" && !state.dismissedNotifications.includes(r.id)) ids.push(r.id); });

    if (ids.length === 0) return;

    ids.forEach(id => {
        state.dismissedNotifications.push(id);
        apiDismissNotification(id).catch(err => console.error("Failed to persist dismissal", err));
    });
    renderNotifications();
    updateNotificationBadge();
}

// ----------------------------------------------------
// AUTHENTICATION & LOGIN UI CONTROLS
// ----------------------------------------------------
let tokenExpiryCheckInterval = null;
function startTokenExpiryChecker() {
    if (tokenExpiryCheckInterval) clearInterval(tokenExpiryCheckInterval);
    
    tokenExpiryCheckInterval = setInterval(() => {
        const token = localStorage.getItem("somdul_jwt_token");
        if (!token) return;
        
        try {
            const base64Url = token.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            
            const payload = JSON.parse(jsonPayload);
            const exp = payload.exp * 1000;
            const now = Date.now();
            
            if (now >= exp) {
                clearInterval(tokenExpiryCheckInterval);
                apiLogout();
                checkLoginSession();
                alertModal("เซสชันการเข้าใช้งานของคุณหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่อีกครั้งเพื่อความปลอดภัย");
            }
        } catch (e) {
            console.error("Error decoding JWT token expiration", e);
        }
    }, 10000);
}

function checkLoginSession() {
    const loginScreen = document.getElementById('loginScreen');
    if (!state.currentUser) {
        // Retract the "assume logged in" shortcut the boot-time inline
        // script (index.html <head>) stamped on <html> from seeing a stored
        // token — that shortcut's CSS rule has higher specificity than the
        // login screen's normal Tailwind classes and would otherwise keep
        // it force-hidden forever, even after we now know for sure the
        // token was invalid/expired and the screen needs to actually show.
        document.documentElement.classList.remove('has-token');
        loginScreen.classList.remove('hidden');
        if (tokenExpiryCheckInterval) {
            clearInterval(tokenExpiryCheckInterval);
            tokenExpiryCheckInterval = null;
        }
    } else {
        loginScreen.classList.add('hidden');
        document.getElementById('headerProfileName').innerText = `สวัสดี, ${state.currentUser.name}`;
        updateNotificationBadge();
        startTokenExpiryChecker();
    }
}

let registerMode = false;
function calculatePasswordStrength(password) {
    if (!password) return { score: 0, text: 'แย่มาก (ไม่มีรหัสผ่าน)', color: 'bg-rose-500', textClass: 'text-rose-500' };
    
    let score = 0;
    if (password.length >= 6) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?`~]/.test(password)) score++;
    if (/[A-Z]/.test(password) || /[a-z]/.test(password)) score++;
    
    let text = 'แย่มาก (ต้องการความยาว 6 ตัว ขึ้นไป ตัวเลข และสัญลักษณ์)';
    let color = 'bg-rose-500';
    let textClass = 'text-rose-500';
    
    if (score === 1) {
        text = 'อ่อนแอ (ยังขาดตัวเลขหรือสัญลักษณ์)';
        color = 'bg-orange-500';
        textClass = 'text-orange-500';
    } else if (score === 2) {
        text = 'ปานกลาง (ควรเพิ่มอักขระพิเศษ)';
        color = 'bg-amber-500';
        textClass = 'text-amber-500';
    } else if (score === 3) {
        text = 'ปลอดภัย (ระดับดี)';
        color = 'bg-teal-500';
        textClass = 'text-teal-500';
    } else if (score === 4) {
        text = 'แข็งแกร่งมาก (ปลอดภัยสูง)';
        color = 'bg-emerald-500';
        textClass = 'text-emerald-500';
    }
    
    return { score, text, color, textClass };
}

function checkRegisterPasswordStrength(val) {
    const wrapper = document.getElementById('passwordStrengthWrapper');
    if (!wrapper) return;
    
    const strength = calculatePasswordStrength(val);
    const bar = document.getElementById('strengthBar');
    const txt = document.getElementById('strengthText');
    
    bar.className = `h-full transition-all duration-300 ${strength.color}`;
    bar.style.width = `${(strength.score / 4) * 100}%`;
    txt.innerText = `ระดับความปลอดภัย: ${strength.text}`;
    txt.className = `text-[11px] ${strength.textClass}`;
}

function checkChangePasswordStrength(val) {
    const wrapper = document.getElementById('changePasswordStrengthWrapper');
    if (!wrapper) return;
    
    const strength = calculatePasswordStrength(val);
    const bar = document.getElementById('changeStrengthBar');
    const txt = document.getElementById('changeStrengthText');
    
    bar.className = `h-full transition-all duration-300 ${strength.color}`;
    bar.style.width = `${(strength.score / 4) * 100}%`;
    txt.innerText = `ระดับความปลอดภัย: ${strength.text}`;
    txt.className = `text-[10px] ${strength.textClass}`;
}

function toggleRegisterMode(forceState) {
    registerMode = (forceState !== undefined) ? forceState : !registerMode;
    const title = document.getElementById('loginTitle');
    const nameField = document.getElementById('regNameField');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const toggleText = document.getElementById('loginToggleText');
    const toggleBtn = document.getElementById('loginToggleBtn');
    const loginNameInput = document.getElementById('loginNameInput');
    const pwStrength = document.getElementById('passwordStrengthWrapper');
    
    if (registerMode) {
        title.innerText = "สมัครสมาชิก Somdul";
        nameField.classList.remove('hidden');
        loginNameInput.required = true;
        submitBtn.innerText = "ลงทะเบียนและเข้าใช้งาน";
        toggleText.innerText = "มีบัญชีอยู่แล้ว?";
        toggleBtn.innerText = "เข้าสู่ระบบ";
        if (pwStrength) pwStrength.classList.remove('hidden');
    } else {
        title.innerText = "เข้าสู่ระบบ Somdul";
        nameField.classList.add('hidden');
        loginNameInput.required = false;
        submitBtn.innerText = "เข้าสู่ระบบ";
        toggleText.innerText = "ยังไม่มีบัญชีใช้งาน?";
        toggleBtn.innerText = "สมัครสมาชิกใหม่";
        if (pwStrength) pwStrength.classList.add('hidden');
    }
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmailInput').value.trim().toLowerCase();
    const password = document.getElementById('loginPasswordInput').value;
    const name = document.getElementById('loginNameInput').value.trim();
    
    try {
        if (registerMode) {
            await apiRegister(name, email, password);
            alertModal(`ลงทะเบียนสำเร็จ! ยินดีต้อนรับคุณ ${name}`);
        } else {
            await apiLogin(email, password);
            alertModal(`เข้าสู่ระบบสำเร็จ!`);
        }
        
        document.getElementById('loginForm').reset();
        registerMode = false;
        toggleRegisterMode(false);
        checkLoginSession();
        refreshAppUI();
    } catch (err) {
        alertModal(err.message);
    }
}

function handleLogout() {
    if (confirm("คุณต้องการออกจากระบบหรือไม่?")) {
        apiLogout();
        closeSettingsModal();
        checkLoginSession();
        alertModal("ออกจากระบบเรียบร้อยแล้ว");
    }
}

// ----------------------------------------------------
// FORMS SUBMISSION HANDLERS (DATABASE CONNECTED)
// ----------------------------------------------------
async function handleTransactionSubmit(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('txAmount').value);
    const desc = document.getElementById('txDesc').value.trim();
    const walletId = document.getElementById('txWallet').value;
    const type = state.currentTxType;

    if (isNaN(amount) || amount <= 0 || !desc) {
        alertModal("กรุณากรอกข้อมูลให้ครบถ้วน");
        return;
    }

    const wallet = state.wallets.find(w => w.id === walletId);
    const card = state.creditCards.find(c => c.id === walletId);
    
    let wId = wallet ? wallet.id : null;
    let cId = card ? card.id : null;

    try {
        await apiCreateTransaction(type, desc, document.getElementById('txCategory').value, amount, wId, cId);
        
        closeTransactionModal();
        document.getElementById('transactionForm').reset();
        switchMainTab('home');
        refreshAppUI();
        alertModal("บันทึกธุรกรรมเรียบร้อย!");
    } catch (err) {
        alertModal(err.message);
    }
}

async function handleDebtSubmit(e) {
    e.preventDefault();
    const splitMode = document.getElementById('debtSplitMode').checked;
    const debtType = document.getElementById('debtType').value;
    const debtCardId = document.getElementById('debtCardId').value;
    const totalAmount = parseFloat(document.getElementById('debtAmount').value);
    const debtInstallments = parseInt(document.getElementById('debtInstallments').value);
    const usesDueDate = debtType === 'CASH_LOAN';
    const debtDueDay = usesDueDate ? 1 : parseInt(document.getElementById('debtDueDay').value);
    const debtDueDate = usesDueDate ? document.getElementById('debtDueDate').value : null;
    const interestType = document.getElementById('debtInterestType').value || null;
    const interestValue = interestType ? parseFloat(document.getElementById('debtInterestValue').value) : null;
    const baseMemo = document.getElementById('debtMemo').value.trim() || "บันทึกยืมเงินส่วนกลาง";

    if (isNaN(totalAmount) || totalAmount <= 0 || isNaN(debtInstallments) || debtInstallments <= 0) {
        alertModal("กรุณากรอกจำนวนเงินและจำนวนงวดให้ถูกต้อง");
        return;
    }
    if (usesDueDate && !debtDueDate) {
        alertModal("กรุณาระบุวันที่ครบกำหนดชำระคืน");
        return;
    }
    if (!usesDueDate && (isNaN(debtDueDay) || debtDueDay < 1 || debtDueDay > 31)) {
        alertModal("กรุณาระบุวันกำหนดชำระ (1-31) ให้ถูกต้อง");
        return;
    }
    if (interestType && (isNaN(interestValue) || interestValue < 0)) {
        alertModal("กรุณาระบุจำนวนดอกเบี้ยให้ถูกต้อง");
        return;
    }

    let debtorNames;
    if (splitMode) {
        debtorNames = document.getElementById('debtSplitNames').value.split('\n').map(n => n.trim()).filter(n => n.length > 0);
        if (debtorNames.length < 2) {
            alertModal("กรุณาระบุชื่อคนที่ร่วมแชร์บิลอย่างน้อย 2 คน (ขึ้นบรรทัดใหม่ทีละคน)");
            return;
        }
    } else {
        const debtorName = document.getElementById('debtorName').value.trim();
        if (!debtorName) {
            alertModal("กรุณาระบุชื่อลูกหนี้");
            return;
        }
        debtorNames = [debtorName];
    }

    // Split the total evenly; the last person absorbs the rounding remainder
    // so the shares always sum back to exactly the entered total.
    const n = debtorNames.length;
    const baseShare = Math.floor((totalAmount / n) * 100) / 100;
    const shares = debtorNames.map(() => baseShare);
    shares[n - 1] = Math.round((totalAmount - baseShare * (n - 1)) * 100) / 100;

    // Cash Loan Wallet Selection (default to BANK wallet or the first wallet)
    const defaultWallet = state.wallets.find(w => w.type === 'BANK_ACCOUNT' || w.type === 'BANK') || state.wallets[0];
    const wId = debtType === 'CASH_LOAN' && defaultWallet ? defaultWallet.id : null;
    const cId = debtType === 'CREDIT_CARD_INSTALLMENT' ? debtCardId : null;

    try {
        for (let i = 0; i < debtorNames.length; i++) {
            const memo = splitMode ? `${baseMemo} (แชร์บิลร่วมกัน ${n} คน)` : baseMemo;
            await apiCreateDebt(
                null, // debtorId (null will prompt server to resolve debtorName)
                debtorNames[i],
                "",   // contactInfo
                debtType,
                cId,
                wId,
                shares[i],
                debtInstallments,
                debtDueDay,
                memo,
                debtDueDate,
                interestType,
                interestValue
            );
        }

        closeDebtModal();
        document.getElementById('debtForm').reset();
        switchMainTab('debtors');
        refreshAppUI();
        alertModal(splitMode ? `สร้างรายการลูกหนี้สำเร็จ ${n} คน!` : "สร้างรายการลูกหนี้สำเร็จ!");
    } catch (err) {
        alertModal(err.message);
    }
}

async function handleCCPaymentSubmit(e) {
    e.preventDefault();
    const cardId = document.getElementById('ccPaymentCardId').value;
    const amount = parseFloat(document.getElementById('ccPaymentAmount').value);
    const walletId = document.getElementById('ccPaymentWallet').value;

    if (!cardId || !walletId || isNaN(amount) || amount <= 0) {
        alertModal("กรุณากรอกข้อมูลและยอดชำระให้ถูกต้อง");
        return;
    }

    try {
        await apiPayCreditCard(cardId, walletId, amount);
        
        closeCreditCardPaymentModal();
        document.getElementById('ccPaymentForm').reset();
        switchMainTab('cards');
        refreshAppUI();
        alertModal("ชำระบัตรเครดิตสำเร็จ!");
    } catch (err) {
        alertModal(err.message);
    }
}

async function handleReceivePaybackSubmit(e) {
    e.preventDefault();
    const debtorId = document.getElementById('paybackDebtorId').value; // Wait! debtorId holds the debt id in our mapped structure
    const paybackAmount = parseFloat(document.getElementById('paybackAmount').value);
    const walletId = document.getElementById('paybackWallet').value;

    if (!debtorId || !walletId || isNaN(paybackAmount) || paybackAmount <= 0) {
        alertModal("กรุณากรอกข้อมูลให้ครบถ้วน");
        return;
    }

    try {
        await apiRepayDebt(debtorId, walletId, paybackAmount);
        
        closeReceivePaybackModal();
        switchMainTab('debtors');
        refreshAppUI();
        alertModal("รับชำระคืนหนี้เรียบร้อย!");
    } catch (err) {
        alertModal(err.message);
    }
}

async function handlePayRecurringSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('payRecurringId').value;
    const walletId = document.getElementById('payRecurringWallet').value;

    if (!id || !walletId) {
        alertModal("กรุณาเลือกบัญชีเงินชำระ");
        return;
    }

    try {
        await apiPayRecurring(id, walletId);
        
        closePayRecurringModal();
        switchMainTab('recurring');
        refreshAppUI();
        alertModal("ชำระค่าบริการรายเดือนสำเร็จ!");
    } catch (err) {
        alertModal(err.message);
    }
}

// ----------------------------------------------------
// WALLET CONFIG CRUD SUBMISSIONS
// ----------------------------------------------------
async function saveWalletSubmit() {
    const id = document.getElementById('editWalletId').value;
    const name = document.getElementById('setWalletName').value.trim();
    const type = document.getElementById('setWalletType').value;
    const balance = parseFloat(document.getElementById('setWalletBalance').value);
    
    if (!name || isNaN(balance)) {
        alertModal("กรุณากรอกข้อมูลให้ครบถ้วน");
        return;
    }
    
    try {
        if (id) {
            await apiUpdateWallet(id, name, type, balance);
            alertModal("แก้ไขบัญชีสำเร็จ!");
        } else {
            await apiCreateWallet(name, type, balance);
            alertModal("เพิ่มกระเป๋าเงินใหม่สำเร็จ!");
        }
        hideWalletForm();
        renderSettingsWallets();
        refreshAppUI();
    } catch (err) {
        alertModal(err.message);
    }
}

async function deleteWallet(walletId) {
    if (state.wallets.length <= 1) {
        alertModal("ไม่สามารถลบกระเป๋าเงินใบสุดท้ายได้! ระบบต้องการอย่างน้อย 1 ใบ");
        return;
    }
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบกระเป๋าเงินนี้?")) {
        try {
            await apiDeleteWallet(walletId);
            renderSettingsWallets();
            refreshAppUI();
            alertModal("ลบกระเป๋าเงินสำเร็จ");
        } catch (err) {
            alertModal(err.message);
        }
    }
}

// ----------------------------------------------------
// CREDIT CARD CONFIG CRUD SUBMISSIONS
// ----------------------------------------------------
async function saveCardSubmit() {
    const id = document.getElementById('editCardId').value;
    const name = document.getElementById('setCardName').value.trim();
    const limit = parseFloat(document.getElementById('setCardLimit').value);
    const balance = parseFloat(document.getElementById('setCardBalance').value);
    const billingDay = parseInt(document.getElementById('setCardBillingDay').value);
    const dueDay = parseInt(document.getElementById('setCardDueDay').value);
    
    if (!name || isNaN(limit) || isNaN(balance) || isNaN(billingDay) || isNaN(dueDay) || billingDay < 1 || billingDay > 31 || dueDay < 1 || dueDay > 31) {
        alertModal("กรุณากรอกข้อมูลให้ถูกต้อง (วันกำหนดชำระ/วันตัดรอบ ต้องอยู่ระหว่าง 1-31)");
        return;
    }
    
    try {
        if (id) {
            await apiUpdateCreditCard(id, name, billingDay, dueDay, limit, balance);
            alertModal("แก้ไขข้อมูลบัตรสำเร็จ!");
        } else {
            await apiCreateCreditCard(name, billingDay, dueDay, limit, balance);
            alertModal("เพิ่มบัตรเครดิตสำเร็จ!");
        }
        hideCardForm();
        renderSettingsCards();
        refreshAppUI();
    } catch (err) {
        alertModal(err.message);
    }
}

async function deleteCard(cardId) {
    if (confirm("คุณแน่ใจหรือไม่ว่าต้องการลบบัตรเครดิตนี้? การผูกหนี้สินกับบัตรนี้จะถูกยกเลิกด้วย")) {
        try {
            await apiDeleteCreditCard(cardId);
            renderSettingsCards();
            refreshAppUI();
            alertModal("ลบบัตรเครดิตสำเร็จ");
        } catch (err) {
            alertModal(err.message);
        }
    }
}

// ----------------------------------------------------
// SELECTS OPTIONS POPULATORS
// ----------------------------------------------------
// Populated from GET /api/categories by apiFetchAllData() — these used to be
// a hardcoded const, but categories are now per-user and editable/addable
// via Settings, so this is filled in at runtime instead. Shape per entry:
// { name, icon, color: 'bg-{family}-500', textColor: 'text-{family}-600', txType, id }
let CATEGORIES = {};

// Populated from GET /api/quick-templates by apiFetchAllData(), plus the
// permanent frontend-only "CUSTOM" sentinel entry. Shape per entry:
// { text, value, description, category } — value is the template id
// ('CUSTOM' for the sentinel), description is the text applyQuickDesc()
// fills into the form (distinct from value, unlike the old hardcoded array
// which overloaded value as both id and description).
let QUICK_TEMPLATES = [
    { text: '✍️ เขียนคำอธิบายเอง (Custom)', value: 'CUSTOM', description: '', category: '' }
];

// Category keys belonging to a given transaction direction, derived from
// CATEGORIES[key].txType (real per-user data) instead of a hardcoded list —
// used by the quick-select filter, the category dropdown, and budget settings.
function categoryKeysForType(txType) {
    return Object.keys(CATEGORIES).filter(k => CATEGORIES[k].txType === txType);
}

function populateTxQuickDescOptions() {
    const selectEl = document.getElementById('txQuickDesc');
    if (!selectEl) return;
    selectEl.innerHTML = '';

    const wantedType = state.currentTxType;

    const customOpt = document.createElement('option');
    customOpt.value = 'CUSTOM';
    customOpt.innerText = '✍️ เขียนคำอธิบายเอง (Custom)';
    selectEl.appendChild(customOpt);

    QUICK_TEMPLATES.forEach(t => {
        if (t.value === 'CUSTOM') return;
        const cat = CATEGORIES[t.category];
        if (cat && cat.txType === wantedType) {
            const opt = document.createElement('option');
            opt.value = t.value;
            opt.innerText = t.text;
            opt.dataset.category = t.category;
            selectEl.appendChild(opt);
        }
    });
}

function populateTxCategoryOptions() {
    const selectEl = document.getElementById('txCategory');
    if (!selectEl) return;
    selectEl.innerHTML = '';

    categoryKeysForType(state.currentTxType).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = CATEGORIES[k].name;
        selectEl.appendChild(opt);
    });
}

function applyQuickDesc() {
    const quickSelect = document.getElementById('txQuickDesc');
    const descInput = document.getElementById('txDesc');
    const catSelect = document.getElementById('txCategory');

    const selectedVal = quickSelect.value;
    if (selectedVal === 'CUSTOM') {
        descInput.value = '';
        descInput.focus();
    } else {
        const template = QUICK_TEMPLATES.find(t => t.value === selectedVal);
        if (template) {
            descInput.value = template.description;
            if (template.category) catSelect.value = template.category;
        }
    }
}

function setTxType(type) {
    state.currentTxType = type;
    const btnExpense = document.getElementById('txTypeExpense');
    const btnIncome = document.getElementById('txTypeIncome');
    
    if (type === 'EXPENSE') {
        btnExpense.className = "py-2 text-center text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnIncome.className = "py-2 text-center text-xs font-semibold rounded-lg text-slate-400 transition-all";
    } else {
        btnIncome.className = "py-2 text-center text-xs font-semibold rounded-lg bg-white text-slate-800 shadow-sm transition-all";
        btnExpense.className = "py-2 text-center text-xs font-semibold rounded-lg text-slate-400 transition-all";
    }
    
    populateTxQuickDescOptions();
    populateTxCategoryOptions();
    populateTxWalletOptions();
}

function populateTxWalletOptions() {
    const selectEl = document.getElementById('txWallet');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    const type = state.currentTxType;
    
    const walletGroup = document.createElement('optgroup');
    walletGroup.label = "บัญชี / กระเป๋าเงินสด";
    state.wallets.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.innerText = `${w.name} (คงเหลือ: ฿${w.balance.toLocaleString('th-TH')})`;
        walletGroup.appendChild(opt);
    });
    selectEl.appendChild(walletGroup);
    
    if (type === 'EXPENSE') {
        const cardGroup = document.createElement('optgroup');
        cardGroup.label = "บัตรเครดิต (เพิ่มยอดรูดค้างจ่าย)";
        state.creditCards.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.innerText = `${c.name} (วงเงินคงเหลือ: ฿${(c.limit - c.balance).toLocaleString('th-TH')})`;
            cardGroup.appendChild(opt);
        });
        selectEl.appendChild(cardGroup);
    }
}

function populateDebtCardOptions() {
    const selectEl = document.getElementById('debtCardId');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    state.creditCards.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = `${c.name} (ครบกำหนดจ่ายวันที่ ${c.dueDay})`;
        selectEl.appendChild(opt);
    });
}

function populateCCPaymentCardOptions() {
    const selectEl = document.getElementById('ccPaymentCardId');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    state.creditCards.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.innerText = `${c.name} (ค้างจ่ายบิล: ฿${c.balance.toLocaleString('th-TH')})`;
        selectEl.appendChild(opt);
    });
}

function populateCCPaymentWalletOptions() {
    const selectEl = document.getElementById('ccPaymentWallet');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    state.wallets.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.innerText = `${w.name} (คงเหลือ: ฿${w.balance.toLocaleString('th-TH')})`;
        selectEl.appendChild(opt);
    });
}

function populatePaybackWalletOptions() {
    const selectEl = document.getElementById('paybackWallet');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    
    state.wallets.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.innerText = `${w.name} (คงเหลือ: ฿${w.balance.toLocaleString('th-TH')})`;
        selectEl.appendChild(opt);
    });
}

// ----------------------------------------------------
// MOBILE NAVIGATION VIEW TAB CONTROLS
// ----------------------------------------------------
function switchMainTab(tabId) {
    state.activeTab = tabId;
    const tabs = ['home', 'debtors', 'cards', 'recurring', 'history'];
    
    tabs.forEach(t => {
        const el = document.getElementById(`view-${t}`);
        const btn = document.getElementById(`bottomTab-${t}`);
        
        if (t === tabId) {
            if (el) el.classList.remove('hidden');
            if (btn) btn.className = "flex flex-col items-center gap-1 text-emerald-600 bg-emerald-50 rounded-xl px-3 py-1.5 transition-all lg:flex-row lg:justify-start lg:gap-3 lg:w-full lg:px-3.5 lg:py-2.5";
        } else {
            if (el) el.classList.add('hidden');
            if (btn) btn.className = "flex flex-col items-center gap-1 text-slate-400 hover:text-emerald-500 rounded-xl px-3 py-1.5 transition-all lg:flex-row lg:justify-start lg:gap-3 lg:w-full lg:px-3.5 lg:py-2.5";
        }
    });
    
    calculateSummary();
    if (tabId === 'home') {
        renderDashboardWallets();
    }
    if (tabId === 'debtors') {
        renderDebtors();
    }
    if (tabId === 'cards') {
        renderCreditCards();
    }
    if (tabId === 'recurring') {
        renderRecurring();
    }
    if (tabId === 'history') {
        renderTransactions();
        renderMonthlyTrendChart();
    }
}

// ----------------------------------------------------
// MODALS CONTROLS & VIEWS
// ----------------------------------------------------
function openTransactionModal() {
    setTxType('EXPENSE');
    document.getElementById('transactionModal').classList.remove('hidden');
}

function closeTransactionModal() {
    document.getElementById('transactionModal').classList.add('hidden');
}

function openDebtModal() {
    populateDebtCardOptions();
    toggleDebtTypeInputs();
    document.getElementById('debtModal').classList.remove('hidden');
}

function populateDebtSubscriptionOptions() {
    const selectEl = document.getElementById('debtLinkedSubscriptionId');
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">-- ไม่ผูกบริการหลัก (ต้องกดขึ้นรอบใหม่เอง) --</option>';
    
    state.recurringPayments.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.innerText = `${r.name} (ค่าบริการหลัก: ฿${r.amount.toLocaleString('th-TH')})`;
        selectEl.appendChild(opt);
    });
}

function toggleDebtSplitMode() {
    const splitOn = document.getElementById('debtSplitMode').checked;
    document.getElementById('debtSingleNameWrapper').classList.toggle('hidden', splitOn);
    document.getElementById('debtSplitNamesWrapper').classList.toggle('hidden', !splitOn);

    if (splitOn) {
        const debtAmountLabel = document.getElementById('debtAmountLabel');
        if (debtAmountLabel) debtAmountLabel.innerText = "ยอดรวมทั้งหมด (จะหารเท่าๆ กันอัตโนมัติ)";
    } else {
        toggleDebtTypeInputs(); // restore the label appropriate for the current debt type
    }
}

function toggleDebtInterestValue() {
    const type = document.getElementById('debtInterestType').value;
    const input = document.getElementById('debtInterestValue');
    input.disabled = !type;
    input.classList.toggle('opacity-50', !type);
    if (!type) input.value = '';
}

function toggleEditDebtInterestValue() {
    const type = document.getElementById('editDebtInterestType').value;
    const input = document.getElementById('editDebtInterestValue');
    input.disabled = !type;
    input.classList.toggle('opacity-50', !type);
}

function toggleDebtTypeInputs() {
    const debtType = document.getElementById('debtType').value;
    const creditCardSelectWrapper = document.getElementById('creditCardSelectWrapper');
    const subscriptionSelectWrapper = document.getElementById('subscriptionSelectWrapper');
    const debtInstallments = document.getElementById('debtInstallments');
    const installmentLabel = document.getElementById('installmentLabel');
    const debtAmountLabel = document.getElementById('debtAmountLabel');
    const debtAmount = document.getElementById('debtAmount');

    // CASH_LOAN is a one-off payback (not a monthly billing cycle), so it
    // gets a real calendar date instead of a recurring "day of month".
    const usesDueDate = debtType === 'CASH_LOAN';
    document.getElementById('debtDueDayWrapper').classList.toggle('hidden', usesDueDate);
    document.getElementById('debtDueDateWrapper').classList.toggle('hidden', !usesDueDate);
    if (usesDueDate && !document.getElementById('debtDueDate').value) {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        document.getElementById('debtDueDate').value = d.toISOString().slice(0, 10);
    }

    if (debtType === 'CREDIT_CARD_INSTALLMENT') {
        creditCardSelectWrapper.classList.remove('hidden');
        if (subscriptionSelectWrapper) subscriptionSelectWrapper.classList.add('hidden');
        debtInstallments.disabled = false;
        debtInstallments.parentElement.classList.remove('opacity-50');
        installmentLabel.innerText = "จำนวนงวดที่ผ่อนชำระ";
        if (debtAmountLabel) debtAmountLabel.innerText = "จำนวนเงินต้นทั้งหมด";
        debtAmount.placeholder = "0.00";
    } else if (debtType === 'INSTALLMENT') {
        creditCardSelectWrapper.classList.add('hidden');
        if (subscriptionSelectWrapper) subscriptionSelectWrapper.classList.add('hidden');
        debtInstallments.disabled = false;
        debtInstallments.parentElement.classList.remove('opacity-50');
        installmentLabel.innerText = "จำนวนงวดที่ผ่อนชำระ";
        if (debtAmountLabel) debtAmountLabel.innerText = "จำนวนเงินต้นทั้งหมด";
        debtAmount.placeholder = "0.00";
    } else if (debtType === 'SHARED_SUBSCRIPTION') {
        creditCardSelectWrapper.classList.add('hidden');
        if (subscriptionSelectWrapper) {
            subscriptionSelectWrapper.classList.remove('hidden');
            populateDebtSubscriptionOptions();
        }
        debtInstallments.disabled = false;
        debtInstallments.parentElement.classList.remove('opacity-50');
        installmentLabel.innerText = "จำนวนเดือนที่แชร์ (ระบุ 999 หากไม่มีกำหนด)";
        if (debtInstallments.value == "1" || debtInstallments.value == "") {
            debtInstallments.value = 999;
        }
        if (debtAmountLabel) debtAmountLabel.innerText = "ค่าบริการส่วนที่แชร์เก็บคืนต่อเดือน (บาท)";
        debtAmount.placeholder = "เช่น 100.00";
    } else { // CASH_LOAN
        creditCardSelectWrapper.classList.add('hidden');
        if (subscriptionSelectWrapper) subscriptionSelectWrapper.classList.add('hidden');
        debtInstallments.value = 1;
        debtInstallments.disabled = true;
        debtInstallments.parentElement.classList.add('opacity-50');
        installmentLabel.innerText = "จำนวนงวดชำระ (ยืมเงินสดทั่วไป = 1)";
        if (debtAmountLabel) debtAmountLabel.innerText = "จำนวนเงินต้นทั้งหมด";
        debtAmount.placeholder = "0.00";
    }
}

function closeDebtModal() {
    document.getElementById('debtModal').classList.add('hidden');
    document.getElementById('debtSplitMode').checked = false;
    toggleDebtSplitMode();
}

// ----------------------------------------------------
// EDIT / RESCHEDULE DEBT + HISTORY
// ----------------------------------------------------
async function openEditDebtModal(debtId) {
    const debtor = state.debtors.find(d => d.id === debtId);
    if (!debtor) return;

    document.getElementById('editDebtId').value = debtId;
    document.getElementById('editDebtDueDay').value = debtor.dueDay;
    document.getElementById('editDebtDueDate').value = debtor.dueDate || '';
    document.getElementById('editDebtInterestType').value = debtor.interestType || '';
    document.getElementById('editDebtInterestValue').value = debtor.interestValue ?? '';
    document.getElementById('editDebtMemo').value = debtor.memo || '';
    toggleEditDebtInterestValue();

    // A debt already using a specific due_date keeps rescheduling by date;
    // otherwise it keeps the recurring day-of-month field.
    document.getElementById('editDebtDueDayWrapper').classList.toggle('hidden', !!debtor.dueDate);
    document.getElementById('editDebtDueDateWrapper').classList.toggle('hidden', !debtor.dueDate);

    const historyEl = document.getElementById('editDebtHistoryList');
    historyEl.innerHTML = '<p class="text-slate-400 text-center py-2">กำลังโหลดประวัติ...</p>';
    document.getElementById('editDebtModal').classList.remove('hidden');

    try {
        const history = await apiFetchDebtHistory(debtId);
        if (history.length === 0) {
            historyEl.innerHTML = '<p class="text-slate-400 text-center py-2">ยังไม่มีประวัติการแก้ไข</p>';
        } else {
            historyEl.innerHTML = history.map(h => `
                <div class="bg-slate-50 rounded-lg p-2 border border-slate-200/70">
                    <p class="text-slate-700">${h.summary}</p>
                    <span class="text-[11px] text-slate-400">${formatThaiDateOnly(h.changed_at)}</span>
                </div>
            `).join('');
        }
    } catch (err) {
        historyEl.innerHTML = '<p class="text-slate-400 text-center py-2">ไม่สามารถโหลดประวัติได้ (อาจอยู่ในโหมดออฟไลน์)</p>';
    }
}

function closeEditDebtModal() {
    document.getElementById('editDebtModal').classList.add('hidden');
}

async function handleEditDebtSubmit(e) {
    e.preventDefault();
    const debtId = document.getElementById('editDebtId').value;
    const usesDueDate = !document.getElementById('editDebtDueDateWrapper').classList.contains('hidden');
    const interestType = document.getElementById('editDebtInterestType').value || null;
    const interestValue = interestType ? parseFloat(document.getElementById('editDebtInterestValue').value) : null;

    if (interestType && (isNaN(interestValue) || interestValue < 0)) {
        alertModal("กรุณาระบุจำนวนดอกเบี้ยให้ถูกต้อง");
        return;
    }

    try {
        await apiUpdateDebt(debtId, {
            dueDay: usesDueDate ? undefined : parseInt(document.getElementById('editDebtDueDay').value),
            dueDate: usesDueDate ? document.getElementById('editDebtDueDate').value : undefined,
            interestType,
            interestValue,
            memo: document.getElementById('editDebtMemo').value.trim()
        });
        closeEditDebtModal();
        refreshAppUI();
        alertModal("บันทึกการแก้ไขสำเร็จ!");
    } catch (err) {
        alertModal(err.message);
    }
}

// DYNAMIC DETAILS POPUP
function closeItemDetailModal() {
    document.getElementById('itemDetailModal').classList.add('hidden');
    document.getElementById('detailDeleteBtn').classList.add('hidden');
    document.getElementById('detailActionBtn').classList.add('hidden');
    document.getElementById('detailDebtorActionsRow').classList.add('hidden');
}

function showTransactionDetail(txId) {
    const tx = state.transactions.find(t => t.id === txId);
    if (!tx) return;
    
    document.getElementById('detailModalTitle').innerText = "รายละเอียดธุรกรรม";
    
    const isExpense = tx.type === "EXPENSE";
    const typeStr = isExpense ? "รายจ่าย (-)" : "รายรับ (+)";
    const typeColor = isExpense ? "text-rose-500" : "text-emerald-500";
    
    let sourceName = 'ไม่ระบุ';
    const wallet = state.wallets.find(w => w.id === tx.walletId);
    const card = state.creditCards.find(c => c.id === tx.walletId);
    if (wallet) sourceName = wallet.name;
    else if (card) sourceName = `${card.name} (บัตรเครดิต)`;
    else if (tx.walletId === "บัตรเครดิต") sourceName = "บัตรเครดิต";
    
    const cat = CATEGORIES[tx.category];
    const catName = cat ? cat.name : 'ไม่ระบุ';
    
    const contentHTML = `
        <div class="space-y-3">
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/70 text-center">
                <span class="text-[11px] text-slate-400 block uppercase font-semibold">จำนวนเงิน</span>
                <span class="text-2xl font-bold ${typeColor}">${isExpense ? '-' : '+'}฿${tx.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-y-3 gap-x-2 border-t border-slate-200/70 pt-3">
                <div>
                    <span class="text-slate-400 block">ประเภทรายการ:</span>
                    <span class="font-bold text-slate-700 ${typeColor}">${typeStr}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">หมวดหมู่:</span>
                    <span class="font-bold text-slate-700">${catName}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">วันเวลาทำรายการ:</span>
                    <span class="font-bold text-slate-700">${tx.date}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">บัญชี/ช่องทาง:</span>
                    <span class="font-bold text-slate-700">${sourceName}</span>
                </div>
                <div class="col-span-2">
                    <span class="text-slate-400 block">คำอธิบาย:</span>
                    <span class="font-bold text-slate-700 text-sm">${tx.desc}</span>
                </div>
                <div class="col-span-2">
                    <span class="text-slate-400 block">รหัสอ้างอิง:</span>
                    <span class="font-mono text-slate-400 text-[11px]">${tx.id}</span>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('detailModalContent').innerHTML = contentHTML;
    
    const deleteBtn = document.getElementById('detailDeleteBtn');
    deleteBtn.classList.remove('hidden');
    deleteBtn.onclick = async function() {
        if (confirm("คุณต้องการลบบันทึกธุรกรรมนี้ใช่หรือไม่? (การลบประวัติจะไม่ย้อนกระแสเงินสดในกระเป๋า)")) {
            try {
                await apiDeleteTransaction(txId);
                closeItemDetailModal();
                refreshAppUI();
                alertModal("ลบรายการประวัติสำเร็จ!");
            } catch (err) {
                alertModal(err.message);
            }
        }
    };
    
    document.getElementById('itemDetailModal').classList.remove('hidden');
}

function showDebtorDetail(debtorId) {
    const debtor = state.debtors.find(d => d.id === debtorId);
    if (!debtor) return;
    
    document.getElementById('detailModalTitle').innerText = "รายละเอียดลูกหนี้";
    
    const nextPaybackVal = getNextPaybackVal(debtor);
    const paidAmount = debtor.totalAmount - debtor.remainingAmount;
    const paidInstallments = debtor.totalInstallments - debtor.remainingInstallments;
    
    let cardName = 'ไม่ระบุ/หนี้เงินสด';
    if (debtor.cardId) {
        const card = state.creditCards.find(c => c.id === debtor.cardId);
        if (card) cardName = card.name;
    }
    
    let typeText = 'ยืมเงินสดก้อนเดียว';
    if (debtor.type === 'CREDIT_CARD_INSTALLMENT') {
        typeText = 'ผ่อนร่วมบัตรเครดิต';
    } else if (debtor.type === 'INSTALLMENT') {
        typeText = 'ผ่อนรายเดือน';
    } else if (debtor.type === 'SHARED_SUBSCRIPTION') {
        typeText = 'แชร์ค่าบริการรายเดือน';
    }

    let amountLabel = 'ยอดหนี้ค้างชำระทั้งหมด';
    let amountSubLabel = `เงินต้นรวม: ฿${debtor.totalAmount.toLocaleString('th-TH')}`;
    if (debtor.type === 'SHARED_SUBSCRIPTION') {
        amountLabel = 'ยอดแชร์ค้างชำระรอบนี้';
        amountSubLabel = `ค่าบริการแชร์รายเดือน: ฿${debtor.totalAmount.toLocaleString('th-TH')}`;
    }

    let installmentsText = `${paidInstallments} / ${debtor.totalInstallments} งวด`;
    if (debtor.type === 'SHARED_SUBSCRIPTION') {
        if (debtor.totalInstallments === 999) {
            installmentsText = 'แชร์ต่อเนื่อง (ไม่มีกำหนด)';
        } else {
            installmentsText = `${paidInstallments} / ${debtor.totalInstallments} เดือน`;
        }
    }

    let extraInfoHTML = '';
    if (debtor.type === 'SHARED_SUBSCRIPTION') {
        let subName = 'ไม่ได้ผูกบริการหลัก';
        if (debtor.linkedSubscriptionId) {
            const sub = state.recurringPayments.find(r => r.id === debtor.linkedSubscriptionId);
            if (sub) subName = sub.name;
        }
        extraInfoHTML = `
            <div>
                <span class="text-slate-400 block">บริการรายเดือนหลัก:</span>
                <span class="font-bold text-slate-700">${subName}</span>
            </div>
        `;
    }

    const contentHTML = `
        <div class="space-y-3">
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/70 text-center">
                <span class="text-[11px] text-slate-400 block uppercase font-semibold">${amountLabel}</span>
                <span class="text-2xl font-bold text-rose-500">฿${debtor.remainingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                <span class="text-[11px] text-slate-400 block mt-0.5">${amountSubLabel}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-y-3 gap-x-2 border-t border-slate-200/70 pt-3">
                <div>
                    <span class="text-slate-400 block">ชื่อลูกหนี้/เพื่อน:</span>
                    <span class="font-bold text-slate-800">${debtor.name}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">ประเภทหนี้:</span>
                    <span class="font-bold text-slate-700">${typeText}</span>
                </div>
                <div class="col-span-2">
                    <span class="text-slate-400 block">บันทึกเพิ่มเติม:</span>
                    <span class="font-bold text-slate-700 text-sm">${debtor.memo}</span>
                </div>
                ${debtor.type === 'SHARED_SUBSCRIPTION' ? extraInfoHTML : `
                <div>
                    <span class="text-slate-400 block">ผูกกับบัตรเครดิต:</span>
                    <span class="font-bold text-slate-700">${cardName}</span>
                </div>
                `}
                <div>
                    <span class="text-slate-400 block">กำหนดชำระคืน:</span>
                    <span class="font-bold text-slate-700">${debtor.dueDate ? formatThaiDateOnly(debtor.dueDate) : `วันที่ ${debtor.dueDay} ของทุกเดือน`}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">ดอกเบี้ย:</span>
                    <span class="font-bold text-slate-700">${debtor.interestType ? `${debtor.interestValue}${debtor.interestType === 'PERCENT' ? '%' : ' บาท'}` : 'ไม่กำหนด'}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">จำนวนงวดที่คืนแล้ว:</span>
                    <span class="font-bold text-slate-700">${installmentsText}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">ยอดคืนงวดถัดไป:</span>
                    <span class="font-bold text-emerald-600">฿${nextPaybackVal.toLocaleString('th-TH')}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">จำนวนหนี้ที่ได้รับคืนแล้ว:</span>
                    <span class="font-bold text-emerald-600">฿${paidAmount.toLocaleString('th-TH')}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">รหัสอ้างอิง:</span>
                    <span class="font-mono text-slate-400 text-[11px]">${debtor.id}</span>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('detailModalContent').innerHTML = contentHTML;

    document.getElementById('detailDebtorActionsRow').classList.remove('hidden');
    document.getElementById('detailEditDebtBtn').onclick = function() {
        closeItemDetailModal();
        openEditDebtModal(debtorId);
    };
    document.getElementById('detailShareSlipBtn').onclick = function() {
        closeItemDetailModal();
        openShareSlip(debtorId);
    };
    document.getElementById('detailReceivePaybackBtn').onclick = function() {
        closeItemDetailModal();
        openReceivePaybackModal(debtorId);
    };

    const deleteBtn = document.getElementById('detailDeleteBtn');
    deleteBtn.classList.remove('hidden');
    deleteBtn.onclick = async function() {
        if (confirm(`คุณต้องการลบรายการลูกหนี้ของ ${debtor.name} หรือไม่? (ยอดเงินจะไม่ถูกหักคืนย้อนหลัง)`)) {
            try {
                await apiDeleteDebt(debtorId);
                closeItemDetailModal();
                refreshAppUI();
                alertModal("ลบข้อมูลลูกหนี้สำเร็จ!");
            } catch (err) {
                alertModal(err.message);
            }
        }
    };

    const actionBtn = document.getElementById('detailActionBtn');
    if (debtor.type === 'SHARED_SUBSCRIPTION') {
        actionBtn.classList.remove('hidden');
        actionBtn.innerHTML = `<i class="fa-solid fa-arrows-rotate mr-1"></i> เริ่มรอบบิลใหม่`;
        actionBtn.onclick = async function() {
            if (confirm(`คุณต้องการตั้งค่าเริ่มรอบเรียกเก็บเงินรอบถัดไปสำหรับ ${debtor.name} หรือไม่?`)) {
                try {
                    await apiResetDebtCycle(debtorId);
                    showDebtorDetail(debtorId);
                    refreshAppUI();
                    alertModal("เริ่มรอบเรียกเก็บเงินรอบใหม่สำเร็จ!");
                } catch (err) {
                    alertModal(err.message);
                }
            }
        };
    } else {
        actionBtn.classList.add('hidden');
    }
    
    document.getElementById('itemDetailModal').classList.remove('hidden');
}

function showCardDetail(cardId) {
    const card = state.creditCards.find(c => c.id === cardId);
    if (!card) return;
    
    document.getElementById('detailModalTitle').innerText = "รายละเอียดบัตรเครดิต";
    
    const availableLimit = card.limit - card.balance;
    const linkedDebtors = state.debtors.filter(d => d.cardId === cardId && d.status !== "PAID" && d.remainingAmount > 0);
    
    let linkedHTML = '';
    if (linkedDebtors.length > 0) {
        linkedDebtors.forEach(d => {
            linkedHTML += `
                <div class="flex justify-between items-center py-1 border-b border-slate-200/70 last:border-0 text-xs">
                    <span class="text-slate-600 font-semibold">${d.name}</span>
                    <span class="text-slate-500 font-light truncate max-w-[150px]">(${d.memo})</span>
                    <span class="font-bold text-rose-500">฿${d.remainingAmount.toLocaleString('th-TH')}</span>
                </div>
            `;
        });
    } else {
        linkedHTML = `<span class="text-slate-400 text-xs block italic text-center py-1">ไม่มีหนี้เพื่อนผ่อนร่วมบนบัตรใบนี้</span>`;
    }
    
    const contentHTML = `
        <div class="space-y-3">
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/70 text-center">
                <span class="text-[11px] text-slate-400 block uppercase font-semibold">ยอดหนี้รูดค้างชำระปัจจุบัน</span>
                <span class="text-2xl font-bold text-slate-800">฿${card.balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                <span class="text-[11px] text-slate-400 block mt-0.5">วงเงินเต็มทั้งหมด: ฿${card.limit.toLocaleString('th-TH')}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-y-3 gap-x-2 border-t border-slate-200/70 pt-3">
                <div>
                    <span class="text-slate-400 block">ชื่อบัตรเครดิต:</span>
                    <span class="font-bold text-slate-800">${card.name}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">วงเงินคงเหลือว่างใช้:</span>
                    <span class="font-bold text-emerald-600">฿${availableLimit.toLocaleString('th-TH')}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">วันตัดรอบบิลสรุปยอด:</span>
                    <span class="font-bold text-slate-700">วันที่ ${card.billingDay} ของทุกเดือน</span>
                </div>
                <div>
                    <span class="text-slate-400 block">วันครบกำหนดชำระจริง:</span>
                    <span class="font-bold text-slate-700">วันที่ ${card.dueDay} ของทุกเดือน</span>
                </div>
            </div>
            
            <div class="border-t border-slate-200/70 pt-3 space-y-1.5">
                <span class="text-slate-400 block font-semibold text-[11px] uppercase">รายการเพื่อนผ่อนร่วมบัตรเครดิตใบนี้:</span>
                <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200/70">
                    ${linkedHTML}
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('detailModalContent').innerHTML = contentHTML;
    document.getElementById('detailDeleteBtn').classList.add('hidden'); // Card deletion in settings
    document.getElementById('itemDetailModal').classList.remove('hidden');
}

function showRecurringDetail(recId) {
    const rec = state.recurringPayments.find(r => r.id === recId);
    if (!rec) return;
    
    document.getElementById('detailModalTitle').innerText = "รายละเอียดบริการรายประจำ";
    
    const contentHTML = `
        <div class="space-y-3">
            <div class="bg-slate-50 p-4 rounded-xl border border-slate-200/70 text-center">
                <span class="text-[11px] text-slate-400 block uppercase font-semibold">ค่าบริการรายเดือน</span>
                <span class="text-2xl font-bold text-amber-500">฿${rec.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
            </div>
            
            <div class="grid grid-cols-2 gap-y-3 gap-x-2 border-t border-slate-200/70 pt-3">
                <div class="col-span-2">
                    <span class="text-slate-400 block">ชื่อบริการ / รายจ่าย:</span>
                    <span class="font-bold text-slate-800 text-sm">${rec.name}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">กำหนดจ่ายของทุกเดือน:</span>
                    <span class="font-bold text-slate-700">วันที่ ${rec.dueDay}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">สถานะชำระรอบนี้:</span>
                    <span class="font-bold ${rec.status === 'PAID' ? 'text-emerald-500' : 'text-amber-500'}">${rec.status === 'PAID' ? 'จ่ายแล้ว' : 'ค้างชำระ/รอหัก'}</span>
                </div>
                <div>
                    <span class="text-slate-400 block">รหัสอ้างอิง:</span>
                    <span class="font-mono text-slate-400 text-[11px]">${rec.id}</span>
                </div>
            </div>
        </div>
    `;
    
    document.getElementById('detailModalContent').innerHTML = contentHTML;
    
    const deleteBtn = document.getElementById('detailDeleteBtn');
    deleteBtn.classList.remove('hidden');
    deleteBtn.onclick = async function() {
        if (confirm(`คุณต้องการลบรายการจ่ายประจำรายเดือน ${rec.name} ออกใช่หรือไม่?`)) {
            try {
                await apiDeleteRecurring(recId);
                closeItemDetailModal();
                refreshAppUI();
                alertModal("ลบรายการจ่ายประจำสำเร็จ!");
            } catch (err) {
                alertModal(err.message);
            }
        }
    };
    
    document.getElementById('itemDetailModal').classList.remove('hidden');
}

function toggleInfoModal() {
    const dialog = document.getElementById('infoModal');
    if (dialog) {
        if (dialog.classList.contains('hidden')) {
            dialog.classList.remove('hidden');
        } else {
            dialog.classList.add('hidden');
        }
    }
}

function openCreditCardPaymentModal() {
    if (state.creditCards.length === 0) {
        alertModal("ไม่มีบัตรเครดิตที่ต้องชำระในขณะนี้!");
        return;
    }
    populateCCPaymentCardOptions();
    populateCCPaymentWalletOptions();
    updateCCPaymentMax();
    document.getElementById('creditCardPaymentModal').classList.remove('hidden');
}

function closeCreditCardPaymentModal() {
    document.getElementById('creditCardPaymentModal').classList.add('hidden');
}

function updateCCPaymentMax() {
    const cardId = document.getElementById('ccPaymentCardId').value;
    const card = state.creditCards.find(c => c.id === cardId);
    if (card) {
        document.getElementById('ccPaymentAmount').value = card.balance;
    }
}

function fillCCMaxAmount() {
    updateCCPaymentMax();
}

function openReceivePaybackModal(debtorId) {
    const debtor = state.debtors.find(d => d.id === debtorId);
    if (!debtor) return;
    
    const nextPaybackVal = getNextPaybackVal(debtor);
    
    document.getElementById('paybackDebtorId').value = debtor.id;
    document.getElementById('paybackDebtorName').innerText = debtor.name;
    document.getElementById('paybackTotalOwed').innerText = `฿${debtor.remainingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    document.getElementById('paybackInstallmentsLeft').innerText = `${debtor.remainingInstallments} งวด`;
    document.getElementById('paybackAmount').value = nextPaybackVal;
    
    populatePaybackWalletOptions();
    document.getElementById('receivePaybackModal').classList.remove('hidden');
}

function closeReceivePaybackModal() {
    document.getElementById('receivePaybackModal').classList.add('hidden');
}

function openPayRecurringModal(recurringId) {
    const rec = state.recurringPayments.find(r => r.id === recurringId);
    if (!rec) return;
    
    document.getElementById('payRecurringId').value = rec.id;
    document.getElementById('payRecurringName').innerText = rec.name;
    document.getElementById('payRecurringAmount').innerText = `฿${rec.amount.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    
    const selectEl = document.getElementById('payRecurringWallet');
    selectEl.innerHTML = '';
    state.wallets.forEach(w => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.innerText = `${w.name} (คงเหลือ: ฿${w.balance.toLocaleString('th-TH')})`;
        selectEl.appendChild(opt);
    });
    
    document.getElementById('payRecurringModal').classList.remove('hidden');
}

function closePayRecurringModal() {
    document.getElementById('payRecurringModal').classList.add('hidden');
}

// Settings CRUD Forms toggles
function showAddWalletForm() {
    document.getElementById('walletFormWrapper').classList.remove('hidden');
    document.getElementById('walletFormTitle').innerText = "เพิ่มกระเป๋าเงินใหม่";
    document.getElementById('editWalletId').value = "";
    document.getElementById('setWalletName').value = "";
    document.getElementById('setWalletType').value = "CASH";
    document.getElementById('setWalletBalance').value = "";
}

function hideWalletForm() {
    document.getElementById('walletFormWrapper').classList.add('hidden');
}

function editWallet(walletId) {
    const w = state.wallets.find(item => item.id === walletId);
    if (!w) return;
    document.getElementById('walletFormWrapper').classList.remove('hidden');
    document.getElementById('walletFormTitle').innerText = `แก้ไขกระเป๋าเงิน: ${w.name}`;
    document.getElementById('editWalletId').value = w.id;
    document.getElementById('setWalletName').value = w.name;
    document.getElementById('setWalletType').value = w.type;
    document.getElementById('setWalletBalance').value = w.balance;
}

function showAddCardForm() {
    document.getElementById('cardFormWrapper').classList.remove('hidden');
    document.getElementById('cardFormTitle').innerText = "เพิ่มบัตรเครดิตใหม่";
    document.getElementById('editCardId').value = "";
    document.getElementById('setCardName').value = "";
    document.getElementById('setCardLimit').value = "";
    document.getElementById('setCardBalance').value = "0.00";
    document.getElementById('setCardBillingDay').value = "10";
    document.getElementById('setCardDueDay').value = "25";
}

function hideCardForm() {
    document.getElementById('cardFormWrapper').classList.add('hidden');
}

function editCard(cardId) {
    const c = state.creditCards.find(item => item.id === cardId);
    if (!c) return;
    document.getElementById('cardFormWrapper').classList.remove('hidden');
    document.getElementById('cardFormTitle').innerText = `แก้ไขบัตรเครดิต: ${c.name}`;
    document.getElementById('editCardId').value = c.id;
    document.getElementById('setCardName').value = c.name;
    document.getElementById('setCardLimit').value = c.limit;
    document.getElementById('setCardBalance').value = c.balance;
    document.getElementById('setCardBillingDay').value = c.billingDay;
    document.getElementById('setCardDueDay').value = c.dueDay;
}

// settings tabs
let activeSettingsTab = 'wallets';
function switchTabGroup(tabs, tabId) {
    tabs.forEach(t => {
        const el = document.getElementById(`setTab-${t}`);
        const btn = document.getElementById(`setTabBtn-${t}`);
        if (el) {
            if (t === tabId) {
                el.classList.remove('hidden');
                btn.className = "shrink-0 md:shrink md:w-full flex items-center justify-center md:justify-start gap-2 px-3.5 py-2 md:py-2.5 text-center md:text-left font-semibold rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 whitespace-nowrap transition-colors";
            } else {
                el.classList.add('hidden');
                btn.className = "shrink-0 md:shrink md:w-full flex items-center justify-center md:justify-start gap-2 px-3.5 py-2 md:py-2.5 text-center md:text-left font-semibold rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 whitespace-nowrap transition-colors";
            }
        }
    });
}

function switchSettingsTab(tabId) {
    activeSettingsTab = tabId;
    switchTabGroup(['wallets', 'cards', 'budgets', 'categories'], tabId);

    if (tabId === 'wallets') {
        renderSettingsWallets();
        populateWalletPromptPayFields();
    }
    if (tabId === 'cards') renderSettingsCards();
    if (tabId === 'budgets') renderSettingsBudgets();
    if (tabId === 'categories') {
        renderSettingsCategories();
        renderSettingsQuickTemplates();
    }
}

function switchAccountTab(tabId) {
    switchTabGroup(['system', 'profile'], tabId);
    if (tabId === 'system') syncFontSizeButtons();
    if (tabId === 'profile') populateUserProfileFields();
}

function openAccountModal() {
    switchAccountTab('profile');
    document.getElementById('accountModal').classList.remove('hidden');
}

function closeAccountModal() {
    document.getElementById('accountModal').classList.add('hidden');
}

function renderSettingsBudgets() {
    const listContainer = document.getElementById('settingsBudgetList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    // Expense categories only — budgets don't make sense for income categories.
    categoryKeysForType('EXPENSE').forEach(catKey => {
        const cat = CATEGORIES[catKey];
        const budget = state.budgets.find(b => b.category === catKey);
        const spent = budget ? budget.spentThisMonth : 0;
        const overBudget = budget && spent > budget.monthlyLimit;

        const itemHTML = `
            <div class="flex items-center justify-between gap-2 p-3 bg-white border border-slate-200/70 rounded-xl text-xs">
                <div class="flex-1 min-w-0">
                    <span class="font-bold text-slate-800"><i class="fa-solid ${cat.icon} mr-1 text-[11px] text-slate-400"></i> ${cat.name}</span>
                    ${budget ? `<span class="text-[11px] ${overBudget ? 'text-rose-500 font-semibold' : 'text-slate-400'} block mt-0.5">ใช้ไปแล้ว ฿${spent.toLocaleString('th-TH', { minimumFractionDigits: 2 })} / ฿${budget.monthlyLimit.toLocaleString('th-TH')}${overBudget ? ' (เกินงบ!)' : ''}</span>` : `<span class="text-[11px] text-slate-400 block mt-0.5">ยังไม่ได้ตั้งงบ</span>`}
                </div>
                <div class="flex items-center gap-1 shrink-0">
                    <input type="number" step="0.01" min="0" placeholder="งบ/เดือน" value="${budget ? budget.monthlyLimit : ''}" id="budgetInput-${catKey}" class="w-20 px-2 py-1.5 rounded-lg border border-slate-200 text-xs">
                    <button onclick="saveBudgetSubmit('${catKey}')" class="w-7 h-7 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-600 flex items-center justify-center transition-colors" title="บันทึก"><i class="fa-solid fa-check"></i></button>
                    ${budget ? `<button onclick="deleteBudgetSubmit('${budget.id}')" class="w-7 h-7 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors" title="ลบงบ"><i class="fa-solid fa-trash"></i></button>` : ''}
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });
}

async function saveBudgetSubmit(category) {
    const input = document.getElementById(`budgetInput-${category}`);
    const value = parseFloat(input.value);
    if (isNaN(value) || value <= 0) {
        alertModal("กรุณาระบุจำนวนเงินงบประมาณให้ถูกต้อง");
        return;
    }
    try {
        await apiSaveBudget(category, value);
        renderSettingsBudgets();
        renderCategorySummary();
    } catch (err) {
        alertModal(err.message);
    }
}

async function deleteBudgetSubmit(budgetId) {
    try {
        await apiDeleteBudget(budgetId);
        renderSettingsBudgets();
        renderCategorySummary();
    } catch (err) {
        alertModal(err.message);
    }
}

// ----------------------------------------------------
// CATEGORY SETTINGS (add/edit/delete)
// ----------------------------------------------------
function updateCategoryPreview() {
    const icon = document.getElementById('setCategoryIcon').value;
    const color = document.getElementById('setCategoryColor').value;
    const preview = document.getElementById('categoryPreviewIcon');
    preview.className = `w-7 h-7 rounded-lg flex items-center justify-center bg-${color}-500/10 text-${color}-600`;
    preview.innerHTML = `<i class="fa-solid ${icon} text-xs"></i>`;
}

function showAddCategoryForm() {
    document.getElementById('categoryFormWrapper').classList.remove('hidden');
    document.getElementById('categoryFormTitle').innerText = "เพิ่มหมวดหมู่ใหม่";
    document.getElementById('editCategoryId').value = "";
    document.getElementById('setCategoryName').value = "";
    document.getElementById('setCategoryType').value = "EXPENSE";
    document.getElementById('setCategoryIcon').value = "fa-tag";
    document.getElementById('setCategoryColor').value = "emerald";
    updateCategoryPreview();
}

function hideCategoryForm() {
    document.getElementById('categoryFormWrapper').classList.add('hidden');
}

function editCategory(catKey) {
    const cat = CATEGORIES[catKey];
    if (!cat) return;
    document.getElementById('categoryFormWrapper').classList.remove('hidden');
    document.getElementById('categoryFormTitle').innerText = `แก้ไขหมวดหมู่: ${cat.name}`;
    document.getElementById('editCategoryId').value = cat.id;
    document.getElementById('setCategoryName').value = cat.name;
    document.getElementById('setCategoryType').value = cat.txType;
    document.getElementById('setCategoryIcon').value = cat.icon;
    // cat.color is stored as "bg-{family}-500" — pull the family name back out.
    document.getElementById('setCategoryColor').value = cat.color.replace('bg-', '').replace('-500', '');
    updateCategoryPreview();
}

async function saveCategorySubmit() {
    const id = document.getElementById('editCategoryId').value;
    const name = document.getElementById('setCategoryName').value.trim();
    const txType = document.getElementById('setCategoryType').value;
    const icon = document.getElementById('setCategoryIcon').value;
    const color = document.getElementById('setCategoryColor').value;

    if (!name) {
        alertModal("กรุณาระบุชื่อหมวดหมู่");
        return;
    }

    try {
        if (id) {
            await apiUpdateCategory(id, name, txType, icon, color);
            alertModal("แก้ไขหมวดหมู่สำเร็จ!");
        } else {
            await apiCreateCategory(name, txType, icon, color);
            alertModal("เพิ่มหมวดหมู่ใหม่สำเร็จ!");
        }
        hideCategoryForm();
        renderSettingsCategories();
        renderSettingsQuickTemplates();
        refreshAppUI();
    } catch (err) {
        alertModal(err.message);
    }
}

async function deleteCategorySubmit(catKey) {
    const cat = CATEGORIES[catKey];
    if (!cat) return;
    if (confirm(`ลบหมวดหมู่ "${cat.name}"? รายการที่บันทึกไว้ก่อนหน้าจะยังคงอยู่ แต่จะไม่มีไอคอน/สีของหมวดนี้อีกต่อไป`)) {
        try {
            await apiDeleteCategory(cat.id);
            renderSettingsCategories();
            renderSettingsQuickTemplates();
            refreshAppUI();
        } catch (err) {
            alertModal(err.message);
        }
    }
}

function renderSettingsCategories() {
    const listContainer = document.getElementById('settingsCategoryList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const catKeys = Object.keys(CATEGORIES);
    catKeys.forEach(catKey => {
        const cat = CATEGORIES[catKey];
        const itemHTML = `
            <div class="flex items-center justify-between p-3 text-xs">
                <div class="flex items-center gap-2 min-w-0">
                    <span class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${cat.color}/10 ${cat.textColor}"><i class="fa-solid ${cat.icon}"></i></span>
                    <div class="min-w-0">
                        <span class="font-bold text-slate-800 block truncate">${cat.name}</span>
                        <span class="text-[11px] text-slate-400 block">${cat.txType === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ'}</span>
                    </div>
                </div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="editCategory('${catKey}')" class="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="deleteCategorySubmit('${catKey}')" class="w-7 h-7 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (catKeys.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400">ไม่มีหมวดหมู่ในระบบ</div>`;
    }
}

// ----------------------------------------------------
// QUICK TEMPLATE SETTINGS (add/edit/delete)
// ----------------------------------------------------
function populateTemplateCategoryOptions() {
    const selectEl = document.getElementById('setTemplateCategory');
    if (!selectEl) return;
    selectEl.innerHTML = '';
    Object.keys(CATEGORIES).forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.innerText = `${CATEGORIES[k].name} (${CATEGORIES[k].txType === 'EXPENSE' ? 'รายจ่าย' : 'รายรับ'})`;
        selectEl.appendChild(opt);
    });
}

function showAddQuickTemplateForm() {
    populateTemplateCategoryOptions();
    document.getElementById('quickTemplateFormWrapper').classList.remove('hidden');
    document.getElementById('quickTemplateFormTitle').innerText = "เพิ่มรายการลัดใหม่";
    document.getElementById('editQuickTemplateId').value = "";
    document.getElementById('setTemplateLabel').value = "";
    document.getElementById('setTemplateDescription').value = "";
}

function hideQuickTemplateForm() {
    document.getElementById('quickTemplateFormWrapper').classList.add('hidden');
}

function editQuickTemplate(templateId) {
    const t = QUICK_TEMPLATES.find(item => item.value === templateId);
    if (!t) return;
    populateTemplateCategoryOptions();
    document.getElementById('quickTemplateFormWrapper').classList.remove('hidden');
    document.getElementById('quickTemplateFormTitle').innerText = `แก้ไขรายการลัด: ${t.text}`;
    document.getElementById('editQuickTemplateId').value = t.value;
    document.getElementById('setTemplateLabel').value = t.text;
    document.getElementById('setTemplateDescription').value = t.description;
    document.getElementById('setTemplateCategory').value = t.category;
}

async function saveQuickTemplateSubmit() {
    const id = document.getElementById('editQuickTemplateId').value;
    const label = document.getElementById('setTemplateLabel').value.trim();
    const description = document.getElementById('setTemplateDescription').value.trim();
    const category = document.getElementById('setTemplateCategory').value;

    if (!label || !description) {
        alertModal("กรุณากรอกป้ายชื่อและคำอธิบายให้ครบถ้วน");
        return;
    }

    try {
        if (id) {
            await apiUpdateQuickTemplate(id, label, description, category);
            alertModal("แก้ไขรายการลัดสำเร็จ!");
        } else {
            await apiCreateQuickTemplate(label, description, category);
            alertModal("เพิ่มรายการลัดสำเร็จ!");
        }
        hideQuickTemplateForm();
        renderSettingsQuickTemplates();
    } catch (err) {
        alertModal(err.message);
    }
}

async function deleteQuickTemplateSubmit(templateId) {
    if (confirm("ลบรายการลัดนี้?")) {
        try {
            await apiDeleteQuickTemplate(templateId);
            renderSettingsQuickTemplates();
        } catch (err) {
            alertModal(err.message);
        }
    }
}

function renderSettingsQuickTemplates() {
    const listContainer = document.getElementById('settingsQuickTemplateList');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const templates = QUICK_TEMPLATES.filter(t => t.value !== 'CUSTOM');
    templates.forEach(t => {
        const cat = CATEGORIES[t.category];
        const itemHTML = `
            <div class="flex items-center justify-between p-3 text-xs">
                <div class="min-w-0">
                    <span class="font-bold text-slate-800 block truncate">${t.text}</span>
                    <span class="text-[11px] text-slate-400 block truncate">${t.description}${cat ? ` · ${cat.name}` : ''}</span>
                </div>
                <div class="flex gap-1 shrink-0">
                    <button onclick="editQuickTemplate('${t.value}')" class="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="deleteQuickTemplateSubmit('${t.value}')" class="w-7 h-7 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });

    if (templates.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400">ไม่มีรายการลัดในระบบ</div>`;
    }
}

function renderSettingsWallets() {
    const listContainer = document.getElementById('settingsWalletList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    state.wallets.forEach(w => {
        const itemHTML = `
            <div class="flex items-center justify-between p-3 text-xs">
                <div>
                    <span class="font-bold text-slate-800">${w.name}</span>
                    <span class="text-[11px] text-slate-400 block">${w.type} | ฿${w.balance.toLocaleString('th-TH', { minimumFractionDigits: 2 })}</span>
                </div>
                <div class="flex gap-1">
                    <button onclick="editWallet('${w.id}')" class="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="deleteWallet('${w.id}')" class="w-7 h-7 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });
    
    if (state.wallets.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400">ไม่มีบัญชีกระเป๋าเงินสดในระบบ</div>`;
    }
}

function renderSettingsCards() {
    const listContainer = document.getElementById('settingsCardList');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    state.creditCards.forEach(c => {
        const itemHTML = `
            <div class="flex items-center justify-between p-3 text-xs">
                <div>
                    <span class="font-bold text-slate-800">${c.name}</span>
                    <span class="text-[11px] text-slate-400 block">วงเงิน: ฿${c.limit.toLocaleString('th-TH')} | ยอดรูดหนี้: ฿${c.balance.toLocaleString('th-TH')}</span>
                    <span class="text-[10px] text-slate-400 block">ตัดรอบวันที่ ${c.billingDay} | ดีลชำระวันที่ ${c.dueDay}</span>
                </div>
                <div class="flex gap-1">
                    <button onclick="editCard('${c.id}')" class="w-7 h-7 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-pen-to-square"></i></button>
                    <button onclick="deleteCard('${c.id}')" class="w-7 h-7 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 flex items-center justify-center transition-colors"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', itemHTML);
    });
    
    if (state.creditCards.length === 0) {
        listContainer.innerHTML = `<div class="p-4 text-center text-slate-400">ไม่มีบัตรเครดิตในระบบ</div>`;
    }
}

// Settings modal wrappers
function openSettingsModal() {
    switchSettingsTab('wallets');
    document.getElementById('settingsModal').classList.remove('hidden');
}

function closeSettingsModal() {
    document.getElementById('settingsModal').classList.add('hidden');
    hideWalletForm();
    hideCardForm();
}

function toggleInfoModal() {
    const el = document.getElementById('infoModal');
    if (el) el.classList.toggle('hidden');
}

// ----------------------------------------------------
// SHAREABLE SLIP IMAGE CREATOR
// ----------------------------------------------------
function openShareSlip(debtorId) {
    const debtor = state.debtors.find(d => d.id === debtorId);
    if (!debtor) return;

    const nextPaybackVal = getNextPaybackVal(debtor);
    
    document.getElementById('slipDebtorName').innerText = debtor.name;
    document.getElementById('slipDebtMemo').innerText = debtor.memo;
    document.getElementById('slipAmountToPay').innerText = `฿${nextPaybackVal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
    
    let debtTypeStr = 'ยืมเงินสดส่วนตัว';
    if (debtor.type === 'CREDIT_CARD_INSTALLMENT') {
        const card = state.creditCards.find(c => c.id === debtor.cardId);
        debtTypeStr = `ผ่อนร่วมบัตรเครดิต (${card ? card.name : 'บัตรเครดิต'})`;
    }
    document.getElementById('slipDebtType').innerText = debtTypeStr;

    const progressText = debtor.totalInstallments > 1 
        ? `งวดที่ ${debtor.totalInstallments - debtor.remainingInstallments + 1} / ${debtor.totalInstallments} งวด`
        : 'ชำระคืนครบยอดก้อนเดียว';
    document.getElementById('slipInstallmentProgress').innerText = progressText;

    // PromptPay QR + account, only shown if the user has set them up in Settings
    const ppSection = document.getElementById('slipPromptPaySection');
    const ppQr = document.getElementById('slipPromptPayQr');
    const ppAccount = document.getElementById('slipPromptPayAccount');
    const hasQr = !!(state.currentUser && state.currentUser.promptpay_qr_data);
    const hasAccount = !!(state.currentUser && state.currentUser.promptpay_account);
    if (hasQr || hasAccount) {
        ppSection.classList.remove('hidden');
        if (hasQr) {
            ppQr.src = state.currentUser.promptpay_qr_data;
            ppQr.classList.remove('hidden');
        } else {
            ppQr.classList.add('hidden');
        }
        ppAccount.innerText = hasAccount ? `พร้อมเพย์: ${state.currentUser.promptpay_account}` : '';
    } else {
        ppSection.classList.add('hidden');
    }

    document.getElementById('shareSlipModal').classList.remove('hidden');
}

function closeShareSlipModal() {
    document.getElementById('shareSlipModal').classList.add('hidden');
    document.getElementById('shareStatusMsg').classList.add('opacity-0');
}

function copySlipText() {
    const debtorName = document.getElementById('slipDebtorName').innerText;
    const memo = document.getElementById('slipDebtMemo').innerText;
    const amount = document.getElementById('slipAmountToPay').innerText;
    const progress = document.getElementById('slipInstallmentProgress').innerText;
    const promptpayAccount = state.currentUser && state.currentUser.promptpay_account;
    const promptpayLine = promptpayAccount ? `\nโอนผ่านพร้อมเพย์: ${promptpayAccount}` : '';

    const txt = `สวัสดีครับคุณ ${debtorName} 🌸\n\nนี่คือบันทึกช่วยเตือนความจำยอดหารระบบ Somdul:\nรายการ: ${memo}\nจำนวนเงินที่สะดวกโอนคืนรอบนี้: ${amount}\n(${progress})${promptpayLine}\n\nรบกวนตรวจสอบความสมบูรณ์ทางการเงิน และโอนเข้าบัญชีส่วนกลางเพื่อไม่ให้ยอดชำระตกหล่นนะครับ ขอบคุณน้า ❤️✨`;

    const textarea = document.createElement("textarea");
    textarea.value = txt;
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        const status = document.getElementById('shareStatusMsg');
        status.innerText = "คัดลอกข้อความทวงหนี้แบบสุภาพชนแล้ว!";
        status.classList.remove('opacity-0');
    } catch (err) {
        console.error('ไม่สามารถคัดลอกได้', err);
    }
    document.body.removeChild(textarea);
}

function downloadSlipImage() {
    const slipArea = document.getElementById('slipArea');
    const status = document.getElementById('shareStatusMsg');
    
    status.innerText = "กำลังสร้างรูปภาพการ์ดทวงหนี้...";
    status.classList.remove('opacity-0');
    
    html2canvas(slipArea, {
        useCORS: true,
        scale: 2,
        backgroundColor: '#f8fafc'
    }).then(canvas => {
        const link = document.createElement('a');
        const debtorName = document.getElementById('slipDebtorName').innerText;
        link.download = `somdul-slip-${debtorName}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        status.innerText = "ดาวน์โหลดรูปการ์ดทวงหนี้สำเร็จ! 📥";
    }).catch(e => {
        console.error(e);
        status.innerText = "ไม่สามารถสร้างรูปภาพได้เนื่องจากข้อจำกัดเว็บบราวเซอร์";
    });
}

// ----------------------------------------------------
// MODAL DIALOG POPUPS
// ----------------------------------------------------
function alertModal(msg) {
    const dialog = document.getElementById('alertModalDialog');
    const text = document.getElementById('alertModalText');
    if (dialog && text) {
        text.innerText = msg;
        dialog.classList.remove('hidden');
    } else {
        alert(msg);
    }
}

function closeAlertModal() {
    const dialog = document.getElementById('alertModalDialog');
    if (dialog) dialog.classList.add('hidden');
}

function populateUserProfileFields() {
    if (!state.currentUser) return;
    document.getElementById('setProfileName').value = state.currentUser.name || '';
    document.getElementById('setProfileEmail').value = state.currentUser.email || '';
    document.getElementById('setProfileOldPassword').value = '';
    document.getElementById('setProfileNewPassword').value = '';
    document.getElementById('setProfileConfirmPassword').value = '';

    document.getElementById('setPromptPayAccount').value = state.currentUser.promptpay_account || '';
    document.getElementById('setPromptPayQrFile').value = '';
    pendingPromptPayQrData = undefined; // undefined = no pending change; "" = clear; string = new data URL
    renderPromptPayQrPreview(state.currentUser.promptpay_qr_data);
}

let pendingPromptPayQrData = undefined;

// PromptPay setup exists in two places (Profile tab in the account modal,
// and a shortcut in the Wallets settings tab) sharing one saved value —
// `source` picks which set of input/preview element ids to read/write.
function promptPayIds(source) {
    return source === 'wallet'
        ? { account: 'setWalletPromptPayAccount', file: 'setWalletPromptPayQrFile', preview: 'walletPromptPayQrPreview', clearBtn: 'clearWalletPromptPayQrBtn' }
        : { account: 'setPromptPayAccount', file: 'setPromptPayQrFile', preview: 'promptPayQrPreview', clearBtn: 'clearPromptPayQrBtn' };
}

function renderPromptPayQrPreview(dataUrl, source = 'profile') {
    const ids = promptPayIds(source);
    const preview = document.getElementById(ids.preview);
    const clearBtn = document.getElementById(ids.clearBtn);
    if (!preview || !clearBtn) return;
    if (dataUrl) {
        preview.innerHTML = `<img src="${dataUrl}" class="w-full h-full object-cover">`;
        clearBtn.classList.remove('hidden');
    } else {
        preview.innerHTML = `<i class="fa-solid fa-qrcode text-slate-300 text-xl"></i>`;
        clearBtn.classList.add('hidden');
    }
}

function handlePromptPayQrSelect(event, source = 'profile') {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        alertModal("กรุณาเลือกไฟล์รูปภาพเท่านั้น");
        event.target.value = '';
        return;
    }
    if (file.size > 700 * 1024) {
        alertModal("ไฟล์รูปภาพมีขนาดใหญ่เกินไป กรุณาเลือกไฟล์ที่เล็กกว่า 700KB");
        event.target.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        pendingPromptPayQrData = reader.result;
        renderPromptPayQrPreview(pendingPromptPayQrData, source);
    };
    reader.readAsDataURL(file);
}

function clearPromptPayQr(source = 'profile') {
    pendingPromptPayQrData = "";
    document.getElementById(promptPayIds(source).file).value = '';
    renderPromptPayQrPreview(null, source);
}

async function savePromptPaySubmit(source = 'profile') {
    const account = document.getElementById(promptPayIds(source).account).value.trim();
    try {
        await apiUpdatePromptPay(account, pendingPromptPayQrData);
        pendingPromptPayQrData = undefined;
        alertModal("บันทึกข้อมูลพร้อมเพย์สำเร็จ!");
    } catch (err) {
        alertModal(err.message);
    }
}

function populateWalletPromptPayFields() {
    if (!state.currentUser) return;
    const el = document.getElementById('setWalletPromptPayAccount');
    if (!el) return;
    el.value = state.currentUser.promptpay_account || '';
    document.getElementById('setWalletPromptPayQrFile').value = '';
    renderPromptPayQrPreview(state.currentUser.promptpay_qr_data, 'wallet');
}

async function handleUpdateProfileSubmit() {
    const name = document.getElementById('setProfileName').value.trim();
    const email = document.getElementById('setProfileEmail').value.trim();
    
    if (!name || !email) {
        alertModal("กรุณากรอกชื่อและอีเมลให้ครบถ้วน");
        return;
    }
    
    try {
        await apiUpdateProfile(name, email);
        alertModal("บันทึกข้อมูลส่วนตัวสำเร็จ!");
        checkLoginSession();
        refreshAppUI();
    } catch (err) {
        alertModal(err.message);
    }
}

async function handleChangePasswordSubmit() {
    const oldPassword = document.getElementById('setProfileOldPassword').value;
    const newPassword = document.getElementById('setProfileNewPassword').value;
    const confirmPassword = document.getElementById('setProfileConfirmPassword').value;
    
    if (!oldPassword || !newPassword || !confirmPassword) {
        alertModal("กรุณากรอกรหัสผ่านให้ครบถ้วน");
        return;
    }
    
    if (newPassword !== confirmPassword) {
        alertModal("รหัสผ่านใหม่และยืนยันรหัสผ่านใหม่ไม่ตรงกัน");
        return;
    }
    
    if (newPassword.length < 6) {
        alertModal("รหัสผ่านใหม่ต้องมีความยาวอย่างน้อย 6 ตัวอักษร");
        return;
    }
    
    try {
        await apiChangePassword(oldPassword, newPassword);
        alertModal("เปลี่ยนรหัสผ่านสำเร็จ!");
        document.getElementById('setProfileOldPassword').value = '';
        document.getElementById('setProfileNewPassword').value = '';
        document.getElementById('setProfileConfirmPassword').value = '';
    } catch (err) {
        alertModal(err.message);
    }
}

// Make functions globally available in Window context so HTML onclick can reach them
window.handleUpdateProfileSubmit = handleUpdateProfileSubmit;
window.handleChangePasswordSubmit = handleChangePasswordSubmit;
window.switchMainTab = switchMainTab;
window.openTransactionModal = openTransactionModal;
window.closeTransactionModal = closeTransactionModal;
window.openDebtModal = openDebtModal;
window.closeDebtModal = closeDebtModal;
window.openEditDebtModal = openEditDebtModal;
window.closeEditDebtModal = closeEditDebtModal;
window.handleEditDebtSubmit = handleEditDebtSubmit;
window.toggleDebtInterestValue = toggleDebtInterestValue;
window.toggleEditDebtInterestValue = toggleEditDebtInterestValue;
window.openCreditCardPaymentModal = openCreditCardPaymentModal;
window.closeCreditCardPaymentModal = closeCreditCardPaymentModal;
window.updateCCPaymentMax = updateCCPaymentMax;
window.fillCCMaxAmount = fillCCMaxAmount;
window.openReceivePaybackModal = openReceivePaybackModal;
window.closeReceivePaybackModal = closeReceivePaybackModal;
window.openPayRecurringModal = openPayRecurringModal;
window.closePayRecurringModal = closePayRecurringModal;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.switchSettingsTab = switchSettingsTab;
window.openAccountModal = openAccountModal;
window.closeAccountModal = closeAccountModal;
window.switchAccountTab = switchAccountTab;
window.populateWalletPromptPayFields = populateWalletPromptPayFields;
window.showAddWalletForm = showAddWalletForm;
window.hideWalletForm = hideWalletForm;
window.editWallet = editWallet;
window.deleteWallet = deleteWallet;
window.saveWalletSubmit = saveWalletSubmit;
window.showAddCardForm = showAddCardForm;
window.hideCardForm = hideCardForm;
window.editCard = editCard;
window.deleteCard = deleteCard;
window.saveCardSubmit = saveCardSubmit;
window.updateCategoryPreview = updateCategoryPreview;
window.showAddCategoryForm = showAddCategoryForm;
window.hideCategoryForm = hideCategoryForm;
window.editCategory = editCategory;
window.saveCategorySubmit = saveCategorySubmit;
window.deleteCategorySubmit = deleteCategorySubmit;
window.showAddQuickTemplateForm = showAddQuickTemplateForm;
window.hideQuickTemplateForm = hideQuickTemplateForm;
window.editQuickTemplate = editQuickTemplate;
window.saveQuickTemplateSubmit = saveQuickTemplateSubmit;
window.deleteQuickTemplateSubmit = deleteQuickTemplateSubmit;
window.openShareSlip = openShareSlip;
window.closeShareSlipModal = closeShareSlipModal;
window.copySlipText = copySlipText;
window.downloadSlipImage = downloadSlipImage;
window.alertModal = alertModal;
window.closeAlertModal = closeAlertModal;
window.toggleRegisterMode = toggleRegisterMode;
window.handleLogout = handleLogout;
window.toggleInfoModal = toggleInfoModal;
window.openNotificationModal = openNotificationModal;
window.closeNotificationModal = closeNotificationModal;
window.dismissNotification = dismissNotification;
window.clearAllNotifications = clearAllNotifications;
window.saveBudgetSubmit = saveBudgetSubmit;
window.deleteBudgetSubmit = deleteBudgetSubmit;
window.exportTransactionsCSV = exportTransactionsCSV;
window.setTransactionViewMode = setTransactionViewMode;
window.setViewMode = setViewMode;
window.getViewMode = getViewMode;
window.toggleDebtSplitMode = toggleDebtSplitMode;
window.setFontSize = setFontSize;
window.handlePromptPayQrSelect = handlePromptPayQrSelect;
window.clearPromptPayQr = clearPromptPayQr;
window.savePromptPaySubmit = savePromptPaySubmit;
window.applyQuickDesc = applyQuickDesc;
window.setTxType = setTxType;
window.toggleDebtTypeInputs = toggleDebtTypeInputs;
window.populateDebtSubscriptionOptions = populateDebtSubscriptionOptions;
window.handleLoginSubmit = handleLoginSubmit;
window.handleTransactionSubmit = handleTransactionSubmit;
window.handleDebtSubmit = handleDebtSubmit;
window.handleCCPaymentSubmit = handleCCPaymentSubmit;
window.handleReceivePaybackSubmit = handleReceivePaybackSubmit;
window.handlePayRecurringSubmit = handlePayRecurringSubmit;
window.closeItemDetailModal = closeItemDetailModal;
window.showTransactionDetail = showTransactionDetail;
window.showDebtorDetail = showDebtorDetail;
window.showCardDetail = showCardDetail;
window.showRecurringDetail = showRecurringDetail;
window.checkRegisterPasswordStrength = checkRegisterPasswordStrength;
window.checkChangePasswordStrength = checkChangePasswordStrength;
