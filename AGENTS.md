# Veyr Stays System

## Stack
- **Backend:** Express.js v5 (`server.js`) — single-file entrypoint
- **Frontend:** Vanilla HTML/CSS/JS served statically from `public/`
- **Database:** MongoDB via Mongoose — local default `mongodb://localhost:27017/veyr_stays`, override via `MONGO_URI` env var
- **File uploads:** Multer — CNIC images stored in `secure_uploads/`

## Commands
```sh
npm start               # Start on http://localhost:3000
npm test                # Placeholder — no tests configured
```

## Architecture
- `server.js` — all API routes, DB init, static serving
- `public/index.html` — SPA dashboard with modals for bookings, expenses, investments, monthly bills
- `public/script.js` — all client logic, auto-applies monthly bills on the 1st (uses localStorage to dedupe)

## Quirks & Gotchas

- `.gitignore` covers `node_modules/` and `secure_uploads/`.
- No lint, typecheck, formatter, or build scripts.
- Currency is PKR throughout.
- Booking PUT endpoint does NOT update `cnic_front`/`cnic_back` — only metadata fields.
