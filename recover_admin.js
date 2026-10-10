/*
 * Recovery / inspection tool for a hosted Veyr Stays database.
 *
 * Run it locally against the SAME database your Render service uses.
 * Grab MONGO_URI from Render -> your service -> Environment.
 *
 *   Read-only report:
 *     $env:MONGO_URI="<paste from Render>"; node recover_admin.js
 *
 *   Create or reset an admin account, and re-claim owner-less records:
 *     $env:MONGO_URI="<paste from Render>"; node recover_admin.js <username> <password>
 *
 * It never deletes anything. Passwords are hashed before they are stored.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const srv = require('./server.js');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/veyr_stays';
const BCRYPT_ROUNDS = 12;

const owned = { $or: [{ owner: { $exists: false } }, { owner: null }] };

async function main() {
    console.log('Connecting to ' + MONGO_URI.replace(/\/\/[^@]*@/, '//<hidden>@') + ' ...');
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 });

    const { User, Booking, Expense, Investment, MonthlyConfig } = srv.models;

    const counts = {
        bookings: await Booking.countDocuments(),
        expenses: await Expense.countDocuments(),
        investments: await Investment.countDocuments(),
        monthlyConfigs: await MonthlyConfig.countDocuments()
    };
    const unowned = {
        bookings: await Booking.countDocuments(owned),
        expenses: await Expense.countDocuments(owned),
        investments: await Investment.countDocuments(owned),
        monthlyConfigs: await MonthlyConfig.countDocuments(owned)
    };

    console.log('\n=== YOUR DATA ===');
    for (const k of Object.keys(counts)) {
        console.log('  ' + k.padEnd(16) + String(counts[k]).padStart(6) +
            ' total, ' + String(unowned[k]).padStart(6) + ' not yet assigned to any account');
    }
    if (counts.bookings === 0 && counts.expenses === 0 && counts.investments === 0) {
        console.log('\n  WARNING: this database has no business records at all.');
        console.log('  You may be pointing at the wrong MONGO_URI. Double-check it in Render.');
    }

    console.log('\n=== ACCOUNTS THAT CAN LOG IN ===');
    const users = await User.find({}).lean();
    if (!users.length) {
        console.log('  (none)');
        console.log('\n  This is why login fails: no account exists yet.');
        console.log('  Run this again with a username and password to create one, e.g.');
        console.log('    node recover_admin.js admin mypassword123');
    } else {
        for (const u of users) {
            console.log('  ' + u.username +
                '   admin=' + (u.is_admin ? 'yes' : 'no') +
                '   active=' + (u.is_active === false ? 'NO' : 'yes'));
        }
    }

    const [username, password] = process.argv.slice(2);
    if (!username || !password) {
        console.log('\n(Read-only mode. Pass a username and password to create or reset an admin.)');
        return;
    }

    const problem = srv.validateCredentials(username.trim().toLowerCase(), password);
    if (problem) {
        console.log('\nCannot use that username/password: ' + problem);
        process.exitCode = 1;
        return;
    }

    const uname = username.trim().toLowerCase();
    const existing = await User.findOne({ username: uname });
    if (existing) {
        existing.password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        existing.is_admin = true;
        existing.is_active = true;
        await existing.save();
        console.log('\nReset the password for existing account "' + uname + '". You can log in with the password you just supplied.');
    } else {
        await User.create({
            username: uname,
            password_hash: await bcrypt.hash(password, BCRYPT_ROUNDS),
            property_name: process.env.ADMIN_PROPERTY_NAME || srv.defaults.adminPropertyName,
            is_admin: true,
            is_active: true,
            created_at: new Date().toISOString().split('T')[0]
        });
        console.log('\nCreated admin account "' + uname + '". You can log in with the password you just supplied.');
    }

    const admin = await User.findOne({ username: uname }).lean();
    await srv.claimOrphanedRecords(admin._id);
    const stillUnowned = await Booking.countDocuments(owned);
    console.log('Owner-less bookings remaining afterwards: ' + stillUnowned);
    console.log('\nDone. Log in at your Render URL with those credentials, then change the password in Settings.');
}

main()
    .catch(err => { console.error('\nFAILED:', err.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
