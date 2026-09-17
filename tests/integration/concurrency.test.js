const {
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

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);
beforeEach(resetState);

/**
 * These are the tests that a read-check-write implementation fails. Capacity is
 * enforced by a single atomic conditional update, so no amount of concurrency
 * can push a slot past 10.
 */
describe("slot capacity under concurrency", () => {
  it("admits exactly 10 of 30 simultaneous bookings for one slot", async () => {
    const slot = await Slot.findOne({
      date: "2024-11-14",
      startTime: "10:00 AM"
    });

    const users = await Promise.all(
      Array.from({ length: 30 }, () => createUserAndLogin())
    );

    const responses = await Promise.all(
      users.map((user) =>
        bookSlot(user.token, String(slot._id), TIME.DAY1_EARLY)
      )
    );

    const created = responses.filter((r) => r.status === 201);
    const rejected = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(SLOT_CAPACITY);
    expect(rejected).toHaveLength(30 - SLOT_CAPACITY);
    rejected.forEach((r) => expect(r.body.error.code).toBe("SLOT_FULL"));

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(SLOT_CAPACITY);
    expect(await Booking.countDocuments({ slotId: slot._id })).toBe(
      SLOT_CAPACITY
    );
  }, 120000);

  it("keeps the counter equal to the real booking count", async () => {
    const slot = await Slot.findOne({
      date: "2024-11-16",
      startTime: "11:30 AM"
    });

    const users = await Promise.all(
      Array.from({ length: 15 }, () => createUserAndLogin())
    );

    await Promise.all(
      users.map((user) =>
        bookSlot(user.token, String(slot._id), TIME.DAY1_EARLY)
      )
    );

    const reloaded = await Slot.findById(slot._id);
    const actual = await Booking.countDocuments({ slotId: slot._id });

    expect(reloaded.bookedCount).toBe(actual);
    expect(reloaded.bookedCount).toBeLessThanOrEqual(SLOT_CAPACITY);
  }, 120000);

  it("does not double-book a dose when one user fires repeated requests", async () => {
    const slot = await Slot.findOne({
      date: "2024-11-17",
      startTime: "10:00 AM"
    });
    const { token } = await createUserAndLogin();

    const responses = await Promise.all(
      Array.from({ length: 6 }, () =>
        bookSlot(token, String(slot._id), TIME.DAY1_EARLY)
      )
    );

    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await Booking.countDocuments({})).toBe(1);

    const reloaded = await Slot.findById(slot._id);
    expect(reloaded.bookedCount).toBe(1);
  }, 120000);

  it("holds the limit when many users move into the same slot at once", async () => {
    const source = await Slot.findOne({
      date: "2024-11-21",
      startTime: "10:00 AM"
    });
    const target = await Slot.findOne({
      date: "2024-11-23",
      startTime: "10:00 AM"
    });

    await Slot.updateOne(
      { _id: target._id },
      { $set: { bookedCount: SLOT_CAPACITY - 2 } }
    );

    const users = await Promise.all(
      Array.from({ length: 8 }, () => createUserAndLogin())
    );

    const bookings = await Promise.all(
      users.map((user) =>
        bookSlot(user.token, String(source._id), TIME.DAY1_EARLY)
      )
    );

    const moves = await Promise.all(
      bookings.map((created, index) =>
        changeBooking(
          users[index].token,
          created.body.data.booking.id,
          String(target._id),
          TIME.DAY1_EARLY
        )
      )
    );

    const succeeded = moves.filter((r) => r.status === 200);
    expect(succeeded).toHaveLength(2);

    const [reloadedTarget, reloadedSource] = await Promise.all([
      Slot.findById(target._id),
      Slot.findById(source._id)
    ]);

    expect(reloadedTarget.bookedCount).toBe(SLOT_CAPACITY);
    expect(reloadedSource.bookedCount).toBe(8 - succeeded.length);
  }, 120000);
});
