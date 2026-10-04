const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const archiver = require('archiver');
const cloudinary = require('cloudinary').v2;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || '',
    api_key: process.env.CLOUDINARY_API_KEY || '',
    api_secret: process.env.CLOUDINARY_API_SECRET || ''
});
const useCloudinary = !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET);
if (useCloudinary) console.log('Cloudinary enabled');
else console.log('Cloudinary not configured — images stored as base64 in MongoDB');

const TOKEN_TTL = process.env.TOKEN_TTL || '7d';
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 6;
// A real bcrypt hash of a value nobody can supply; comparing against it keeps the
// "unknown username" login path as slow as the "wrong password" one.
const DUMMY_HASH = '$2b$12$mi5IyPfBtUc43G4zzH7oxuZm1403/UXQ0h7n12nqVtFhaBRL/MSg.';

// Brute-force limits on the public endpoints. Override via env when deploying.
const LOGIN_LIMIT = { windowMs: 10 * 60 * 1000, max: Number(process.env.LOGIN_RATE_MAX || 10) };
const REGISTER_LIMIT = { windowMs: 60 * 60 * 1000, max: Number(process.env.REGISTER_RATE_MAX || 5) };
const FORGOT_LIMIT = { windowMs: 60 * 60 * 1000, max: Number(process.env.FORGOT_RATE_MAX || 5) };

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/veyr_stays';

async function connectDb() {
    await mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 3000,
        bufferCommands: false,
        connectTimeoutMS: 3000
    });
    console.log('Connected to MongoDB at:', MONGO_URI);
    await initSystem();
}

mongoose.connection.on('error', err => {
    if (err.message && err.message.includes('timed out')) {
        console.error('MongoDB is not running. Start it or set MONGO_URI env var.');
    }
});

/* ---------------------------------- models --------------------------------- */

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password_hash: { type: String, required: true },
    property_name: { type: String, default: '' },
    contact_email: { type: String, default: '' },
    is_admin: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },
    created_at: String,
    last_login_at: String
}, { versionKey: false });

const passwordResetSchema = new mongoose.Schema({
    user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    username: String,
    contact: String,
    status: { type: String, default: 'pending' },
    requested_at: String,
    resolved_at: String,
    resolved_by: String
}, { versionKey: false });

const bookingSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    booking_number: Number,
    guest_name: String,
    reference_name: String,
    reference_contact: String,
    roomNumber: String,
    check_in_date: String,
    checkOutDate: String,
    bookingType: String,
    payment_amount: Number,
    payment_status: { type: String, default: 'Paid' },
    cnic_front: String,
    cnic_back: String,
    created_at: String
}, { versionKey: false });

const expenseSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    expense_title: String,
    amount: Number,
    expense_date: String,
    created_at: String,
    bill_type: String,
    bill_month: String
}, { versionKey: false });

const investmentSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    investor_name: String,
    amount: Number,
    investment_date: String,
    created_at: String
}, { versionKey: false });

const monthlyConfigSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    rent: Number,
    electric: Number,
    internet: Number
}, { versionKey: false });

const counterSchema = new mongoose.Schema({
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true },
    seq: { type: Number, default: 0 }
}, { versionKey: false });

const systemSettingSchema = new mongoose.Schema({
    key: { type: String, unique: true },
    value: String
}, { versionKey: false });

const User = mongoose.model('User', userSchema);
const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);
const Booking = mongoose.model('Booking', bookingSchema);
const Expense = mongoose.model('Expense', expenseSchema);
const Investment = mongoose.model('Investment', investmentSchema);
const MonthlyConfig = mongoose.model('MonthlyConfig', monthlyConfigSchema);
const Counter = mongoose.model('Counter', counterSchema);
const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);

/* ---------------------------------- helpers -------------------------------- */

function isDbConnected() {
    return mongoose.connection.readyState === 1;
}

function today() {
    return new Date().toISOString().slice(0, 10);
}

function nowStamp() {
    return new Date().toISOString();
}

function sanitizeUsername(raw) {
    return String(raw || '').trim().toLowerCase();
}

