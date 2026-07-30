const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const archiver = require('archiver');

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

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/veyr_stays';

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 3000,
    bufferCommands: false,
    connectTimeoutMS: 3000
}).then(() => console.log('Connected to MongoDB at:', MONGO_URI))
  .catch(err => console.error('MongoDB connection error:', err.message));

mongoose.connection.on('error', err => {
    if (err.message && err.message.includes('timed out')) {
        console.error('MongoDB is not running. Start it or set MONGO_URI env var.');
    }
});

const bookingSchema = new mongoose.Schema({
    guest_name: String,
    reference_name: String,
    reference_contact: String,
    roomNumber: String,
    check_in_date: String,
    checkOutDate: String,
    bookingType: String,
    payment_amount: Number,
    cnic_front: String,
    cnic_back: String,
    created_at: String
}, { versionKey: false });

const expenseSchema = new mongoose.Schema({
    expense_title: String,
    amount: Number,
    expense_date: String,
    created_at: String,
    bill_type: String,
    bill_month: String
}, { versionKey: false });

const investmentSchema = new mongoose.Schema({
    investor_name: String,
    amount: Number,
    investment_date: String,
    created_at: String
}, { versionKey: false });

const monthlyConfigSchema = new mongoose.Schema({
    rent: Number,
    electric: Number,
    internet: Number
}, { versionKey: false });

const Booking = mongoose.model('Booking', bookingSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const Investment = mongoose.model('Investment', investmentSchema);
const MonthlyConfig = mongoose.model('MonthlyConfig', monthlyConfigSchema);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './secure_uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

app.get('/api/data', async (req, res) => {
    try {
        if (mongoose.connection.readyState !== 1) {
            return res.json({ bookings: [], expenses: [], investments: [], monthlyConfig: { rent: 0, electric: 0, internet: 0 } });
        }
        const [bookings, expenses, investments, monthlyConfig] = await Promise.all([
            Booking.find().sort({ _id: -1 }).lean(),
            Expense.find().sort({ _id: -1 }).lean(),
            Investment.find().sort({ _id: -1 }).lean(),
            MonthlyConfig.findOne().sort({ _id: -1 }).lean()
        ]);

        const mappedBookings = bookings.map(b => ({ ...b, id: b._id }));
        const mappedExpenses = expenses.map(e => ({ ...e, id: e._id }));
        const mappedInvestments = investments.map(i => ({ ...i, id: i._id }));

        res.json({
            bookings: mappedBookings,
            expenses: mappedExpenses,
            investments: mappedInvestments,
            monthlyConfig: monthlyConfig || { rent: 0, electric: 0, internet: 0 }
        });
    } catch (err) {
        res.json({ bookings: [], expenses: [], investments: [], monthlyConfig: { rent: 0, electric: 0, internet: 0 } });
    }
});

function isDbConnected() {
    return mongoose.connection.readyState === 1;
}

app.post('/api/config/monthly', async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { rent, electric, internet } = req.body;
        const config = await MonthlyConfig.findOneAndUpdate(
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
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { guest_name, reference_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount } = req.body;
        const cnic_front = req.files && req.files['cnic_front'] ? req.files['cnic_front'][0].filename : '';
        const cnic_back = req.files && req.files['cnic_back'] ? req.files['cnic_back'][0].filename : '';
        const created_at = new Date().toISOString().split('T')[0];

        const booking = await Booking.create({
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
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const result = await Booking.deleteOne({ _id: req.params.id });
        res.json({ message: 'Booking deleted successfully', changes: result.deletedCount });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.put('/api/bookings/:id', async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const { guest_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, reference_name } = req.body;
        const result = await Booking.updateOne(
            { _id: req.params.id },
            { guest_name, reference_contact, roomNumber, check_in_date: check_in, checkOutDate, bookingType, payment_amount, reference_name }
        );
        res.json({ message: 'Booking updated successfully', changes: result.modifiedCount });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.post('/api/expenses', async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { expense_title, amount, expense_date, bill_type, bill_month } = req.body;
        const created_at = new Date().toISOString().split('T')[0];

        const expense = await Expense.create({ expense_title, amount, expense_date, created_at, bill_type, bill_month });
        res.json({ success: true, id: expense._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/investments', async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { investor_name, amount, investment_date } = req.body;
        const created_at = new Date().toISOString().split('T')[0];

        const investment = await Investment.create({ investor_name, amount, investment_date, created_at });
        res.json({ success: true, id: investment._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/export', async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });

        const [bookings, expenses, investments, monthlyConfig] = await Promise.all([
            Booking.find().sort({ _id: -1 }).lean(),
            Expense.find().sort({ _id: -1 }).lean(),
            Investment.find().sort({ _id: -1 }).lean(),
            MonthlyConfig.findOne().sort({ _id: -1 }).lean()
        ]);

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', 'attachment; filename=veyr_stays_export.zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        const data = {
            exported_at: new Date().toISOString(),
            bookings: bookings.map(b => ({ ...b, id: b._id })),
            expenses: expenses.map(e => ({ ...e, id: e._id })),
            investments: investments.map(i => ({ ...i, id: i._id })),
            monthlyConfig: monthlyConfig || { rent: 0, electric: 0, internet: 0 }
        };
        archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });

        const uploadsDir = path.join(__dirname, 'secure_uploads');
        if (fs.existsSync(uploadsDir)) {
            const files = fs.readdirSync(uploadsDir);
            for (const file of files) {
                const filePath = path.join(uploadsDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    archive.file(filePath, { name: 'cnic_images/' + file });
                }
            }
        }

        await archive.finalize();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
