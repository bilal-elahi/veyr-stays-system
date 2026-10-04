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
| `ADMIN_USERNAME` | `admin` | First boot only. Must match `/^[a-z0-9._-]{3,32}$/` or boot fails. |
| `ADMIN_PASSWORD` | `7583` | First boot only. Minimum 6 characters. |
| `ADMIN_PROPERTY_NAME` | `Veyr Stays` | First boot only. |
| `LOGIN_RATE_MAX` | `10` | Per IP, per 10 minutes. |
| `REGISTER_RATE_MAX` | `5` | Per IP, per hour. |
| `FORGOT_RATE_MAX` | `5` | Per IP, per hour. |
| `CLOUDINARY_*` | unset | Falls back to base64 in MongoDB. |

There is no `dotenv` dependency — env vars must come from the shell or the hosting platform.

## Multi-tenancy model
- `users` is the tenant table. `bookings`, `expenses`, `investments`, and `monthlyconfigs` all carry `owner` (ObjectId → `User`) and are filtered by it in **every** query.
- `counters` holds the per-owner booking sequence; `nextBookingNumber()` is the only allocator. New accounts both start at #1.
- First boot creates the admin and then claims any pre-multi-tenant records that have no `owner` via `claimOrphanedRecords()`. That safety net also runs on later boots.
- Cloudinary uploads go to a per-owner folder so deleting an account cannot touch another tenant's images.
- Deleting a user cascades to their records; deactivation blocks new logins **and** invalidates already-issued tokens (the auth middleware re-reads the user on every request).

## Auth flows
- Public self-registration is open: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/forgot-password`.
- Forgot-password deliberately creates a `PasswordReset` row for the admin to action rather than emailing a token — there is no mail transport. The response is always generic so usernames cannot be enumerated, and the route is IP rate-limited.
- `PUT /api/auth/password` is self-service and requires the current password.
- Everything under `/api/admin/*` requires an admin token.

## Architecture
- `server.js` — all API routes, DB init, static serving. Exports `app`, `startServer`, `connectDb`, `initSystem`, `nextBookingNumber`, `claimOrphanedRecords`, and the models so tests can drive it in-process; `startServer()` only runs under `require.main === module`.
- `public/index.html` — SPA dashboard with a monthly-profit section, plus modals for bookings, expenses, investments, monthly bills, settings, and admin management
- `public/script.js` — all client logic, auto-applies monthly bills on the 1st (uses localStorage to dedupe)
- `public/style.css` — all styles including toast notifications, filter UI, profit chart, auth/admin UI, and the mobile card-table layout
- `test_tenancy.js` — boots the real Express app against `mongodb-memory-server` via supertest; no local MongoDB required

## Quirks & Gotchas

- `.gitignore` covers `node_modules/`, `secure_uploads/`, `.env`, and `.env.*`.
- No lint, typecheck, formatter, or build scripts.
- Currency is PKR throughout.
- All API endpoints except the three public auth routes require JWT auth.
- Booking PUT endpoint DOES update `cnic_front`/`cnic_back` if provided.
- Month-wise profit is computed entirely client-side in `computeMonthlyProfit()` — bookings bucket by check-in month, expenses by `bill_month` (falling back to expense date). The top metric cards stay all-time totals.
- Every dynamically rendered `<td>` MUST carry a `data-label` attribute; under 768px the CSS turns tables into labeled cards using `td::before { content: attr(data-label) }`.
- Submit buttons must restore `disabled`/label in a `finally` block, otherwise the modal stays stuck on "Saving..." after a successful save (`form.reset()` does not reset button state).
- Customer-supplied text rendered into the admin panel MUST go through `esc()`. A customer controls their own property name and contact details, and those values are rendered in the *admin's* session — skipping this is a tenant-to-admin escalation.
- `apiFetch()` treats both 401 and 403 as "session over": it clears the token and shows the login overlay. 403 is what a deactivated account receives.
- The `DOMContentLoaded` handler wires every listener first and only then kicks off the async auth bootstrap, so a slow or failed `/api/auth/me` cannot leave the UI inert.
- Adding a new data route means adding an `owner` filter. There is no global middleware that scopes collections for you.