function validateCredentials(username, password) {
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return 'Username must be 3-32 characters (letters, numbers, dot, dash, underscore).';
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return 'Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.';
    }
    if (password.length > 200) return 'Password is too long.';
    return null;
}

function publicUser(user) {
    return {
        id: user._id,
        username: user.username,
        property_name: user.property_name || '',
        contact_email: user.contact_email || '',
        is_admin: !!user.is_admin
    };
}

/* ---------------------------------- auth ----------------------------------- */

let jwtSecretPromise = null;

async function loadJwtSecret() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    const existing = await SystemSetting.findOne({ key: 'jwt_secret' }).lean();
    if (existing && existing.value) return existing.value;
    const generated = crypto.randomBytes(48).toString('hex');
    await SystemSetting.findOneAndUpdate({ key: 'jwt_secret' }, { value: generated }, { upsert: true });
    console.log('Generated a new JWT secret and stored it in the database.');
    return generated;
}

function getJwtSecret() {
    if (!jwtSecretPromise) {
        jwtSecretPromise = loadJwtSecret().catch(err => {
            jwtSecretPromise = null;
            throw err;
        });
    }
    return jwtSecretPromise;
}

async function signToken(user) {
    const secret = await getJwtSecret();
    return jwt.sign({ sub: String(user._id), username: user.username, is_admin: !!user.is_admin }, secret, { expiresIn: TOKEN_TTL });
}

async function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    let payload;
    try {
        payload = jwt.verify(header.split(' ')[1], await getJwtSecret());
    } catch {
        return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
    const user = await User.findById(payload.sub).lean();
    if (!user) return res.status(401).json({ error: 'Account not found. Please log in again.' });
    if (user.is_active === false) return res.status(403).json({ error: 'This account has been deactivated. Contact support.' });
    req.user = user;
    next();
}

function adminMiddleware(req, res, next) {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
}

const rateBuckets = new Map();

function rateLimit(windowMs, max, message) {
    return (req, res, next) => {
        const key = (req.ip || 'unknown') + '|' + req.baseUrl + req.path;
        const now = Date.now();
        let bucket = rateBuckets.get(key);
        if (!bucket || now > bucket.reset) {
            bucket = { count: 0, reset: now + windowMs };
            rateBuckets.set(key, bucket);
        }
        if (rateBuckets.size > 10000) {
            for (const [k, v] of rateBuckets) if (now > v.reset) rateBuckets.delete(k);
        }
        bucket.count += 1;
        if (bucket.count > max) return res.status(429).json({ error: message });
        next();
    };
}

/* -------------------------- bootstrap & migration -------------------------- */

