# Vaccine Registration Backend

Node.js + Express + MongoDB (Mongoose) implementation of the Runo **Backend
Developer Assignment - I**: a CoWIN-style vaccine slot registration service with
user and admin APIs.

---

## 1. Project overview

The service models a vaccination drive that runs from **1 Nov 2024 to 30 Nov
2024**, 10:00-17:00 daily, in 30-minute slots of 10 doses each - 14 slots a day,
420 slots, 4,200 doses in total.

Users register, log in, see the slots available to them on a given day, book a
dose, and may move that booking until more than 24 hours before the registered
slot. A dose counts as administered the moment its registered slot has lapsed;
the second dose only becomes bookable after that. Admins - who are seeded, never
self-registered - can count and filter registered users and read per-day slot
statistics.

Three things are treated as the hard parts and are implemented explicitly rather
than incidentally:

| Problem | Approach |
| --- | --- |
| A slot must never exceed 10 registrations under concurrency | A single atomic `findOneAndUpdate` that tests `bookedCount < capacity` and increments in one server-side operation |
| Moving a booking must release the old seat and take the new one, or do neither | A MongoDB transaction where supported (always on Atlas), with atomic conditional updates plus explicit compensation as the fallback |
| The drive is fixed to November 2024, which is in the past | A clock abstraction with a test/dev-only `x-mock-time` override; the assignment's dates are not moved |

---

## 2. Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js >= 18 (uses `node:async_hooks` `AsyncLocalStorage`) |
| Framework | Express 4 |
| Database | MongoDB (Atlas M0 free tier) via Mongoose 8 |
| Auth | JSON Web Tokens (`jsonwebtoken`), bcrypt password hashing (`bcryptjs`) |
| Validation | `express-validator` at the edge, Mongoose schema validation behind it |
| Security | `helmet`, `express-rate-limit` |
| Tests | Jest + Supertest + `mongodb-memory-server` (single-node replica set) |

---

## 3. Architecture

```
server.js                 process entrypoint: config check -> connect -> listen
└── src/
    ├── app.js            express wiring, middleware order, /health
    ├── config/
    │   ├── env.js        single place that reads process.env; fails fast
    │   └── db.js         mongoose connection + transaction-support probe
    ├── constants/        drive parameters and enums
    ├── routes/           HTTP surface only - no logic
    ├── controllers/      request/response shaping only - no business rules
    ├── services/         all business rules and all database access
    ├── models/           Mongoose schemas, indexes, projections
    ├── middleware/       auth, validation, mock clock, rate limit, errors
    └── utils/            clock, dates, JWT, masking, transactions, ApiError
```

The rule enforced throughout: **controllers contain no business logic and
services contain no HTTP concepts.** Services throw `ApiError`; a single error
handler turns those into the response envelope. That is what makes the state
machine and the slot-generation logic unit-testable without a database.

---

## 4. Prerequisites

- Node.js 18 or newer (`node -v`)
- npm 9 or newer
- A MongoDB Atlas account (free M0 tier is enough), or a local MongoDB
- No local MongoDB is needed to run the tests - the suite starts its own
  in-memory replica set

---

## 5. Installation

```bash
git clone <your-private-repo-url>
cd vaccine-registration-backend
npm install
cp .env.example .env      # then edit .env
```

> The first `npm install` downloads a MongoDB binary for
> `mongodb-memory-server` (test dependency only). It needs network access to
> `fastdl.mongodb.org` once; afterwards it is cached.

---

## 6. Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | no | `development` | `production` disables all mock-time and debug output |
| `PORT` | no | `5000` | HTTP port |
| `MONGO_URI` | **yes** | - | Atlas SRV connection string |
| `JWT_SECRET` | **yes** | - | Token signing secret; >= 32 chars enforced in production |
| `JWT_EXPIRES_IN` | no | `1d` | Token lifetime |
| `BCRYPT_ROUNDS` | no | `12` | Password hashing cost |
| `ADMIN_NAME` | no | `System Admin` | Used by `npm run seed:admin` |
| `ADMIN_PHONE` | for seed | - | Admin login phone (10 digits) |
| `ADMIN_PASSWORD` | for seed | - | Admin login password (>= 8 chars) |
| `VACCINATION_START` | no | `2024-11-01` | Override only for local demos |
| `VACCINATION_END` | no | `2024-11-30` | Override only for local demos |
| `ALLOW_MOCK_TIME` | no | `false` | Enables the `x-mock-time` header outside production |

