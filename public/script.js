let allBookingsCache = [];
let allExpensesCache = [];
let allInvestmentsCache = [];
let allDataCache = null;
let pendingFilterActive = false;
let profitFocusMonth = '';
let currentUser = null;

function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('toast-removing');
        setTimeout(() => el.remove(), 200);
    }, 3000);
}

function getToken() { return sessionStorage.getItem('veyr_token') }

function authHeaders() {
    const t = getToken();
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' }
}

async function apiFetch(url, opts) {
    opts = opts || {};
    opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
    const res = await fetch(url, opts);
    if (res.status === 401) {
        sessionStorage.removeItem('veyr_token');
        currentUser = null;
        showLoginOverlay('Your session has expired. Please log in again.');
        throw new Error('Session expired. Please login again.');
    }
    if (res.status === 403) {
        const body = await res.json().catch(() => ({}));
        sessionStorage.removeItem('veyr_token');
        currentUser = null;
        showLoginOverlay(body.error || 'Your account does not have access. Please log in again.');
        throw new Error(body.error || 'Access denied.');
    }
    return res;
}

function esc(value) {
    return String(value === null || value === undefined ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setAuthError(message, isInfo) {
    const errEl = document.getElementById('loginError');
    if (!errEl) return;
    errEl.classList.toggle('is-info', !!isInfo);
    if (message) {
        errEl.textContent = message;
        errEl.style.display = 'block';
    } else {
        errEl.style.display = 'none';
    }
}

function showLoginOverlay(message) {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'flex';
    setAuthError(message || '', false);
}

function hideLoginOverlay() {
    const overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
    setAuthError('', false);
}

function setAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(btn => {
        btn.classList.toggle('is-active', btn.dataset.authTab === tab);
    });
    ['login', 'register'].forEach(name => {
        const pane = document.getElementById(name + 'Form');
        if (pane) pane.classList.toggle('is-active', name === tab);
    });
    const forgot = document.getElementById('forgotForm');
    const tabs = document.getElementById('authTabs');
    if (forgot) forgot.classList.toggle('is-active', tab === 'forgot');
    if (tabs) tabs.style.display = tab === 'forgot' ? 'none' : 'flex';
}

function applyCurrentUser(user) {
    currentUser = user || null;
    const propertyEl = document.getElementById('headerPropertyName');
    if (propertyEl) propertyEl.textContent = (user && user.property_name) || '';

    const adminBtn = document.getElementById('openAdminModal');
    if (adminBtn) adminBtn.style.display = (user && user.is_admin) ? '' : 'none';

    if (user) {
        const username = document.getElementById('accountUsername');
        if (username) username.value = user.username;
        const prop = document.getElementById('accountPropertyName');
        if (prop) prop.value = user.property_name || '';
        const email = document.getElementById('accountEmail');
        if (email) email.value = user.contact_email || '';
    }
}

async function login(username, password) {
    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (data.success) {
        sessionStorage.setItem('veyr_token', data.token);
        applyCurrentUser(data.user);
        return true;
    }
    return data.error || 'Invalid username or password';
}

async function logout() {
    sessionStorage.removeItem('veyr_token');
    applyCurrentUser(null);
    allBookingsCache = [];
    allExpensesCache = [];
    allInvestmentsCache = [];
    allDataCache = null;
    setAuthTab('login');
    showLoginOverlay();
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showToast('Logged out', 'success');
}

async function loadCurrentUser() {
    if (!getToken()) return null;
    try {
        const res = await apiFetch('/api/auth/me');
        if (!res.ok) return null;
        const data = await res.json();
        applyCurrentUser(data.user);
        return data.user;
    } catch {
        return null;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    if (!getToken()) showLoginOverlay();

    document.querySelectorAll('.auth-tab').forEach(btn => {
        btn.addEventListener('click', () => setAuthTab(btn.dataset.authTab));
    });
    document.getElementById("showForgotBtn").addEventListener('click', () => {
        document.getElementById('forgotUsername').value = document.getElementById('loginUsername').value || '';
        setAuthTab('forgot');
    });
    document.getElementById("showLoginBtn").addEventListener('click', () => setAuthTab('login'));

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Logging in...';
        setAuthError('', false);
        try {
            const error = await login(document.getElementById('loginUsername').value, document.getElementById('loginPassword').value);
            if (error) {
                setAuthError(error, false);
                return;
            }
            hideLoginOverlay();
            window.scrollTo(0, 0);
            await loadCurrentUser();
            await fetchDashboardData();
            checkAndApplyMonthlyBills();
        } catch (err) {
            setAuthError('Network error: ' + err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = orig;
        }
    });

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Creating account...';
        setAuthError('', false);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('registerUsername').value,
                    password: document.getElementById('registerPassword').value,
                    property_name: document.getElementById('registerProperty').value,
                    contact_email: document.getElementById('registerEmail').value
                })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.token) {
                setAuthError(data.error || 'Could not create your account.', false);
                return;
            }
            sessionStorage.setItem('veyr_token', data.token);
            applyCurrentUser(data.user);
            e.target.reset();
            hideLoginOverlay();
            window.scrollTo(0, 0);
            showToast('Account created. Welcome aboard.', 'success');
            await fetchDashboardData();
        } catch (err) {
            setAuthError('Network error: ' + err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = orig;
        }
    });

    document.getElementById('forgotForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button[type="submit"]');
        const orig = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Sending...';
        setAuthError('', false);
        try {
            const res = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: document.getElementById('forgotUsername').value,
                    contact: document.getElementById('forgotContact').value
                })
            });
            const data = await res.json().catch(() => ({}));
            setAuthError(data.message || data.error || 'Request sent.', true);
            if (res.ok) e.target.reset();
        } catch (err) {
            setAuthError('Network error: ' + err.message, false);
        } finally {
            btn.disabled = false;
            btn.textContent = orig;
        }
    });

    setupModal("openBookingModal", "bookingModal", "close-modal");
    setupModal("openBillModal", "billModal", "close-modal");
    setupModal("openFinanceModal", "financeModal", "close-modal");
    setupModal("openConfigModal", "configModal", "close-modal");
    setupModal("openAdminModal", "adminModal", "close-modal");
    setupModal(null, "editBookingModal", "close-modal");
    setupModal(null, "editExpenseModal", "close-modal");
    setupModal(null, "editInvestmentModal", "close-modal");
    setupModal(null, "adminSetPasswordModal", "close-modal");

    document.getElementById("exportBtn").addEventListener("click", handleExport);
    document.getElementById("refreshBtn").addEventListener("click", handleRefresh);

    const profitMonthFilter = document.getElementById("profitMonthFilter");
    if (profitMonthFilter) {
        profitMonthFilter.addEventListener("change", () => {
            setProfitFocus(profitMonthFilter.value);
        });
    }
    const clearProfitFocusBtn = document.getElementById("clearProfitFocusBtn");
    if (clearProfitFocusBtn) {
        clearProfitFocusBtn.addEventListener("click", () => setProfitFocus(''));
    }

    document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);
    document.getElementById("editBookingForm").addEventListener("submit", handleEditBookingSubmit);
    document.getElementById("billForm").addEventListener("submit", handleBillSubmit);
    document.getElementById("financeForm").addEventListener("submit", handleFinanceSubmit);
    document.getElementById("editExpenseForm").addEventListener("submit", handleEditExpenseSubmit);
    document.getElementById("editInvestmentForm").addEventListener("submit", handleEditInvestmentSubmit);

    document.getElementById("configForm").addEventListener("submit", handleConfigSubmit);
    document.getElementById("accountForm").addEventListener("submit", handleAccountSubmit);
    document.getElementById("passwordForm").addEventListener("submit", handlePasswordSubmit);
    document.getElementById("adminSetPasswordForm").addEventListener("submit", handleAdminSetPasswordSubmit);
    document.getElementById("logoutBtn").addEventListener("click", logout);
    document.getElementById("adminRefreshBtn").addEventListener("click", loadAdminPanel);

    document.getElementById("openAdminModal").addEventListener("click", loadAdminPanel);

    document.getElementById("openConfigModal").addEventListener("click", () => {
        applyCurrentUser(currentUser);
        if (allDataCache && allDataCache.monthlyConfig) {
            const c = allDataCache.monthlyConfig;
            document.getElementById("configRent").value = c.rent || 0;
            document.getElementById("configElectric").value = c.electric || 0;
            document.getElementById("configInternet").value = c.internet || 0;
        }
    });

    const invFilter = document.getElementById("investmentMonthFilter");
    if (invFilter) {
        const now = new Date();
        invFilter.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        invFilter.addEventListener("change", () => renderFilteredInvestments());
    }
    document.getElementById("searchInvestmentInput")?.addEventListener("input", () => renderFilteredInvestments());

    document.getElementById("pendingRevenueCard").addEventListener("click", () => {
        pendingFilterActive = !pendingFilterActive;
        document.getElementById("pendingRevenueCard").style.opacity = pendingFilterActive ? '0.7' : '1';
        renderFilteredBookings();
    });

    document.getElementById("totalBookingsCard").addEventListener("click", () => {
        pendingFilterActive = false;
        document.getElementById("pendingRevenueCard").style.opacity = '1';
        const monthFilter = document.getElementById("bookingMonthFilter");
        if (monthFilter) monthFilter.value = '';
        const typeFilter = document.getElementById("bookingTypeFilter");
        if (typeFilter) typeFilter.value = '';
        const searchInput = document.getElementById("searchBookingInput");
        if (searchInput) searchInput.value = '';
        renderFilteredBookings();
    });

    document.getElementById("searchBookingInput").addEventListener("input", () => {
        renderFilteredBookings();
    });

    const monthFilter = document.getElementById("bookingMonthFilter");
    if (monthFilter) {
        const now = new Date();
        monthFilter.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        monthFilter.addEventListener("change", () => {
            renderFilteredBookings();
        });
    }

    const typeFilterEl = document.getElementById("bookingTypeFilter");
    if (typeFilterEl) {
        typeFilterEl.addEventListener("change", () => {
            renderFilteredBookings();
        });
    }

    const expenseMonthInput = document.getElementById("expenseMonthFilter");
    const now = new Date();
    expenseMonthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    expenseMonthInput.addEventListener("change", () => {
        renderFilteredExpenses();
    });

    // Auth bootstrap runs last so every listener above is already wired.
    if (getToken()) {
        loadCurrentUser().then(user => {
            if (!user) return;
            hideLoginOverlay();
            fetchDashboardData();
            checkAndApplyMonthlyBills();
        });
    }
});