async function nextBookingNumber(ownerId) {
    const counter = await Counter.findOneAndUpdate(
        { owner: ownerId },
        { $inc: { seq: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (counter.seq === 1) {
        // Counter was just created — align it with any bookings that already exist.
        const maxDoc = await Booking.findOne({ owner: ownerId }).sort({ booking_number: -1 }).select('booking_number').lean();
        if (maxDoc && maxDoc.booking_number >= 1) {
            const next = maxDoc.booking_number + 1;
            await Counter.updateOne({ owner: ownerId }, { $set: { seq: next } });
            return next;
        }
    }
    return counter.seq;
}

async function claimOrphanedRecords(ownerId) {
    const orphanFilter = { $or: [{ owner: { $exists: false } }, { owner: null }] };
    const results = await Promise.all([
        Booking.updateMany(orphanFilter, { $set: { owner: ownerId } }),
        Expense.updateMany(orphanFilter, { $set: { owner: ownerId } }),
        Investment.updateMany(orphanFilter, { $set: { owner: ownerId } }),
        MonthlyConfig.updateMany(orphanFilter, { $set: { owner: ownerId } })
    ]);
    const total = results.reduce((sum, r) => sum + (r.modifiedCount || 0), 0);
    if (total > 0) console.log(`Assigned ${total} pre-existing record(s) to the admin account.`);
    return total;
}

async function initSystem() {
    const existingUsers = await User.countDocuments();
    if (existingUsers === 0) {
        const username = sanitizeUsername(process.env.ADMIN_USERNAME || 'admin');
        const password = process.env.ADMIN_PASSWORD || '7583';
        const usernameProblem = validateCredentials(username, password);
        if (usernameProblem) {
            console.log('--------------------------------------------');
            console.log('Cannot create the first admin account:');
            console.log('  ' + usernameProblem);
            console.log('  ADMIN_USERNAME must be 3-32 characters (letters, numbers, dot, dash, underscore).');
            console.log('--------------------------------------------');
            throw new Error('Invalid ADMIN_USERNAME / ADMIN_PASSWORD for the first admin account.');
        }
        const admin = await User.create({
            username,
            password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
            property_name: process.env.ADMIN_PROPERTY_NAME || 'Veyr Stays',
            is_admin: true,
            is_active: true,
            created_at: today()
        });
        console.log('--------------------------------------------');
        console.log('Created the first admin account:');
        console.log('  username: ' + admin.username);
        console.log('  password: ' + password);
        console.log('Set ADMIN_USERNAME / ADMIN_PASSWORD before first boot to change these.');
        console.log('--------------------------------------------');
        await claimOrphanedRecords(admin._id);
        return;
    }
    // Safety net: any record still missing an owner belongs to the first admin.
    const admin = await User.findOne({ is_admin: true }).sort({ _id: 1 }).lean();
    if (admin) await claimOrphanedRecords(admin._id);
}

/* ------------------------------ public auth API ---------------------------- */

app.post('/api/auth/register', rateLimit(REGISTER_LIMIT.windowMs, REGISTER_LIMIT.max, 'Too many accounts created from this device. Try again later.'), async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const username = sanitizeUsername(req.body.username);
    const password = req.body.password;
    const property_name = String(req.body.property_name || '').trim().slice(0, 80);
    const contact_email = String(req.body.contact_email || '').trim().slice(0, 120);

    const invalid = validateCredentials(username, password);
    if (invalid) return res.status(400).json({ error: invalid });

    const taken = await User.findOne({ username }).lean();
    if (taken) return res.status(409).json({ error: 'That username is already taken.' });

    const user = await User.create({
        username,
        password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
        property_name,
        contact_email,
        is_admin: false,
        is_active: true,
        created_at: today()
    });

    await MonthlyConfig.findOneAndUpdate(
        { owner: user._id },
        { $setOnInsert: { rent: 0, electric: 0, internet: 0 } },
        { upsert: true }
    );

    res.json({ success: true, token: await signToken(user), user: publicUser(user) });
});

app.post('/api/auth/login', rateLimit(LOGIN_LIMIT.windowMs, LOGIN_LIMIT.max, 'Too many login attempts. Please wait 10 minutes.'), async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const username = sanitizeUsername(req.body.username);
    const password = String(req.body.password || '');
    const user = await User.findOne({ username }).lean();
    // Always run a bcrypt comparison so a missing user and a wrong password take
    // roughly the same time, which stops usernames being enumerated by timing.
    const matches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !matches) {
        return res.json({ success: false, error: 'Invalid username or password' });
    }
    if (user.is_active === false) {
        return res.json({ success: false, error: 'This account has been deactivated. Please contact support.' });
    }
    await User.updateOne({ _id: user._id }, { $set: { last_login_at: nowStamp() } });
    res.json({ success: true, token: await signToken(user), user: publicUser(user) });
});

app.post('/api/auth/forgot-password', rateLimit(FORGOT_LIMIT.windowMs, FORGOT_LIMIT.max, 'Too many reset requests. Try again later.'), async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const username = sanitizeUsername(req.body.username);
    const contact = String(req.body.contact || '').trim().slice(0, 120);

    // Always respond the same way so usernames cannot be enumerated.
    const user = await User.findOne({ username, is_active: { $ne: false } }).lean();
    if (user) {
        await PasswordReset.updateMany({ user_id: user._id, status: 'pending' }, { $set: { status: 'superseded' } });
        await PasswordReset.create({
            user_id: user._id,
            username: user.username,
            contact,
            status: 'pending',
            requested_at: nowStamp()
        });
    }
    res.json({ success: true, message: 'If that account exists, a reset request has been sent to support.' });
});