`src/config/env.js` is the only module that reads `process.env` for business
configuration, and `assertRuntimeConfig()` refuses to start the server if
`MONGO_URI` or `JWT_SECRET` is missing. Real secrets live only in `.env`, which
is git-ignored; `.env.example` contains placeholders.

---

## 7. MongoDB Atlas setup

1. Create a free **M0** cluster at <https://cloud.mongodb.com>.
2. **Database Access** → add a user with *Read and write to any database*.
3. **Network Access** → add your IP (or `0.0.0.0/0` for an evaluation cluster).
4. **Connect → Drivers → Node.js** → copy the SRV string.
5. Paste it into `.env` as `MONGO_URI`, with the database name in the path:

```
MONGO_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/vaccine_registration?retryWrites=true&w=majority
```

Atlas is always a replica set, so multi-document transactions are available and
the slot-change flow uses them automatically.

---

## 8. Database initialisation

Indexes are declared in the schemas and are built by Mongoose on connect
(`autoIndex` is on by default). No manual index creation is needed. To verify:

```js
db.users.getIndexes(); db.slots.getIndexes(); db.bookings.getIndexes();
```

---

## 9. Seed the admin

```bash
npm run seed:admin
```

Reads `ADMIN_NAME`, `ADMIN_PHONE`, `ADMIN_PASSWORD` from the environment, stores
only a bcrypt hash, and is idempotent - re-running it rotates the password
rather than creating a second admin. There is deliberately **no admin
registration API**.

## 10. Seed the slots

```bash
npm run seed:slots
```

Generates the full drive deterministically and upserts on the unique `startAt`,
so it is safe to run repeatedly:

```
Slot seeding complete
  drive window   : 2024-11-01 .. 2024-11-30
  slots per day  : 14
  doses per slot : 10
  generated      : 420
  newly inserted : 420
  already present: 0
  total slots    : 420
  total doses    : 4200
```

Running it a second time reports `newly inserted: 0`. It only writes
`bookedCount` on insert, so existing reservations are never wiped.

Both seeds at once:

```bash
npm run seed
```

---

## 11. Run

```bash
npm run dev     # nodemon
npm start       # production-style
```

Check it is alive:

```bash
curl http://localhost:5000/health
```

---

## 12. Tests

```bash
npm test              # unit + integration
npm run test:unit     # pure logic only, no database required
npm run test:coverage
```

The integration suite starts its own single-node MongoDB **replica set** via
`mongodb-memory-server` (a replica set rather than a standalone, because the
slot-change flow uses a transaction). It runs with `--runInBand` so every test
file shares one database deterministically.

---

## 13. API documentation

Base URL: `http://localhost:5000`. All bodies are JSON. Every response uses one
of two envelopes:

```jsonc
// success
{ "success": true, "message": "...optional...", "data": { } }

// failure
{ "success": false, "error": { "code": "MACHINE_CODE", "message": "human text", "details": [] } }
```

### 13.1 `GET /health`

No auth. Reports environment and drive configuration.

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "environment": "development",
    "mockTimeEnabled": false,
    "drive": { "start": "2024-11-01", "end": "2024-11-30", "slotsPerDay": 14, "dosesPerSlot": 10 }
  }
}
```

### 13.2 `POST /api/auth/register`

No auth. Registers a user.

```json
{
  "name": "Saiyam Sharma",
  "phoneNumber": "9876543210",
  "age": 28,
  "pincode": "226001",
  "aadharNo": "123456789012",
  "password": "Password123"
}
```

`201 Created`

```json
{
  "success": true,
  "message": "User registered successfully",
  "data": {
    "user": {
      "id": "6721a1b2c3d4e5f607182930",
      "name": "Saiyam Sharma",
      "phoneNumber": "9876543210",
      "age": 28,
      "pincode": "226001",
      "aadharNo": "XXXXXXXX9012",
      "vaccinationStatus": "NONE",
      "createdAt": "2024-10-30T09:12:44.001Z"
    }
  }
}
```

Errors: `400 VALIDATION_ERROR`, `409 DUPLICATE_KEY` (phone or Aadhaar).

### 13.3 `POST /api/auth/login`

No auth. Body `{ "phoneNumber": "9876543210", "password": "Password123" }`.

`200 OK`

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": "1d",
    "user": { "id": "6721a1b2c3d4e5f607182930", "name": "Saiyam Sharma", "phoneNumber": "9876543210", "vaccinationStatus": "NONE" }
  }
}
```

