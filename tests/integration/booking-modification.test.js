const {
  app,
  request,
  TIME,
  createUserAndLogin,
  seedAllSlots,
  bookSlot,
  changeBooking
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
let originalSlot;
let targetSlot;
let bookingId;

// Registered slot starts 2024-11-10T11:00:00Z, so the 24-hour boundary is
// exactly 2024-11-09T11:00:00Z.
const JUST_OVER_24H = "2024-11-09T10:59:59.000Z";
const EXACTLY_24H = "2024-11-09T11:00:00.000Z";
const JUST_UNDER_24H = "2024-11-09T11:00:01.000Z";
const WELL_UNDER_24H = "2024-11-10T09:00:00.000Z";

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await resetState();
  ({ token } = await createUserAndLogin());

  originalSlot = await Slot.findOne({
    date: "2024-11-10",
    startTime: "11:00 AM"
  });
  targetSlot = await Slot.findOne({
    date: "2024-11-15",
    startTime: "02:00 PM"
  });

  const created = await bookSlot(
    token,
    String(originalSlot._id),
    TIME.DAY1_EARLY
  );
  bookingId = created.body.data.booking.id;
});

describe("the 24-hour modification rule", () => {
  it("allows a change more than 24 hours before the registered slot", async () => {
    const response = await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      JUST_OVER_24H
    );

    expect(response.status).toBe(200);
    expect(String(response.body.data.newSlot.id)).toBe(String(targetSlot._id));
  });

  it("rejects a change at exactly 24 hours before the registered slot", async () => {
    const response = await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      EXACTLY_24H
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MODIFICATION_WINDOW_CLOSED");

    const booking = await Booking.findById(bookingId);
    expect(String(booking.slotId)).toBe(String(originalSlot._id));
  });

  it("rejects a change less than 24 hours before the registered slot", async () => {
    for (const time of [JUST_UNDER_24H, WELL_UNDER_24H]) {
      // eslint-disable-next-line no-await-in-loop
      const response = await changeBooking(
        token,
        bookingId,
        String(targetSlot._id),
        time
      );

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("MODIFICATION_WINDOW_CLOSED");
    }

    const [original, target] = await Promise.all([
      Slot.findById(originalSlot._id),
      Slot.findById(targetSlot._id)
    ]);
    expect(original.bookedCount).toBe(1);
    expect(target.bookedCount).toBe(0);
  });
});

describe("capacity accounting on a slot change", () => {
  it("releases the old slot and reserves the new one", async () => {
    const before = await Promise.all([
      Slot.findById(originalSlot._id),
      Slot.findById(targetSlot._id)
    ]);
    expect(before[0].bookedCount).toBe(1);
    expect(before[1].bookedCount).toBe(0);

    const response = await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );

    expect(response.status).toBe(200);
    expect(response.body.data.previousSlot.bookedCount).toBe(0);
    expect(response.body.data.newSlot.bookedCount).toBe(1);

    const after = await Promise.all([
      Slot.findById(originalSlot._id),
      Slot.findById(targetSlot._id)
    ]);
    expect(after[0].bookedCount).toBe(0);
    expect(after[1].bookedCount).toBe(1);

    const booking = await Booking.findById(bookingId);
    expect(String(booking.slotId)).toBe(String(targetSlot._id));
    expect(booking.slotStartAt.toISOString()).toBe(
      targetSlot.startAt.toISOString()
    );
    expect(booking.slotEndAt.toISOString()).toBe(
      targetSlot.endAt.toISOString()
    );
  });

  it("frees a seat that someone else can immediately take", async () => {
    await Slot.updateOne(
      { _id: originalSlot._id },
      { $set: { bookedCount: SLOT_CAPACITY } }
    );

    const { token: otherToken } = await createUserAndLogin();
    const blocked = await bookSlot(
      otherToken,
      String(originalSlot._id),
      TIME.DAY1_EARLY
    );
    expect(blocked.status).toBe(409);

    await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );

    const allowed = await bookSlot(
      otherToken,
      String(originalSlot._id),
      TIME.DAY1_EARLY
    );
    expect(allowed.status).toBe(201);
  });

  it("refuses to move into a full slot and leaves both slots untouched", async () => {
    await Slot.updateOne(
      { _id: targetSlot._id },
      { $set: { bookedCount: SLOT_CAPACITY } }
    );

    const response = await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("SLOT_FULL");

    const [original, target] = await Promise.all([
      Slot.findById(originalSlot._id),
      Slot.findById(targetSlot._id)
    ]);
    expect(original.bookedCount).toBe(1);
    expect(target.bookedCount).toBe(SLOT_CAPACITY);

    const booking = await Booking.findById(bookingId);
    expect(String(booking.slotId)).toBe(String(originalSlot._id));
  });

  it("never lets the total reservation count drift", async () => {
    await changeBooking(
      token,
      bookingId,
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );

    const [{ total }] = await Slot.aggregate([
      { $group: { _id: null, total: { $sum: "$bookedCount" } } }
    ]);

    expect(total).toBe(await Booking.countDocuments({}));
  });
});

describe("modification guard rails", () => {
  it("rejects a move to the slot the booking is already in", async () => {
    const response = await changeBooking(
      token,
      bookingId,
      String(originalSlot._id),
      TIME.DAY1_EARLY
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SAME_SLOT");
  });

  it("rejects a move to a slot that has already started", async () => {
    const past = await Slot.findOne({
      date: "2024-11-02",
      startTime: "10:00 AM"
    });

    const response = await changeBooking(
      token,
      bookingId,
      String(past._id),
      "2024-11-03T08:00:00.000Z"
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("SLOT_NOT_BOOKABLE");
  });

  it("refuses to modify another user's booking", async () => {
    const { token: otherToken } = await createUserAndLogin();

    const response = await changeBooking(
      otherToken,
      bookingId,
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("NOT_BOOKING_OWNER");

    const booking = await Booking.findById(bookingId);
    expect(String(booking.slotId)).toBe(String(originalSlot._id));
  });

  it("refuses to modify a dose that has already been administered", async () => {
    const later = await Slot.findOne({
      date: "2024-11-25",
      startTime: "10:00 AM"
    });

    const response = await changeBooking(
      token,
      bookingId,
      String(later._id),
      "2024-11-11T08:00:00.000Z"
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("BOOKING_ALREADY_COMPLETED");
  });

  it("rejects an unknown booking id with 404 and a malformed one with 400", async () => {
    const mongoose = require("mongoose");

    const unknown = await changeBooking(
      token,
      String(new mongoose.Types.ObjectId()),
      String(targetSlot._id),
      TIME.DAY1_EARLY
    );
    expect(unknown.status).toBe(404);

    const malformed = await request(app)
      .patch("/api/bookings/nope")
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY)
      .send({ slotId: String(targetSlot._id) });
    expect(malformed.status).toBe(400);
  });

  it("accepts PUT as an alias for PATCH", async () => {
    const response = await request(app)
      .put(`/api/bookings/${bookingId}`)
      .set("Authorization", `Bearer ${token}`)
      .set("x-mock-time", TIME.DAY1_EARLY)
      .send({ slotId: String(targetSlot._id) });

    expect(response.status).toBe(200);
  });
});