/* ---------------------------- authenticated user API ------------------------ */

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: publicUser(req.user) });
});

app.put('/api/auth/password', authMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    const fresh = await User.findById(req.user._id).lean();
    if (!fresh || !(await bcrypt.compare(current, fresh.password_hash || ''))) {
        return res.status(400).json({ error: 'Your current password is incorrect.' });
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'New password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.' });
    }
    await User.updateOne({ _id: fresh._id }, { $set: { password_hash: await bcrypt.hash(next, BCRYPT_ROUNDS) } });
    res.json({ success: true });
});

app.put('/api/auth/profile', authMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const property_name = String(req.body.property_name || '').trim().slice(0, 80);
    const contact_email = String(req.body.contact_email || '').trim().slice(0, 120);
    await User.updateOne({ _id: req.user._id }, { $set: { property_name, contact_email } });
    const fresh = await User.findById(req.user._id).lean();
    res.json({ success: true, user: publicUser(fresh) });
});

/* -------------------------------- admin API -------------------------------- */

app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    const users = await User.find().sort({ _id: 1 }).lean();
    res.json({
        users: users.map(u => ({
            ...publicUser(u),
            is_active: u.is_active !== false,
            created_at: u.created_at || '',
            last_login_at: u.last_login_at || ''
        }))
    });
});

app.get('/api/admin/reset-requests', authMiddleware, adminMiddleware, async (req, res) => {
    const requests = await PasswordReset.find().sort({ _id: -1 }).limit(200).lean();
    res.json({ requests: requests.map(r => ({ ...r, id: r._id })) });
});

app.post('/api/admin/reset-requests/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const newPassword = String(req.body.new_password || '');
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'New password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.' });
    }
    const request = await PasswordReset.findById(req.params.id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.status !== 'pending') return res.status(400).json({ error: 'This request has already been handled.' });

    await User.updateOne(
        { _id: request.user_id },
        { $set: { password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } }
    );
    await PasswordReset.updateOne(
        { _id: request._id },
        { $set: { status: 'resolved', resolved_at: nowStamp(), resolved_by: req.user.username } }
    );
    res.json({ success: true });
});

app.post('/api/admin/reset-requests/:id/cancel', authMiddleware, adminMiddleware, async (req, res) => {
    await PasswordReset.updateOne(
        { _id: req.params.id, status: 'pending' },
        { $set: { status: 'cancelled', resolved_at: nowStamp(), resolved_by: req.user.username } }
    );
    res.json({ success: true });
});

app.post('/api/admin/users/:id/reset-password', authMiddleware, adminMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const newPassword = String(req.body.new_password || '');
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'Password must be at least ' + MIN_PASSWORD_LENGTH + ' characters.' });
    }
    const target = await User.findById(req.params.id).lean();
    if (!target) return res.status(404).json({ error: 'User not found' });
    await User.updateOne({ _id: target._id }, { $set: { password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS) } });
    res.json({ success: true });
});

app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const target = await User.findById(req.params.id).lean();
    if (!target) return res.status(404).json({ error: 'User not found' });

    const update = {};
    if (typeof req.body.is_active === 'boolean') {
        if (target.is_admin && !req.body.is_active) {
            return res.status(400).json({ error: 'You cannot deactivate your own admin account.' });
        }
        update.is_active = req.body.is_active;
    }
    if (req.body.property_name !== undefined) update.property_name = String(req.body.property_name).trim().slice(0, 80);
    if (req.body.contact_email !== undefined) update.contact_email = String(req.body.contact_email).trim().slice(0, 120);
    if (!Object.keys(update).length) return res.status(400).json({ error: 'Nothing to update' });

    await User.updateOne({ _id: target._id }, { $set: update });
    const fresh = await User.findById(target._id).lean();
    res.json({ success: true, user: { ...publicUser(fresh), is_active: fresh.is_active !== false } });
});

