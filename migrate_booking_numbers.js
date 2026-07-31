const mongoose = require('mongoose');
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/veyr_stays';

const bookingSchema = new mongoose.Schema({
    booking_number: Number,
    guest_name: String,
    created_at: String
}, { versionKey: false, strict: false });

const Booking = mongoose.model('Booking', bookingSchema);

(async () => {
    await mongoose.connect(MONGO_URI);
    const bookings = await Booking.find().sort({ _id: 1 }).lean();
    let maxDoc = await Booking.findOne().sort({ booking_number: -1 }).select('booking_number').lean();
    let nextNum = (maxDoc?.booking_number || 0) + 1;

    let updated = 0;
    for (const b of bookings) {
        if (b.booking_number === undefined || b.booking_number === null) {
            await Booking.updateOne({ _id: b._id }, { $set: { booking_number: nextNum } });
            nextNum++;
            updated++;
        }
    }
    console.log('Updated ' + updated + ' bookings with booking numbers');
    await mongoose.disconnect();
})();
