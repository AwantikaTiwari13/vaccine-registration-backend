const mongoose = require("mongoose");

const { ROLE } = require("../constants/vaccine");

/**
 * Administrator account. There is deliberately no registration API: admins are
 * created only by `npm run seed:admin`, per the assignment.
 */
const adminSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      match: [/^\d{10}$/, "Phone number must contain exactly 10 digits"]
    },
    passwordHash: {
      type: String,
      required: true,
      select: false
    },
    role: {
      type: String,
      enum: [ROLE.ADMIN],
      default: ROLE.ADMIN
    }
  },
  { timestamps: true }
);

// { phoneNumber: 1 } unique is created by `unique: true` above and serves the
// admin login lookup.

module.exports = mongoose.model("Admin", adminSchema);
