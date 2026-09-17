const {
  app,
  request,
  TIME,
  createUserAndLogin,
  seedAllSlots,
  bookSlot,
  getAvailableSlots
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const Slot = require("../../src/models/Slot");
const Booking = require("../../src/models/Booking");
const User = require("../../src/models/User");

let token;
let userId;

/**
 * The assignment's rule: "Once the registered time slot is lapsed, the user
 * should be considered as vaccinated for that registered dose." There is no
 * manual confirmation step - lapsing is the whole state transition.
 */
beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);

beforeEach(async () => {
  await resetState();
  const created = await createUserAndLogin();
  token = created.token;
  userId = created.user.id;
});

async function profileAt(time) {
  return request(app)
    .get("/api/users/me")
    .set("Authorization", `Bearer ${token}`)
    .set("x-mock-time", time);
}

describe("vaccination state progression", () => {
  it("walks NONE -> FIRST_DOSE_COMPLETED -> FULLY_VACCINATED", async () => {
    const firstSlot = await Slot.findOne({
      date: "2024-11-05",
      startTime: "10:00 AM"
    });
    const secondSlot = await Slot.findOne({
      date: "2024-11-20",
      startTime: "02:00 PM"
    });

    // --- NONE: dose 1 booked, dose 2 refused -----------------------------
    const firstBooking = await bookSlot(
      token,
      String(firstSlot._id),
      TIME.DAY1_EARLY
    );
    expect(firstBooking.status).toBe(201);
    expect(firstBooking.body.data.booking.doseNumber).toBe(1);

    const earlySecond = await bookSlot(
      token,
      String(secondSlot._id),
      TIME.DAY1_EARLY,
      2
    );
    expect(earlySecond.status).toBe(400);
    expect(earlySecond.body.error.code).toBe("FIRST_DOSE_NOT_COMPLETED");

    // --- during the slot: NOT yet vaccinated -----------------------------
    const during = await profileAt("2024-11-05T10:15:00.000Z");
    expect(during.body.data.user.vaccinationStatus).toBe("NONE");
    expect(during.body.data.bookings[0].status).toBe("BOOKED");

    // --- exactly at slot end: dose 1 complete ----------------------------
    const atEnd = await profileAt("2024-11-05T10:30:00.000Z");
    expect(atEnd.body.data.user.vaccinationStatus).toBe("FIRST_DOSE_COMPLETED");
    expect(atEnd.body.data.eligibleDose).toBe(2);
    expect(atEnd.body.data.bookings[0].status).toBe("COMPLETED");
    expect(atEnd.body.data.bookings[0].completedAt).not.toBeNull();

    // --- FIRST_DOSE_COMPLETED: dose 2 allowed, dose 1 refused ------------
    const repeatFirst = await bookSlot(
      token,
      String(secondSlot._id),
      "2024-11-06T08:00:00.000Z",
      1
    );
    expect(repeatFirst.status).toBe(409);
    expect(repeatFirst.body.error.code).toBe("FIRST_DOSE_ALREADY_COMPLETED");

    const secondBooking = await bookSlot(
      token,
      String(secondSlot._id),
      "2024-11-06T08:00:00.000Z"
    );
    expect(secondBooking.status).toBe(201);
    expect(secondBooking.body.data.booking.doseNumber).toBe(2);

    // --- after the second slot lapses: fully vaccinated -------------------
    const afterSecond = await profileAt("2024-11-20T14:31:00.000Z");
    expect(afterSecond.body.data.user.vaccinationStatus).toBe(
      "FULLY_VACCINATED"
    );
    expect(afterSecond.body.data.eligibleDose).toBeNull();

    // --- no further booking is possible ----------------------------------
    const thirdSlot = await Slot.findOne({
      date: "2024-11-25",
      startTime: "10:00 AM"
    });
    const third = await bookSlot(
      token,
      String(thirdSlot._id),
      "2024-11-21T08:00:00.000Z"
    );
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe("ALREADY_FULLY_VACCINATED");

    expect(await Booking.countDocuments({ userId })).toBe(2);
  });

  it("offers no slots to a fully vaccinated user", async () => {
    const firstSlot = await Slot.findOne({
      date: "2024-11-02",
      startTime: "10:00 AM"
    });
    const secondSlot = await Slot.findOne({
      date: "2024-11-03",
      startTime: "10:00 AM"
    });

    await bookSlot(token, String(firstSlot._id), TIME.DAY1_EARLY);
    await bookSlot(token, String(secondSlot._id), "2024-11-02T11:00:00.000Z");

    const response = await getAvailableSlots(
      token,
      "2024-11-10",
      "2024-11-04T08:00:00.000Z"
    );

    expect(response.status).toBe(200);
    expect(response.body.data.eligibleDose).toBeNull();
    expect(response.body.data.slots).toEqual([]);
    expect(response.body.data.vaccinationStatus).toBe("FULLY_VACCINATED");
  });

  it("only flips status for the user whose slot lapsed", async () => {
    const slotA = await Slot.findOne({
      date: "2024-11-04",
      startTime: "10:00 AM"
    });
    const slotB = await Slot.findOne({
      date: "2024-11-28",
      startTime: "10:00 AM"
    });

    const other = await createUserAndLogin();

    await bookSlot(token, String(slotA._id), TIME.DAY1_EARLY);
    await bookSlot(other.token, String(slotB._id), TIME.DAY1_EARLY);

    await profileAt("2024-11-05T08:00:00.000Z");

    const mine = await User.findById(userId).lean();
    const theirs = await User.findById(other.user.id).lean();

    expect(mine.vaccinationStatus).toBe("FIRST_DOSE_COMPLETED");
    expect(theirs.vaccinationStatus).toBe("NONE");
  });

  it("does not complete a dose while the slot is still in progress", async () => {
    const slot = await Slot.findOne({
      date: "2024-11-06",
      startTime: "03:00 PM"
    });
    await bookSlot(token, String(slot._id), TIME.DAY1_EARLY);

    const justBeforeEnd = await profileAt("2024-11-06T15:29:59.000Z");
    expect(justBeforeEnd.body.data.user.vaccinationStatus).toBe("NONE");

    const atEnd = await profileAt("2024-11-06T15:30:00.000Z");
    expect(atEnd.body.data.user.vaccinationStatus).toBe("FIRST_DOSE_COMPLETED");
  });
});
