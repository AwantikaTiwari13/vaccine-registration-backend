const Booking = require("../models/Booking");
const User = require("../models/User");
const ApiError = require("../utils/apiError");
const { now } = require("../utils/clock");
const { BOOKING_STATUS, VACCINATION_STATUS } = require("../constants/vaccine");

/* -------------------------------------------------------------------------- */
/* Pure state-machine logic (no database access - exhaustively unit tested)    */
/* -------------------------------------------------------------------------- */

/**
 * A user's status is a pure function of the highest dose they have completed.
 * A completed dose 2 necessarily implies a completed dose 1, because dose 2 can
 * only be booked once dose 1 has lapsed.
 */
function deriveStatusFromMaxCompletedDose(maxDose) {
  if (maxDose >= 2) return VACCINATION_STATUS.FULLY_VACCINATED;
  if (maxDose === 1) return VACCINATION_STATUS.FIRST_DOSE_COMPLETED;
  return VACCINATION_STATUS.NONE;
}

/**
 *   NONE                 -> may book dose 1 only
 *   FIRST_DOSE_COMPLETED -> may book dose 2 only
 *   FULLY_VACCINATED     -> may book nothing
 */
function eligibleDoseFor(vaccinationStatus) {
  switch (vaccinationStatus) {
    case VACCINATION_STATUS.NONE:
      return 1;
    case VACCINATION_STATUS.FIRST_DOSE_COMPLETED:
      return 2;
    default:
      return null;
  }
}

/**
 * Validates a requested dose against the user's state and returns the dose that
 * will actually be booked. `requestedDose` may be omitted, in which case the
 * only eligible dose is used.
 */
function resolveDose(vaccinationStatus, requestedDose) {
  const eligible = eligibleDoseFor(vaccinationStatus);

  if (eligible === null) {
    throw ApiError.conflict(
      "Both doses are already completed; no further booking is possible",
      "ALREADY_FULLY_VACCINATED"
    );
  }

  if (requestedDose === undefined || requestedDose === null) {
    return eligible;
  }

  if (requestedDose === eligible) {
    return eligible;
  }

  if (requestedDose === 2 && vaccinationStatus === VACCINATION_STATUS.NONE) {
    throw ApiError.badRequest(
      "Second dose can only be booked after the first dose is completed",
      "FIRST_DOSE_NOT_COMPLETED"
    );
  }

  if (
    requestedDose === 1 &&
    vaccinationStatus === VACCINATION_STATUS.FIRST_DOSE_COMPLETED
  ) {
    throw ApiError.conflict(
      "First dose is already completed; only the second dose can be booked",
      "FIRST_DOSE_ALREADY_COMPLETED"
    );
  }

  throw ApiError.badRequest(
    `Dose ${requestedDose} is not valid for vaccination status ${vaccinationStatus}`,
    "INVALID_DOSE_FOR_STATUS"
  );
}

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Completes every booking whose registered slot has fully lapsed and refreshes
 * the denormalised status of exactly the affected users.
 *
 * Cost profile - this runs before any read that depends on vaccination status:
 *   - steady state (nothing newly lapsed): ONE indexed query returning zero
 *     documents, using { status: 1, slotEndAt: 1 };
 *   - otherwise: one updateMany + one aggregation + one bulkWrite, all scoped
 *     to the bookings that just lapsed, never to the whole user collection.
 *
 * The lapsed booking ids are captured before the update rather than recomputed
 * afterwards, so a booking that lapses mid-sweep is picked up by the next sweep
 * instead of being completed without its user's status being recalculated.
 */
async function syncLapsedVaccinations() {
  const currentTime = now();

  const lapsed = await Booking.find({
    status: BOOKING_STATUS.BOOKED,
    slotEndAt: { $lte: currentTime }
  })
    .select("_id userId")
    .lean();

  if (lapsed.length === 0) {
    return { completedBookings: 0, updatedUsers: 0 };
  }

  const bookingIds = lapsed.map((booking) => booking._id);
  const userIds = [
    ...new Map(lapsed.map((b) => [String(b.userId), b.userId])).values()
  ];

  await Booking.updateMany(
    { _id: { $in: bookingIds }, status: BOOKING_STATUS.BOOKED },
    { $set: { status: BOOKING_STATUS.COMPLETED, completedAt: currentTime } }
  );

  const grouped = await Booking.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        status: BOOKING_STATUS.COMPLETED
      }
    },
    { $group: { _id: "$userId", maxDose: { $max: "$doseNumber" } } }
  ]);

  const operations = grouped.map((entry) => {
    const vaccinationStatus = deriveStatusFromMaxCompletedDose(entry.maxDose);
    return {
      updateOne: {
        filter: { _id: entry._id, vaccinationStatus: { $ne: vaccinationStatus } },
        update: { $set: { vaccinationStatus } }
      }
    };
  });

  let updatedUsers = 0;
  if (operations.length > 0) {
    const result = await User.bulkWrite(operations, { ordered: false });
    updatedUsers = result.modifiedCount || 0;
  }

  return { completedBookings: bookingIds.length, updatedUsers };
}

/**
 * Sweeps, then returns the caller's own (now current) user document.
 * Throws 404 if the token refers to a user that no longer exists.
 */
async function getUserWithCurrentStatus(userId, { includeAadhar = false } = {}) {
  await syncLapsedVaccinations();

  const query = User.findById(userId);
  if (includeAadhar) query.select("+aadharNo");

  const user = await query;
  if (!user) {
    throw ApiError.notFound("User not found", "USER_NOT_FOUND");
  }

  return user;
}

module.exports = {
  deriveStatusFromMaxCompletedDose,
  eligibleDoseFor,
  resolveDose,
  syncLapsedVaccinations,
  getUserWithCurrentStatus
};