function setupModal(openBtnId, modalId, closeClass) {
    const openBtn = openBtnId ? document.getElementById(openBtnId) : null;
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (openBtn) {
        openBtn.addEventListener("click", () => {
            modal.style.display = "flex";
            if (modalId === 'billModal') {
                const now = new Date();
                document.getElementById("billMonth").value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            }
        });
    }
    
    modal.querySelectorAll(`.${closeClass}`).forEach(el => {
        el.addEventListener("click", () => modal.style.display = "none");
    });

    window.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
    });
}

async function checkAndApplyMonthlyBills() {
    if (!getToken()) return;
    try {
        const response = await apiFetch('/api/data');
        if (!response.ok) return;
        const data = await response.json();
        const config = data.monthlyConfig;

        if (!config || (!config.rent && !config.electric && !config.internet)) return;

        const now = new Date();
        const currentYearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const lastApplied = localStorage.getItem("veyr_last_applied_month");

        if (now.getDate() === 1 && lastApplied !== currentYearMonth) {
            const dateStr = currentYearMonth + '-01';

            const autoBills = [
                { expense_title: "Rent - Automated Monthly Rent", amount: config.rent, expense_date: dateStr, bill_type: "Rent", bill_month: currentYearMonth },
                { expense_title: "Electric Bill - Automated Monthly Electricity", amount: config.electric, expense_date: dateStr, bill_type: "Electric", bill_month: currentYearMonth },
                { expense_title: "Internet Bill - Automated Monthly Internet", amount: config.internet, expense_date: dateStr, bill_type: "Internet", bill_month: currentYearMonth }
            ];

            let applied = 0;
            for (const bill of autoBills) {
                if (!(bill.amount > 0)) continue;
                const billRes = await apiFetch('/api/expenses', {
                    method: 'POST',
                    body: JSON.stringify(bill)
                }).catch(() => null);
                const billJson = billRes ? await billRes.json().catch(() => ({})) : {};
                if (billJson.success) applied++;
            }

            if (applied > 0) {
                localStorage.setItem("veyr_last_applied_month", currentYearMonth);
                showToast(applied + ' monthly bill(s) auto-created', 'success');
                await fetchDashboardData();
            }
        }
    } catch (err) {
        console.error("Error auto-applying monthly bills:", err);
    }
}

