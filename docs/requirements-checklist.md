# Requirement-by-requirement audit

Status is against the assignment PDF and the final code in this repository.
"Verified by" names the test that actually exercises it.

## User functionality

| # | Requirement | Status | Implementation | Verified by |
| --- | --- | --- | --- | --- |
| 1 | Register with name, phone, age, pincode, Aadhaar, password | PASS | `POST /api/auth/register` | `integration/auth.test.js` |
| 2 | Phone number unique | PASS | unique index + pre-check | `auth.test.js` duplicate-phone and race tests |
| 3 | Aadhaar unique | PASS | unique index | `auth.test.js` duplicate-Aadhaar test |
| 4 | Password hashed, never stored or returned in plaintext | PASS | bcrypt, `select: false` | `auth.test.js` hash + no-leak assertions |
| 5 | Login with phone + password returns a token | PASS | `POST /api/auth/login` | `auth.test.js` |
| 6 | See available slots for a day, respecting drive window, hours, capacity, status and dose | PASS | `GET /api/slots/available` | `slots.test.js`, `vaccination-flow.test.js` |
| 7 | Register for the first dose | PASS | `POST /api/bookings` | `booking.test.js` |
| 8 | Second dose only after the first is completed | PASS | `resolveDose` state machine | `unit/vaccination-state.test.js`, `vaccination-flow.test.js` |
| 9 | Dose complete once the registered slot lapses | PASS | lapse sweep on `slotEndAt` | `vaccination-flow.test.js` (during / at end / after) |
| 10 | Change slot until 24 hours before | PASS | strict `> 24h` | `unit/date.test.js`, `booking-modification.test.js` |

## Admin functionality

| # | Requirement | Status | Implementation | Verified by |
| --- | --- | --- | --- | --- |
| 11 | No admin registration API | PASS | no route mounted | `auth.test.js` 404 assertion |
| 12 | Admin credentials seeded manually | PASS | `npm run seed:admin` | `seed.test.js` |
| 13 | Admin login | PASS | `POST /api/auth/admin/login` | `auth.test.js`, `admin.test.js` |
| 14 | Total registered users | PASS | `totalRegisteredUsers` | `admin.test.js` |
| 15 | Filter by age | PASS | indexed query (exact + range) | `admin.test.js` |
| 16 | Filter by pincode | PASS | indexed query | `admin.test.js` |
| 17 | Filter by vaccination status (none / first / all) | PASS | indexed query on denormalised status | `admin.test.js` |
| 18 | Combined filters | PASS | `buildUserFilter` | `admin.test.js`, `unit/misc.test.js` |
| 19 | Daily registered slots: first / second / total | PASS | `$facet` aggregation | `admin.test.js` |

## Slot rules

| # | Requirement | Status | Verified by |
| --- | --- | --- | --- |
| 20 | Drive 2024-11-01 to 2024-11-30 | PASS | `unit/slot-generation.test.js`, `slots.test.js` |
| 21 | 10:00 - 17:00 daily | PASS | `unit/slot-generation.test.js` |
| 22 | 30-minute slots, 14 per day | PASS | `unit/slot-generation.test.js` |
| 23 | 420 slots total | PASS | `slots.test.js`, `seed.test.js` |
| 24 | 10 doses per slot, shared by both doses | PASS | `slots.test.js`, `admin.test.js` per-slot stats |
| 25 | 4,200 doses total | PASS | `unit/slot-generation.test.js`, `seed.test.js` |
| 26 | Slot unavailable at 10 registrations | PASS | `slots.test.js`, `booking.test.js` |
| 27 | Capacity released when a user moves slot | PASS | `booking-modification.test.js` |

## Engineering requirements

| # | Requirement | Status | Verified by |
| --- | --- | --- | --- |
| 28 | Capacity never exceeds 10 under concurrency | PASS | `concurrency.test.js` (30 simultaneous → exactly 10) |
| 29 | Atomic booking, no counter drift | PASS | `concurrency.test.js`, `booking-modification.test.js` |
| 30 | Transaction for the slot change | PASS | replica-set test harness exercises the transactional path |
| 31 | Authentication (missing / invalid / expired / malformed token) | PASS | `security.test.js` |
| 32 | Authorisation (role guards, cross-user access) | PASS | `security.test.js`, `admin.test.js`, `booking.test.js` |
| 33 | No stack traces or secrets in responses | PASS | `security.test.js` |
| 34 | Validation across registration, booking and admin filters | PASS | `auth.test.js`, `booking.test.js`, `admin.test.js` |
| 35 | Admin filtering at the database level, no N+1 | PASS | `admin.service.js`; bulk sweep replaces per-user refresh |
| 36 | Indexes for the real query patterns | PASS | declared in the models, listed in the README and LLD |
| 37 | Idempotent slot seed | PASS | `seed.test.js` (three runs, plus gap-fill) |
| 38 | Admin seed stores only a hash | PASS | `seed.test.js` |
| 39 | Time abstraction, disabled in production | PASS | `unit/clock.test.js` |
| 40 | README documents only routes that exist | PASS | manual cross-check against `src/routes/` |
| 41 | Postman collection matches the final API | PASS | manual cross-check against `src/routes/` |
| 42 | Low-level design matches the code | PASS | `docs/low-level-design.md` |
| 43 | `.env.example` + `.gitignore`, no committed secrets | PASS | repository contents |