Errors: `400 VALIDATION_ERROR`, `401 INVALID_CREDENTIALS` (identical message for
an unknown number and a wrong password, so the endpoint cannot be used to
enumerate registered phone numbers).

### 13.4 `POST /api/auth/admin/login`

No auth. Same body shape. Returns an `ADMIN`-role token and the admin profile.
Errors: `401 INVALID_CREDENTIALS`.

### 13.5 `GET /api/users/me`

`Authorization: Bearer <user token>`

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "6721a1b2c3d4e5f607182930",
      "name": "Saiyam Sharma",
      "phoneNumber": "9876543210",
      "age": 28,
      "pincode": "226001",
      "aadharNo": "XXXXXXXX9012",
      "vaccinationStatus": "FIRST_DOSE_COMPLETED",
      "createdAt": "2024-10-30T09:12:44.001Z"
    },
    "eligibleDose": 2,
    "bookings": [
      {
        "id": "6721a2f0c3d4e5f607182931",
        "doseNumber": 1,
        "status": "COMPLETED",
        "slotStartAt": "2024-11-05T10:00:00.000Z",
        "slotEndAt": "2024-11-05T10:30:00.000Z",
        "completedAt": "2024-11-05T10:30:00.000Z",
        "slot": { "id": "...", "date": "2024-11-05", "startTime": "10:00 AM", "endTime": "10:30 AM", "capacity": 10, "bookedCount": 3 }
      }
    ]
  }
}
```

### 13.6 `GET /api/slots/available?date=YYYY-MM-DD`

`Authorization: Bearer <user token>`

Returns the slots on that date that are inside the drive, have not started yet,
and still have capacity - plus the dose this user is currently eligible for.

```json
{
  "success": true,
  "data": {
    "date": "2024-11-05",
    "vaccinationStatus": "NONE",
    "eligibleDose": 1,
    "currentBookingSlotId": null,
    "totalSlotsOnDate": 14,
    "availableSlotCount": 13,
    "slots": [
      {
        "id": "6721a0aac3d4e5f607182900",
        "date": "2024-11-05",
        "startTime": "10:00 AM",
        "endTime": "10:30 AM",
        "startAt": "2024-11-05T10:00:00.000Z",
        "endAt": "2024-11-05T10:30:00.000Z",
        "capacity": 10,
        "bookedCount": 2,
        "availableDoses": 8,
        "isYourCurrentSlot": false
      }
    ]
  }
}
```

A fully vaccinated user receives `eligibleDose: null` and an empty `slots` array
rather than an error. Errors: `400 VALIDATION_ERROR` (malformed date),
`400 DATE_OUTSIDE_DRIVE`, `401`.

### 13.7 `POST /api/bookings`

`Authorization: Bearer <user token>`

```json
{ "slotId": "6721a0aac3d4e5f607182900", "doseNumber": 1 }
```

`doseNumber` is **optional**. Omit it and the server books the only dose you are
eligible for. Supply it and it is validated against your state, which is how
"second dose before the first" gets a meaningful rejection instead of being
silently rewritten.

`201 Created`

```json
{
  "success": true,
  "message": "Dose 1 registered for 2024-11-05 10:00 AM - 10:30 AM",
  "data": {
    "booking": {
      "id": "6721a2f0c3d4e5f607182931",
      "userId": "6721a1b2c3d4e5f607182930",
      "slotId": "6721a0aac3d4e5f607182900",
      "doseNumber": 1,
      "status": "BOOKED",
      "slotStartAt": "2024-11-05T10:00:00.000Z",
      "slotEndAt": "2024-11-05T10:30:00.000Z",
      "completedAt": null
    },
    "slot": { "id": "...", "date": "2024-11-05", "startTime": "10:00 AM", "endTime": "10:30 AM", "capacity": 10, "bookedCount": 3, "availableDoses": 7 }
  }
}
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | missing/malformed `slotId`, `doseNumber` not 1 or 2 |
| 400 | `FIRST_DOSE_NOT_COMPLETED` | dose 2 requested while status is `NONE` |
| 400 | `SLOT_NOT_BOOKABLE` | the slot has already started |
| 400 | `SLOT_OUTSIDE_DRIVE` | slot outside 1-30 Nov 2024 |
| 404 | `SLOT_NOT_FOUND` | no such slot |
| 409 | `SLOT_FULL` | all 10 doses taken |
| 409 | `DOSE_ALREADY_BOOKED` | an active booking for that dose exists |
| 409 | `FIRST_DOSE_ALREADY_COMPLETED` | dose 1 requested after it is done |
| 409 | `ALREADY_FULLY_VACCINATED` | both doses complete |

