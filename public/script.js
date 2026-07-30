let allBookingsCache = [];
let allExpensesCache = [];
let allInvestmentsCache = [];

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
        document.getElementById('loginOverlay').style.display = 'flex';
        throw new Error('Session expired. Please login again.');
    }
    return res;
}

document.addEventListener("DOMContentLoaded", () => {
    if (!getToken()) document.getElementById('loginOverlay').style.display = 'flex';

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('loginError');
        errEl.style.display = 'none';
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value })
        });
        const data = await res.json();
        if (data.success) {
            sessionStorage.setItem('veyr_token', data.token);
            document.getElementById('loginOverlay').style.display = 'none';
            window.scrollTo(0, 0);
            fetchDashboardData();
        } else {
            errEl.textContent = data.error || 'Invalid credentials';
            errEl.style.display = 'block';
        }
    });

    checkAndApplyMonthlyBills();
    if (getToken()) fetchDashboardData();

    setupModal("openBookingModal", "bookingModal", "close-modal");
    setupModal("openBillModal", "billModal", "close-modal");
    setupModal("openFinanceModal", "financeModal", "close-modal");
    setupModal(null, "editBookingModal", "close-modal"); // Setup edit modal closing events
    setupModal(null, "editExpenseModal", "close-modal");
    setupModal(null, "editInvestmentModal", "close-modal");

    document.getElementById("exportBtn").addEventListener("click", handleExport);

    document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);
    document.getElementById("editBookingForm").addEventListener("submit", handleEditBookingSubmit);
    document.getElementById("billForm").addEventListener("submit", handleBillSubmit);
    document.getElementById("financeForm").addEventListener("submit", handleFinanceSubmit);
    document.getElementById("editExpenseForm").addEventListener("submit", handleEditExpenseSubmit);
    document.getElementById("editInvestmentForm").addEventListener("submit", handleEditInvestmentSubmit);

    document.getElementById("searchBookingInput").addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const filtered = allBookingsCache.filter(b => 
            (b.guest_name && b.guest_name.toLowerCase().includes(searchTerm)) ||
            (b.guestName && b.guestName.toLowerCase().includes(searchTerm))
        );
        renderBookingsTable(filtered);
    });

    const monthInput = document.getElementById("expenseMonthFilter");
    const now = new Date();
    monthInput.value = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    monthInput.addEventListener("change", () => {
        renderFilteredExpenses();
    });
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
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        const config = data.monthlyConfig;
        
        if (!config || (!config.rent && !config.electric && !config.internet)) return;

        const now = new Date();
        const currentYearMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const lastApplied = localStorage.getItem("veyr_last_applied_month");

        if (now.getDate() === 1 && lastApplied !== currentYearMonth) {
            const dateStr = now.toISOString().split('T')[0];
            
            const autoBills = [
                { expense_title: "Rent - Automated Monthly Rent", amount: config.rent, expense_date: dateStr, bill_type: "Rent", bill_month: currentYearMonth },
                { expense_title: "Electric Bill - Automated Monthly Electricity", amount: config.electric, expense_date: dateStr, bill_type: "Electric", bill_month: currentYearMonth },
                { expense_title: "Internet Bill - Automated Monthly Internet", amount: config.internet, expense_date: dateStr, bill_type: "Internet", bill_month: currentYearMonth }
            ];

            for (const bill of autoBills) {
                if (bill.amount > 0 && getToken()) {
                    await apiFetch('/api/expenses', {
                        method: 'POST',
                        body: JSON.stringify(bill)
                    }).catch(() => {});
                }
            }
            localStorage.setItem("veyr_last_applied_month", currentYearMonth);
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
        alert(result.error || 'Failed to save bill');
        return;
    }

    document.getElementById("billModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
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
    lb.innerHTML = '<img src="' + src + '" style="max-width:90%;max-height:90%;border-radius:8px">';
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
            alert('No image available');
        }
    } catch {
        alert('Failed to load image');
    }
}

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        // Clear cached CNIC images so fresh ones are loaded on next view
        Object.keys(cnicCache).forEach(k => delete cnicCache[k]);
        allBookingsCache = data.bookings || [];
        renderBookingsTable(allBookingsCache);
        populateFinanceTables(data);
        calculateMetrics(data);
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
    }
    window.scrollTo(0, 0);
}
function renderBookingsTable(bookings) {
    const bookingTbody = document.querySelector("#bookingsTable tbody");
    if (!bookingTbody) return;

    if (!bookings || bookings.length === 0) {
        bookingTbody.innerHTML = '<tr><td colspan="12" class="empty-state">No bookings found</td></tr>';
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
            '<td>' + name + '</td>' +
            '<td>' + contact + '</td>' +
            '<td>' + room + '</td>' +
            '<td>' + checkIn.replace('T', ' ') + '</td>' +
            '<td>' + checkOut.replace('T', ' ') + '</td>' +
            '<td><span class="badge ' + (type === 'Short Booking' ? 'badge-short-booking' : type === 'Night' ? 'badge-night' : 'badge-full-day') + '">' + type + '</span></td>' +
            '<td>' + Number(amount).toLocaleString() + ' PKR</td>' +
            '<td><span class="badge ' + (status === 'Pending' ? 'badge-pending' : 'badge-paid') + '">' + status + '</span></td>' +
            '<td>' + ref + '</td>' +
            '<td>' + frontLink + '</td>' +
            '<td>' + backLink + '</td>' +
            '<td class="actions-cell">' +
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
            '<td>' + (e.bill_type || (e.expense_title || '-')) + '</td>' +
            '<td>' + (e.expense_title || '-') + '</td>' +
            '<td>' + e.amount + ' PKR</td>' +
            '<td>' + (e.expense_date || e.date || e.created_at) + '</td>' +
            '<td>' + (e.bill_month || (e.expense_date ? e.expense_date.substring(0, 7) : '-')) + '</td>' +
            '<td class="actions-cell">' +
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

    const investmentTbody = document.querySelector("#investmentsTable tbody");
    if (investmentTbody && data.investments) {
        if (!data.investments.length) {
            investmentTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No investments found</td></tr>';
        } else {
            investmentTbody.innerHTML = data.investments.map(i => 
                '<tr>' +
                '<td>' + (i.investor_name || i.category || '-') + '</td>' +
                '<td>' + (i.description || '-') + '</td>' +
                '<td>' + i.amount + ' PKR</td>' +
                '<td>' + (i.investment_date || i.date || i.created_at) + '</td>' +
                '<td class="actions-cell">' +
                    '<button onclick="openEditInvestmentModal(\'' + i._id + '\')" class="btn-primary btn-sm">Edit</button>' +
                    '<button onclick="deleteInvestment(\'' + i._id + '\')" class="btn-danger btn-sm">Delete</button>' +
                '</td>' +
                '</tr>'
            ).join('');
        }
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
    document.getElementById("pendingRevenue").innerText = pendingRev.toLocaleString() + " PKR";
    document.getElementById("totalExpenses").innerText = totalExp.toLocaleString() + " PKR";
    document.getElementById("totalInvestments").innerText = totalInv.toLocaleString() + " PKR";
    document.getElementById("netProfit").innerText = netProf.toLocaleString() + " PKR";
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
            }, 'image/jpeg', 0.45);
        };
        img.src = URL.createObjectURL(file);
    });
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    const frontInput = document.getElementById("idCardFrontFile");
    const backInput = document.getElementById("idCardBackFile");

    let cnic_front = '', cnic_back = '';
    if (frontInput.files && frontInput.files[0]) cnic_front = await compressImage(frontInput.files[0], 800);
    if (backInput.files && backInput.files[0]) cnic_back = await compressImage(backInput.files[0], 800);

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

    try {
        const res = await apiFetch('/api/bookings', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        if (result.success) {
            document.getElementById("bookingModal").style.display = "none";
            e.target.reset();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            fetchDashboardData();
        } else {
            btn.disabled = false;
            btn.textContent = orig;
            alert('Failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
        btn.disabled = false;
        btn.textContent = orig;
        alert('Network error: ' + err.message);
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
    if (frontInput.files && frontInput.files[0]) cnic_front = await compressImage(frontInput.files[0], 800);
    if (backInput.files && backInput.files[0]) cnic_back = await compressImage(backInput.files[0], 800);

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
        } else {
            alert("Failed to update booking.");
        }
    } catch (err) {
        alert('Network error: ' + err.message);
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
    } else {
        alert("Failed to delete booking.");
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
            alert(msg.error || 'Export failed');
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
        alert('Export failed: ' + err.message);
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
        if (!result.success) { alert(result.error || 'Failed to save expense'); return; }
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
        if (!result.success) { alert(result.error || 'Failed to save investment'); return; }
    }

    document.getElementById("financeModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
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
    if (!result.success) { alert(result.error || 'Failed to update expense'); return; }

    document.getElementById("editExpenseModal").style.display = "none";
    fetchDashboardData();
}

async function deleteExpense(id) {
    if (!confirm("Are you sure you want to delete this expense?")) return;

    const res = await apiFetch('/api/expenses/' + id, {
        method: 'DELETE'
    });
    const result = await res.json();
    if (!result.success) { alert(result.error || 'Failed to delete expense'); return; }

    fetchDashboardData();
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
    if (!result.success) { alert(result.error || 'Failed to update investment'); return; }

    document.getElementById("editInvestmentModal").style.display = "none";
    fetchDashboardData();
}

async function deleteInvestment(id) {
    if (!confirm("Are you sure you want to delete this investment?")) return;

    const res = await apiFetch('/api/investments/' + id, {
        method: 'DELETE'
    });
    const result = await res.json();
    if (!result.success) { alert(result.error || 'Failed to delete investment'); return; }

    fetchDashboardData();
}