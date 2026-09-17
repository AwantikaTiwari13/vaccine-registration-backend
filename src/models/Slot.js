const mongoose = require("mongoose");

const { SLOT_CAPACITY } = require("../constants/vaccine");

/**
 * One 30-minute vaccination window.
 *
 * `bookedCount` is a reservation counter, not a derived value. Capacity is
 * enforced by a single atomic `findOneAndUpdate` with the predicate
 * `bookedCount < capacity`, which is the only way to guarantee that the limit
 * of 10 holds under concurrency (read-check-write cannot).
 *
 * `date` (YYYY-MM-DD, UTC) is stored alongside `startAt` even though it is
 * derivable, because every user- and admin-facing query is "give me one day",
 * and an equality match on a short string is cheaper and simpler than a range
 * match plus date arithmetic.
 */
const slotSchema = new mongoose.Schema(
  {
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    startTime: {
      type: String,
      required: true
    },
    endTime: {
      type: String,
      required: true
    },
    startAt: {
      type: Date,
      required: true,
      unique: true
    },
    endAt: {
      type: Date,
      required: true
    },
    capacity: {
      type: Number,
      required: true,
      default: SLOT_CAPACITY,
      min: 0
    },
    bookedCount: {
      type: Number,
      required: true,
      default: 0,
      min: [0, "bookedCount cannot be negative"]
    }
  },
  { timestamps: true }
);

// { startAt: 1 } unique is created by `unique: true` above. It is the slot's
// natural key and is what makes the seed idempotent: re-running it can only
// upsert onto the same instants, never duplicate them.
//
// Serves "slots for this date, ordered by time" - the single hottest query.
slotSchema.index({ date: 1, startAt: 1 });

slotSchema.virtual("availableDoses").get(function availableDoses() {
  return Math.max(this.capacity - this.bookedCount, 0);
});

module.exports = mongoose.model("Slot", slotSchema);
