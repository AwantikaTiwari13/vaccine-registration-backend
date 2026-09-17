const {
  app,
  request,
  TIME,
  createUserAndLogin,
  seedAllSlots,
  seedAdmin,
  loginAdmin,
  bookSlot,
  changeBooking
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const Slot = require("../../src/models/Slot");
const User = require("../../src/models/User");

let adminToken;

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await resetState();
  await seedAdmin();
  adminToken = await loginAdmin();
});

function adminGet(path, query = {}, time) {
  const req = request(app)
    .get(path)
    .query(query)
    .set("Authorization", `Bearer ${adminToken}`);
  return time ? req.set("x-mock-time", time) : req;
}

/** Creates a user and forces a vaccination status directly, for filter tests. */
async function seedUserWith({ age, pincode, vaccinationStatus }) {
  const { user } = await createUserAndLogin({ age, pincode });
  if (vaccinationStatus) {
    await User.updateOne({ _id: user.id }, { $set: { vaccinationStatus } });
  }
  return user;
}

describe("admin authorisation", () => {
  it("rejects an unauthenticated request", async () => {
    const response = await request(app).get("/api/admin/users");
    expect(response.status).toBe(401);
  });

  it("rejects a normal user's token with 403", async () => {
    const { token } = await createUserAndLogin();

    const response = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INSUFFICIENT_ROLE");
  });

  it("rejects an admin token on user-only endpoints", async () => {
    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INSUFFICIENT_ROLE");
  });
});

