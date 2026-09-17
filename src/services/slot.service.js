const Slot = require("../models/Slot");
const Booking = require("../models/Booking");
const ApiError = require("../utils/apiError");
const { now } = require("../utils/clock");
const {
  VACCINATION_START,
  VACCINATION_END,
  DAY_START_HOUR,
  DAY_END_HOUR,
  SLOT_DURATION_MINUTES,
  SLOT_CAPACITY,
  BOOKING_STATUS
} = require("../constants/vaccine");
const {
  addDays,
  buildSlotInstant,
  formatClockTime,
  isValidDriveDate
} = require("../utils/date");
const {
  getUserWithCurrentStatus,
  eligibleDoseFor
} = require("./vaccination.service");

/* -------------------------------------------------------------------------- */
/* Slot generation (pure - unit tested without a database)                    */
/* -------------------------------------------------------------------------- */

/**
 * Produces the complete, deterministic slot set for the drive window.
 *
 * With the assignment's parameters this yields:
 *   (17:00 - 10:00) * 60 / 30 = 14 slots per day
 *   30 days                    = 420 slots
 *   420 * 10                   = 4,200 doses
 *
 * The function is pure: same inputs, same output, same order, every time. That
 * is what makes the seed idempotent - it always upserts onto the same
 * `startAt` instants, which carry a unique index.
 */
function generateSlotDefinitions(
  startDate = VACCINATION_START,
  endDate = VACCINATION_END
) {
  const definitions = [];
  let date = startDate;

  while (date <= endDate) {
    for (
      let minutes = DAY_START_HOUR * 60;
      minutes < DAY_END_HOUR * 60;
      minutes += SLOT_DURATION_MINUTES
    ) {
      const startHour = Math.floor(minutes / 60);
      const startMinute = minutes % 60;
      const endMinutes = minutes + SLOT_DURATION_MINUTES;
      const endHour = Math.floor(endMinutes / 60);
      const endMinute = endMinutes % 60;

      definitions.push({
        date,
        startTime: formatClockTime(startHour, startMinute),
        endTime: formatClockTime(endHour, endMinute),
        startAt: buildSlotInstant(date, startHour, startMinute),
        endAt: buildSlotInstant(date, endHour, endMinute),
        capacity: SLOT_CAPACITY
      });
    }

    date = addDays(date, 1);
  }

  return definitions;
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Idempotent slot seed.
 *
 * Uses one `bulkWrite` of upserts keyed on the unique `startAt`, so:
 *   - running it twice inserts nothing the second time;
 *   - `bookedCount` is only ever written via `$setOnInsert`, so re-running the
 *     seed on a live database can never wipe existing reservations.
 */
async function seedSlots(options = {}) {
  const definitions = generateSlotDefinitions(
    options.startDate,
    options.endDate
  );

  const operations = definitions.map((definition) => ({
    updateOne: {
      filter: { startAt: definition.startAt },
      update: {
        $setOnInsert: { ...definition, bookedCount: 0 }
      },
      upsert: true
    }
  }));

  const result = await Slot.bulkWrite(operations, { ordered: false });
  const totalSlots = await Slot.countDocuments({});

  return {
    generated: definitions.length,
    inserted: result.upsertedCount || 0,
    matched: result.matchedCount || 0,
    totalSlots,
    totalDoses: totalSlots * SLOT_CAPACITY
  };
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Available slots for a given day, from the perspective of one user.
 *
 * "Available" means all of:
 *   - inside the drive window,
 *   - not yet started (a slot already in progress cannot be registered for),
 *   - `bookedCount < capacity`.
 *
 * The response also carries the dose the user is currently eligible for, which
 * is what the assignment means by "first/second dose based on his vaccination
 * status". A fully vaccinated user receives an empty list rather than an error,
 * because "nothing is available to you" is the honest answer to the question.
 *
 * Query cost: one indexed lookup on { date: 1, startAt: 1 } returning at most
 * 14 documents. Availability is computed in memory over those 14 documents
 * rather than with `$expr`, which cannot use an index.
 */
async function listAvailableSlots(userId, date) {
  if (!isValidDriveDate(date)) {
    throw ApiError.badRequest(
      `Date must be a valid calendar date between ${VACCINATION_START} and ${VACCINATION_END}`,
      "DATE_OUTSIDE_DRIVE"
    );
  }

  const user = await getUserWithCurrentStatus(userId);
  const eligibleDose = eligibleDoseFor(user.vaccinationStatus);
  const currentTime = now();

  if (eligibleDose === null) {
    return {
      date,
      vaccinationStatus: user.vaccinationStatus,
      eligibleDose: null,
      message: "Both doses are completed; no further slots can be registered",
      currentBookingSlotId: null,
      slots: []
    };
  }

  const [slots, currentBooking] = await Promise.all([
    Slot.find({ date, startAt: { $gt: currentTime } })
      .select("date startTime endTime startAt endAt capacity bookedCount")
      .sort({ startAt: 1 })
      .lean(),
    Booking.findOne({
      userId,
      doseNumber: eligibleDose,
      status: BOOKING_STATUS.BOOKED
    })
      .select("slotId")
      .lean()
  ]);

  const currentSlotId = currentBooking ? String(currentBooking.slotId) : null;

  const available = slots
    .filter((slot) => slot.bookedCount < slot.capacity)
    .map((slot) => ({
      id: slot._id,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
      startAt: slot.startAt,
      endAt: slot.endAt,
      capacity: slot.capacity,
      bookedCount: slot.bookedCount,
      availableDoses: slot.capacity - slot.bookedCount,
      isYourCurrentSlot: String(slot._id) === currentSlotId
    }));

  return {
    date,
    vaccinationStatus: user.vaccinationStatus,
    eligibleDose,
    currentBookingSlotId: currentSlotId,
    totalSlotsOnDate: slots.length,
    availableSlotCount: available.length,
    slots: available
  };
}

module.exports = {
  generateSlotDefinitions,
  seedSlots,
  listAvailableSlots
};
