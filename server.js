const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

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

// Use Render's persistent directory if available, otherwise local path
const dbPath = process.env.RENDER 
    ? path.join('/opt/render/project/src', 'veyr_stays.db') 
    : path.join(__dirname, 'veyr_stays.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Database opening error: ' + err.message);
    else console.log('Connected to SQLite database at:', dbPath);
});

// Create tables for Bookings, Expenses, and Investments
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guest_name TEXT,
        reference_name TEXT,
        reference_contact TEXT,
        payment_amount REAL,
        expense_amount REAL,
        investment_amount REAL,
        check_in_date TEXT,
        cnic_front TEXT,
        cnic_back TEXT,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        expense_title TEXT,
        amount REAL,
        expense_date TEXT,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS investments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        investor_name TEXT,
        amount REAL,
        investment_date TEXT,
        created_at TEXT
    )`);
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, './secure_uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

// API: Get All Financial Data (Bookings, Expenses, Investments)
app.get('/api/data', (req, res) => {
    db.all("SELECT * FROM bookings ORDER BY id DESC", [], (err, bookings) => {
        if (err) return res.status(500).json({ error: err.message });
        
        db.all("SELECT * FROM expenses ORDER BY id DESC", [], (err, expenses) => {
            if (err) return res.status(500).json({ error: err.message });

            db.all("SELECT * FROM investments ORDER BY id DESC", [], (err, investments) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({ bookings, expenses, investments });
            });
        });
    });
});

// API: Add Booking
app.post('/api/bookings', upload.fields([{ name: 'cnic_front' }, { name: 'cnic_back' }]), (req, res) => {
    const { guest_name, reference_name, reference_contact, payment_amount, expense_amount, investment_amount, check_in } = req.body;
    const cnic_front = req.files && req.files['cnic_front'] ? req.files['cnic_front'][0].filename : '';
    const cnic_back = req.files && req.files['cnic_back'] ? req.files['cnic_back'][0].filename : '';
    const created_at = new Date().toISOString().split('T')[0];

    const query = `INSERT INTO bookings (guest_name, reference_name, reference_contact, payment_amount, expense_amount, investment_amount, check_in_date, cnic_front, cnic_back, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(query, [guest_name, reference_name, reference_contact, payment_amount || 0, expense_amount || 0, investment_amount || 0, check_in, cnic_front, cnic_back, created_at], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// API: Add Expense (Rent, Bills, etc.)
app.post('/api/expenses', (req, res) => {
    const { expense_title, amount, expense_date } = req.body;
    const created_at = new Date().toISOString().split('T')[0];

    db.run(`INSERT INTO expenses (expense_title, amount, expense_date, created_at) VALUES (?, ?, ?, ?)`, 
    [expense_title, amount, expense_date, created_at], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

// API: Add Investment
app.post('/api/investments', (req, res) => {
    const { investor_name, amount, investment_date } = req.body;
    const created_at = new Date().toISOString().split('T')[0];

    db.run(`INSERT INTO investments (investor_name, amount, investment_date, created_at) VALUES (?, ?, ?, ?)`, 
    [investor_name, amount, investment_date, created_at], function(err) {
        if (err) return res.json({ success: false, error: err.message });
        res.json({ success: true, id: this.lastID });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});