async function handleBillSubmit(e) {
    e.preventDefault();
    const billMonth = document.getElementById("billMonth").value;
    const billType = document.getElementById("billType").value;
    const description = document.getElementById("billDescription").value;
    const amount = Number(document.getElementById("billAmount").value) || 0;

    if (!amount) return;

    const payload = {
        expense_title: billType + (description ? ' - ' + description : ''),
        amount: amount,
        expense_date: billMonth + '-01',
        bill_type: billType,
        bill_month: billMonth
    };

    const res = await apiFetch('/api/expenses', {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (!result.success) {
        showToast(result.error || 'Failed to save bill', 'error');
        return;
    }

    document.getElementById("billModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
    showToast('Bill saved', 'success');
}

function openLightbox(src) {
    let lb = document.getElementById('lightbox');
    if (!lb) {
        lb = document.createElement('div');
        lb.id = 'lightbox';
        lb.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:9999;cursor:pointer';
        lb.addEventListener('click', () => lb.style.display = 'none');
        document.body.appendChild(lb);
    }
    lb.replaceChildren();
    const img = document.createElement('img');
    img.src = String(src || '');
    img.style.cssText = 'max-width:90%;max-height:90%;border-radius:8px';
    lb.appendChild(img);
    lb.style.display = 'flex';
}

const cnicCache = {};
async function loadCnicImage(bookingId, side) {
    const key = bookingId + '_' + side;
    if (cnicCache[key]) { openLightbox(cnicCache[key]); return; }
    try {
        const res = await apiFetch('/api/bookings/' + bookingId + '/images');
        const data = await res.json();
        const url = data[side === 'front' ? 'cnic_front' : 'cnic_back'];
        if (url) {
            cnicCache[key] = url;
            openLightbox(url);
        } else {
            showToast('No image available', 'warning');
        }
    } catch {
        showToast('Failed to load image', 'error');
    }
}

async function fetchDashboardData() {
    try {
        const response = await apiFetch('/api/data');
        const data = await response.json();

        allDataCache = data;
        // Clear cached CNIC images so fresh ones are loaded on next view
        Object.keys(cnicCache).forEach(k => delete cnicCache[k]);
        allBookingsCache = data.bookings || [];
        renderFilteredBookings();
        populateFinanceTables(data);
        renderMonthlyProfit();
        calculateMetrics(data);
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
    }
    window.scrollTo(0, 0);
}

function renderFilteredBookings() {
    const monthInput = document.getElementById("bookingMonthFilter");
    const selectedMonth = monthInput ? monthInput.value : '';
    const searchInput = document.getElementById("searchBookingInput");
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const typeFilter = document.getElementById("bookingTypeFilter");
    const selectedType = typeFilter ? typeFilter.value : '';

    let filtered = allBookingsCache;

    if (selectedMonth) {
        filtered = filtered.filter(b => {
            const dateStr = b.check_in_date || b.checkInDate || b.created_at || '';
            return dateStr.startsWith(selectedMonth);
        });
    }

    if (selectedType) {
        filtered = filtered.filter(b => (b.bookingType || 'Full Day') === selectedType);
    }

    if (searchTerm) {
        filtered = filtered.filter(b =>
            (b.guest_name && b.guest_name.toLowerCase().includes(searchTerm)) ||
            (b.guestName && b.guestName.toLowerCase().includes(searchTerm)) ||
            (b.reference_name && b.reference_name.toLowerCase().includes(searchTerm)) ||
            (b.bookingReference && b.bookingReference.toLowerCase().includes(searchTerm))
        );
    }

    if (pendingFilterActive) {
        filtered = filtered.filter(b => (b.payment_status || 'Paid') === 'Pending');
    }

    renderBookingsTable(filtered);

    const totalRev = filtered.reduce((sum, b) => {
        const amt = Number(b.payment_amount !== undefined ? b.payment_amount : (b.amount || 0));
        return sum + ((b.payment_status || 'Paid') === 'Paid' ? amt : 0);
    }, 0);
    const pendingRev = filtered.reduce((sum, b) => {
        const amt = Number(b.payment_amount !== undefined ? b.payment_amount : (b.amount || 0));
        return sum + ((b.payment_status || 'Paid') === 'Pending' ? amt : 0);
    }, 0);

    document.getElementById("monthBookingCount").innerText = filtered.length;
    document.getElementById("monthBookingRevenue").innerText = totalRev.toLocaleString() + ' PKR';
    document.getElementById("monthBookingPending").innerText = pendingRev.toLocaleString() + ' PKR';
}

function renderBookingsTable(bookings) {
    const bookingTbody = document.querySelector("#bookingsTable tbody");
    if (!bookingTbody) return;

    if (!bookings || bookings.length === 0) {
        bookingTbody.innerHTML = '<tr><td colspan="13" class="empty-state">No bookings found</td></tr>';
        return;
    }

    bookingTbody.innerHTML = bookings.map(b => {
        const name = b.guest_name || b.guestName || 'N/A';
        const contact = b.reference_contact || b.guestContact || 'N/A';
        const room = b.roomNumber || 'N/A';
        const checkIn = b.check_in_date || b.checkInDate || '';
        const checkOut = b.checkOutDate || '';
        const type = b.bookingType || 'Full Day';
        const amount = b.payment_amount !== undefined && b.payment_amount !== null ? b.payment_amount : (b.amount || 0);
        const status = b.payment_status || 'Paid';
        const ref = b.reference_name || b.bookingReference || 'N/A';
        const frontLink = '<button class="btn-secondary btn-sm" onclick="loadCnicImage(\'' + b.id + '\',\'front\')">Front</button>';
        const backLink = '<button class="btn-secondary btn-sm" onclick="loadCnicImage(\'' + b.id + '\',\'back\')">Back</button>';

        return '<tr>' +
            '<td data-label="Booking #">' + (b.booking_number || '-') + '</td>' +
            '<td data-label="Guest Name">' + name + '</td>' +
            '<td data-label="Contact">' + contact + '</td>' +
            '<td data-label="Room / Property">' + room + '</td>' +
            '<td data-label="Check-In">' + checkIn.replace('T', ' ') + '</td>' +
            '<td data-label="Check-Out">' + checkOut.replace('T', ' ') + '</td>' +
            '<td data-label="Type"><span class="badge ' + (type === 'Short Booking' ? 'badge-short-booking' : type === 'Night' ? 'badge-night' : 'badge-full-day') + '">' + type + '</span></td>' +
            '<td data-label="Amount">' + Number(amount).toLocaleString() + ' PKR</td>' +
            '<td data-label="Status"><span class="badge ' + (status === 'Pending' ? 'badge-pending' : 'badge-paid') + '">' + status + '</span></td>' +
            '<td data-label="Reference">' + ref + '</td>' +
            '<td data-label="ID Front">' + frontLink + '</td>' +
            '<td data-label="ID Back">' + backLink + '</td>' +
            '<td data-label="Actions" class="actions-cell">' +
                '<button onclick="openEditBookingModal(\'' + b.id + '\')" class="btn-primary btn-sm">Edit</button>' +
                '<button onclick="deleteBooking(\'' + b.id + '\')" class="btn-danger btn-sm">Delete</button>' +
            '</td>' +
            '</tr>';
    }).join('');

}

function categorizeExpense(expense) {
    if (expense.bill_type) return expense.bill_type.toLowerCase();
    const t = (expense.expense_title || '').toLowerCase();
    if (t.includes('rent')) return 'rent';
    if (t.includes('electric')) return 'electric';
    if (t.includes('internet')) return 'internet';
    return 'other';
}

function renderFilteredExpenses() {
    const monthInput = document.getElementById("expenseMonthFilter");
    const selectedMonth = monthInput.value;
    if (!selectedMonth || !allExpensesCache.length) {
        document.querySelector("#expensesTable tbody").innerHTML = '<tr><td colspan="6" class="empty-state">No expenses found</td></tr>';
        document.getElementById("monthTotalExpense").innerText = '0 PKR';
        document.getElementById("monthRentExpense").innerText = '0 PKR';
        document.getElementById("monthElectricExpense").innerText = '0 PKR';
        document.getElementById("monthInternetExpense").innerText = '0 PKR';
        document.getElementById("monthOtherExpense").innerText = '0 PKR';
        return;
    }

    const filtered = allExpensesCache.filter(e => {
        const dateStr = e.expense_date || e.date || e.created_at || '';
        return dateStr.startsWith(selectedMonth);
    });

    const expenseTbody = document.querySelector("#expensesTable tbody");
    if (!filtered.length) {
        expenseTbody.innerHTML = '<tr><td colspan="6" class="empty-state">No expenses for this month</td></tr>';
    } else {
        expenseTbody.innerHTML = filtered.map(e =>
            '<tr>' +
            '<td data-label="Type">' + (e.bill_type || (e.expense_title || '-')) + '</td>' +
            '<td data-label="Description">' + (e.expense_title || '-') + '</td>' +
            '<td data-label="Amount">' + Number(e.amount || 0).toLocaleString() + ' PKR</td>' +
            '<td data-label="Date">' + (e.expense_date || e.date || e.created_at) + '</td>' +
            '<td data-label="Month">' + (e.bill_month || (e.expense_date ? e.expense_date.substring(0, 7) : '-')) + '</td>' +
            '<td data-label="Actions" class="actions-cell">' +
                '<button onclick="openEditExpenseModal(\'' + e._id + '\')" class="btn-primary btn-sm">Edit</button>' +
                '<button onclick="deleteExpense(\'' + e._id + '\')" class="btn-danger btn-sm">Delete</button>' +
            '</td>' +
            '</tr>'
        ).join('');
    }

    let total = 0, rent = 0, electric = 0, internet = 0, other = 0;
    filtered.forEach(e => {
        const amt = Number(e.amount || 0);
        total += amt;
        const cat = categorizeExpense(e);
        if (cat === 'rent') rent += amt;
        else if (cat === 'electric') electric += amt;
        else if (cat === 'internet') internet += amt;
        else other += amt;
    });

    document.getElementById("monthTotalExpense").innerText = total.toLocaleString() + ' PKR';
    document.getElementById("monthRentExpense").innerText = rent.toLocaleString() + ' PKR';
    document.getElementById("monthElectricExpense").innerText = electric.toLocaleString() + ' PKR';
    document.getElementById("monthInternetExpense").innerText = internet.toLocaleString() + ' PKR';
    document.getElementById("monthOtherExpense").innerText = other.toLocaleString() + ' PKR';
}

function populateFinanceTables(data) {
    allExpensesCache = data.expenses || [];
    allInvestmentsCache = data.investments || [];
    renderFilteredExpenses();
    renderFilteredInvestments();
}

function renderFilteredInvestments() {
    const monthFilter = document.getElementById("investmentMonthFilter");
    const selectedMonth = monthFilter ? monthFilter.value : '';
    const searchInput = document.getElementById("searchInvestmentInput");
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const investmentTbody = document.querySelector("#investmentsTable tbody");
    if (!investmentTbody) return;

    let filtered = allInvestmentsCache;

    if (selectedMonth) {
        filtered = filtered.filter(i => {
            const dateStr = i.investment_date || i.date || i.created_at || '';
            return dateStr.startsWith(selectedMonth);
        });
    }

    if (searchTerm) {
        filtered = filtered.filter(i =>
            (i.investor_name && i.investor_name.toLowerCase().includes(searchTerm)) ||
            (i.category && i.category.toLowerCase().includes(searchTerm))
        );
    }

    if (!filtered.length) {
        investmentTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No investments found</td></tr>';
    } else {
        investmentTbody.innerHTML = filtered.map(i =>
            '<tr>' +
            '<td data-label="Investor">' + (i.investor_name || i.category || '-') + '</td>' +
            '<td data-label="Description">' + (i.description || '-') + '</td>' +
            '<td data-label="Amount">' + Number(i.amount || 0).toLocaleString() + ' PKR</td>' +
            '<td data-label="Date">' + (i.investment_date || i.date || i.created_at) + '</td>' +
            '<td data-label="Actions" class="actions-cell">' +
                '<button onclick="openEditInvestmentModal(\'' + i._id + '\')" class="btn-primary btn-sm">Edit</button>' +
                '<button onclick="deleteInvestment(\'' + i._id + '\')" class="btn-danger btn-sm">Delete</button>' +
            '</td>' +
            '</tr>'
        ).join('');
    }
}

function calculateMetrics(data) {
    const bookings = data.bookings || [];
    const totalRev = bookings.reduce((sum, item) => {
        const amt = Number(item.payment_amount !== undefined ? item.payment_amount : (item.amount || 0));
        return sum + ((item.payment_status || 'Paid') === 'Paid' ? amt : 0);
    }, 0);
    const pendingRev = bookings.reduce((sum, item) => {
        const amt = Number(item.payment_amount !== undefined ? item.payment_amount : (item.amount || 0));
        return sum + ((item.payment_status || 'Paid') === 'Pending' ? amt : 0);
    }, 0);
    const totalExp = (data.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInv = (data.investments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const netProf = totalRev - totalExp;

    document.getElementById("totalRevenue").innerText = totalRev.toLocaleString() + " PKR";
    document.getElementById("totalBookings").innerText = bookings.length;
    document.getElementById("pendingRevenue").innerText = pendingRev.toLocaleString() + " PKR";
    document.getElementById("totalExpenses").innerText = totalExp.toLocaleString() + " PKR";
    document.getElementById("totalInvestments").innerText = totalInv.toLocaleString() + " PKR";
    document.getElementById("netProfit").innerText = netProf.toLocaleString() + " PKR";
}

function toMonthKey(value) {
    const str = String(value || '');
    const m = str.match(/^(\d{4})-(\d{2})/);
    return m ? m[1] + '-' + m[2] : '';
}

function monthLabel(key) {
    const parts = key.split('-');
    if (parts.length !== 2) return key;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const idx = Number(parts[1]) - 1;
    if (idx < 0 || idx > 11) return key;
    return months[idx] + " '" + parts[0].slice(2);
}

function formatPKR(value) {
    return Number(value || 0).toLocaleString() + ' PKR';
}

function computeMonthlyProfit() {
    const buckets = new Map();

    const bucketFor = (key) => {
        if (!buckets.has(key)) {
            buckets.set(key, { month: key, bookings: 0, revenue: 0, pending: 0, expenses: 0 });
        }
        return buckets.get(key);
    };

    allBookingsCache.forEach(b => {
        const key = toMonthKey(b.check_in_date || b.checkInDate || b.created_at);
        if (!key) return;
        const entry = bucketFor(key);
        const amt = Number(b.payment_amount !== undefined ? b.payment_amount : (b.amount || 0)) || 0;
        entry.bookings += 1;
        if ((b.payment_status || 'Paid') === 'Pending') entry.pending += amt;
        else entry.revenue += amt;
    });

    allExpensesCache.forEach(x => {
        const key = toMonthKey(x.bill_month || x.expense_date || x.date || x.created_at);
        if (!key) return;
        bucketFor(key).expenses += Number(x.amount || 0) || 0;
    });

    return Array.from(buckets.values())
        .map(m => ({ ...m, net: m.revenue - m.expenses }))
        .sort((a, b) => a.month.localeCompare(b.month));
}

function setProfitFocus(month) {
    profitFocusMonth = month || '';
    const input = document.getElementById("profitMonthFilter");
    if (input) input.value = profitFocusMonth;
    renderMonthlyProfit();
}

function renderMonthlyProfit() {
    const tbody = document.querySelector("#profitTable tbody");
    const chart = document.getElementById("profitChart");
    if (!tbody || !chart) return;

    const months = computeMonthlyProfit();

    if (!months.length) {
        profitFocusMonth = '';
        const emptyInput = document.getElementById("profitMonthFilter");
        if (emptyInput) emptyInput.value = '';
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No activity recorded yet</td></tr>';
        chart.innerHTML = '<div class="profit-chart-empty">No data to chart yet</div>';
        document.getElementById("profitMonthCount").innerText = '0';
        document.getElementById("profitTotalRevenue").innerText = '0 PKR';
        document.getElementById("profitTotalExpenses").innerText = '0 PKR';
        document.getElementById("profitTotalPending").innerText = '0 PKR';
        document.getElementById("profitTotalNet").innerText = '0 PKR';
        return;
    }

    if (profitFocusMonth && !months.some(m => m.month === profitFocusMonth)) profitFocusMonth = '';
    const input = document.getElementById("profitMonthFilter");
    if (input && input.value !== profitFocusMonth) input.value = profitFocusMonth;

    const shown = profitFocusMonth ? months.filter(m => m.month === profitFocusMonth) : months;
    const totals = shown.reduce((acc, m) => ({
        revenue: acc.revenue + m.revenue,
        expenses: acc.expenses + m.expenses,
        pending: acc.pending + m.pending,
        net: acc.net + m.net
    }), { revenue: 0, expenses: 0, pending: 0, net: 0 });

    document.getElementById("profitMonthCount").innerText = shown.length;
    document.getElementById("profitTotalRevenue").innerText = formatPKR(totals.revenue);
    document.getElementById("profitTotalExpenses").innerText = formatPKR(totals.expenses);
    document.getElementById("profitTotalPending").innerText = formatPKR(totals.pending);
    document.getElementById("profitTotalNet").innerText = formatPKR(totals.net);

    tbody.innerHTML = months.map(m => {
        const margin = m.revenue > 0 ? Math.round((m.net / m.revenue) * 100) : 0;
        const active = m.month === profitFocusMonth ? ' class="row-active"' : '';
        return '<tr' + active + ' data-month="' + m.month + '" onclick="toggleProfitFocus(\'' + m.month + '\')">' +
            '<td data-label="Month"><span class="cell-main">' + monthLabel(m.month) + '<span class="cell-sub">' + m.month + '</span></span></td>' +
            '<td data-label="Bookings">' + m.bookings + '</td>' +
            '<td data-label="Revenue">' + formatPKR(m.revenue) + '</td>' +
            '<td data-label="Expenses">' + formatPKR(m.expenses) + '</td>' +
            '<td data-label="Pending">' + formatPKR(m.pending) + '</td>' +
            '<td data-label="Net Profit"><span class="val-' + (m.net >= 0 ? 'gain' : 'loss') + '">' + formatPKR(m.net) + '</span></td>' +
            '<td data-label="Margin"><span class="val-' + (m.net >= 0 ? 'gain' : 'loss') + '">' + margin + '%</span></td>' +
            '</tr>';
    }).join('');

    const maxValue = Math.max(1, ...months.map(m => Math.max(m.revenue, m.expenses)));
    chart.innerHTML = months.map(m => {
        const active = m.month === profitFocusMonth ? ' is-active' : '';
        return '<button type="button" class="profit-col' + active + '" onclick="toggleProfitFocus(\'' + m.month + '\')" title="' + m.month + '">' +
            '<span class="profit-col-bars">' +
                '<span class="profit-bar bar-revenue" style="height:' + Math.round((m.revenue / maxValue) * 100) + '%"></span>' +
                '<span class="profit-bar bar-expense" style="height:' + Math.round((m.expenses / maxValue) * 100) + '%"></span>' +
            '</span>' +
            '<span class="profit-col-label">' + monthLabel(m.month) + '</span>' +
            '<span class="profit-col-net val-' + (m.net >= 0 ? 'gain' : 'loss') + '">' + (m.net >= 0 ? '+' : '-') + formatPKR(Math.abs(m.net)).replace(' PKR', '') + '</span>' +
            '</button>';
    }).join('');
}

function toggleProfitFocus(month) {
    setProfitFocus(profitFocusMonth === month ? '' : month);
}

async function handleRefresh() {
    const btn = document.getElementById("refreshBtn");
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Refreshing...';
    try {
        await fetchDashboardData();
        showToast('Data refreshed', 'success');
    } catch (err) {
        showToast('Refresh failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function compressImage(file, maxSize) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let w = img.width, h = img.height;
            if (w > maxSize || h > maxSize) {
                const ratio = Math.min(maxSize / w, maxSize / h);
                w *= ratio; h *= ratio;
            }
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            c.toBlob((blob) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            }, 'image/jpeg', 0.85);
        };
        img.src = URL.createObjectURL(file);
    });
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const frontInput = document.getElementById("idCardFrontFile");
        const backInput = document.getElementById("idCardBackFile");

        let cnic_front = '', cnic_back = '';
        if (frontInput.files && frontInput.files[0]) cnic_front = await compressImage(frontInput.files[0], 1200);
        if (backInput.files && backInput.files[0]) cnic_back = await compressImage(backInput.files[0], 1200);

        const payload = {
            guest_name: document.getElementById("guestName").value,
            reference_contact: document.getElementById("guestContact").value,
            roomNumber: document.getElementById("roomNumber").value,
            check_in: document.getElementById("checkInDate").value,
            checkOutDate: document.getElementById("checkOutDate").value,
            bookingType: document.getElementById("bookingType").value,
            payment_amount: Number(document.getElementById("bookingAmount").value),
            payment_status: document.getElementById("bookingPaymentStatus").value,
            reference_name: document.getElementById("bookingReference").value,
            cnic_front, cnic_back
        };

        const res = await apiFetch('/api/bookings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (result.success) {
            document.getElementById("bookingModal").style.display = "none";
            form.reset();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            showToast('Booking saved', 'success');
            await fetchDashboardData();
        } else {
            showToast('Failed: ' + (result.error || 'Unknown error'), 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function openEditBookingModal(id) {
    const booking = allBookingsCache.find(b => String(b.id) === String(id));
    if (!booking) return;

    document.getElementById("editBookingId").value = booking.id;
    document.getElementById("editGuestName").value = booking.guest_name || booking.guestName || '';
    document.getElementById("editGuestContact").value = booking.reference_contact || booking.guestContact || '';
    document.getElementById("editRoomNumber").value = booking.roomNumber || '';
    document.getElementById("editCheckInDate").value = booking.check_in_date || booking.checkInDate || '';
    document.getElementById("editCheckOutDate").value = booking.checkOutDate || '';
    document.getElementById("editBookingType").value = booking.bookingType || 'Full Day';
    document.getElementById("editBookingAmount").value = booking.payment_amount !== undefined ? booking.payment_amount : (booking.amount || 0);
    document.getElementById("editBookingPaymentStatus").value = booking.payment_status || 'Paid';
    document.getElementById("editBookingReference").value = booking.reference_name || booking.bookingReference || '';
    document.getElementById("editCardFrontFile").value = '';
    document.getElementById("editCardBackFile").value = '';

    document.getElementById("editBookingModal").style.display = "flex";
}

async function handleEditBookingSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Updating...';

    const id = document.getElementById("editBookingId").value;
    const frontInput = document.getElementById("editCardFrontFile");
    const backInput = document.getElementById("editCardBackFile");

    let cnic_front = '', cnic_back = '';
    if (frontInput.files && frontInput.files[0]) cnic_front = await compressImage(frontInput.files[0], 1200);
    if (backInput.files && backInput.files[0]) cnic_back = await compressImage(backInput.files[0], 1200);

    const payload = {
        guest_name: document.getElementById("editGuestName").value,
        reference_contact: document.getElementById("editGuestContact").value,
        roomNumber: document.getElementById("editRoomNumber").value,
        check_in: document.getElementById("editCheckInDate").value,
        checkOutDate: document.getElementById("editCheckOutDate").value,
        bookingType: document.getElementById("editBookingType").value,
        payment_amount: Number(document.getElementById("editBookingAmount").value),
        payment_status: document.getElementById("editBookingPaymentStatus").value,
        reference_name: document.getElementById("editBookingReference").value,
        cnic_front, cnic_back
    };

    try {
        const response = await apiFetch(`/api/bookings/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            document.getElementById("editBookingModal").style.display = "none";
            window.scrollTo({ top: 0, behavior: 'smooth' });
            fetchDashboardData();
            showToast('Booking updated', 'success');
        } else {
            showToast("Failed to update booking.", 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function deleteBooking(id) {
    if (!confirm("Are you sure you want to delete this booking?")) return;

    const response = await apiFetch(`/api/bookings/${id}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        fetchDashboardData();
        showToast('Booking deleted', 'success');
    } else {
        showToast("Failed to delete booking.", 'error');
    }
}

async function handleExport() {
    const btn = document.getElementById('exportBtn');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing...';
    try {
        const res = await apiFetch('/api/export');
        if (!res.ok) {
            const msg = await res.json().catch(() => ({}));
            showToast(msg.error || 'Export failed', 'error');
            return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'veyr_stays_export.zip';
        a.click();
        URL.revokeObjectURL(url);
    } catch (err) {
        showToast('Export failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function handleFinanceSubmit(e) {
    e.preventDefault();
    const type = document.getElementById("financeType").value;
    
    if (type === 'expense') {
        const payload = {
            expense_title: document.getElementById("financeCategory").value + (document.getElementById("financeDescription").value ? ' - ' + document.getElementById("financeDescription").value : ''),
            amount: Number(document.getElementById("financeAmount").value),
            expense_date: document.getElementById("financeDate").value
        };

        const res = await apiFetch('/api/expenses', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save expense', 'error'); return; }
    } else {
        const payload = {
            investor_name: document.getElementById("financeCategory").value,
            amount: Number(document.getElementById("financeAmount").value),
            investment_date: document.getElementById("financeDate").value
        };

        const res = await apiFetch('/api/investments', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) { showToast(result.error || 'Failed to save investment', 'error'); return; }
    }

    document.getElementById("financeModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
    showToast(type === 'expense' ? 'Expense saved' : 'Investment saved', 'success');
}

function openEditExpenseModal(id) {
    const expense = allExpensesCache.find(e => String(e._id) === String(id));
    if (!expense) return;

    const title = expense.expense_title || '';
    const dashIdx = title.indexOf(' - ');
    const category = dashIdx > -1 ? title.substring(0, dashIdx) : title;
    const desc = dashIdx > -1 ? title.substring(dashIdx + 3) : '';

    document.getElementById("editExpenseId").value = expense._id;
    document.getElementById("editExpenseCategory").value = category;
    document.getElementById("editExpenseDescription").value = desc;
    document.getElementById("editExpenseAmount").value = expense.amount || 0;
    document.getElementById("editExpenseDate").value = expense.expense_date || expense.date || expense.created_at || '';

    document.getElementById("editExpenseModal").style.display = "flex";
}

async function handleEditExpenseSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("editExpenseId").value;
    const category = document.getElementById("editExpenseCategory").value;
    const desc = document.getElementById("editExpenseDescription").value;
    const expense_title = category + (desc ? ' - ' + desc : '');

    const payload = {
        expense_title,
        amount: Number(document.getElementById("editExpenseAmount").value),
        expense_date: document.getElementById("editExpenseDate").value
    };

    const res = await apiFetch('/api/expenses/' + id, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!result.success) { showToast(result.error || 'Failed to update expense', 'error'); return; }

    document.getElementById("editExpenseModal").style.display = "none";
    fetchDashboardData();
    showToast('Expense updated', 'success');
}

async function deleteExpense(id) {
    if (!confirm("Are you sure you want to delete this expense?")) return;

    const res = await apiFetch('/api/expenses/' + id, {
        method: 'DELETE'
    });
    const result = await res.json();
    if (!result.success) { showToast(result.error || 'Failed to delete expense', 'error'); return; }

    fetchDashboardData();
    showToast('Expense deleted', 'success');
}

function openEditInvestmentModal(id) {
    const investment = allInvestmentsCache.find(i => String(i._id) === String(id));
    if (!investment) return;

    document.getElementById("editInvestmentId").value = investment._id;
    document.getElementById("editInvestorName").value = investment.investor_name || investment.category || '';
    document.getElementById("editInvestmentAmount").value = investment.amount || 0;
    document.getElementById("editInvestmentDate").value = investment.investment_date || investment.date || investment.created_at || '';

    document.getElementById("editInvestmentModal").style.display = "flex";
}

async function handleEditInvestmentSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("editInvestmentId").value;

    const payload = {
        investor_name: document.getElementById("editInvestorName").value,
        amount: Number(document.getElementById("editInvestmentAmount").value),
        investment_date: document.getElementById("editInvestmentDate").value
    };

    const res = await apiFetch('/api/investments/' + id, {
        method: 'PUT',
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!result.success) { showToast(result.error || 'Failed to update investment', 'error'); return; }

    document.getElementById("editInvestmentModal").style.display = "none";
    fetchDashboardData();
    showToast('Investment updated', 'success');
}

async function deleteInvestment(id) {
    if (!confirm("Are you sure you want to delete this investment?")) return;

    const res = await apiFetch('/api/investments/' + id, {
        method: 'DELETE'
    });
    const result = await res.json();
    if (!result.success) { showToast(result.error || 'Failed to delete investment', 'error'); return; }

    fetchDashboardData();
    showToast('Investment deleted', 'success');
}

async function handleConfigSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const payload = {
            rent: Number(document.getElementById("configRent").value) || 0,
            electric: Number(document.getElementById("configElectric").value) || 0,
            internet: Number(document.getElementById("configInternet").value) || 0
        };

        const res = await apiFetch('/api/config/monthly', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (result.success) {
            if (allDataCache) allDataCache.monthlyConfig = payload;
            showToast('Monthly bills saved', 'success');
            await fetchDashboardData();
        } else {
            showToast(result.error || 'Failed to save settings', 'error');
        }
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function handleAccountSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        const res = await apiFetch('/api/auth/profile', {
            method: 'PUT',
            body: JSON.stringify({
                property_name: document.getElementById('accountPropertyName').value,
                contact_email: document.getElementById('accountEmail').value
            })
        });
        const result = await res.json();
        if (!res.ok || !result.success) {
            showToast(result.error || 'Failed to save account', 'error');
            return;
        }
        applyCurrentUser(result.user);
        showToast('Account saved', 'success');
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function handlePasswordSubmit(e) {
    e.preventDefault();
    const current = document.getElementById('currentPassword').value;
    const next = document.getElementById('newPassword').value;
    const confirm = document.getElementById('confirmPassword').value;

    if (next !== confirm) {
        showToast('The new passwords do not match', 'error');
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Updating...';
    try {
        const res = await apiFetch('/api/auth/password', {
            method: 'PUT',
            body: JSON.stringify({ current_password: current, new_password: next })
        });
        const result = await res.json();
        if (!res.ok || !result.success) {
            showToast(result.error || 'Failed to update password', 'error');
            return;
        }
        e.target.reset();
        showToast('Password updated', 'success');
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

function formatTimestamp(value) {
    if (!value) return 'never';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString();
}

async function loadAdminPanel() {
    const requestsEl = document.getElementById('adminResetRequests');
    const usersEl = document.getElementById('adminUserList');
    requestsEl.innerHTML = '<div class="admin-empty">Loading...</div>';
    usersEl.innerHTML = '<div class="admin-empty">Loading...</div>';

    try {
        const [reqRes, userRes] = await Promise.all([
            apiFetch('/api/admin/reset-requests'),
            apiFetch('/api/admin/users')
        ]);
        if (!reqRes.ok || !userRes.ok) {
            requestsEl.innerHTML = '<div class="admin-empty">Could not load. Are you an admin?</div>';
            usersEl.innerHTML = '';
            return;
        }
        const { requests } = await reqRes.json();
        const { users } = await userRes.json();

        const pending = requests.filter(r => r.status === 'pending');
        const handled = requests.filter(r => r.status !== 'pending').slice(0, 10);

        const rowFor = (r, isPending) =>
            '<div class="admin-row">' +
                '<div class="admin-row-main">' +
                    '<strong>' + esc(r.username || 'unknown') + '</strong>' +
                    '<span class="admin-row-sub">' + (r.contact ? esc(r.contact) + ' · ' : '') + 'requested ' + esc(formatTimestamp(r.requested_at)) + '</span>' +
                '</div>' +
                (isPending
                    ? '<div class="admin-row-actions">' +
                        '<button class="btn-primary btn-sm" onclick="openAdminSetPassword(\'' + esc(r.user_id) + '\',\'' + esc(r.id || r._id) + '\')">Set password</button>' +
                        '<button class="btn-secondary btn-sm" onclick="cancelResetRequest(\'' + esc(r.id || r._id) + '\')">Dismiss</button>' +
                      '</div>'
                    : '<span class="admin-tag tag-' + esc(r.status) + '">' + esc(r.status) + '</span>') +
            '</div>';

        requestsEl.innerHTML = pending.length
            ? pending.map(r => rowFor(r, true)).join('')
            : '<div class="admin-empty">No pending requests.</div>';
        if (pending.length || handled.length) {
            requestsEl.innerHTML += '<h4 class="admin-subhead">Recently handled</h4>' +
                (handled.length ? handled.map(r => rowFor(r, false)).join('') : '<div class="admin-empty">Nothing yet.</div>');
        }

        usersEl.innerHTML = users.map(u =>
            '<div class="admin-row">' +
                '<div class="admin-row-main">' +
                    '<strong>' + esc(u.username) + (u.is_admin ? ' <span class="admin-tag tag-admin">admin</span>' : '') + (u.is_active ? '' : ' <span class="admin-tag tag-off">disabled</span>') + '</strong>' +
                    '<span class="admin-row-sub">' + esc(u.property_name || 'no property name') + (u.contact_email ? ' · ' + esc(u.contact_email) : '') + '</span>' +
                    '<span class="admin-row-sub">joined ' + esc(formatTimestamp(u.created_at)) + ' · last login ' + esc(formatTimestamp(u.last_login_at)) + '</span>' +
                '</div>' +
                '<div class="admin-row-actions">' +
                    '<button class="btn-primary btn-sm" onclick="openAdminSetPassword(\'' + esc(u.id) + '\',\'\')">Password</button>' +
                    '<button class="btn-secondary btn-sm" onclick="toggleUserActive(\'' + esc(u.id) + '\',' + (!u.is_active) + ')">' + (u.is_active ? 'Disable' : 'Enable') + '</button>' +
                    (u.is_admin ? '' : '<button class="btn-danger btn-sm" onclick="deleteUser(\'' + esc(u.id) + '\')">Delete</button>') +
                '</div>' +
            '</div>'
        ).join('');
    } catch (err) {
        requestsEl.innerHTML = '<div class="admin-empty">Could not load admin panel.</div>';
        usersEl.innerHTML = '';
    }
}

function openAdminSetPassword(userId, requestId) {
    document.getElementById('adminSetPasswordUserId').value = userId;
    document.getElementById('adminSetPasswordRequestId').value = requestId || '';
    document.getElementById('adminSetPasswordValue').value = '';
    document.getElementById('adminSetPasswordTarget').textContent =
        'Set a new password for "' + userId + '" and share it with them.';
    document.getElementById('adminSetPasswordModal').style.display = 'flex';
}

async function handleAdminSetPasswordSubmit(e) {
    e.preventDefault();
    const userId = document.getElementById('adminSetPasswordUserId').value;
    const requestId = document.getElementById('adminSetPasswordRequestId').value;
    const newPassword = document.getElementById('adminSetPasswordValue').value;

    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';
    try {
        if (requestId) {
            const res = await apiFetch('/api/admin/reset-requests/' + requestId + '/resolve', {
                method: 'POST',
                body: JSON.stringify({ new_password: newPassword })
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                showToast(result.error || 'Failed to set password', 'error');
                return;
            }
        } else {
            const res = await apiFetch('/api/admin/users/' + userId + '/reset-password', {
                method: 'POST',
                body: JSON.stringify({ new_password: newPassword })
            });
            const result = await res.json();
            if (!res.ok || !result.success) {
                showToast(result.error || 'Failed to set password', 'error');
                return;
            }
        }
        document.getElementById('adminSetPasswordModal').style.display = 'none';
        e.target.reset();
        showToast('Password updated. Share it with the customer.', 'success');
        loadAdminPanel();
    } catch (err) {
        showToast('Network error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = orig;
    }
}

async function cancelResetRequest(requestId) {
    const res = await apiFetch('/api/admin/reset-requests/' + requestId + '/cancel', { method: 'POST' });
    const result = await res.json();
    if (!result.success) {
        showToast(result.error || 'Failed to dismiss request', 'error');
        return;
    }
    showToast('Request dismissed', 'success');
    loadAdminPanel();
}

async function toggleUserActive(userId, activate) {
    const res = await apiFetch('/api/admin/users/' + userId, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !!activate })
    });
    const result = await res.json();
    if (!result.success) {
        showToast(result.error || 'Failed to update account', 'error');
        return;
    }
    showToast(activate ? 'Account enabled' : 'Account disabled', 'success');
    loadAdminPanel();
}

async function deleteUser(userId) {
    if (!confirm('Delete this account and ALL of its bookings, expenses and investments? This cannot be undone.')) return;
    const res = await apiFetch('/api/admin/users/' + userId, { method: 'DELETE' });
    const result = await res.json().catch(() => ({}));
    if (!result.success) {
        showToast(result.error || 'Failed to delete account', 'error');
        return;
    }
    showToast('Account deleted', 'success');
    loadAdminPanel();
}