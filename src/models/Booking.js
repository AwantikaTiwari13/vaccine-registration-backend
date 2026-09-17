const mongoose = require("mongoose");

const { BOOKING_STATUS } = require("../constants/vaccine");

/**
 * A user's registration for one dose in one slot.
 *
 * `slotStartAt` / `slotEndAt` are denormalised from the slot. This is a
 * deliberate trade-off: slot instants are immutable once seeded, so there is no
 * staleness risk, and it removes a `$lookup` from both the lapse sweep and the
 * admin daily statistics - the two queries that would otherwise scale with the
 * whole booking collection.
 *
 * A booking is BOOKED until its slot end time has passed, at which point the
 * sweep flips it to COMPLETED. There is no manual confirmation step: the
 * assignment defines the dose as administered when the registered slot lapses.
 */
const bookingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    slotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Slot",
      required: true
    },
    doseNumber: {
      type: Number,
      required: true,
      enum: [1, 2]
    },
    status: {
      type: String,
      enum: Object.values(BOOKING_STATUS),
      default: BOOKING_STATUS.BOOKED
    },
    slotStartAt: {
      type: Date,
      required: true
    },
    slotEndAt: {
      type: Date,
      required: true
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  { timestamps: true }
);

// One booking per user per dose. This is the database-level guarantee behind
// "no duplicate dose bookings" - it holds even if two concurrent requests both
// pass the application-level eligibility check.
bookingSchema.index({ userId: 1, doseNumber: 1 }, { unique: true });

// Drives the lapse sweep: find BOOKED bookings whose slot has already ended.
bookingSchema.index({ status: 1, slotEndAt: 1 });

// Drives admin daily statistics without touching the slots collection.
bookingSchema.index({ slotStartAt: 1, doseNumber: 1 });

// Reconciliation / per-slot inspection.
bookingSchema.index({ slotId: 1 });

bookingSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    userId: this.userId,
    slotId: this.slotId,
    doseNumber: this.doseNumber,
    status: this.status,
    slotStartAt: this.slotStartAt,
    slotEndAt: this.slotEndAt,
    completedAt: this.completedAt,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt
  };
};

module.exports = mongoose.model("Booking", bookingSchema);