describe("GET /api/admin/users", () => {
  beforeEach(async () => {
    await seedUserWith({ age: 25, pincode: "226001" });
    await seedUserWith({ age: 25, pincode: "110001" });
    await seedUserWith({ age: 40, pincode: "226001" });
    await seedUserWith({
      age: 40,
      pincode: "226001",
      vaccinationStatus: "FIRST_DOSE_COMPLETED"
    });
    await seedUserWith({
      age: 60,
      pincode: "560001",
      vaccinationStatus: "FULLY_VACCINATED"
    });
  });

  it("returns the total registered users with no filter", async () => {
    const response = await adminGet("/api/admin/users");

    expect(response.status).toBe(200);
    expect(response.body.data.totalRegisteredUsers).toBe(5);
    expect(response.body.data.matchingUsers).toBe(5);
    expect(response.body.data.users).toHaveLength(5);
  });

  it("never exposes password hashes or Aadhar numbers", async () => {
    const response = await adminGet("/api/admin/users");
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain("aadharNo");
  });

  it("filters by exact age", async () => {
    const response = await adminGet("/api/admin/users", { age: 25 });

    expect(response.body.data.matchingUsers).toBe(2);
    response.body.data.users.forEach((user) => expect(user.age).toBe(25));
  });

  it("filters by an age range", async () => {
    const response = await adminGet("/api/admin/users", {
      minAge: 30,
      maxAge: 50
    });

    expect(response.body.data.matchingUsers).toBe(2);
    response.body.data.users.forEach((user) => {
      expect(user.age).toBeGreaterThanOrEqual(30);
      expect(user.age).toBeLessThanOrEqual(50);
    });
  });

  it("filters by pincode", async () => {
    const response = await adminGet("/api/admin/users", { pincode: "226001" });

    expect(response.body.data.matchingUsers).toBe(3);
    response.body.data.users.forEach((user) =>
      expect(user.pincode).toBe("226001")
    );
  });

  it.each([
    ["NONE", 3],
    ["FIRST_DOSE_COMPLETED", 1],
    ["FULLY_VACCINATED", 1]
  ])("filters by vaccination status %s", async (status, expected) => {
    const response = await adminGet("/api/admin/users", {
      vaccinationStatus: status
    });

    expect(response.body.data.matchingUsers).toBe(expected);
    response.body.data.users.forEach((user) =>
      expect(user.vaccinationStatus).toBe(status)
    );
  });

  it("combines age, pincode and vaccination status", async () => {
    const response = await adminGet("/api/admin/users", {
      age: 40,
      pincode: "226001",
      vaccinationStatus: "FIRST_DOSE_COMPLETED"
    });

    expect(response.body.data.matchingUsers).toBe(1);
    expect(response.body.data.users[0].age).toBe(40);
    expect(response.body.data.users[0].pincode).toBe("226001");
    expect(response.body.data.totalRegisteredUsers).toBe(5);
  });

  it("returns an empty result set for a filter that matches nothing", async () => {
    const response = await adminGet("/api/admin/users", { pincode: "999999" });

    expect(response.status).toBe(200);
    expect(response.body.data.matchingUsers).toBe(0);
    expect(response.body.data.users).toEqual([]);
  });

  it("paginates", async () => {
    const page1 = await adminGet("/api/admin/users", { page: 1, limit: 2 });
    const page2 = await adminGet("/api/admin/users", { page: 2, limit: 2 });
    const page3 = await adminGet("/api/admin/users", { page: 3, limit: 2 });

    expect(page1.body.data.users).toHaveLength(2);
    expect(page1.body.data.pagination.totalPages).toBe(3);
    expect(page1.body.data.pagination.hasNextPage).toBe(true);
    expect(page3.body.data.users).toHaveLength(1);
    expect(page3.body.data.pagination.hasNextPage).toBe(false);

    const ids = [...page1.body.data.users, ...page2.body.data.users].map(
      (u) => u.id
    );
    expect(new Set(ids).size).toBe(4);
  });

  it.each([
    [{ age: "abc" }],
    [{ age: 0 }],
    [{ pincode: "12" }],
    [{ vaccinationStatus: "PARTIAL" }],
    [{ page: 0 }],
    [{ limit: 5000 }],
    [{ minAge: 50, maxAge: 20 }]
  ])("rejects invalid filter %o", async (query) => {
    const response = await adminGet("/api/admin/users", query);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("reflects a status that changed because a slot lapsed, not stale state", async () => {
    const { token, user } = await createUserAndLogin({ pincode: "700001" });
    const slot = await Slot.findOne({
      date: "2024-11-08",
      startTime: "10:00 AM"
    });
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const stored = await User.findById(user.id).lean();
    expect(stored.vaccinationStatus).toBe("NONE");

    const response = await adminGet(
      "/api/admin/users",
      { pincode: "700001", vaccinationStatus: "FIRST_DOSE_COMPLETED" },
      "2024-11-09T08:00:00.000Z"
    );

    expect(response.body.data.matchingUsers).toBe(1);
    expect(String(response.body.data.users[0].id)).toBe(String(user.id));
  });
});

describe("GET /api/admin/slots", () => {
  it("reports first dose, second dose and total for a day", async () => {
    const slot = await Slot.findOne({
      date: "2024-11-12",
      startTime: "10:00 AM"
    });
    const otherSlot = await Slot.findOne({
      date: "2024-11-12",
      startTime: "03:00 PM"
    });

    // Two first-dose registrations on 2024-11-12.
    const a = await createUserAndLogin();
    const b = await createUserAndLogin();
    await bookSlot(a.token, String(slot._id), TIME.DAY1_EARLY);
    await bookSlot(b.token, String(otherSlot._id), TIME.DAY1_EARLY);

    // One user completes dose 1 earlier and books dose 2 on 2024-11-12.
    const c = await createUserAndLogin();
    const earlySlot = await Slot.findOne({
      date: "2024-11-02",
      startTime: "10:00 AM"
    });
    await bookSlot(c.token, String(earlySlot._id), TIME.DAY1_EARLY);
    const second = await bookSlot(
      c.token,
      String(slot._id),
      "2024-11-03T08:00:00.000Z"
    );
    expect(second.body.data.booking.doseNumber).toBe(2);

    const response = await adminGet(
      "/api/admin/slots",
      { date: "2024-11-12" },
      "2024-11-04T08:00:00.000Z"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.firstDose).toBe(2);
    expect(response.body.data.secondDose).toBe(1);
    expect(response.body.data.total).toBe(3);
    expect(response.body.data.totalSlots).toBe(14);
    expect(response.body.data.totalCapacity).toBe(140);

    const perSlot = response.body.data.slots.find(
      (s) => String(s.id) === String(slot._id)
    );
    expect(perSlot.firstDose).toBe(1);
    expect(perSlot.secondDose).toBe(1);
    expect(perSlot.total).toBe(2);
    expect(perSlot.bookedCount).toBe(2);
    expect(perSlot.availableDoses).toBe(8);
  });

  it("returns zeroes for a day with no registrations", async () => {
    const response = await adminGet("/api/admin/slots", { date: "2024-11-22" });

    expect(response.status).toBe(200);
    expect(response.body.data.firstDose).toBe(0);
    expect(response.body.data.secondDose).toBe(0);
    expect(response.body.data.total).toBe(0);
    expect(response.body.data.slots).toHaveLength(14);
  });

  it("moves a booking between days when the user changes slot", async () => {
    const from = await Slot.findOne({
      date: "2024-11-18",
      startTime: "10:00 AM"
    });
    const to = await Slot.findOne({
      date: "2024-11-19",
      startTime: "10:00 AM"
    });

    const { token } = await createUserAndLogin();
    const created = await bookSlot(token, String(from._id), TIME.DAY1_EARLY);

    await changeBooking(
      token,
      created.body.data.booking.id,
      String(to._id),
      TIME.DAY1_EARLY
    );

    const dayFrom = await adminGet("/api/admin/slots", { date: "2024-11-18" });
    const dayTo = await adminGet("/api/admin/slots", { date: "2024-11-19" });

    expect(dayFrom.body.data.total).toBe(0);
    expect(dayTo.body.data.total).toBe(1);
    expect(dayTo.body.data.firstDose).toBe(1);
  });

  it("validates the date parameter", async () => {
    const missing = await adminGet("/api/admin/slots");
    const malformed = await adminGet("/api/admin/slots", { date: "12-11-2024" });
    const impossible = await adminGet("/api/admin/slots", {
      date: "2024-02-30"
    });

    expect(missing.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(impossible.status).toBe(400);
  });
});