### 13.8 `GET /api/bookings`

`Authorization: Bearer <user token>`. Lists the caller's own bookings with the
slot expanded, ordered by dose.

### 13.9 `GET /api/bookings/:bookingId`

`Authorization: Bearer <user token>`. Errors: `400 VALIDATION_ERROR` (malformed
id), `403 NOT_BOOKING_OWNER`, `404 BOOKING_NOT_FOUND`.

### 13.10 `PATCH /api/bookings/:bookingId` (`PUT` accepted as an alias)

`Authorization: Bearer <user token>`. Body `{ "slotId": "<new slot id>" }`.

`200 OK`

```json
{
  "success": true,
  "message": "Booking moved to 2024-11-15 02:00 PM - 02:30 PM",
  "data": {
    "booking": { "id": "...", "doseNumber": 1, "status": "BOOKED", "slotStartAt": "2024-11-15T14:00:00.000Z", "slotEndAt": "2024-11-15T14:30:00.000Z" },
    "previousSlot": { "id": "...", "date": "2024-11-10", "startTime": "11:00 AM", "bookedCount": 0, "availableDoses": 10 },
    "newSlot": { "id": "...", "date": "2024-11-15", "startTime": "02:00 PM", "endTime": "02:30 PM", "bookedCount": 1, "availableDoses": 9 }
  }
}
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `MODIFICATION_WINDOW_CLOSED` | 24 hours or less until the current slot |
| 400 | `SAME_SLOT` | target is the slot already booked |
| 400 | `BOOKING_ALREADY_COMPLETED` | the dose has already been administered |
| 400 | `SLOT_NOT_BOOKABLE` | target slot has already started |
| 403 | `NOT_BOOKING_OWNER` | the booking belongs to another user |
| 404 | `BOOKING_NOT_FOUND` / `SLOT_NOT_FOUND` | unknown id |
| 409 | `SLOT_FULL` | target slot is full - nothing is changed |

### 13.11 `GET /api/admin/users`

`Authorization: Bearer <admin token>`

Query parameters, all optional and freely combinable:

| Parameter | Type | Notes |
| --- | --- | --- |
| `age` | int 1-120 | exact age; takes precedence over the range |
| `minAge` / `maxAge` | int 1-120 | inclusive range |
| `pincode` | 6 digits | exact |
| `vaccinationStatus` | `NONE` / `FIRST_DOSE_COMPLETED` / `FULLY_VACCINATED` | |
| `page` | int >= 1 | default 1 |
| `limit` | int 1-200 | default 50 |

```json
{
  "success": true,
  "data": {
    "totalRegisteredUsers": 137,
    "matchingUsers": 12,
    "filtersApplied": { "age": 28, "pincode": "226001", "vaccinationStatus": "NONE" },
    "pagination": { "page": 1, "limit": 50, "totalPages": 1, "hasNextPage": false },
    "users": [
      { "id": "...", "name": "Saiyam Sharma", "phoneNumber": "9876543210", "age": 28, "pincode": "226001", "vaccinationStatus": "NONE", "registeredAt": "2024-10-30T09:12:44.001Z" }
    ]
  }
}
```

`totalRegisteredUsers` is the unfiltered registration count, so the admin always
sees the whole alongside the filtered subset. Aadhaar and password hashes are
never included.

### 13.12 `GET /api/admin/slots?date=YYYY-MM-DD`

`Authorization: Bearer <admin token>`

```json
{
  "success": true,
  "data": {
    "date": "2024-11-12",
    "firstDose": 24,
    "secondDose": 11,
    "total": 35,
    "totalSlots": 14,
    "totalCapacity": 140,
    "slots": [
      { "id": "...", "startTime": "10:00 AM", "endTime": "10:30 AM", "startAt": "2024-11-12T10:00:00.000Z", "capacity": 10, "bookedCount": 4, "availableDoses": 6, "firstDose": 3, "secondDose": 1, "total": 4 }
    ]
  }
}
```

---

## 14. Authentication

- `POST /api/auth/login` and `POST /api/auth/admin/login` return a JWT signed
  with `JWT_SECRET`, carrying `sub` (the principal id) and `role`
  (`USER` or `ADMIN`).
- Send it as `Authorization: Bearer <token>`.
- `authenticate` verifies the signature and expiry, then **looks the principal
  up in the collection its role points at**. A token claiming `ADMIN` for a
  normal user's id is therefore rejected: the id does not exist in `admins`.
  The loaded document is attached to the request, so the check costs no extra
  queries overall.
- `requireUser` / `requireAdmin` then enforce the role.

| Situation | Status | Code |
| --- | --- | --- |
| No `Authorization` header, or not `Bearer` | 401 | `TOKEN_MISSING` |
| Malformed or wrongly signed token | 401 | `TOKEN_INVALID` |
| Expired token | 401 | `TOKEN_EXPIRED` |
| Valid token, principal deleted | 401 | `PRINCIPAL_NOT_FOUND` |
| Wrong role for the endpoint | 403 | `INSUFFICIENT_ROLE` |
| Another user's booking | 403 | `NOT_BOOKING_OWNER` |

---

## 15. User flow

```
register  ->  login  ->  GET /api/slots/available?date=...
          ->  POST /api/bookings { slotId }            (dose 1)
          ->  [ slot lapses -> dose 1 complete ]
          ->  GET /api/slots/available?date=...        (now eligibleDose = 2)
          ->  POST /api/bookings { slotId }            (dose 2)
          ->  [ slot lapses -> fully vaccinated ]

