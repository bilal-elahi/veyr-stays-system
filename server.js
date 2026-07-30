const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const archiver = require('archiver');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
});
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (useCloudinary) console.log('Cloudinary enabled');
else console.log('Cloudinary not configured — images stored as base64 in MongoDB');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'Veyr Stays';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '7583';
const JWT_SECRET = process.env.JWT_SECRET || 'veyr-stays-jwt-secret-' + Math.random().toString(36).slice(2);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

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

function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    try {
        jwt.verify(header.split(' ')[1], JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Unauthorized' });
    }
}

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token });
    }
    res.json({ success: false, error: 'Invalid credentials' });
});

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

app.post('/api/config/monthly', authMiddleware, async (req, res) => {
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

async function uploadImage(base64Str) {
    if (!base64Str) return '';
    if (!useCloudinary) return base64Str;
    try {
        const result = await cloudinary.uploader.upload(base64Str, {
            folder: 'veyr_stays',
            transformation: { width: 1200, quality: 60, fetch_format: 'auto' }
        });
        return result.secure_url;
    } catch {
        return base64Str;
    }
}

app.post('/api/bookings', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { guest_name, reference_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, cnic_front, cnic_back } = req.body;
        const created_at = new Date().toISOString().split('T')[0];

        const [cnicFrontUrl, cnicBackUrl] = await Promise.all([
            uploadImage(cnic_front),
            uploadImage(cnic_back)
        ]);

        const booking = await Booking.create({
            guest_name, reference_name, reference_contact, roomNumber,
            check_in_date: check_in, checkOutDate, bookingType,
            payment_amount: Number(payment_amount) || 0,
            cnic_front: cnicFrontUrl || '', cnic_back: cnicBackUrl || '', created_at
        });

        res.json({ success: true, id: booking._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.delete('/api/bookings/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const result = await Booking.deleteOne({ _id: req.params.id });
        res.json({ message: 'Booking deleted successfully', changes: result.deletedCount });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.put('/api/bookings/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const { guest_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, reference_name, cnic_front, cnic_back } = req.body;

        const update = { guest_name, reference_contact, roomNumber, check_in_date: check_in, checkOutDate, bookingType, payment_amount, reference_name };
        if (cnic_front) update.cnic_front = await uploadImage(cnic_front);
        if (cnic_back) update.cnic_back = await uploadImage(cnic_back);

        const result = await Booking.updateOne({ _id: req.params.id }, update);
        res.json({ message: 'Booking updated successfully', changes: result.modifiedCount });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.post('/api/expenses', authMiddleware, async (req, res) => {
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

app.post('/api/investments', authMiddleware, async (req, res) => {
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
        if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });

        const [bookings, expenses, investments, monthlyConfig] = await Promise.all([
            Booking.find().sort({ _id: -1 }).lean(),
            Expense.find().sort({ _id: -1 }).lean(),
            Investment.find().sort({ _id: -1 }).lean(),
            MonthlyConfig.findOne().sort({ _id: -1 }).lean()
        ]);

        const tmpFile = path.join(os.tmpdir(), 'veyr_export_' + Date.now() + '.zip');
        const output = fs.createWriteStream(tmpFile);
        const archive = new archiver.ZipArchive({ zlib: { level: 9 } });

        const done = new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            output.on('error', reject);
        });

        archive.pipe(output);

        const data = {
            exported_at: new Date().toISOString(),
            bookings: bookings.map(b => ({ ...b, id: b._id })),
            expenses: expenses.map(e => ({ ...e, id: e._id })),
            investments: investments.map(i => ({ ...i, id: i._id })),
            monthlyConfig: monthlyConfig || { rent: 0, electric: 0, internet: 0 }
        };
        archive.append(JSON.stringify(data, null, 2), { name: 'data.json' });

        await archive.finalize();
        await done;

        res.download(tmpFile, 'veyr_stays_export.zip', () => fs.unlink(tmpFile, () => {}));
    } catch (err) {
        if (!res.headersSent) return res.status(500).json({ error: err.message });
        res.end();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
