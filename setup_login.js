/*
 * Guided setup for your login. Double-click setup_login.bat instead of running
 * this by hand.
 *
 * It asks for your MongoDB connection string (from Render -> Environment),
 * then a username and password, creates the admin account, and attaches any
 * owner-less records to it. Nothing is ever deleted.
 */
const readline = require('readline');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = q => new Promise(resolve => rl.question(q, a => resolve(a)));
const clean = s => String(s || '').trim().replace(/^["']|["']$/g, '').trim();

async function main() {
    console.log('');
    console.log('==============================================');
    console.log(' Veyr Stays - set up your login');
    console.log('==============================================');
    console.log('');
    console.log('You need your MongoDB connection string.');
    console.log('Get it here: render.com -> your service -> Environment -> MONGO_URI');
    console.log('Copy the whole value (it starts with "mongodb+srv://" or "mongodb://").');
    console.log('');

    let uri = '';
    while (!uri) {
        uri = clean(await ask('Paste the MONGO_URI value, then press Enter:\n> '));
        if (!uri) console.log('  Nothing pasted. Try again.\n');
        else if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
            console.log('  That does not look like a MongoDB connection string (should start with mongodb+srv:// or mongodb://).\n');
            uri = '';
        }
    }

    console.log('\nConnecting... (this can take 5-10 seconds)');
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    console.log('Connected.');

    // Load models via the app so schemas match exactly.
    const srv = require('./server.js');
    const { User, Booking, Expense, Investment, MonthlyConfig } = srv.models;

    const owned = { $or: [{ owner: { $exists: false } }, { owner: null }] };
    const bookings = await Booking.countDocuments();
    const unassigned = await Booking.countDocuments(owned);
    const expenses = await Expense.countDocuments();
    const investments = await Investment.countDocuments();

    console.log('');
    console.log('--- YOUR DATA ---');
    console.log('  bookings:    ' + bookings + '  (' + unassigned + ' not attached to a login yet)');
    console.log('  expenses:    ' + expenses);
    console.log('  investments: ' + investments);
    if (bookings === 0 && expenses === 0 && investments === 0) {
        console.log('');
        console.log('  WARNING: no records found. You may have the wrong connection string.');
    }

    const existing = await User.find({}).lean();
    console.log('');
    console.log('--- EXISTING LOGINS ---');
    if (!existing.length) console.log('  (none)');
    else existing.forEach(u => console.log('  ' + u.username + (u.is_admin ? '  [admin]' : '') + (u.is_active === false ? '  [disabled]' : '')));

    console.log('');
    let username = '';
    while (!username) {
        username = clean(await ask('Choose a username (letters, numbers, dot, dash, underscore; 3-32 chars):\n> ')).toLowerCase();
        const problem = srv.validateCredentials(username, 'placeholder');
        if (problem && problem.toLowerCase().includes('username')) { console.log('  ' + problem + '\n'); username = ''; }
    }

    let password = '';
    while (!password) {
        password = await ask('Choose a password (at least 6 characters):\n> ');
        if (password.length < 6) { console.log('  Too short - needs at least 6 characters.\n'); password = ''; }
    }

    const already = await User.findOne({ username });
    if (already) {
        already.password_hash = await bcrypt.hash(password, 12);
        already.is_admin = true;
        already.is_active = true;
        await already.save();
        console.log('\nPassword updated for the existing account "' + username + '".');
    } else {
        await User.create({
            username,
            password_hash: await bcrypt.hash(password, 12),
            property_name: process.env.ADMIN_PROPERTY_NAME || srv.defaults.adminPropertyName,
            is_admin: true,
            is_active: true,
            created_at: new Date().toISOString().split('T')[0]
        });
        console.log('\nCreated the account "' + username + '".');
    }

    const admin = await User.findOne({ username }).lean();
    await srv.claimOrphanedRecords(admin._id);
    const stillUnassigned = await Booking.countDocuments(owned);
    console.log('Bookings still unattached: ' + stillUnassigned);

    console.log('');
    console.log('==============================================');
    console.log(' DONE. Log in at your Render URL with:');
    console.log('   username: ' + username);
    console.log('   password: (the one you just typed)');
    console.log('==============================================');
    console.log('');
    console.log('After logging in, change the password in Settings.');
    console.log('');
}

main()
    .catch(err => {
        console.log('');
        console.log('FAILED: ' + err.message);
        console.log('');
        if (/ECONNREFUSED|ENOTFOUND|timed out|server selection/i.test(err.message)) {
            console.log('Could not reach the database. Check that you copied the whole MONGO_URI.');
        }
        process.exitCode = 1;
    })
    .finally(() => { rl.close(); mongoose.disconnect(); });