at any point, more than 24h before the registered slot:
          ->  PATCH /api/bookings/:id { slotId }
```

## 16. Admin flow

```
POST /api/auth/admin/login
  -> GET /api/admin/users?age=&minAge=&maxAge=&pincode=&vaccinationStatus=&page=&limit=
  -> GET /api/admin/slots?date=YYYY-MM-DD
```

---

## 17. Vaccination status logic

```
NONE
  │  registered dose-1 slot lapses (slot END time passes)
  ▼
FIRST_DOSE_COMPLETED
  │  registered dose-2 slot lapses
  ▼
FULLY_VACCINATED
```

| Status | May book |
| --- | --- |
| `NONE` | dose 1 only |
| `FIRST_DOSE_COMPLETED` | dose 2 only |
| `FULLY_VACCINATED` | nothing |

There is **no manual "mark as vaccinated" step** - the assignment defines the
dose as administered when the registered slot lapses, and that is the entire
transition. "Lapsed" is interpreted as the slot's **end** time having passed: at
10:15 you are still inside your 10:00-10:30 appointment.

Status is stored on the user (denormalised) so admin filtering is one indexed
query. It is kept truthful by `syncLapsedVaccinations()`, which runs before every
read that depends on it:

1. find `BOOKED` bookings with `slotEndAt <= now` - one indexed query, normally
   returning zero documents;
2. flip exactly those to `COMPLETED`;
3. recompute status for only the affected users via a `$max` aggregation on
   completed doses, applied with a single `bulkWrite`.

The lapsed ids are captured *before* the update rather than recomputed after, so
a booking that lapses mid-sweep is picked up by the next sweep instead of being
completed without its user's status being recalculated.

---

## 18. Slot logic

- Drive: 2024-11-01 to 2024-11-30 inclusive (30 days).
- Window: 10:00-17:00, 30-minute slots → 14 per day → **420 slots**.
- Capacity: 10 doses per slot → **4,200 doses**. First and second doses consume
  the same pool.
- `generateSlotDefinitions()` is a pure function - same output, same order, every
  run - which is what makes the seed idempotent.
- A slot is offered only if it is inside the drive, has not started, and has
  `bookedCount < capacity`.

**Time zone:** all slot instants are stored and compared in **UTC**, so
`2024-11-01` + `10:00 AM` is always `2024-11-01T10:00:00.000Z`. This is a
deliberate assumption: it makes the date string an unambiguous key and removes
every DST/offset edge case. To present the drive in IST instead, shift at the
presentation layer or set the slot generation offset - do not mix zones in
storage.

---

## 19. Capacity handling and concurrency

`bookedCount` is a reservation counter on the slot, and the **only** way it
changes is an atomic conditional update:

```js
Slot.findOneAndUpdate(
  { _id: slotId, $expr: { $lt: ["$bookedCount", "$capacity"] } },
  { $inc: { bookedCount: 1 } },
  { new: true }
);
```

MongoDB applies the predicate and the increment as one indivisible server-side
operation on a single document, so 30 simultaneous requests against a slot with
10 seats produce exactly 10 winners. The naive read → check → increment → save
sequence cannot make that guarantee: every reader can observe the same
pre-increment value. A returned `null` *is* the "slot is full" signal.

Booking creation reserves the seat **before** inserting the booking document. If
the insert then fails - most importantly on the unique `{ userId, doseNumber }`
index, which is what stops one user's concurrent duplicate requests from
double-booking - the seat is compensated back. That ordering can only ever
under-allocate on failure, never oversubscribe.

Duplicate protection is layered:

| Guard | Level |
| --- | --- |
| eligibility check on `vaccinationStatus` | application |
| existing-booking lookup | application |
| unique index `{ userId, doseNumber }` | database - wins every race |

---

## 20. The 24-hour modification rule

A booking may be changed **if and only if** more than 24 hours remain until the
currently registered slot start:

| Time remaining | Result |
| --- | --- |
| `> 24h` | allowed |
| `== 24h` | **rejected** (`MODIFICATION_WINDOW_CLOSED`) |
| `< 24h` | rejected |

Implemented as a strict inequality in `canModifyBooking()` and checked twice -
once before the transaction and once inside it, so a concurrent change cannot
slip past.

The move itself runs inside a MongoDB transaction where supported (Atlas always
supports it; a standalone `mongod` does not, and the code falls back to the same
atomic conditional updates with explicit compensation). Order of operations:

1. authenticate, 2. verify ownership, 3. validate the booking is still `BOOKED`,
4. validate the destination slot (exists, in drive, not started, has room),
5. validate the 24-hour rule, 6. **reserve the new seat**, 7. **release the old
seat**, 8. update the booking.

The new seat is taken before the old one is released. The reverse order would
briefly free a seat the user still holds, letting someone else take it while the
move might still fail. On any failure the new seat is given back and the
database is left exactly as it was.

---

## 21. Database models

### `users`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String | 2-100 chars |
| `phoneNumber` | String | **unique**, exactly 10 digits, login identifier |
| `age` | Number | integer 1-120 |
| `pincode` | String | exactly 6 digits (kept as a string - leading zeros matter) |
| `aadharNo` | String | **unique**, 12 digits, `select: false` |
| `passwordHash` | String | bcrypt, `select: false` |
| `vaccinationStatus` | Enum | `NONE` / `FIRST_DOSE_COMPLETED` / `FULLY_VACCINATED` |

### `admins`

`name`, `phoneNumber` (**unique**), `passwordHash` (`select: false`), `role`.
Created only by the seed script.

### `slots`

| Field | Type | Notes |
| --- | --- | --- |
| `date` | String | `YYYY-MM-DD` (UTC) - the grouping key for every day query |
| `startTime` / `endTime` | String | display labels, e.g. `10:00 AM` |
| `startAt` / `endAt` | Date | **unique** `startAt`; the authoritative instants |
| `capacity` | Number | 10 |
| `bookedCount` | Number | reservation counter, `min: 0` |

### `bookings`

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId → `users` | |
| `slotId` | ObjectId → `slots` | |
| `doseNumber` | Number | 1 or 2 |
| `status` | Enum | `BOOKED` → `COMPLETED` |
| `slotStartAt` / `slotEndAt` | Date | denormalised from the slot |
| `completedAt` | Date | set when the slot lapses |

**Why denormalise the slot instants onto the booking?** Slot instants are
immutable once seeded, so there is no staleness risk, and it removes a `$lookup`
from the two queries that would otherwise scale with the entire booking
collection: the lapse sweep and the admin daily statistics.

---

## 22. Indexes

| Collection | Index | Why |
| --- | --- | --- |
| `users` | `{ phoneNumber: 1 }` unique | login lookup + uniqueness rule |
| `users` | `{ aadharNo: 1 }` unique | uniqueness rule, enforced in the database |
| `users` | `{ vaccinationStatus: 1 }` | admin filter |
| `users` | `{ pincode: 1 }` | admin filter |
| `users` | `{ age: 1 }` | admin filter (exact and range) |
| `admins` | `{ phoneNumber: 1 }` unique | admin login |
| `slots` | `{ startAt: 1 }` unique | slot's natural key; makes the seed idempotent |
| `slots` | `{ date: 1, startAt: 1 }` | "slots for this day, ordered by time" - the hottest query |
| `bookings` | `{ userId: 1, doseNumber: 1 }` unique | one booking per user per dose; the race-proof duplicate guard |
| `bookings` | `{ status: 1, slotEndAt: 1 }` | the lapse sweep |
| `bookings` | `{ slotStartAt: 1, doseNumber: 1 }` | admin daily statistics without a join |
| `bookings` | `{ slotId: 1 }` | per-slot reconciliation |

The three admin filters are independent and may arrive in any combination, so
single-field indexes are used and MongoDB intersects them. One compound index
would only serve its prefix subsets and would leave `age`-only or
`vaccinationStatus`-only queries unindexed. No index exists that no query uses.

---

## 23. Performance considerations

| Concern | What was done |
| --- | --- |
| Admin user filtering | Filtering, counting and pagination all happen in MongoDB. Nothing is loaded into Node and filtered there. Three round trips regardless of result size |
| N+1 on status refresh | The sweep is bulk: one indexed query, then `updateMany` + one aggregation + one `bulkWrite` scoped to the affected users. It never iterates users |
| Daily statistics | One `$facet` aggregation over `bookings.slotStartAt` (indexed). No `$lookup` into `slots`. Plus one 14-document slot read to add capacity per slot |
| Available slots | One indexed read of at most 14 documents. Availability is computed in memory over those 14 rather than with `$expr` in the filter, which cannot use an index |
| Over-fetching | `.select()` projections everywhere; `.lean()` for read-only paths; `select: false` on `passwordHash` and `aadharNo` |
| Capacity race | Single atomic conditional update - no read-modify-write anywhere |
| Unbounded responses | Admin listing is paginated (default 50, max 200) |
| Auth overhead | The principal document loaded during authentication is reused downstream, so the existence check adds no net queries |

---

## 24. Validation

Two layers: `express-validator` at the edge (rejecting before any database
access) and Mongoose schema validation behind it as defence in depth.

| Field | Rule |
| --- | --- |
| `name` | string, 2-100 chars, trimmed |
| `phoneNumber` | exactly 10 digits, unique |
| `age` | integer 1-120 |
| `pincode` | exactly 6 digits |
| `aadharNo` | exactly 12 digits, unique |
| `password` | 8-128 chars, at least one letter and one digit |
| `date` query | `YYYY-MM-DD` **and** a real calendar date (`2024-11-31` is rejected) |
| `slotId` / `bookingId` | valid ObjectId |
| `doseNumber` | 1 or 2, optional |
| admin filters | typed, ranged, enum-checked; `minAge <= maxAge` |

Also handled: duplicate phone, duplicate Aadhaar, malformed ObjectId, missing /
invalid / expired / malformed JWT, malformed JSON body, dates outside the drive,
slots outside operating hours, full slots, already-started slots, invalid dose
for the current state, duplicate dose bookings, and cross-user resource access.

---

## 25. Error handling

Every failure exits through one handler. Services throw `ApiError(status, message,
code)`; anything unrecognised is logged server-side and returned as a bare
`500 INTERNAL_ERROR`. **Stack traces, driver messages and connection strings are
never sent to the client** (a `debug` field appears only when `NODE_ENV` is not
`production`).

| Status | Meaning |
| --- | --- |
| 200 / 201 | success |
| 400 | validation failure or a rule violation that is the caller's fault |
| 401 | missing, invalid or expired credentials |
| 403 | authenticated but not allowed |
| 404 | unknown route or resource |
| 409 | conflict: duplicate, full slot, impossible state transition |
| 429 | rate limited |
| 500 | unexpected - generic message only |

---

## 26. Design assumptions

1. **UTC everywhere.** Slot times are stored and compared in UTC; `date` strings
   are UTC calendar days.
2. **A dose is complete when the slot's END time passes**, not its start. The
   assignment says "once the registered time slot is lapsed"; a slot in progress
   has not lapsed.
3. **Exactly 24 hours is too late** to change a booking ("till 24 hours prior"
   read as a strict boundary).
4. **`doseNumber` is optional on booking.** The server derives the only eligible
   dose; an explicit value is validated rather than obeyed.
5. **Slot changes are only allowed to slots that have not started**, mirroring
   the rule for a new booking.
6. **There is no cancellation endpoint** - the assignment does not ask for one,
   so `BOOKED → COMPLETED` is the whole booking lifecycle and no dead
   `CANCELLED` state is carried.
7. **The drive dates are overridable by environment variable but default to the
   assignment's**, purely so the project can be demonstrated outside November
   2024. Hours, slot length and capacity are not overridable, because changing
   them would silently break the 420/4,200 contract.
8. **Password policy is stricter than the assignment requires** (8+ chars, letter
   + digit). The assignment sets no policy; a weaker one seemed worse than a
   slightly stricter one.

---

## 27. Testing time-dependent behaviour (`x-mock-time`)

The drive is fixed to November 2024, which is in the past. Rather than move the
assignment's dates, time-dependent logic goes through a clock abstraction
(`src/utils/clock.js`) that can be overridden per request.

**This is how you demo the API today.** With `ALLOW_MOCK_TIME=true` and
`NODE_ENV` set to anything other than `production`, add a header:

```bash
curl -H "Authorization: Bearer $TOKEN" \
     -H "x-mock-time: 2024-11-01T08:00:00.000Z" \
     "http://localhost:5000/api/slots/available?date=2024-11-05"
