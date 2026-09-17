const request = require("supertest");

const app = require("../../src/app");
const { seedSlots } = require("../../src/services/slot.service");
const { seedAdminAccount } = require("../../src/services/seed.service");

/**
 * Reference instants used across the suite. Every time-dependent request sends
 * `x-mock-time`, because the assignment's drive is fixed to November 2024 and
 * the real clock is well past it. The header is only honoured because
 * NODE_ENV=test and ALLOW_MOCK_TIME=true; in production the middleware is never
 * mounted.
 */
const TIME = {
  BEFORE_DRIVE: "2024-10-25T08:00:00.000Z",
  DAY1_EARLY: "2024-11-01T08:00:00.000Z",
  DAY1_MID_FIRST_SLOT: "2024-11-01T10:15:00.000Z",
  DAY1_AFTER_FIRST_SLOT: "2024-11-01T10:31:00.000Z",
  DAY2_EARLY: "2024-11-02T08:00:00.000Z",
  DAY5_EARLY: "2024-11-05T08:00:00.000Z",
  DAY10_EARLY: "2024-11-10T08:00:00.000Z",
  AFTER_DRIVE: "2024-12-01T08:00:00.000Z"
};

const DEFAULT_ADMIN = {
  name: "Test Admin",
  phoneNumber: "9000000000",
  password: "AdminPass123"
};

let phoneCounter = 0;
let aadharCounter = 0;

function uniqueUser(overrides = {}) {
  phoneCounter += 1;
  aadharCounter += 1;

  return {
    name: `Test User ${phoneCounter}`,
    phoneNumber: String(7000000000 + phoneCounter),
    age: 30,
    pincode: "226001",
    aadharNo: String(100000000000 + aadharCounter),
    password: "Password123",
    ...overrides
  };
}

/** Attaches the mock clock to a supertest request when one is supplied. */
function at(req, time) {
  return time ? req.set("x-mock-time", time) : req;
}

async function seedAllSlots() {
  return seedSlots();
}

async function seedAdmin(overrides = {}) {
  return seedAdminAccount({ ...DEFAULT_ADMIN, ...overrides });
}

async function registerUser(overrides = {}) {
  const payload = uniqueUser(overrides);
  const response = await request(app).post("/api/auth/register").send(payload);

  if (response.status !== 201) {
    throw new Error(
      `registerUser failed: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return { payload, user: response.body.data.user };
}

async function loginUser(phoneNumber, password) {
  const response = await request(app)
    .post("/api/auth/login")
    .send({ phoneNumber, password });

  if (response.status !== 200) {
    throw new Error(
      `loginUser failed: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return response.body.data.token;
}

/** Registers a user and returns { payload, user, token }. */
async function createUserAndLogin(overrides = {}) {
  const { payload, user } = await registerUser(overrides);
  const token = await loginUser(payload.phoneNumber, payload.password);
  return { payload, user, token };
}

async function loginAdmin(overrides = {}) {
  const credentials = { ...DEFAULT_ADMIN, ...overrides };
  const response = await request(app)
    .post("/api/auth/admin/login")
    .send({
      phoneNumber: credentials.phoneNumber,
      password: credentials.password
    });

  if (response.status !== 200) {
    throw new Error(
      `loginAdmin failed: ${response.status} ${JSON.stringify(response.body)}`
    );
  }

  return response.body.data.token;
}

/** Returns available slots for a date as seen by one user at a given instant. */
async function getAvailableSlots(token, date, time) {
  const response = await at(
    request(app)
      .get("/api/slots/available")
      .query({ date })
      .set("Authorization", `Bearer ${token}`),
    time
  );

  return response;
}

async function bookSlot(token, slotId, time, doseNumber) {
  const body = doseNumber === undefined ? { slotId } : { slotId, doseNumber };

  return at(
    request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .send(body),
    time
  );
}

async function changeBooking(token, bookingId, slotId, time) {
  return at(
    request(app)
      .patch(`/api/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ slotId }),
    time
  );
}

module.exports = {
  app,
  request,
  TIME,
  DEFAULT_ADMIN,
  at,
  uniqueUser,
  seedAllSlots,
  seedAdmin,
  registerUser,
  loginUser,
  createUserAndLogin,
  loginAdmin,
  getAvailableSlots,
  bookSlot,
  changeBooking
};
