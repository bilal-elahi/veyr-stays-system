const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'database.json');

function load() {
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch {
        return { bookings: [], expenses: [], investments: [], monthlyConfig: null, _seq: 0 };
    }
}

function save(data) {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function generateId(seq) {
    seq._seq = (seq._seq || 0) + 1;
    return seq._seq;
}

function collection(name) {
    return {
        find(query = {}) {
            const data = load();
            let items = data[name] || [];
            if (query._id) {
                const id = String(query._id);
                items = items.filter(item => String(item._id) === id);
            }
            return items;
        },
        sort(key) {
            const data = load();
            let items = [...(data[name] || [])];
            const [field, order] = key.startsWith('-') ? [key.slice(1), -1] : [key, 1];
            items.sort((a, b) => {
                if (a[field] < b[field]) return -1 * order;
                if (a[field] > b[field]) return 1 * order;
                return 0;
            });
            return items;
        },
        lean() {
            return this;
        },
        async create(doc) {
            const data = load();
            const _id = generateId(data);
            const entry = { _id, ...doc };
            data[name].unshift(entry);
            save(data);
            return entry;
        },
        async deleteOne(query) {
            const data = load();
            const id = String(query._id);
            const before = data[name].length;
            data[name] = data[name].filter(item => String(item._id) !== id);
            const deleted = before - data[name].length;
            save(data);
            return { deletedCount: deleted };
        },
        async updateOne(query, update) {
            const data = load();
            const id = String(query._id);
            const index = data[name].findIndex(item => String(item._id) === id);
            let modified = 0;
            if (index !== -1) {
                Object.assign(data[name][index], update);
                modified = 1;
                save(data);
            }
            return { modifiedCount: modified };
        },
        findOneAndUpdate(query, update, options = {}) {
            const data = load();
            if (!data[name]) data[name] = [];
            let entry = data[name][0] || null;
            if (entry) {
                Object.assign(entry, update);
                save(data);
            } else if (options.upsert) {
                const _id = generateId(data);
                entry = { _id, ...update };
                data[name].push(entry);
                save(data);
            }
            if (options.lean) return entry;
            return entry;
        }
    };
}

module.exports = {
    bookings: collection('bookings'),
    expenses: collection('expenses'),
    investments: collection('investments'),
    monthlyConfig: collection('monthlyConfig'),
};
