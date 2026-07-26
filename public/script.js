let appData = { bookings: [], expenses: [], investments: [] };

document.addEventListener("DOMContentLoaded", () => {
    fetchData();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('bookingDateInput').value = today;
    document.getElementById('expenseDateInput').value = today;
    document.getElementById('investmentDateInput').value = today;
});

async function fetchData() {
    try {
        const response = await fetch('http://localhost:3000/api/data');
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

    bookingTbody.innerHTML = '';
    expenseTbody.innerHTML = '';
    investmentTbody.innerHTML = '';

    let totalRev = 0;
    let totalExp = 0;
    let totalInv = 0;

    // Render Bookings
    if (data.bookings.length === 0) {
        bookingTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;">No bookings found.</td></tr>`;
    } else {
        data.bookings.forEach(b => {
            totalRev += b.payment_amount;
            bookingTbody.innerHTML += `
                <tr>
                    <td>${b.created_at}</td>
                    <td><strong>${b.guest_name}</strong></td>
                    <td>${b.reference_name}</td>
                    <td>${b.reference_contact}</td>
                    <td class="text-success">Rs. ${b.payment_amount}</td>
                    <td>
                        <a href="http://localhost:3000/secure_uploads/${b.cnic_front}" target="_blank">Front</a> | 
                        <a href="http://localhost:3000/secure_uploads/${b.cnic_back}" target="_blank">Back</a>
                    </td>
                </tr>
            `;
        });
    }

    // Render Expenses
    if (data.expenses.length === 0) {
        expenseTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">No expenses recorded.</td></tr>`;
    } else {
        data.expenses.forEach(e => {
            totalExp += e.amount;
            expenseTbody.innerHTML += `
                <tr>
                    <td>${e.expense_date}</td>
                    <td><strong>${e.expense_title}</strong></td>
                    <td class="text-danger">Rs. ${e.amount}</td>
                </tr>
            `;
        });
    }

    // Render Investments
    if (data.investments.length === 0) {
        investmentTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">No investments recorded.</td></tr>`;
    } else {
        data.investments.forEach(i => {
            totalInv += i.amount;
            investmentTbody.innerHTML += `
                <tr>
                    <td>${i.investment_date}</td>
                    <td><strong>${i.investor_name}</strong></td>
                    <td class="text-info">Rs. ${i.amount}</td>
                </tr>
            `;
        });
    }

    let netProfit = totalRev - totalExp;

    document.getElementById('stat-total-bookings').innerText = data.bookings.length;
    document.getElementById('stat-revenue').innerText = `Rs. ${totalRev}`;
    document.getElementById('stat-expenses').innerText = `Rs. ${totalExp}`;
    document.getElementById('stat-investment').innerText = `Rs. ${totalInv}`;
    document.getElementById('stat-profit').innerText = `Rs. ${netProfit}`;
}

async function submitBooking(event) {
    event.preventDefault();
    const formData = new FormData(document.getElementById('bookingForm'));
    const response = await fetch('http://localhost:3000/api/bookings', { method: 'POST', body: formData });
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
    const response = await fetch('http://localhost:3000/api/expenses', {
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
    const response = await fetch('http://localhost:3000/api/investments', {
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
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    const timeFilter = document.getElementById('timeFilter').value;
    const dateQuery = document.getElementById('dateFilter').value;

    const now = new Date();
    
    function matchesTime(dateStr) {
        if (!dateStr) return true;
        const itemDate = new Date(dateStr);

        if (dateQuery) {
            return dateStr === dateQuery;
        }

        if (timeFilter === 'this_week') {
            const startOfWeek = new Date(now);
            startOfWeek.setDate(now.getDate() - now.getDay());
            startOfWeek.setHours(0,0,0,0);
            return itemDate >= startOfWeek;
        }

        if (timeFilter === 'this_month') {
            return itemDate.getFullYear() === now.getFullYear() && itemDate.getMonth() === now.getMonth();
        }

        if (timeFilter === 'last_month') {
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            return itemDate >= lastMonth && itemDate < thisMonth;
        }

        return true;
    }

    const filteredBookings = appData.bookings.filter(b => {
        const matchesName = b.guest_name.toLowerCase().includes(searchQuery) || b.reference_name.toLowerCase().includes(searchQuery);
        return matchesName && matchesTime(b.created_at || b.check_in_date);
    });

    const filteredExpenses = appData.expenses.filter(e => {
        return matchesTime(e.expense_date);
    });

    const filteredInvestments = appData.investments.filter(i => {
        return matchesTime(i.investment_date);
    });

    renderDashboard({ 
        bookings: filteredBookings, 
        expenses: filteredExpenses, 
        investments: filteredInvestments 
    });
}

function resetFilters() {
    document.getElementById('searchInput').value = '';
    document.getElementById('timeFilter').value = 'all';
    document.getElementById('dateFilter').value = '';
    renderDashboard(appData);
}

function openModal(modalId) { document.getElementById(modalId).style.display = 'block'; }
function closeModal(modalId) { document.getElementById(modalId).style.display = 'none'; }