const {
  app,
  request,
  TIME,
  createUserAndLogin,
  seedAllSlots,
  getAvailableSlots,
  bookSlot
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const Slot = require("../../src/models/Slot");
const { SLOT_CAPACITY } = require("../../src/constants/vaccine");

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);
beforeEach(resetState);

describe("slot seeding", () => {
  it("creates exactly 420 slots representing 4,200 doses", async () => {
    const total = await Slot.countDocuments({});
    expect(total).toBe(420);

    const capacity = await Slot.aggregate([
      { $group: { _id: null, doses: { $sum: "$capacity" } } }
    ]);
    expect(capacity[0].doses).toBe(4200);
  });

  it("creates 14 slots for every day of the drive", async () => {
    const perDay = await Slot.aggregate([
      { $group: { _id: "$date", count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);

    expect(perDay).toHaveLength(30);
    expect(perDay[0]._id).toBe("2024-11-01");
    expect(perDay[29]._id).toBe("2024-11-30");
    perDay.forEach((day) => expect(day.count).toBe(14));
  });

  it("is idempotent - re-running the seed inserts nothing", async () => {
    const result = await seedAllSlots();

    expect(result.inserted).toBe(0);
    expect(result.matched).toBe(420);
    expect(await Slot.countDocuments({})).toBe(420);
  });

  it("does not reset existing reservations when re-run", async () => {
    const slot = await Slot.findOne({ date: "2024-11-10" });
    await Slot.updateOne({ _id: slot._id }, { $set: { bookedCount: 4 } });

    await seedAllSlots();

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(4);
  });

  it("holds every slot inside 10:00-17:00 in 30-minute steps", async () => {
    const slots = await Slot.find({ date: "2024-11-01" })
      .sort({ startAt: 1 })
      .lean();

    expect(slots[0].startTime).toBe("10:00 AM");
    expect(slots[13].endTime).toBe("05:00 PM");
    slots.forEach((slot) => {
      expect((slot.endAt - slot.startAt) / 60000).toBe(30);
      expect(slot.capacity).toBe(SLOT_CAPACITY);
    });
  });
});

describe("GET /api/slots/available", () => {
  let token;

  beforeEach(async () => {
    ({ token } = await createUserAndLogin());
  });

  it("requires authentication", async () => {
    const response = await request(app)
      .get("/api/slots/available")
      .query({ date: "2024-11-05" });

    expect(response.status).toBe(401);
  });

  it("returns the 14 slots of a future day with full availability", async () => {
    const response = await getAvailableSlots(token, "2024-11-05", TIME.DAY1_EARLY);

    expect(response.status).toBe(200);
    expect(response.body.data.slots).toHaveLength(14);
    expect(response.body.data.eligibleDose).toBe(1);
    expect(response.body.data.vaccinationStatus).toBe("NONE");
    response.body.data.slots.forEach((slot) => {
      expect(slot.availableDoses).toBe(10);
    });
  });

  it("excludes slots that have already started", async () => {
    // 11:15 on day 1: the 10:00, 10:30 and 11:00 slots have all begun.
    const response = await getAvailableSlots(
      token,
      "2024-11-01",
      "2024-11-01T11:15:00.000Z"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.slots).toHaveLength(11);
    expect(response.body.data.slots[0].startTime).toBe("11:30 AM");
  });

  it("excludes a slot once its 10 doses are taken", async () => {
    const slot = await Slot.findOne({ date: "2024-11-05", startTime: "10:00 AM" });
    await Slot.updateOne(
      { _id: slot._id },
      { $set: { bookedCount: SLOT_CAPACITY } }
    );

    const response = await getAvailableSlots(token, "2024-11-05", TIME.DAY1_EARLY);

    expect(response.body.data.slots).toHaveLength(13);
    expect(
      response.body.data.slots.map((s) => String(s.id))
    ).not.toContain(String(slot._id));
  });

  it("reports availability shrinking as doses are taken", async () => {
    const slot = await Slot.findOne({ date: "2024-11-05", startTime: "02:00 PM" });
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const response = await getAvailableSlots(token, "2024-11-05", TIME.DAY1_EARLY);
    const target = response.body.data.slots.find(
      (s) => String(s.id) === String(slot._id)
    );

    expect(target.bookedCount).toBe(1);
    expect(target.availableDoses).toBe(9);
    expect(target.isYourCurrentSlot).toBe(true);
    expect(String(response.body.data.currentBookingSlotId)).toBe(
      String(slot._id)
    );
  });

  it("rejects a date outside the vaccination drive", async () => {
    const before = await getAvailableSlots(token, "2024-10-31", TIME.BEFORE_DRIVE);
    const after = await getAvailableSlots(token, "2024-12-01", TIME.DAY1_EARLY);

    expect(before.status).toBe(400);
    expect(before.body.error.code).toBe("DATE_OUTSIDE_DRIVE");
    expect(after.status).toBe(400);
  });

  it("rejects a malformed or impossible date", async () => {
    const malformed = await getAvailableSlots(token, "05-11-2024", TIME.DAY1_EARLY);
    const impossible = await getAvailableSlots(token, "2024-11-31", TIME.DAY1_EARLY);

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe("VALIDATION_ERROR");
    expect(impossible.status).toBe(400);
  });

  it("requires the date query parameter", async () => {
    const response = await request(app)
      .get("/api/slots/available")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects an invalid x-mock-time value", async () => {
    const response = await request(app)
      .get("/api/slots/available")
      .query({ date: "2024-11-05" })
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", "yesterday-ish");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_MOCK_TIME");
  });

  it("returns an empty list once the whole day has passed", async () => {
    const response = await getAvailableSlots(
      token,
      "2024-11-01",
      "2024-11-01T18:00:00.000Z"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.slots).toHaveLength(0);
  });
});
