document.addEventListener("DOMContentLoaded", () => {
    fetchDashboardData();

    // Modal Handling Logic
    setupModal("openBookingModal", "bookingModal", "close-modal");
    setupModal("openFinanceModal", "financeModal", "close-modal");

    // Form submissions
    document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);
    document.getElementById("financeForm").addEventListener("submit", handleFinanceSubmit);
});

function setupModal(openBtnId, modalId, closeClass) {
    const openBtn = document.getElementById(openBtnId);
    const modal = document.getElementById(modalId);
    if (!openBtn || !modal) return;

    openBtn.addEventListener("click", () => modal.style.display = "flex");
    
    modal.querySelectorAll(`.${closeClass}`).forEach(el => {
        el.addEventListener("click", () => modal.style.display = "none");
    });

    window.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
    });
}

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/data'); // Adjust endpoint if needed
        const data = await response.json();
        
        populateTables(data);
        calculateMetrics(data);
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
    }
}

function populateTables(data) {
    // Populate Bookings
    const bookingTbody = document.querySelector("#bookingsTable tbody");
    if (bookingTbody && data.bookings) {
        bookingTbody.innerHTML = data.bookings.map(b => `
            <tr>
                <td>${b.guestName}</td>
                <td>${b.guestContact}</td>
                <td>${b.roomNumber}</td>
                <td>${b.checkInDate}</td>
                <td>${b.checkOutDate}</td>
                <td>${b.amount} PKR</td>
                <td>${b.idCardInfo ? `<a href="${b.idCardInfo}" target="_blank">View ID</a>` : 'N/A'}</td>
                <td><button onclick="deleteBooking('${b.id}')" class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Delete</button></td>
            </tr>
        `).join('');
    }

    // Populate Expenses
    const expenseTbody = document.querySelector("#expensesTable tbody");
    if (expenseTbody && data.expenses) {
        expenseTbody.innerHTML = data.expenses.map(e => `
            <tr>
                <td>${e.category}</td>
                <td>${e.description || '-'}</td>
                <td>${e.amount} PKR</td>
                <td>${e.date}</td>
            </tr>
        `).join('');
    }

    // Populate Investments
    const investmentTbody = document.querySelector("#investmentsTable tbody");
    if (investmentTbody && data.investments) {
        investmentTbody.innerHTML = data.investments.map(i => `
            <tr>
                <td>${i.category}</td>
                <td>${i.description || '-'}</td>
                <td>${i.amount} PKR</td>
                <td>${i.date}</td>
            </tr>
        `).join('');
    }
}

function calculateMetrics(data) {
    const totalRev = (data.bookings || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalExp = (data.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInv = (data.investments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const netProf = totalRev - totalExp;

    document.getElementById("totalRevenue").innerText = `${totalRev.toLocaleString()} PKR`;
    document.getElementById("totalExpenses").innerText = `${totalExp.toLocaleString()} PKR`;
    document.getElementById("totalInvestments").innerText = `${totalInv.toLocaleString()} PKR`;
    document.getElementById("netProfit").innerText = `${netProf.toLocaleString()} PKR`;
}

async function handleBookingSubmit(e) {
    e.preventDefault();
    const payload = {
        guestName: document.getElementById("guestName").value,
        guestContact: document.getElementById("guestContact").value,
        roomNumber: document.getElementById("roomNumber").value,
        checkInDate: document.getElementById("checkInDate").value,
        checkOutDate: document.getElementById("checkOutDate").value,
        amount: document.getElementById("bookingAmount").value,
        idCardInfo: document.getElementById("idCardInfo").value
    };

    await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    document.getElementById("bookingModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
}

async function handleFinanceSubmit(e) {
    e.preventDefault();
    const type = document.getElementById("financeType").value;
    const payload = {
        category: document.getElementById("financeCategory").value,
        description: document.getElementById("financeDescription").value,
        amount: document.getElementById("financeAmount").value,
        date: document.getElementById("financeDate").value
    };

    const endpoint = type === 'expense' ? '/api/expenses' : '/api/investments';

    await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    document.getElementById("financeModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
}