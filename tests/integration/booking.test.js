const mongoose = require("mongoose");

const {
  app,
  request,
  TIME,
  createUserAndLogin,
  seedAllSlots,
  bookSlot
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const Slot = require("../../src/models/Slot");
const Booking = require("../../src/models/Booking");
const { SLOT_CAPACITY } = require("../../src/constants/vaccine");

let token;
let slot;

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await resetState();
  ({ token } = await createUserAndLogin());
  slot = await Slot.findOne({ date: "2024-11-10", startTime: "11:00 AM" });
});

describe("POST /api/bookings - first dose", () => {
  it("books a first-dose slot and consumes one dose", async () => {
    const response = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    expect(response.status).toBe(201);
    expect(response.body.data.booking.doseNumber).toBe(1);
    expect(response.body.data.booking.status).toBe("BOOKED");
    expect(response.body.data.slot.bookedCount).toBe(1);
    expect(response.body.data.slot.availableDoses).toBe(9);

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(1);

    const stored = await Booking.findOne({ slotId: slot._id });
    expect(stored.slotStartAt.toISOString()).toBe(slot.startAt.toISOString());
    expect(stored.slotEndAt.toISOString()).toBe(slot.endAt.toISOString());
  });

  it("accepts an explicit doseNumber of 1", async () => {
    const response = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY, 1);
    expect(response.status).toBe(201);
    expect(response.body.data.booking.doseNumber).toBe(1);
  });

  it("rejects a second dose before the first is completed", async () => {
    const response = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY, 2);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("FIRST_DOSE_NOT_COMPLETED");
    expect(await Booking.countDocuments({})).toBe(0);

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(0);
  });

  it("rejects a second booking for the same dose", async () => {
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const other = await Slot.findOne({
      date: "2024-11-12",
      startTime: "02:00 PM"
    });
    const response = await bookSlot(token, String(other._id), TIME.DAY1_EARLY);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DOSE_ALREADY_BOOKED");
    expect(await Booking.countDocuments({})).toBe(1);

    const reloaded = await Slot.findById(other._id);
    expect(reloaded.bookedCount).toBe(0);
  });

  it("rejects a full slot with 409 and leaves capacity at 10", async () => {
    await Slot.updateOne(
      { _id: slot._id },
      { $set: { bookedCount: SLOT_CAPACITY } }
    );

    const response = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SLOT_FULL");

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(SLOT_CAPACITY);
  });

  it("rejects a slot that has already started", async () => {
    const response = await bookSlot(
      token,
      String(slot._id),
      "2024-11-10T11:05:00.000Z"
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SLOT_NOT_BOOKABLE");
  });

  it("rejects a slot that starts at exactly the current instant", async () => {
    const response = await bookSlot(
      token,
      String(slot._id),
      slot.startAt.toISOString()
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SLOT_NOT_BOOKABLE");
  });

  it("rejects an unknown slot id with 404", async () => {
    const response = await bookSlot(
      token,
      String(new mongoose.Types.ObjectId()),
      TIME.DAY1_EARLY
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("SLOT_NOT_FOUND");
  });

  it("rejects a malformed slot id with 400", async () => {
    const response = await bookSlot(token, "not-an-object-id", TIME.DAY1_EARLY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a missing slotId", async () => {
    const response = await request(app)
      .post("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.details.map((d) => d.field)).toContain("slotId");
  });

  it("rejects an out-of-range doseNumber", async () => {
    const response = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY, 3);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .post("/api/bookings")
      .send({ slotId: String(slot._id) });

    expect(response.status).toBe(401);
  });
});

describe("booking retrieval", () => {
  it("lists the caller's own bookings with the slot expanded", async () => {
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const response = await request(app)
      .get("/api/bookings")
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(1);
    expect(response.body.data.bookings[0].slot.startTime).toBe("11:00 AM");
    expect(response.body.data.bookings[0].slot.date).toBe("2024-11-10");
  });

  it("fetches a single booking by id", async () => {
    const created = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);
    const bookingId = created.body.data.booking.id;

    const response = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(200);
    expect(String(response.body.data.booking.id)).toBe(String(bookingId));
  });

  it("refuses to show another user's booking", async () => {
    const created = await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);
    const bookingId = created.body.data.booking.id;

    const { token: otherToken } = await createUserAndLogin();

    const response = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${otherToken}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NOT_BOOKING_OWNER");
  });

  it("returns 404 for a booking that does not exist", async () => {
    const response = await request(app)
      .get(`/api/bookings/${new mongoose.Types.ObjectId()}`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("BOOKING_NOT_FOUND");
  });

  it("returns 400 for a malformed booking id", async () => {
    const response = await request(app)
      .get("/api/bookings/12345")
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/users/me", () => {
  it("returns the profile, masked Aadhar, eligible dose and bookings", async () => {
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY);

    expect(response.status).toBe(200);
    expect(response.body.data.user.aadharNo).toMatch(/^X{8}\d{4}$/);
    expect(response.body.data.user.vaccinationStatus).toBe("NONE");
    expect(response.body.data.eligibleDose).toBe(1);
    expect(response.body.data.bookings).toHaveLength(1);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });
});
