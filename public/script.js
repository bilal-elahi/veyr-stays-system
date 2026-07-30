let allBookingsCache = [];
let allExpensesCache = [];

document.addEventListener("DOMContentLoaded", () => {
    checkAndApplyMonthlyBills();
    fetchDashboardData();

    setupModal("openBookingModal", "bookingModal", "close-modal");
    setupModal("openBillModal", "billModal", "close-modal");
    setupModal("openFinanceModal", "financeModal", "close-modal");
    setupModal(null, "editBookingModal", "close-modal"); // Setup edit modal closing events

    document.getElementById("exportBtn").addEventListener("click", handleExport);

    document.getElementById("bookingForm").addEventListener("submit", handleBookingSubmit);
    document.getElementById("editBookingForm").addEventListener("submit", handleEditBookingSubmit);
    document.getElementById("billForm").addEventListener("submit", handleBillSubmit);
    document.getElementById("financeForm").addEventListener("submit", handleFinanceSubmit);

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

    const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

    if (!bookings || bookings.length === 0) {
        bookingTbody.innerHTML = '<tr><td colspan="11" class="empty-state">No bookings found</td></tr>';
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
        const ref = b.reference_name || b.bookingReference || 'N/A';
        const frontImg = b.cnic_front || b.idCardFront;
        const backImg = b.cnic_back || b.idCardBack;
        
        const frontLink = frontImg ? '<a href="' + (frontImg.startsWith('http') || frontImg.startsWith('data') ? frontImg : '/secure_uploads/' + frontImg) + '" target="_blank">View Front</a>' : 'N/A';
        const backLink = backImg ? '<a href="' + (backImg.startsWith('http') || backImg.startsWith('data') ? backImg : '/secure_uploads/' + backImg) + '" target="_blank">View Back</a>' : 'N/A';

        return '<tr>' +
            '<td>' + name + '</td>' +
            '<td>' + contact + '</td>' +
            '<td>' + room + '</td>' +
            '<td>' + checkIn.replace('T', ' ') + '</td>' +
            '<td>' + checkOut.replace('T', ' ') + '</td>' +
            '<td><span class="badge ' + (type === 'Short Booking' ? 'badge-short-booking' : type === 'Night' ? 'badge-night' : 'badge-full-day') + '">' + type + '</span></td>' +
            '<td>' + Number(amount).toLocaleString() + ' PKR</td>' +
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
        document.querySelector("#expensesTable tbody").innerHTML = '<tr><td colspan="5" class="empty-state">No expenses found</td></tr>';
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
        expenseTbody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses for this month</td></tr>';
    } else {
        expenseTbody.innerHTML = filtered.map(e =>
            '<tr>' +
            '<td>' + (e.bill_type || (e.expense_title || '-')) + '</td>' +
            '<td>' + (e.expense_title || '-') + '</td>' +
            '<td>' + e.amount + ' PKR</td>' +
            '<td>' + (e.expense_date || e.date || e.created_at) + '</td>' +
            '<td>' + (e.bill_month || (e.expense_date ? e.expense_date.substring(0, 7) : '-')) + '</td>' +
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
    renderFilteredExpenses();

    const investmentTbody = document.querySelector("#investmentsTable tbody");
    if (investmentTbody && data.investments) {
        investmentTbody.innerHTML = data.investments.map(i => 
            '<tr>' +
            '<td>' + (i.investor_name || i.category || '-') + '</td>' +
            '<td>' + (i.description || '-') + '</td>' +
            '<td>' + i.amount + ' PKR</td>' +
            '<td>' + (i.investment_date || i.date || i.created_at) + '</td>' +
            '</tr>'
        ).join('');
    }
}

function calculateMetrics(data) {
    const totalRev = (data.bookings || []).reduce((sum, item) => sum + Number(item.payment_amount !== undefined ? item.payment_amount : (item.amount || 0)), 0);
    const totalExp = (data.expenses || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalInv = (data.investments || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const netProf = totalRev - totalExp;

    document.getElementById("totalRevenue").innerText = totalRev.toLocaleString() + " PKR";
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
                resolve(new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
            }, 'image/jpeg', 0.6);
        };
        img.src = URL.createObjectURL(file);
    });
}

async function handleBookingSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);

    const frontInput = document.getElementById("idCardFrontFile");
    const backInput = document.getElementById("idCardBackFile");

    formData.set("guest_name", document.getElementById("guestName").value);
    formData.set("reference_contact", document.getElementById("guestContact").value);
    formData.set("roomNumber", document.getElementById("roomNumber").value);
    formData.set("check_in", document.getElementById("checkInDate").value);
    formData.set("checkOutDate", document.getElementById("checkOutDate").value);
    formData.set("bookingType", document.getElementById("bookingType").value);
    formData.set("payment_amount", Number(document.getElementById("bookingAmount").value));
    formData.set("reference_name", document.getElementById("bookingReference").value);

    if (frontInput.files && frontInput.files[0]) {
        formData.set("cnic_front", await compressImage(frontInput.files[0], 1200));
    }
    if (backInput.files && backInput.files[0]) {
        formData.set("cnic_back", await compressImage(backInput.files[0], 1200));
    }

    try {
        const res = await fetch('/api/bookings', {
            method: 'POST',
            body: formData
        });
        const result = await res.json();

        if (result.success) {
            document.getElementById("bookingModal").style.display = "none";
            e.target.reset();
            fetchDashboardData();
        } else {
            alert('Failed: ' + (result.error || 'Unknown error'));
        }
    } catch (err) {
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
    document.getElementById("editBookingReference").value = booking.reference_name || booking.bookingReference || '';

    document.getElementById("editBookingModal").style.display = "flex";
}

async function handleEditBookingSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("editBookingId").value;

    const payload = {
        guest_name: document.getElementById("editGuestName").value,
        reference_contact: document.getElementById("editGuestContact").value,
        roomNumber: document.getElementById("editRoomNumber").value,
        check_in: document.getElementById("editCheckInDate").value,
        checkOutDate: document.getElementById("editCheckOutDate").value,
        bookingType: document.getElementById("editBookingType").value,
        payment_amount: Number(document.getElementById("editBookingAmount").value),
        reference_name: document.getElementById("editBookingReference").value
    };

    const response = await fetch(`/api/bookings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        document.getElementById("editBookingModal").style.display = "none";
        fetchDashboardData();
    } else {
        alert("Failed to update booking.");
    }
}

async function deleteBooking(id) {
    if (!confirm("Are you sure you want to delete this booking?")) return;

    const response = await fetch(`/api/bookings/${id}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        fetchDashboardData();
    } else {
        alert("Failed to delete booking.");
    }
}

function handleExport() {
    const a = document.createElement('a');
    a.href = '/api/export';
    a.download = 'veyr_stays_export.zip';
    a.click();
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

        const res = await fetch('/api/expenses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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

        const res = await fetch('/api/investments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (!result.success) { alert(result.error || 'Failed to save investment'); return; }
    }

    document.getElementById("financeModal").style.display = "none";
    e.target.reset();
    fetchDashboardData();
}