const {
  VACCINATION_START,
  VACCINATION_END,
  DAY_START_HOUR,
  DAY_END_HOUR,
  SLOT_DURATION_MINUTES,
  MODIFICATION_CUTOFF_HOURS
} = require("../constants/vaccine");

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * All slot instants are stored and compared in UTC. A date string is therefore
 * an unambiguous key: "2024-11-01" always means 2024-11-01T00:00:00.000Z and
 * the 10:00 slot is always 2024-11-01T10:00:00.000Z. Documented in the README
 * as a design assumption.
 */
function parseDateOnly(dateString) {
  if (typeof dateString !== "string" || !DATE_ONLY_PATTERN.test(dateString)) {
    return null;
  }

  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;

  // Rejects impossible calendar dates such as 2024-11-31 or 2024-02-30.
  if (date.toISOString().slice(0, 10) !== dateString) return null;

  return date;
}

function isValidDateString(dateString) {
  return parseDateOnly(dateString) !== null;
}

function isValidDriveDate(dateString) {
  if (!isValidDateString(dateString)) return false;
  return dateString >= VACCINATION_START && dateString <= VACCINATION_END;
}

function toDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildSlotInstant(dateString, hour, minute) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive UTC day bounds, used for indexed range queries on Date fields. */
function dayBounds(dateString) {
  const start = parseDateOnly(dateString);
  if (!start) return null;
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function formatClockTime(hour, minute) {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(displayHour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0"
  )} ${suffix}`;
}

function hoursBetween(from, to) {
  return (new Date(to).getTime() - new Date(from).getTime()) / MS_PER_HOUR;
}

/**
 * The assignment allows a change "till 24 hours prior to his registered slot
 * time". Implemented as a strict inequality, so:
 *   remaining  > 24h -> allowed
 *   remaining == 24h -> rejected
 *   remaining  < 24h -> rejected
 */
function canModifyBooking(slotStartAt, currentTime) {
  return hoursBetween(currentTime, slotStartAt) > MODIFICATION_CUTOFF_HOURS;
}

/** A dose counts as administered once the registered slot has fully lapsed. */
function hasSlotLapsed(slotEndAt, currentTime) {
  return new Date(slotEndAt).getTime() <= new Date(currentTime).getTime();
}

function isWithinOperatingHours(instant) {
  const date = new Date(instant);
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (
    minutes >= DAY_START_HOUR * 60 &&
    minutes < DAY_END_HOUR * 60 &&
    minutes % SLOT_DURATION_MINUTES === 0
  );
}

module.exports = {
  DATE_ONLY_PATTERN,
  parseDateOnly,
  isValidDateString,
  isValidDriveDate,
  toDateString,
  buildSlotInstant,
  addDays,
  dayBounds,
  formatClockTime,
  hoursBetween,
  canModifyBooking,
  hasSlotLapsed,
  isWithinOperatingHours
};
