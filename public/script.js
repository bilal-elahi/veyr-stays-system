let appData = { bookings: [], expenses: [], investments: [] };

document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    const today = new Date().toISOString().split('T')[0];
    
    // Safely set dates if inputs exist
    const bookingDate = document.getElementById('bookingDateInput');
    const expenseDate = document.getElementById('expenseDateInput');
    const investmentDate = document.getElementById('investmentDateInput');
    
    if (bookingDate) bookingDate.value = today;
    if (expenseDate) expenseDate.value = today;
    if (investmentDate) investmentDate.value = today;
});

async function fetchData() {
    try {
        const response = await fetch('/api/data');
        if (!response.ok) throw new Error('Failed to fetch data');
        appData = await response.json();
        renderDashboard(appData);
    } catch (err) {
        console.error("Failed to load data:", err);
    }
}

function renderDashboard(data) {
    const bookingTbody = document.getElementById('bookingsTableBody');
    const expenseTbody = document.getElementById('expensesTableBody');
    const investmentTbody = document.getElementById('investmentsTableBody');

    if (!bookingTbody || !expenseTbody || !investmentTbody) return;

    bookingTbody.innerHTML = '';
    expenseTbody.innerHTML = '';
    investmentTbody.innerHTML = '';

    let totalRev = 0;
    let totalExp = 0;
    let totalInv = 0;

    // Render Bookings
    if (!data.bookings || data.bookings.length === 0) {
        bookingTbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px; color: var(--text-2);">No bookings found.</td></tr>`;
    } else {
        data.bookings.forEach(b => {
            totalRev += Number(b.payment_amount || 0);
            bookingTbody.innerHTML += `
                <tr>
                    <td>${b.created_at || '-'}</td>
                    <td><strong>${b.guest_name || '-'}</strong></td>
                    <td>${b.reference_name || '-'}</td>
                    <td>${b.reference_contact || '-'}</td>
                    <td class="text-success">Rs. ${b.payment_amount || 0}</td>
                    <td>
                        ${b.cnic_front ? `<a href="/secure_uploads/${b.cnic_front}" target="_blank">Front</a>` : ''} 
                        ${b.cnic_back ? `| <a href="/secure_uploads/${b.cnic_back}" target="_blank">Back</a>` : ''}
                    </td>
                </tr>
            `;
        });
    }

    // Render Expenses
    if (!data.expenses || data.expenses.length === 0) {
        expenseTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 24px; color: var(--text-2);">No expenses recorded.</td></tr>`;
    } else {
        data.expenses.forEach(e => {
            totalExp += Number(e.amount || 0);
            expenseTbody.innerHTML += `
                <tr>
                    <td>${e.expense_date || '-'}</td>
                    <td><strong>${e.expense_title || '-'}</strong></td>
                    <td class="text-danger">Rs. ${e.amount || 0}</td>
                </tr>
            `;
        });
    }

    // Render Investments
    if (!data.investments || data.investments.length === 0) {
        investmentTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 24px; color: var(--text-2);">No investments recorded.</td></tr>`;
    } else {
        data.investments.forEach(i => {
            totalInv += Number(i.amount || 0);
            investmentTbody.innerHTML += `
                <tr>
                    <td>${i.investment_date || '-'}</td>
                    <td><strong>${i.investor_name || '-'}</strong></td>
                    <td class="text-info">Rs. ${i.amount || 0}</td>
                </tr>
            `;
        });
    }

    let netProfit = totalRev - totalExp;

    const setInnerText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    setInnerText('stat-total-bookings', data.bookings ? data.bookings.length : 0);
    setInnerText('stat-revenue', `Rs. ${totalRev}`);
    setInnerText('stat-expenses', `Rs. ${totalExp}`);
    setInnerText('stat-investment', `Rs. ${totalInv}`);
    setInnerText('stat-profit', `Rs. ${netProfit}`);
}

async function submitBooking(event) {
    event.preventDefault();
    const formData = new FormData(document.getElementById('bookingForm'));
    const response = await fetch('/api/bookings', { method: 'POST', body: formData });
    const result = await response.json();
    if (result.success) {
        closeModal('bookingModal');
        document.getElementById('bookingForm').reset();
        fetchData();
    } else { alert(result.error); }
}

async function submitExpense(event) {
    event.preventDefault();
    const formData = new FormData(document.getElementById('expenseForm'));
    const data = Object.fromEntries(formData.entries());
    const response = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await response.json();
    if (result.success) {
        closeModal('expenseModal');
        document.getElementById('expenseForm').reset();
        fetchData();
    } else { alert(result.error); }
}

async function submitInvestment(event) {
    event.preventDefault();
    const formData = new FormData(document.getElementById('investmentForm'));
    const data = Object.fromEntries(formData.entries());
    const response = await fetch('/api/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    const result = await response.json();
    if (result.success) {
        closeModal('investmentModal');
        document.getElementById('investmentForm').reset();
        fetchData();
    } else { alert(result.error); }
}

function filterData() {
    const searchInput = document.getElementById('searchInput');
    const timeFilter = document.getElementById('timeFilter');
    const dateFilter = document.getElementById('dateFilter');

    const searchQuery = searchInput ? searchInput.value.toLowerCase() : '';
    const timeFilterVal = timeFilter ? timeFilter.value : 'all';
    const dateQuery = dateFilter ? dateFilter.value : '';

    const now = new Date();
    
    function matchesTime(dateStr) {
        if (!dateStr) return true;
        const itemDate = new Date(dateStr);

        if (dateQuery) {
            return dateStr === dateQuery;
        }

        if (timeFilterVal === 'this_week') {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0,0,0,0);
            return itemDate >= startOfWeek;
        }

        if (timeFilterVal === 'this_month') {
            return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
        }

        if (timeFilterVal === 'last_month') {
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return itemDate >= lastMonth && itemDate < thisMonth;
        }

        return true;
    }

    const filteredBookings = (appData.bookings || []).filter(b => {
        const name = (b.guest_name || '').toLowerCase();
        const ref = (b.reference_name || '').toLowerCase();
        const matchesName = name.includes(searchQuery) || ref.includes(searchQuery);
        return matchesName && matchesTime(b.created_at || b.check_in_date);
    });

    const filteredExpenses = (appData.expenses || []).filter(e => {
        return matchesTime(e.expense_date);
    });

    const filteredInvestments = (appData.investments || []).filter(i => {
        return matchesTime(i.investment_date);
    });

    renderDashboard({ 
        bookings: filteredBookings, 
        expenses: filteredExpenses, 
        investments: filteredInvestments 
    });
}

function resetFilters() {
    const searchInput = document.getElementById('searchInput');
    const timeFilter = document.getElementById('timeFilter');
    const dateFilter = document.getElementById('dateFilter');

    if (searchInput) searchInput.value = '';
    if (timeFilter) timeFilter.value = 'all';
    if (dateFilter) dateFilter.value = '';
    renderDashboard(appData);
}

function openModal(modalId) { 
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'block'; 
}

function closeModal(modalId) { 
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none'; 
}