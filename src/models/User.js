const mongoose = require("mongoose");

const { VACCINATION_STATUS } = require("../constants/vaccine");
const { maskAadhar } = require("../utils/mask");

/**
 * A citizen registered for vaccination.
 *
 * Sensitive fields (`passwordHash`, `aadharNo`) use `select: false` so they are
 * excluded from every query unless explicitly requested. That makes accidental
 * exposure an opt-in mistake rather than the default.
 *
 * `vaccinationStatus` is denormalised onto the user so that admin filtering can
 * be a single indexed query instead of a per-user join. It is kept truthful by
 * the lapse sweep in services/vaccination.service.js, which runs before any
 * read that depends on it.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      minlength: [2, "Name must be at least 2 characters"],
      maxlength: [100, "Name must be at most 100 characters"]
    },
    phoneNumber: {
      type: String,
      required: [true, "Phone number is required"],
      unique: true,
      trim: true,
      match: [/^\d{10}$/, "Phone number must contain exactly 10 digits"]
    },
    age: {
      type: Number,
      required: [true, "Age is required"],
      min: [1, "Age must be at least 1"],
      max: [120, "Age must be at most 120"],
      validate: {
        validator: Number.isInteger,
        message: "Age must be an integer"
      }
    },
    pincode: {
      type: String,
      required: [true, "Pincode is required"],
      trim: true,
      match: [/^\d{6}$/, "Pincode must contain exactly 6 digits"]
    },
    aadharNo: {
      type: String,
      required: [true, "Aadhar number is required"],
      unique: true,
      trim: true,
      select: false,
      match: [/^\d{12}$/, "Aadhar number must contain exactly 12 digits"]
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    vaccinationStatus: {
      type: String,
      enum: Object.values(VACCINATION_STATUS),
      default: VACCINATION_STATUS.NONE
    }
  },
  { timestamps: true }
);

// Indexes on this collection:
//   { phoneNumber: 1 } unique  - created by `unique: true` above. Serves login
//                                lookups and the registration duplicate check.
//   { aadharNo: 1 }    unique  - created by `unique: true` above. Enforces the
//                                assignment's "Aadhar must be unique" rule at
//                                the database level, not just in application
//                                code, so concurrent registrations cannot both
//                                succeed.
//
// Admin filtering. The three filters are independent and may be supplied in any
// combination, so single-field indexes are used and MongoDB intersects them for
// combined queries. A single compound index would only serve prefix subsets.
userSchema.index({ vaccinationStatus: 1 });
userSchema.index({ pincode: 1 });
userSchema.index({ age: 1 });

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    name: this.name,
    phoneNumber: this.phoneNumber,
    age: this.age,
    pincode: this.pincode,
    aadharNo: this.aadharNo ? maskAadhar(this.aadharNo) : undefined,
    vaccinationStatus: this.vaccinationStatus,
    createdAt: this.createdAt
  };
};

module.exports = mongoose.model("User", userSchema);
