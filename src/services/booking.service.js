const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const ApiError = require("../utils/apiError");
const { now } = require("../utils/clock");
const {
  BOOKING_STATUS,
  MODIFICATION_CUTOFF_HOURS,
  VACCINATION_START,
  VACCINATION_END
} = require("../constants/vaccine");
const {
  isValidDriveDate,
  canModifyBooking,
  hoursBetween
} = require("../utils/date");
const {
  sessionOption,
  withOptionalTransaction
} = require("../utils/transactions");
const {
  getUserWithCurrentStatus,
  resolveDose
} = require("./vaccination.service");

/* -------------------------------------------------------------------------- */
/* Shared validation                                                          */
/* -------------------------------------------------------------------------- */

async function loadBookableSlot(slotId, session = null) {
  const slot = await Slot.findById(slotId, null, sessionOption(session));

  if (!slot) {
    throw ApiError.notFound("Slot not found", "SLOT_NOT_FOUND");
  }

  if (!isValidDriveDate(slot.date)) {
    throw ApiError.badRequest(
      `Slot is outside the vaccination drive (${VACCINATION_START} to ${VACCINATION_END})`,
      "SLOT_OUTSIDE_DRIVE"
    );
  }

  if (slot.startAt.getTime() <= now().getTime()) {
    throw ApiError.badRequest(
      "Cannot register for a slot that has already started",
      "SLOT_NOT_BOOKABLE"
    );
  }

  if (slot.bookedCount >= slot.capacity) {
    throw ApiError.conflict(
      "This slot is already fully booked",
      "SLOT_FULL"
    );
  }

  return slot;
}

/**
 * The only safe way to take a seat.
 *
 * A single atomic `findOneAndUpdate` both tests `bookedCount < capacity` and
 * increments it in one indivisible server-side operation, so N concurrent
 * requests against a slot with 1 seat left produce exactly 1 winner. The naive
 * read -> check -> increment -> save sequence cannot make that guarantee,
 * because every reader can observe the same pre-increment value.
 */
async function reserveSeat(slotId, session = null) {
  return Slot.findOneAndUpdate(
    { _id: slotId, $expr: { $lt: ["$bookedCount", "$capacity"] } },
    { $inc: { bookedCount: 1 } },
    { new: true, ...sessionOption(session) }
  );
}

/** Releases a seat, guarded so the counter can never go negative. */
async function releaseSeat(slotId, session = null) {
  return Slot.findOneAndUpdate(
    { _id: slotId, bookedCount: { $gt: 0 } },
    { $inc: { bookedCount: -1 } },
    { new: true, ...sessionOption(session) }
  );
}

/* -------------------------------------------------------------------------- */
/* Create                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Registers the authenticated user for a slot.
 *
 * `requestedDose` is optional. When supplied it is validated against the user's
 * vaccination state, which is how "second dose before first dose" is rejected
 * with a meaningful message instead of being silently rewritten to dose 1.
 *
 * Capacity is reserved before the booking document is created. If the insert
 * then fails - most importantly on the unique { userId, doseNumber } index,
 * which is what stops two concurrent requests from double-booking the same dose
 * - the seat is compensated back. That ordering is deliberate: reserving first
 * can only ever under-allocate on failure, never oversubscribe.
 */