app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
    const target = await User.findById(req.params.id).lean();
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.is_admin) return res.status(400).json({ error: 'Admin accounts cannot be deleted.' });

    const [bookings] = await Promise.all([
        Booking.find({ owner: target._id }).select('cnic_front cnic_back').lean()
    ]);
    for (const b of bookings) {
        await Promise.all([deleteFromCloudinary(b.cnic_front), deleteFromCloudinary(b.cnic_back)]);
    }
    await Promise.all([
        Booking.deleteMany({ owner: target._id }),
        Expense.deleteMany({ owner: target._id }),
        Investment.deleteMany({ owner: target._id }),
        MonthlyConfig.deleteMany({ owner: target._id }),
        Counter.deleteMany({ owner: target._id }),
        PasswordReset.deleteMany({ user_id: target._id }),
        User.deleteOne({ _id: target._id })
    ]);
    res.json({ success: true });
});

/* -------------------------------- data API --------------------------------- */

function ownedBy(req) {
    return { owner: req.user._id };
}

function isOwner(doc, req) {
    return doc && doc.owner && String(doc.owner) === String(req.user._id);
}

app.get('/api/data', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.json({ bookings: [], expenses: [], investments: [], monthlyConfig: { rent: 0, electric: 0, internet: 0 } });
        }
        const scope = ownedBy(req);
        const [bookings, expenses, investments, monthlyConfig] = await Promise.all([
            Booking.find(scope).sort({ _id: -1 }).select('-cnic_front -cnic_back').lean(),
            Expense.find(scope).sort({ _id: -1 }).lean(),
            Investment.find(scope).sort({ _id: -1 }).lean(),
            MonthlyConfig.findOne(scope).sort({ _id: -1 }).lean()
        ]);

        const mappedBookings = bookings.map(b => ({ ...b, id: b._id, cnic_front: '', cnic_back: '' }));
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