```

Without it, every November 2024 slot is in the past and nothing is bookable -
which is correct behaviour, not a bug.

Safety: the middleware is **not registered at all** when `NODE_ENV=production`,
so the header is inert rather than merely ignored by a runtime branch someone
could flip. `isMockTimeEnabled()` requires both the flag and a non-production
environment, and `/health` reports whether it is on. The override uses
`AsyncLocalStorage`, so concurrent requests never see each other's clock.

Scenarios the suite drives with it: before a slot, at slot boundaries, after a
slot, a lapsed first-dose slot, a lapsed second-dose slot, and exactly / slightly
more / slightly less than 24 hours before a modification.

---

## 28. Postman

`postman/Vaccine-Registration.postman_collection.json` and
`postman/Vaccine-Registration.postman_environment.json`. Import both, select the
environment, and run the folders top to bottom - the login requests save
`userToken` / `adminToken` and the booking requests save `bookingId` / `slotId`
automatically. Variables: `baseUrl`, `userToken`, `adminToken`, `slotId`,
`altSlotId`, `bookingId`, `date`, `mockTime`, plus the admin credentials.

---

## 29. Project structure

```
vaccine-registration-backend/
├── docs/
│   ├── low-level-design.md
│   └── requirements-checklist.md
├── postman/
│   ├── Vaccine-Registration.postman_collection.json
│   └── Vaccine-Registration.postman_environment.json
├── scripts/
│   ├── seedAdmin.js
│   └── seedSlots.js
├── src/
│   ├── app.js
│   ├── config/{env.js, db.js}
│   ├── constants/vaccine.js
│   ├── controllers/{auth,user,slot,booking,admin}.controller.js
│   ├── middleware/{auth,errorHandler,mockTime,rateLimit,validate}.js
│   ├── models/{User,Admin,Slot,Booking}.js
│   ├── routes/{index,auth,user,slot,booking,admin}.routes.js
│   ├── services/{vaccination,slot,booking,admin,seed}.service.js
│   └── utils/{apiError,clock,date,jwt,mask,transactions,validation}.js
├── tests/
│   ├── support/{globalSetup,globalTeardown,db,helpers}.js
│   ├── unit/{date,clock,slot-generation,vaccination-state,misc}.test.js
│   └── integration/{auth,slots,booking,vaccination-flow,
│                    booking-modification,admin,security,concurrency,seed}.test.js
├── .env.example
├── jest.config.js
├── jest.unit.config.js
├── package.json
└── server.js
```

---

## 30. Quick start, end to end

```bash
npm install
cp .env.example .env            # fill MONGO_URI, JWT_SECRET, ADMIN_PHONE, ADMIN_PASSWORD
                                # and set ALLOW_MOCK_TIME=true to demo November 2024
npm run seed                    # 420 slots + 1 admin
npm test                        # full suite
npm run dev                     # http://localhost:5000
```
