# Veyr Stays System

Multi-tenant apartment-lease bookkeeping. Each account manages exactly one property and can only ever see its own records.

## Stack
- **Backend:** Express.js v5 (`server.js`) — single-file entrypoint
- **Frontend:** Vanilla HTML/CSS/JS served statically from `public/`
- **Database:** MongoDB via Mongoose — local default `mongodb://localhost:27017/veyr_stays`, override via `MONGO_URI` env var
- **Auth:** bcryptjs password hashing + JWT (Authorization: Bearer token)
- **Image storage:** Cloudinary (if configured with env vars) or base64 in MongoDB

## Commands
```sh
npm start               # Start on http://localhost:3000
npm test                # Multi-tenant isolation suite (95 assertions, in-memory MongoDB)
```

## Environment variables
| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | |
| `MONGO_URI` | `mongodb://localhost:27017/veyr_stays` | |
| `JWT_SECRET` | generated once and stored in the `systemsettings` collection | Set it explicitly in production. |
| `TOKEN_TTL` | `7d` | JWT lifetime. |
| `ADMIN_USERNAME` | `admin` | First boot only. Must match `/^[a-z0-9._-]{3,32}$/` or boot fails. Never use the display name (it contains a space). |
| `ADMIN_PASSWORD` | `changeme123` | First boot only. Minimum 6 characters — the default **must** satisfy this or the bootstrap throws and no account is created. |
| `ADMIN_PROPERTY_NAME` | `Veyr Stays` | First boot only. Display name only; not used as a username. |
| `LOGIN_RATE_MAX` | `10` | Per IP, per 10 minutes. |
| `REGISTER_RATE_MAX` | `5` | Per IP, per hour. |
| `FORGOT_RATE_MAX` | `5` | Per IP, per hour. |
| `CLOUDINARY_*` | unset | Falls back to base64 in MongoDB. |

There is no `dotenv` dependency — env vars must come from the shell or the hosting platform.

## Multi-tenancy model
- `users` is the tenant table. `bookings`, `expenses`, `investments`, and `monthlyconfigs` all carry `owner` (ObjectId → `User`) and are filtered by it in **every** query.
- `counters` holds the per-owner booking sequence; `nextBookingNumber()` is the only allocator. New accounts both start at #1.
- First boot creates the admin and then claims any pre-multi-tenant records that have no `owner` via `claimOrphanedRecords()`. That safety net also runs on later boots.
- If `initSystem()` throws, the server still starts and serves the UI, but there is no admin — every login returns "Invalid username or password". `startServer()` now logs this distinction explicitly. The old pre-multi-tenant build had no `users` collection at all (it compared `/api/login` against env vars), so upgrading never destroys data; existing records simply get claimed on first boot.
- Cloudinary uploads go to a per-owner folder so deleting an account cannot touch another tenant's images.
- Deleting a user cascades to their records; deactivation blocks new logins **and** invalidates already-issued tokens (the auth middleware re-reads the user on every request).

## Auth flows
- Public self-registration is open: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/forgot-password`.
- Forgot-password deliberately creates a `PasswordReset` row for the admin to action rather than emailing a token — there is no mail transport. The response is always generic so usernames cannot be enumerated, and the route is IP rate-limited.
- `PUT /api/auth/password` is self-service and requires the current password.
- `PUT /api/auth/profile` is self-service and also accepts an optional `username`, so an account can rename itself from Settings without a database script. It is sanitized (trim + lowercase), validated against `/^[a-z0-9._-]{3,32}$/`, and rejected with 409 if taken.
- Everything under `/api/admin/*` requires an admin token.

## Architecture
- `server.js` — all API routes, DB init, static serving. Exports `app`, `startServer`, `connectDb`, `initSystem`, `nextBookingNumber`, `claimOrphanedRecords`, and the models so tests can drive it in-process; `startServer()` only runs under `require.main === module`. `GET /api/export` returns a per-owner ZIP with `data.json`, `bookings.csv`, `bookings-summary.csv` (monthly bookings/revenue/pending) and `profit-breakdown.csv`; its `computeProfitBreakdown()` mirrors the client's `computeMonthlyProfit()` and the two must stay in sync.
- `public/index.html` — SPA dashboard with a monthly-profit section, plus modals for bookings, expenses, investments, monthly bills, settings, and admin management
- `public/script.js` — all client logic. `checkAndApplyMonthlyBills()` backfills auto monthly bills for every month from the account's first record through the current month, deduped by `bill_type` + `bill_month` (so it no longer only fires on the 1st and no longer relies on localStorage)
- `public/style.css` — all styles including toast notifications, filter UI, profit chart, auth/admin UI, and the mobile card-table layout
- `test_tenancy.js` — boots the real Express app against `mongodb-memory-server` via supertest; no local MongoDB required

## Quirks & Gotchas

- `.gitignore` covers `node_modules/`, `secure_uploads/`, `.env`, and `.env.*`.
- No lint, typecheck, formatter, or build scripts.
- Currency is PKR throughout.
- All API endpoints except the three public auth routes require JWT auth.
- Booking PUT endpoint DOES update `cnic_front`/`cnic_back` if provided.
- Month-wise profit is computed entirely client-side in `computeMonthlyProfit()`. Bookings bucket by check-in month (Paid only). Expenses are split in two: **fixed bills** (`bill_type` = Rent/Electric/Internet) are deducted from the **previous** month's revenue (`fixedBillsNextMonth`), while every other **regular expense** is deducted from the month it is recorded in (`net = revenue - regular`). Each expense is counted exactly once; the top metric cards stay all-time totals.
- The dashboard is button-driven: the summary, bookings, expenses and investments sections carry `.app-view` and stay hidden until a `.view-btn[data-view]` is tapped. `openView()` / `toggleView()` / `closeAllViews()` in `script.js` manage it, and tapping the active button collapses back to the buttons-only landing screen. After login the app auto-opens the Summary dashboard via `showDashboard()` (kept separate from `fetchDashboardData()` so refreshes do not yank the user out of a view they chose). The Summary dashboard also renders hero/current-month figures, an expense breakdown, recent bookings and a bills/expenses panel through `renderDashboard()`, which is called from `fetchDashboardData()`. Hiding the profit chart is safe — it is CSS bars, not a canvas. The `[data-goto-view]` buttons (e.g. "View all") call `openView()`.
- Every dynamically rendered `<td>` MUST carry a `data-label` attribute; under 768px the CSS turns tables into labeled cards using `td::before { content: attr(data-label) }`.
- Submit buttons must restore `disabled`/label in a `finally` block, otherwise the modal stays stuck on "Saving..." after a successful save (`form.reset()` does not reset button state).
- Customer-supplied text rendered into the admin panel MUST go through `esc()`. A customer controls their own property name and contact details, and those values are rendered in the *admin's* session — skipping this is a tenant-to-admin escalation.
- `apiFetch()` treats both 401 and 403 as "session over": it clears the token and shows the login overlay. 403 is what a deactivated account receives.
- The `DOMContentLoaded` handler wires every listener first and only then kicks off the async auth bootstrap, so a slow or failed `/api/auth/me` cannot leave the UI inert.
- Adding a new data route means adding an `owner` filter. There is no global middleware that scopes collections for you.
