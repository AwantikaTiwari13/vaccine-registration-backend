const User = require("../models/User");
const Booking = require("../models/Booking");
const Slot = require("../models/Slot");
const ApiError = require("../utils/apiError");
const { VACCINATION_STATUS } = require("../constants/vaccine");
const { dayBounds, isValidDateString } = require("../utils/date");
const { syncLapsedVaccinations } = require("./vaccination.service");

/**
 * Builds the MongoDB filter for the admin user listing.
 *
 * Every filter is applied by the database. Nothing is fetched into Node and
 * filtered there - with 4,200 possible registrations that would be wasteful,
 * and it would break pagination and the total count outright.
 */
function buildUserFilter({ age, minAge, maxAge, pincode, vaccinationStatus }) {
  const filter = {};

  if (age !== undefined) {
    filter.age = age;
  } else if (minAge !== undefined || maxAge !== undefined) {
    filter.age = {};
    if (minAge !== undefined) filter.age.$gte = minAge;
    if (maxAge !== undefined) filter.age.$lte = maxAge;
  }

  if (pincode !== undefined) {
    filter.pincode = pincode;
  }

  if (vaccinationStatus !== undefined) {
    filter.vaccinationStatus = vaccinationStatus;
  }

  return filter;
}

/**
 * Total registered users, optionally filtered by age / pincode / vaccination
 * status, in any combination.
 *
 * The lapse sweep runs first so the denormalised `vaccinationStatus` column is
 * current before it is filtered on - otherwise a user whose slot lapsed a
 * minute ago would still be reported as NONE.
 *
 * Exactly three database round trips regardless of result size:
 *   1. the sweep (one indexed query, usually zero documents),
 *   2. countDocuments for the filtered total,
 *   3. one paginated find.
 * Plus one unfiltered count so the admin always sees the overall registration
 * total alongside the filtered subset.
 */
async function listUsers(filters, pagination) {
  await syncLapsedVaccinations();

  const filter = buildUserFilter(filters);
  const page = pagination.page || 1;
  const limit = pagination.limit || 50;
  const skip = (page - 1) * limit;

  const [totalRegisteredUsers, matchingUsers, users] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments(filter),
    User.find(filter)
      .select("name phoneNumber age pincode vaccinationStatus createdAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean()
  ]);

  return {
    totalRegisteredUsers,
    matchingUsers,
    filtersApplied: filters,
    pagination: {
      page,
      limit,
      totalPages: Math.max(Math.ceil(matchingUsers / limit), 1),
      hasNextPage: skip + users.length < matchingUsers
    },
    users: users.map((user) => ({
      id: user._id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      age: user.age,
      pincode: user.pincode,
      vaccinationStatus: user.vaccinationStatus,
      registeredAt: user.createdAt
    }))
  };
}

/**
 * Registered slots for a given day: first dose, second dose and total.
 *
 * Implemented as a single aggregation over `bookings` using the denormalised
 * `slotStartAt`, so it is served by the { slotStartAt: 1, doseNumber: 1 } index
 * and never joins to the slots collection. The previous implementation did a
 * `$lookup` over every booking in the database before filtering by date; this
 * one touches only the bookings that fall inside the requested day.
 *
 * Because `slotStartAt` moves with the booking, a user who changes their slot
 * is counted against the new day immediately and drops off the old one.
 */
async function getDailySlotStatistics(date) {
  if (!isValidDateString(date)) {
    throw ApiError.badRequest(
      "Date must be a valid calendar date in YYYY-MM-DD format",
      "INVALID_DATE"
    );
  }

  const bounds = dayBounds(date);

  const firstDoseSum = { $sum: { $cond: [{ $eq: ["$doseNumber", 1] }, 1, 0] } };
  const secondDoseSum = { $sum: { $cond: [{ $eq: ["$doseNumber", 2] }, 1, 0] } };

  const [aggregation] = await Booking.aggregate([
    { $match: { slotStartAt: { $gte: bounds.start, $lt: bounds.end } } },
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              firstDose: firstDoseSum,
              secondDose: secondDoseSum,
              total: { $sum: 1 }
            }
          }
        ],
        perSlot: [
          {
            $group: {
              _id: "$slotId",
              slotStartAt: { $first: "$slotStartAt" },
              firstDose: firstDoseSum,
              secondDose: secondDoseSum,
              total: { $sum: 1 }
            }
          },
          { $sort: { slotStartAt: 1 } }
        ]
      }
    }
  ]);

  const totals = aggregation.totals[0] || {
    firstDose: 0,
    secondDose: 0,
    total: 0
  };

  // At most 14 documents for a day - cheap, and it lets the response show
  // capacity and remaining doses per slot, including slots with zero bookings.
  const slots = await Slot.find({ date })
    .select("startTime endTime startAt capacity bookedCount")
    .sort({ startAt: 1 })
    .lean();

  const bookingsBySlot = new Map(
    aggregation.perSlot.map((entry) => [String(entry._id), entry])
  );

  return {
    date,
    firstDose: totals.firstDose,
    secondDose: totals.secondDose,
    total: totals.total,
    totalSlots: slots.length,
    totalCapacity: slots.reduce((sum, slot) => sum + slot.capacity, 0),
    slots: slots.map((slot) => {
      const entry = bookingsBySlot.get(String(slot._id));
      return {
        id: slot._id,
        startTime: slot.startTime,
        endTime: slot.endTime,
        startAt: slot.startAt,
        capacity: slot.capacity,
        bookedCount: slot.bookedCount,
        availableDoses: slot.capacity - slot.bookedCount,
        firstDose: entry ? entry.firstDose : 0,
        secondDose: entry ? entry.secondDose : 0,
        total: entry ? entry.total : 0
      };
    })
  };
}

module.exports = {
  buildUserFilter,
  listUsers,
  getDailySlotStatistics,
  VACCINATION_STATUS
};
