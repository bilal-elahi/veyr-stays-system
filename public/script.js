let allBookingsCache = [];

document.addEventListener("DOMContentLoaded", () => {
    checkAndApplyMonthlyBills();
    fetchDashboardData();

    // Modal Handling Logic
    setupModal("openBookingModal", "bookingModal", "close-modal");
    setupModal("openMonthlyExpenseModal", "monthlyExpenseModal", "close-modal");
    setupModal("openFinanceModal", "financeModal", "close-modal");

    // Form submissions
    document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);
    document.getElementById("monthlyBillsForm").addEventListener("submit", handleMonthlyBillsSubmit);
    document.getElementById("financeForm").addEventListener("submit", handleFinanceSubmit);

    // Search input listener
    document.getElementById("searchBookingInput").addEventListener("input", (e) => {
        const searchTerm = e.target.value.toLowerCase().trim();
        const filtered = allBookingsCache.filter(b => 
            b.guestName && b.guestName.toLowerCase().includes(searchTerm)
        );
        renderBookingsTable(filtered);
    });
});

function setupModal(openBtnId, modalId, closeClass) {
    const openBtn = document.getElementById(openBtnId);
    const modal = document.getElementById(modalId);
    if (!openBtn || !modal) return;

    openBtn.addEventListener("click", () => {
        modal.style.display = "flex";
        if (modalId === 'monthlyExpenseModal') {
            loadExistingMonthlyConfig();
        }
    });
    
    modal.querySelectorAll(`.${closeClass}`).forEach(el => {
        el.addEventListener("click", () => modal.style.display = "none");
    });

    window.addEventListener("click", (e) => {
        if (e.target === modal) modal.style.display = "none";
    });
}

// Automatically check if today is the 1st of the month and add fixed recurring bills if not already added
async function checkAndApplyMonthlyBills() {
    const config = JSON.parse(localStorage.getItem("veyr_monthly_bills_config") || "null");
    if (!config) return;

    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastApplied = localStorage.getItem("veyr_last_applied_month");

    // If today is the 1st day of the month (or testing) and hasn't been added for this month yet
    if (now.getDate() === 1 && lastApplied !== currentYearMonth) {
        const dateStr = now.toISOString().split('T')[0];
        
        const autoBills = [
            { category: "Rent", description: "Automated Monthly Rent", amount: config.rent, date: dateStr },
            { category: "Electric Bill", description: "Automated Monthly Electricity", amount: config.electric, date: dateStr },
            { category: "Internet Bill", description: "Automated Monthly Internet", amount: config.internet, date: dateStr }
        ];

        for (const bill of autoBills) {
            if (bill.amount > 0) {
                await fetch('/api/expenses', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(bill)
                });
            }
        }
        localStorage.setItem("veyr_last_applied_month", currentYearMonth);
    }
}

function loadExistingMonthlyConfig() {
    const config = JSON.parse(localStorage.getItem("veyr_monthly_bills_config") || "{}");
    document.getElementById("monthlyRent").value = config.rent || "";
    document.getElementById("monthlyElectric").value = config.electric || "";
    document.getElementById("monthlyInternet").value = config.internet || "";
}

async function handleMonthlyBillsSubmit(e) {
    e.preventDefault();
    const config = {
        rent: Number(document.getElementById("monthlyRent").value || 0),
        electric: Number(document.getElementById("monthlyElectric").value || 0),
        internet: Number(document.getElementById("monthlyInternet").value || 0)
    };

    localStorage.setItem("veyr_monthly_bills_config", JSON.stringify(config));
    
    // Immediately inject them for the current month if configured
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    const bills = [
        { category: "Rent", description: "Monthly Fixed Rent", amount: config.rent, date: dateStr },
        { category: "Electric Bill", description: "Monthly Fixed Electric Bill", amount: config.electric, date: dateStr },
        { category: "Internet Bill", description: "Monthly Fixed Internet Bill", amount: config.internet, date: dateStr }
    ];

    for (const bill of bills) {
        if (bill.amount > 0) {
            await fetch('/api/expenses', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bill)
            });
        }
    }

    document.getElementById("monthlyExpenseModal").style.display = "none";
    fetchDashboardData();
}

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        allBookingsCache = data.bookings || [];
        renderBookingsTable(allBookingsCache);
        populateFinanceTables(data);
        calculateMetrics(data);
    } catch (error) {
        console.error("Error fetching dashboard data:", error);
    }
}

function renderBookingsTable(bookings) {
    const bookingTbody = document.querySelector("#bookingsTable tbody");
    if (!bookingTbody) return;

    if (bookings.length === 0) {
        bookingTbody.innerHTML = `<tr><td colspan="11" style="text-align: center; color: var(--text-muted);">No bookings found</td></tr>`;
        return;
    }

    bookingTbody.innerHTML = bookings.map(b => `
        <tr>
            <td>${b.guestName}</td>
            <td>${b.guestContact}</td>
            <td>${b.roomNumber}</td>
            <td>${b.checkInDate ? b.checkInDate.replace('T', ' ') : ''}</td>
            <td>${b.checkOutDate ? b.checkOutDate.replace('T', ' ') : ''}</td>
            <td><span style="padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 500; background: ${b.bookingType === 'Short Booking' ? '#fef3c7; color: #d97706;' : '#e0e7ff; color: #4338ca;}">${b.bookingType || 'Full Day'}</span></td>
            <td>${b.amount} PKR</td>
            <td>${b.bookingReference || 'N/A'}</td>
            <td>${b.idCardFront ? `<a href="${b.idCardFront}" target="_blank">View Front</a>` : 'N/A'}</td>
            <td>${b.idCardBack ? `<a href="${b.idCardBack}" target="_blank">View Back</a>` : 'N/A'}</td>
            <td><button onclick="deleteBooking('${b.id}')" class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Delete</button></td>
        </tr>
    `).join('');
}

function populateFinanceTables(data) {
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
    
    const frontInput = document.getElementById("idCardFrontFile");
    const backInput = document.getElementById("idCardBackFile");
    
    let frontUrl = "";
    let backUrl = "";

    if (frontInput.files && frontInput.files[0]) {
        frontUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target.result);
            reader.readAsDataURL(frontInput.files[0]);
        });
    }

    if (backInput.files && backInput.files[0]) {
        backUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target.result);
            reader.readAsDataURL(backInput.files[0]);
        });
    }

    const payload = {
        guestName: document.getElementById("guestName").value,
        guestContact: document.getElementById("guestContact").value,
        roomNumber: document.getElementById("roomNumber").value,
        checkInDate: document.getElementById("checkInDate").value,
        checkOutDate: document.getElementById("checkOutDate").value,
        bookingType: document.getElementById("bookingType").value,
        amount: document.getElementById("bookingAmount").value,
        bookingReference: document.getElementById("bookingReference").value,
        idCardFront: frontUrl,
        idCardBack: backUrl
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