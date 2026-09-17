const { config } = require("../config/env");

/**
 * Vaccination drive parameters.
 *
 * The assignment fixes these values:
 *   drive window : 2024-11-01 .. 2024-11-30  (30 days)
 *   daily window : 10:00 - 17:00             (7 hours)
 *   slot length  : 30 minutes                => 14 slots/day
 *   slot capacity: 10 doses                  => 30 * 14 * 10 = 4,200 doses
 *
 * The dates are overridable through the environment purely so the project can
 * be demonstrated outside November 2024; the defaults are the assignment's.
 * Hours, slot length and capacity are NOT overridable - they are part of the
 * specification and changing them would silently break the 420/4,200 contract.
 */
const VACCINATION_START = config.vaccinationStart;
const VACCINATION_END = config.vaccinationEnd;

const DAY_START_HOUR = 10;
const DAY_END_HOUR = 17;
const SLOT_DURATION_MINUTES = 30;
const SLOT_CAPACITY = 10;

const SLOTS_PER_DAY =
  ((DAY_END_HOUR - DAY_START_HOUR) * 60) / SLOT_DURATION_MINUTES;

/** Hours before the registered slot start until which a change is allowed. */
const MODIFICATION_CUTOFF_HOURS = 24;

const VACCINATION_STATUS = Object.freeze({
  NONE: "NONE",
  FIRST_DOSE_COMPLETED: "FIRST_DOSE_COMPLETED",
  FULLY_VACCINATED: "FULLY_VACCINATED"
});

const BOOKING_STATUS = Object.freeze({
  BOOKED: "BOOKED",
  COMPLETED: "COMPLETED"
});

const ROLE = Object.freeze({
  USER: "USER",
  ADMIN: "ADMIN"
});

module.exports = {
  VACCINATION_START,
  VACCINATION_END,
  DAY_START_HOUR,
  DAY_END_HOUR,
  SLOT_DURATION_MINUTES,
  SLOT_CAPACITY,
  SLOTS_PER_DAY,
  MODIFICATION_CUTOFF_HOURS,
  VACCINATION_STATUS,
  BOOKING_STATUS,
  ROLE
};
