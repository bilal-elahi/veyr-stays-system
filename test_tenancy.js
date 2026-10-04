/*
 * Multi-tenant isolation test.
 *
 * Boots the real server.js against a throwaway in-memory MongoDB and proves that
 * two separate accounts can never see or touch each other's data.
 *
 * Run with:  npm run test:tenancy
 */
process.env.ADMIN_USERNAME = 'rootadmin';
process.env.ADMIN_PASSWORD = 'rootpass1';
process.env.JWT_SECRET = 'test-only-secret';
// Brute-force limits are exercised at the end of this file; lift them elsewhere
// so the rest of the suite is not throttled.
process.env.LOGIN_RATE_MAX = '500';
process.env.REGISTER_RATE_MAX = '500';
process.env.FORGOT_RATE_MAX = '3';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

let pass = 0;
let fail = 0;

function check(label, condition, extra) {
    if (condition) {
        pass++;
        console.log('  PASS  ' + label);
    } else {
        fail++;
        console.log('  FAIL  ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : ''));
    }
}

function section(title) {
    console.log('\n' + title);
}

(async () => {
    const mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri('veyr_test');

    const server = require('./server.js');
    const { app, connectDb, initSystem, claimOrphanedRecords, models } = server;

    await connectDb();

    const api = {
        get: (route, token) => request(app).get(route).set(token ? 'Authorization' : 'X', token ? 'Bearer ' + token : ''),
        post: (route, body, token) => {
            let r = request(app).post(route);
            if (token) r = r.set('Authorization', 'Bearer ' + token);
            return r.send(body || {});
        },
        put: (route, body, token) => {
            let r = request(app).put(route);
            if (token) r = r.set('Authorization', 'Bearer ' + token);
            return r.send(body || {});
        },
        del: (route, token) => {
            let r = request(app).delete(route);
            if (token) r = r.set('Authorization', 'Bearer ' + token);
            return r.send();
        }
    };

    const booking = (guest, room, date, amount, type) => ({
        guest_name: guest, reference_contact: '0300', roomNumber: room,
        check_in: date + 'T12:00', checkOutDate: date + 'T14:00',
        bookingType: type || 'Full Day', payment_amount: amount, payment_status: 'Paid'
    });

    section('Bootstrap');
    check('first admin account created', await models.User.countDocuments({ username: 'rootadmin' }) === 1);
    check('that account is an admin', (await models.User.findOne({ username: 'rootadmin' }).lean()).is_admin === true);

    section('Admin login');
    const badLogin = await api.post('/api/auth/login', { username: 'rootadmin', password: 'wrong' });
    check('wrong password rejected', badLogin.body.success === false, badLogin.body);
    const adminLogin = await api.post('/api/auth/login', { username: 'rootadmin', password: 'rootpass1' });
    check('correct password returns a token', !!adminLogin.body.token, adminLogin.body);
    check('login response has no password hash', !JSON.stringify(adminLogin.body).includes('password_hash'));
    const adminToken = adminLogin.body.token;
    const adminId = adminLogin.body.user.id;

    section('Login does not reveal which usernames exist');
    const unknownUser = await api.post('/api/auth/login', { username: 'nosuchperson', password: 'wrong' });
    check('unknown username is rejected the same way', unknownUser.body.success === false, unknownUser.body);
    check('unknown username and wrong password give identical messages', unknownUser.body.error === badLogin.body.error, {
        unknown: unknownUser.body.error, wrongPassword: badLogin.body.error
    });
    check('unknown username is rejected without a 500', unknownUser.status === 200, unknownUser.status);

    section('Passwords are hashed at rest');
    const storedAdmin = await models.User.findOne({ username: 'rootadmin' }).lean();
    check('stored as a bcrypt hash', /^\$2[aby]\$/.test(storedAdmin.password_hash), storedAdmin.password_hash);
    check('hash is not the plain password', storedAdmin.password_hash !== 'rootpass1');
    check('hash contains no plaintext substring', !storedAdmin.password_hash.includes('rootpass1'));

    section('Self-registration validation');
    check('short password rejected', (await api.post('/api/auth/register', { username: 'alice', password: '123' })).status === 400);
    check('invalid username rejected', (await api.post('/api/auth/register', { username: 'a b!', password: 'alicepass' })).status === 400);
    check('no account was created by the rejected attempts', await models.User.countDocuments({}) === 1);

    const aliceReg = await api.post('/api/auth/register', { username: 'alice', password: 'alicepass', property_name: 'Green Villa', contact_email: 'alice@example.com' });
    check('alice registered', !!aliceReg.body.token, aliceReg.body);
    const aliceToken = aliceReg.body.token;
    const aliceId = aliceReg.body.user.id;

    check('duplicate username rejected', (await api.post('/api/auth/register', { username: 'ALICE', password: 'alicepass' })).status === 409);
    check('duplicate is detected case-insensitively', (await api.post('/api/auth/register', { username: 'alice', password: 'other1234' })).status === 409);
    check('duplicate is detected with surrounding whitespace', (await api.post('/api/auth/register', { username: '  alice  ', password: 'other1234' })).status === 409);

    const bobReg = await api.post('/api/auth/register', { username: 'bob', password: 'bobpass1', property_name: 'Blue Heights' });
    const bobToken = bobReg.body.token;
    const bobId = bobReg.body.user.id;
    check('bob registered', !!bobToken);
    check('new accounts are never admins', aliceReg.body.user.is_admin === false && bobReg.body.user.is_admin === false);
    check('alice and bob are distinct accounts', aliceId !== bobId);

    section('Per-account monthly config');
    await api.post('/api/config/monthly', { rent: 50000, electric: 8000, internet: 3000 }, aliceToken);
    await api.post('/api/config/monthly', { rent: 70000, electric: 9000, internet: 2500 }, bobToken);
    const aliceData = await api.get('/api/data', aliceToken);
    const bobData = await api.get('/api/data', bobToken);
    check('alice sees her own rent', aliceData.body.monthlyConfig.rent === 50000, aliceData.body.monthlyConfig);
    check('bob sees his own rent', bobData.body.monthlyConfig.rent === 70000, bobData.body.monthlyConfig);

    section('Bookings stay isolated');
    const aBooking = await api.post('/api/bookings', booking('Alice Guest', 'A1', '2026-05-01', 9000), aliceToken);
    const bBooking = await api.post('/api/bookings', booking('Bob Guest', 'B1', '2026-05-03', 4000, 'Night'), bobToken);
    check('alice booking created', aBooking.body.success === true, aBooking.body);
    check('bob booking created', bBooking.body.success === true, bBooking.body);

    const aliceBookings = (await api.get('/api/data', aliceToken)).body.bookings;
    const bobBookings = (await api.get('/api/data', bobToken)).body.bookings;
    check('alice sees exactly her 1 booking', aliceBookings.length === 1, aliceBookings.length);
    check('bob sees exactly his 1 booking', bobBookings.length === 1, bobBookings.length);
    check("alice cannot see bob's guest name", !JSON.stringify(aliceBookings).includes('Bob Guest'));
    check("bob cannot see alice's guest name", !JSON.stringify(bobBookings).includes('Alice Guest'));

    section('Booking numbers are per-account sequences');
    check("alice's first booking is #1", aliceBookings[0].booking_number === 1, aliceBookings[0].booking_number);
    check("bob's first booking is also #1", bobBookings[0].booking_number === 1, bobBookings[0].booking_number);
    await api.post('/api/bookings', booking('Bob Second', 'B2', '2026-05-05', 1000), bobToken);
    await api.post('/api/bookings', booking('Alice Second', 'A2', '2026-05-06', 1000), aliceToken);
    const aliceNums = (await api.get('/api/data', aliceToken)).body.bookings.map(b => b.booking_number).sort();
    const bobNums = (await api.get('/api/data', bobToken)).body.bookings.map(b => b.booking_number).sort();
    check('alice numbers are 1,2', JSON.stringify(aliceNums) === '[1,2]', aliceNums);
    check('bob numbers are 1,2', JSON.stringify(bobNums) === '[1,2]', bobNums);

    section('Cross-account tampering is blocked');
    const bId = bBooking.body.id;
    check('alice cannot edit bob booking', (await api.put('/api/bookings/' + bId, booking('HACKED', 'X', '2026-05-03', 1), aliceToken)).status === 404);
    check("bob's booking is untouched", (await api.get('/api/data', bobToken)).body.bookings.find(b => b.id === bId).guest_name === 'Bob Guest');
    check('alice cannot delete bob booking', (await api.del('/api/bookings/' + bId, aliceToken)).status === 404);
    check('bob still has his booking', (await api.get('/api/data', bobToken)).body.bookings.some(b => b.id === bId));
    check('alice cannot read bob booking images', (await api.get('/api/bookings/' + bId + '/images', aliceToken)).status === 404);

    section('Cross-account tampering on expenses and investments');
    const aExp = await api.post('/api/expenses', { expense_title: 'Alice repair', amount: 5000, expense_date: '2026-05-04', bill_type: 'Maintenance', bill_month: '2026-05' }, aliceToken);
    const bExp = await api.post('/api/expenses', { expense_title: 'Bob repair', amount: 6000, expense_date: '2026-05-04', bill_type: 'Maintenance', bill_month: '2026-05' }, bobToken);
    check('alice expense created', aExp.body.success === true);
    check('bob expense created', bExp.body.success === true);
    check('alice cannot delete bob expense', (await api.del('/api/expenses/' + bExp.body.id, aliceToken)).status === 404);
    check('alice cannot edit bob expense', (await api.put('/api/expenses/' + bExp.body.id, { expense_title: 'HACK', amount: 0 }, aliceToken)).status === 404);
    check("bob's expense survived", (await api.get('/api/data', bobToken)).body.expenses.some(e => e.expense_title === 'Bob repair'));

    const aInv = await api.post('/api/investments', { investor_name: 'Alice Sponsor', amount: 100000, investment_date: '2026-05-01' }, aliceToken);
    check('alice investment created', aInv.body.success === true);
    check('bob cannot delete alice investment', (await api.del('/api/investments/' + aInv.body.id, bobToken)).status === 404);

    section('Monthly profit buckets are computed per account on the client');
    check('alice expense list has only her expense', (await api.get('/api/data', aliceToken)).body.expenses.length === 1);
    check('bob expense list has only his expense', (await api.get('/api/data', bobToken)).body.expenses.length === 1);

    section('Unauthenticated and forged access is refused');
    check('no token on /api/data is 401', (await api.get('/api/data')).status === 401);
    check('bogus token is 401', (await api.get('/api/data', 'not-a-token')).status === 401);
    check('cannot create a booking without a token', (await api.post('/api/bookings', booking('Hack', 'H', '2026-01-01', 1))).status === 401);
    check('cannot read admin users without a token', (await api.get('/api/admin/users')).status === 401);

    section('Admin routes are admin-only');
    check('bob cannot list users', (await api.get('/api/admin/users', bobToken)).status === 403);
    check('alice cannot list users', (await api.get('/api/admin/users', aliceToken)).status === 403);
    const adminUsers = await api.get('/api/admin/users', adminToken);
    check('admin can list all 3 accounts', adminUsers.status === 200 && adminUsers.body.users.length === 3, adminUsers.body.users && adminUsers.body.users.length);
    check('admin listing has no password hashes', !JSON.stringify(adminUsers.body).includes('password_hash'));
    check('bob cannot self-escalate via admin route', (await api.put('/api/admin/users/' + bobId, { is_active: true }, bobToken)).status === 403);
    check('alice cannot delete bob via admin route', (await api.del('/api/admin/users/' + bobId, aliceToken)).status === 403);

    section('Password reset request flow');
    const unknown = await api.post('/api/auth/forgot-password', { username: 'nobody-here', contact: 'x' });
    check('unknown username gets the same generic reply', unknown.body.success === true && /if that account exists/i.test(unknown.body.message), unknown.body);
    check('no request created for unknown username', (await models.PasswordReset.countDocuments({ username: 'nobody-here' })) === 0);

    await api.post('/api/auth/forgot-password', { username: 'bob', contact: 'bob@phone.com' });
    const pending = (await api.get('/api/admin/reset-requests', adminToken)).body.requests.filter(r => r.status === 'pending');
    check('admin sees 1 pending request for bob', pending.length === 1 && pending[0].username === 'bob', pending.map(p => p.username));
    check('bob cannot see reset requests', (await api.get('/api/admin/reset-requests', bobToken)).status === 403);
    check('admin cannot set a too-short password', (await api.post('/api/admin/reset-requests/' + pending[0].id + '/resolve', { new_password: '123' }, adminToken)).status === 400);
    check('admin resolved the request', (await api.post('/api/admin/reset-requests/' + pending[0].id + '/resolve', { new_password: 'bobnewpass' }, adminToken)).body.success === true);
    check("bob's old password no longer works", (await api.post('/api/auth/login', { username: 'bob', password: 'bobpass1' })).body.success === false);
    check("bob's new password works", (await api.post('/api/auth/login', { username: 'bob', password: 'bobnewpass' })).body.success === true);
    check('a handled request cannot be replayed', (await api.post('/api/admin/reset-requests/' + pending[0].id + '/resolve', { new_password: 'another1' }, adminToken)).status === 400);
    const bobToken2 = (await api.post('/api/auth/login', { username: 'bob', password: 'bobnewpass' })).body.token;

    section('Self-service password change');
    check('wrong current password rejected', (await api.put('/api/auth/password', { current_password: 'nope', new_password: 'alicepass2' }, aliceToken)).status === 400);
    check('password change accepted', (await api.put('/api/auth/password', { current_password: 'alicepass', new_password: 'alicepass2' }, aliceToken)).body.success === true);
    check('alice old password rejected', (await api.post('/api/auth/login', { username: 'alice', password: 'alicepass' })).body.success === false);
    const aliceAgain = await api.post('/api/auth/login', { username: 'alice', password: 'alicepass2' });
    check('alice new password accepted', aliceAgain.body.success === true, aliceAgain.body);
    const aliceToken2 = aliceAgain.body.token;

    section('Deactivation blocks login and live sessions');
    await api.put('/api/admin/users/' + bobId, { is_active: false }, adminToken);
    const disabled = await api.post('/api/auth/login', { username: 'bob', password: 'bobnewpass' });
    check('disabled account cannot log in', disabled.body.success === false && /deactivat/i.test(disabled.body.error || ''), disabled.body);
    check("bob's already-issued session is rejected", (await api.get('/api/data', bobToken2)).status === 403);
    await api.put('/api/admin/users/' + bobId, { is_active: true }, adminToken);
    check('re-enabled account can log in again', (await api.post('/api/auth/login', { username: 'bob', password: 'bobnewpass' })).body.success === true);

    section('Admin lockout protections');
    check('admin cannot deactivate itself', (await api.put('/api/admin/users/' + adminId, { is_active: false }, adminToken)).status === 400);
    check('admin account cannot be deleted', (await api.del('/api/admin/users/' + adminId, adminToken)).status === 400);

    section('Profile updates');
    const profile = await api.put('/api/auth/profile', { property_name: 'Green Villa Annex', contact_email: 'a@b.com' }, aliceToken2);
    check('property name updated', profile.body.user.property_name === 'Green Villa Annex', profile.body);
    check('/api/auth/me reflects the change', (await api.get('/api/auth/me', aliceToken2)).body.user.property_name === 'Green Villa Annex');

    section('Account deletion is scoped');
    const carol = await api.post('/api/auth/register', { username: 'carol', password: 'carolpass', property_name: 'Teardown House' });
    const carolToken = carol.body.token;
    const carolId = carol.body.user.id;
    await api.post('/api/bookings', booking('Carol Guest', 'C1', '2026-06-01', 100, 'Night'), carolToken);
    check('carol has 1 booking before deletion', (await api.get('/api/data', carolToken)).body.bookings.length === 1);
    check('carol deleted', (await api.del('/api/admin/users/' + carolId, adminToken)).body.success === true);
    check("carol's bookings are gone", await models.Booking.countDocuments({ owner: new mongoose.Types.ObjectId(carolId) }) === 0);
    check("alice's data survived carol's deletion", (await api.get('/api/data', aliceToken2)).body.bookings.length === 2);
    check('carol cannot log in after deletion', (await api.post('/api/auth/login', { username: 'carol', password: 'carolpass' })).body.success === false);

    section('Pre-multi-tenant records are claimed by the admin on boot');
    const legacyBooking = await models.Booking.create({
        booking_number: 999, guest_name: 'Legacy Guest', payment_amount: 1234,
        payment_status: 'Paid', check_in_date: '2025-01-01T12:00', created_at: '2025-01-01'
    });
    const legacyExpense = await models.Expense.create({ expense_title: 'Legacy Rent', amount: 4200, expense_date: '2025-01-01', created_at: '2025-01-01' });
    check('legacy booking really has no owner', !legacyBooking.owner);
    await claimOrphanedRecords(new mongoose.Types.ObjectId(adminId));
    const claimedBooking = await models.Booking.findById(legacyBooking._id).lean();
    const claimedExpense = await models.Expense.findById(legacyExpense._id).lean();
    check('legacy booking was assigned to the admin', String(claimedBooking.owner) === adminId, claimedBooking.owner);
    check('legacy expense was assigned to the admin', String(claimedExpense.owner) === adminId, claimedExpense.owner);
    const adminView = (await api.get('/api/data', adminToken)).body;
    check('admin can see the legacy booking', adminView.bookings.some(b => b.guest_name === 'Legacy Guest'));
    check("legacy data did not leak into alice's account", !(await api.get('/api/data', aliceToken2)).body.bookings.some(b => b.guest_name === 'Legacy Guest'));
    check("legacy data did not leak into bob's account", !(await api.get('/api/data', bobToken2)).body.bookings.some(b => b.guest_name === 'Legacy Guest'));

    section('Export only contains the caller data');
    const exportRes = await api.get('/api/export', aliceToken);
    check('export succeeded', exportRes.status === 200, exportRes.status);
    check("export does not contain bob's guest", !exportRes.text.includes('Bob Guest'));
    check("export does not contain legacy admin data", !exportRes.text.includes('Legacy Guest'));

    section('Booking number sequence resumes after the legacy claim');
    const newAdminBooking = await api.post('/api/bookings', booking('Admin New', 'Z1', '2026-07-01', 500), adminToken);
    const adminBookings = (await api.get('/api/data', adminToken)).body.bookings;
    check('new admin booking number continues past the legacy max', adminBookings.some(b => b.booking_number > 999), adminBookings.map(b => b.booking_number));

    section('Rate limiting protects the public endpoints');
    // FORGOT_RATE_MAX is 3 in this test env and exactly two requests were already
    // made above, so only the first call in this batch is allowed through.
    const codes = [];
    for (let i = 0; i < 5; i++) {
        codes.push((await api.post('/api/auth/forgot-password', { username: 'bob', contact: 'x' })).status);
    }
    check('repeat reset requests are rate limited', codes.includes(429), codes);
    check('only the 3rd request in the window is allowed', JSON.stringify(codes) === '[200,429,429,429,429]', codes);
    check('normal logins are unaffected by the reset limit', (await api.post('/api/auth/login', { username: 'rootadmin', password: 'rootpass1' })).body.success === true);

    console.log('\n' + '='.repeat(54));
    console.log('  passed: ' + pass + '    failed: ' + fail);
    console.log('='.repeat(54));

    await mongoose.disconnect();
    await mongo.stop();
    process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
    console.error('\nHARNESS ERROR:', err);
    process.exit(1);
});