async function createBooking(userId, slotId, requestedDose) {
  const user = await getUserWithCurrentStatus(userId);
  const doseNumber = resolveDose(user.vaccinationStatus, requestedDose);

  const existing = await Booking.findOne({ userId, doseNumber }).lean();
  if (existing) {
    throw ApiError.conflict(
      `A booking for dose ${doseNumber} already exists. Use the booking update endpoint to change its slot.`,
      "DOSE_ALREADY_BOOKED"
    );
  }

  const slot = await loadBookableSlot(slotId);
  const reserved = await reserveSeat(slot._id);

  if (!reserved) {
    throw ApiError.conflict("This slot is already fully booked", "SLOT_FULL");
  }

  try {
    const booking = await Booking.create({
      userId,
      slotId: reserved._id,
      doseNumber,
      status: BOOKING_STATUS.BOOKED,
      slotStartAt: reserved.startAt,
      slotEndAt: reserved.endAt
    });

    return { booking, slot: reserved };
  } catch (error) {
    await releaseSeat(reserved._id);

    if (error.code === 11000) {
      throw ApiError.conflict(
        `A booking for dose ${doseNumber} already exists`,
        "DOSE_ALREADY_BOOKED"
      );
    }

    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

async function listUserBookings(userId) {
  await getUserWithCurrentStatus(userId);

  const bookings = await Booking.find({ userId })
    .populate({
      path: "slotId",
      select: "date startTime endTime startAt endAt capacity bookedCount"
    })
    .sort({ doseNumber: 1 })
    .lean();

  return bookings.map(formatBooking);
}

/**
 * Ownership is enforced here, not in the route, so every caller gets the same
 * check. A user asking for someone else's booking gets 403; a non-existent id
 * gets 404.
 */
async function getUserBooking(userId, bookingId) {
  await getUserWithCurrentStatus(userId);

  const booking = await Booking.findById(bookingId)
    .populate({
      path: "slotId",
      select: "date startTime endTime startAt endAt capacity bookedCount"
    })
    .lean();

  if (!booking) {
    throw ApiError.notFound("Booking not found", "BOOKING_NOT_FOUND");
  }

  if (String(booking.userId) !== String(userId)) {
    throw ApiError.forbidden(
      "You are not allowed to access this booking",
      "NOT_BOOKING_OWNER"
    );
  }

  return formatBooking(booking);
}

function formatBooking(booking) {
  const slot = booking.slotId && booking.slotId._id ? booking.slotId : null;

  return {
    id: booking._id,
    userId: booking.userId,
    doseNumber: booking.doseNumber,
    status: booking.status,
    slotStartAt: booking.slotStartAt,
    slotEndAt: booking.slotEndAt,
    completedAt: booking.completedAt,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    slot: slot
      ? {
          id: slot._id,
          date: slot.date,
          startTime: slot.startTime,
          endTime: slot.endTime,
          startAt: slot.startAt,
          endAt: slot.endAt,
          capacity: slot.capacity,
          bookedCount: slot.bookedCount
        }
      : { id: booking.slotId }
  };
}

/* -------------------------------------------------------------------------- */
/* Update                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Moves an existing booking to a different slot.
 *
 * Two documents must change together (release the old seat, take the new one),
 * so the whole sequence runs inside a MongoDB transaction when the deployment
 * supports one - Atlas always does. On a standalone `mongod` it degrades to the
 * same atomic conditional updates with explicit compensation, which still
 * cannot oversubscribe a slot.
 *
 * The new seat is taken before the old one is released. If anything after that
 * fails, the new seat is given back. The reverse order would briefly free a
 * seat the user still holds, letting someone else take it while the move might
 * still fail.
 */
async function changeBookingSlot(userId, bookingId, newSlotId) {
  await getUserWithCurrentStatus(userId);

  const owned = await Booking.findById(bookingId).lean();
  if (!owned) {
    throw ApiError.notFound("Booking not found", "BOOKING_NOT_FOUND");
  }
  if (String(owned.userId) !== String(userId)) {
    throw ApiError.forbidden(
      "You are not allowed to modify this booking",
      "NOT_BOOKING_OWNER"
    );
  }
  if (owned.status !== BOOKING_STATUS.BOOKED) {
    throw ApiError.badRequest(
      "This dose has already been administered and can no longer be changed",
      "BOOKING_ALREADY_COMPLETED"
    );
  }
  if (String(owned.slotId) === String(newSlotId)) {
    throw ApiError.badRequest(
      "The booking is already registered for this slot",
      "SAME_SLOT"
    );
  }

  const currentTime = now();
  if (!canModifyBooking(owned.slotStartAt, currentTime)) {
    const remaining = hoursBetween(currentTime, owned.slotStartAt);
    throw ApiError.badRequest(
      `A booking can only be changed more than ${MODIFICATION_CUTOFF_HOURS} hours before the registered slot. ` +
        `Time remaining: ${remaining.toFixed(2)} hours.`,
      "MODIFICATION_WINDOW_CLOSED"
    );
  }

  return withOptionalTransaction(async (session) => {
    const booking = await Booking.findOne(
      { _id: bookingId, userId, status: BOOKING_STATUS.BOOKED },
      null,
      sessionOption(session)
    );

    if (!booking) {
      throw ApiError.notFound(
        "Active booking not found",
        "ACTIVE_BOOKING_NOT_FOUND"
      );
    }

    // Re-checked inside the transaction so a concurrent change cannot slip
    // past the pre-check above.
    if (!canModifyBooking(booking.slotStartAt, now())) {
      throw ApiError.badRequest(
        `A booking can only be changed more than ${MODIFICATION_CUTOFF_HOURS} hours before the registered slot`,
        "MODIFICATION_WINDOW_CLOSED"
      );
    }

    const newSlot = await loadBookableSlot(newSlotId, session);
    const previousSlotId = booking.slotId;

    const reserved = await reserveSeat(newSlot._id, session);
    if (!reserved) {
      throw ApiError.conflict(
        "The requested slot is already fully booked",
        "SLOT_FULL"
      );
    }

    try {
      const released = await releaseSeat(previousSlotId, session);
      if (!released) {
        throw new Error(
          `Capacity accounting error: slot ${previousSlotId} had no seat to release`
        );
      }

      booking.slotId = reserved._id;
      booking.slotStartAt = reserved.startAt;
      booking.slotEndAt = reserved.endAt;
      await booking.save(sessionOption(session));

      return {
        booking,
        previousSlotId,
        newSlot: reserved,
        releasedSlot: released
      };
    } catch (error) {
      // Give the newly taken seat back. This is a no-op when a transaction is
      // active (the abort rolls it back anyway) and essential on a standalone
      // deployment. It is swallowed on failure so that it can never mask the
      // original error - in particular, `withTransaction` must still see a
      // transient write conflict as transient in order to retry it.
      try {
        await releaseSeat(reserved._id, session);
      } catch (compensationError) {
        /* intentionally ignored - the original error is the one that matters */
      }
      throw error;
    }
  });
}

module.exports = {
  createBooking,
  listUserBookings,
  getUserBooking,
  changeBookingSlot,
  reserveSeat,
  releaseSeat
};