app.post('/api/config/monthly', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { rent, electric, internet } = req.body;
        const config = await MonthlyConfig.findOneAndUpdate(
            ownedBy(req),
            { $set: { rent: rent || 0, electric: electric || 0, internet: internet || 0 } },
            { upsert: true, new: true, lean: true }
        );
        res.json({ success: true, monthlyConfig: { rent: config.rent, electric: config.electric, internet: config.internet } });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

async function deleteFromCloudinary(url) {
    if (url && url.includes('res.cloudinary.com') && useCloudinary) {
        const parts = url.split('/');
        const publicId = parts.slice(-2).join('/').replace(/\.[^.]+$/, '');
        await cloudinary.uploader.destroy(publicId).catch(() => {});
    }
}

async function uploadImage(base64Str, ownerId) {
    if (!base64Str) return '';
    if (!useCloudinary) return base64Str;
    try {
        const result = await cloudinary.uploader.upload(base64Str, {
            folder: 'veyr_stays/' + ownerId,
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
        const { guest_name, reference_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, payment_status, cnic_front, cnic_back } = req.body;
        const created_at = today();

        const [cnicFrontUrl, cnicBackUrl] = await Promise.all([
            uploadImage(cnic_front, req.user._id),
            uploadImage(cnic_back, req.user._id)
        ]);

        const booking_number = await nextBookingNumber(req.user._id);

        const booking = await Booking.create({
            owner: req.user._id,
            booking_number, guest_name, reference_name, reference_contact, roomNumber,
            check_in_date: check_in, checkOutDate, bookingType,
            payment_amount: Number(payment_amount) || 0,
            payment_status: payment_status || 'Paid',
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
        const booking = await Booking.findOne({ _id: req.params.id, ...ownedBy(req) }).lean();
        if (!booking) return res.status(404).json({ error: 'Booking not found' });

        await Promise.all([
            deleteFromCloudinary(booking.cnic_front),
            deleteFromCloudinary(booking.cnic_back)
        ]);

        await Booking.deleteOne({ _id: booking._id });
        res.json({ message: 'Booking and associated images deleted successfully' });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.get('/api/bookings/:id/images', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const booking = await Booking.findOne({ _id: req.params.id, ...ownedBy(req) }).select('cnic_front cnic_back').lean();
        if (!booking) return res.status(404).json({ error: 'Booking not found' });
        res.json({ cnic_front: booking.cnic_front || '', cnic_back: booking.cnic_back || '' });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.put('/api/bookings/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ error: 'Database not connected' });
        const { guest_name, reference_contact, roomNumber, check_in, checkOutDate, bookingType, payment_amount, payment_status, reference_name, cnic_front, cnic_back } = req.body;

        const existing = await Booking.findOne({ _id: req.params.id, ...ownedBy(req) }).lean();
        if (!existing) return res.status(404).json({ error: 'Booking not found' });

        const update = { guest_name, reference_contact, roomNumber, check_in_date: check_in, checkOutDate, bookingType, payment_amount, payment_status, reference_name };
        if (cnic_front) update.cnic_front = await uploadImage(cnic_front, req.user._id);
        if (cnic_back) update.cnic_back = await uploadImage(cnic_back, req.user._id);

        const result = await Booking.updateOne({ _id: existing._id }, update);
        res.json({ message: 'Booking updated successfully', changes: result.modifiedCount });
    } catch (err) {
        res.json({ error: err.message });
    }
});

app.post('/api/expenses', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { expense_title, amount, expense_date, bill_type, bill_month } = req.body;
        const created_at = today();

        const expense = await Expense.create({ owner: req.user._id, expense_title, amount, expense_date, created_at, bill_type, bill_month });
        res.json({ success: true, id: expense._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.put('/api/expenses/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { expense_title, amount, expense_date, bill_type, bill_month } = req.body;
        const result = await Expense.updateOne({ _id: req.params.id, ...ownedBy(req) }, { expense_title, amount, expense_date, bill_type, bill_month });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.delete('/api/expenses/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const result = await Expense.deleteOne({ _id: req.params.id, ...ownedBy(req) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Expense not found' });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.post('/api/investments', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { investor_name, amount, investment_date } = req.body;
        const created_at = today();

        const investment = await Investment.create({ owner: req.user._id, investor_name, amount, investment_date, created_at });
        res.json({ success: true, id: investment._id });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.put('/api/investments/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const { investor_name, amount, investment_date } = req.body;
        const result = await Investment.updateOne({ _id: req.params.id, ...ownedBy(req) }, { investor_name, amount, investment_date });
        if (result.matchedCount === 0) return res.status(404).json({ error: 'Investment not found' });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.delete('/api/investments/:id', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.json({ success: false, error: 'Database not connected' });
        const result = await Investment.deleteOne({ _id: req.params.id, ...ownedBy(req) });
        if (result.deletedCount === 0) return res.status(404).json({ error: 'Investment not found' });
        res.json({ success: true });
    } catch (err) {
        res.json({ success: false, error: err.message });
    }
});

app.get('/api/export', authMiddleware, async (req, res) => {
    try {
        if (!isDbConnected()) return res.status(503).json({ error: 'Database not connected' });
        const scope = ownedBy(req);

        const [bookings, expenses, investments, monthlyConfig] = await Promise.all([
            Booking.find(scope).sort({ _id: -1 }).lean(),
            Expense.find(scope).sort({ _id: -1 }).lean(),
            Investment.find(scope).sort({ _id: -1 }).lean(),
            MonthlyConfig.findOne(scope).sort({ _id: -1 }).lean()
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
            exported_at: nowStamp(),
            property_name: req.user.property_name || '',
            account: req.user.username,
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

function startServer() {
    connectDb().catch(err => console.error('MongoDB connection error:', err.message));
    return app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

if (require.main === module) startServer();

module.exports = {
    app,
    startServer,
    connectDb,
    initSystem,
    nextBookingNumber,
    claimOrphanedRecords,
    models: { User, PasswordReset, Booking, Expense, Investment, MonthlyConfig, Counter, SystemSetting }
};