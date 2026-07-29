const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/secure_uploads', express.static(path.join(__dirname, 'secure_uploads')));

if (!fs.existsSync('./secure_uploads')) {
    fs.mkdirSync('./secure_uploads');
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './secure_uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.get('/api/data', async (req, res) => {
    try {
        const bookings = db.bookings.sort('-_id').lean();
        const expenses = db.expenses.sort('-_id').lean();
        const investments = db.investments.sort('-_id').lean();
        let monthlyConfig = db.monthlyConfig.findOneAndUpdate({}, {}, { upsert: false, lean: true });
        if (!monthlyConfig) monthlyConfig = { rent: 0, electric: 0, internet: 0 };

        const mappedBookings = bookings.map(b => ({ ...b, id: b._id }));
        const mappedExpenses = expenses.map(e => ({ ...e, id: e._id }));
        const mappedInvestments = investments.map(i => ({ ...i, id: i._id }));

        res.json({
            bookings: mappedBookings,
            expenses: mappedExpenses,
            investments: mappedInvestments,
            monthlyConfig
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/config/monthly', async (req, res) => {
    try {
        const { rent, electric, internet } = req.body;
        const config = db.monthlyConfig.findOneAndUpdate(
            {},
            { rent: rent || 0, electric: electric || 0, internet: internet || 0 },
            { upsert: true, new: true, lean: true }
        );
        res.json({ success: true, monthlyConfig: { rent: config.rent, electric: config.electric, internet: config.internet } });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/bookings', upload.fields([{ name: 'cnic_front' }, { name: 'cnic_back' }]), async (req, res) => {
    try {
        const { guest_name, reference_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount } = req.body;
        const cnic_front = req.files && req.files['cnic_front'] ? req.files['cnic_front'][0].filename : '';
        const cnic_back = req.files && req.files['cnic_back'] ? req.files['cnic_back'][0].filename : '';
        const created_at = new Date().toISOString().split('T')[0];

        const booking = await db.bookings.create({
            guest_name, reference_name, reference_contact, roomNumber,
            check_in_date: check_in, checkOutDate, bookingType,
            payment_amount: Number(payment_amount) || 0,
            cnic_front, cnic_back, created_at
        });

        res.json({ success: true, id: booking._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.delete('/api/bookings/:id', async (req, res) => {
    try {
        const result = await db.bookings.deleteOne({ _id: req.params.id });
        res.json({ message: 'Booking deleted successfully', changes: result.deletedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/bookings/:id', async (req, res) => {
    try {
        const { guest_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, reference_name } = req.body;
        const result = await db.bookings.updateOne(
            { _id: req.params.id },
            { guest_name, reference_contact, roomNumber, check_in_date: check_in, checkOutDate, bookingType, payment_amount, reference_name }
        );
        res.json({ message: 'Booking updated successfully', changes: result.modifiedCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/expenses', async (req, res) => {
    try {
        const { expense_title, amount, expense_date, bill_type, bill_month } = req.body;
        const created_at = new Date().toISOString().split('T')[0];

        const expense = await db.expenses.create({ expense_title, amount, expense_date, created_at, bill_type, bill_month });
        res.json({ success: true, id: expense._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/investments', async (req, res) => {
    try {
        const { investor_name, amount, investment_date } = req.body;
        const created_at = new Date().toISOString().split('T')[0];

        const investment = await db.investments.create({ investor_name, amount, investment_date, created_at });
        res.json({ success: true, id: investment._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
