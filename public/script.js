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
            (b.guest_name && b.guest_name.toLowerCase().includes(searchTerm)) ||
            (b.guestName && b.guestName.toLowerCase().includes(searchTerm))
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

async function checkAndApplyMonthlyBills() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        const config = data.monthlyConfig;
        
        if (!config || (!config.rent && !config.electric && !config.internet)) return;

        const now = new Date();
        const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const lastApplied = localStorage.getItem("veyr_last_applied_month");

        if (now.getDate() === 1 && lastApplied !== currentYearMonth) {
            const dateStr = now.toISOString().split('T')[0];
            
            const autoBills = [
                { expense_title: "Rent - Automated Monthly Rent", amount: config.rent, expense_date: dateStr },
                { expense_title: "Electric Bill - Automated Monthly Electricity", amount: config.electric, expense_date: dateStr },
                { expense_title: "Internet Bill - Automated Monthly Internet", amount: config.internet, expense_date: dateStr }
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
    } catch (err) {
        console.error("Error auto-applying monthly bills:", err);
    }
}

async function loadExistingMonthlyConfig() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        if (data.monthlyConfig) {
            document.getElementById("monthlyRent").value = data.monthlyConfig.rent || "";
            document.getElementById("monthlyElectric").value = data.monthlyConfig.electric || "";
            document.getElementById("monthlyInternet").value = data.monthlyConfig.internet || "";
        }
    } catch (err) {
        console.error("Error loading config:", err);
    }
}

async function handleMonthlyBillsSubmit(e) {
    e.preventDefault();
    const config = {
        rent: Number(document.getElementById("monthlyRent").value || 0),
        electric: Number(document.getElementById("monthlyElectric").value || 0),
        internet: Number(document.getElementById("monthlyInternet").value || 0)
    };

    await fetch('/api/config/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    
    const bills = [
        { expense_title: "Rent - Monthly Fixed Rent", amount: config.rent, expense_date: dateStr },
        { expense_title: "Electric Bill - Monthly Fixed Electric Bill", amount: config.electric, expense_date: dateStr },
        { expense_title: "Internet Bill - Monthly Fixed Internet Bill", amount: config.internet, expense_date: dateStr }
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

    bookingTbody.innerHTML = bookings.map(b => {
        const name = b.guest_name || b.guestName || 'N/A';
        const contact = b.reference_contact || b.guestContact || 'N/A';
        const room = b.roomNumber || 'N/A';
        const checkIn = b.check_in_date || b.checkInDate || '';
        const checkOut = b.checkOutDate || '';
        const type = b.bookingType || 'Full Day';
        const amount = b.payment_amount !== undefined ? b.payment_amount : (b.amount || 0);
        const ref = b.reference_name || b.bookingReference || 'N/A';
        const frontImg = b.cnic_front || b.idCardFront;
        const backImg = b.cnic_back || b.idCardBack;
        const frontLink = frontImg ? `<a href="${frontImg.startsWith('http') || frontImg.startsWith('data') ? frontImg : '/secure_uploads/' + frontImg}" target="_blank">View Front</a>` : 'N/A';
        const backLink = backImg ? `<a href="${backImg.startsWith('http') || backImg.startsWith('data') ? backImg : '/secure_uploads/' + backImg}" target="_blank">View Back</a>` : 'N/A';

        return `
            <tr>
                <td>${name}</td>
                <td>${contact}</td>
                <td>${room}</td>
                <td>${checkIn.replace('T', ' ')}</td>
                <td>${checkOut.replace('T', ' ')}</td>
                <td><span style="padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 500; background: ${type === 'Short Booking' ? '#fef3c7; color: #d97706;' : '#e0e7ff; color: #4338ca;}">${type}</span></td>
                <td>${amount} PKR</td>
                <td>${ref}</td>
                <td>${frontLink}</td>
                <td>${backLink}</td>
                <td><button onclick="deleteBooking('${b.id}')" class="btn-secondary" style="padding: 0.3rem 0.6rem; font-size: 0.8rem;">Delete</button></td>
            </tr>
        `;
    }).join('');
}

function populateFinanceTables(data) {
    const expenseTbody = document.querySelector("#expensesTable tbody");
    if (expenseTbody && data.expenses) {
        expenseTbody.innerHTML = data.expenses.map(e => `
            <tr>
                <td>${e.expense_title || e.category || '-'}</td>
                <td>${e.description || '-'}</td>
                <td>${e.amount} PKR</td>
                <td>${e.expense_date || e.date || e.created_at}</td>
            </tr>
        `).join('');
    }

    const investmentTbody = document.querySelector("#investmentsTable tbody");
    if (investmentTbody && data.investments) {
        investmentTbody.innerHTML = data.investments.map(i => `
            <tr>
                <td>${i.investor_name || i.category || '-'}</td>
                <td>${i.description || '-'}</td>
                <td>${i.amount} PKR</td>
                <td>${i.investment_date || i.date || i.created_at}</td>
            </tr>
        `).join('');
    }
}

function calculateMetrics(data) {
    const totalRev = (data.bookings || []).reduce((sum, item) => sum + Number(item.payment_amount !== undefined ? item.payment_amount : (item.amount || 0)), 0);
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
    
    const formData = new FormData();
    formData.append("guest_name", document.getElementById("guestName").value);
    formData.append("reference_contact", document.getElementById("guestContact").value);
    formData.append("roomNumber", document.getElementById("roomNumber").value);
    formData.append("check_in", document.getElementById("checkInDate").value);
    formData.append("checkOutDate", document.getElementById("checkOutDate").value);
    formData.append("bookingType", document.getElementById("bookingType").value);
    formData.append("payment_amount", Number(document.getElementById("bookingAmount").value));
    formData.append("reference_name", document.getElementById("bookingReference").value);

    if (frontInput.files && frontInput.files[0]) {
        formData.append("cnic_front", frontInput.files[0]);
    }
    if (backInput.files && backInput.files[0]) {
        formData.append("cnic_back", backInput.files[0]);
    }

    await fetch('/api/bookings', {
        method: 'POST',
        body: formData
    });

    document.getElementById("bookingModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
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

        await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } else {
        const payload = {
            investor_name: document.getElementById("financeCategory").value,
            amount: Number(document.getElementById("financeAmount").value),
            investment_date: document.getElementById("financeDate").value
        };

        await fetch('/api/investments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    document.getElementById("financeModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
}