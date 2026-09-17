const bcrypt = require("bcryptjs");

const Admin = require("../models/Admin");
const { config } = require("../config/env");
const { ROLE } = require("../constants/vaccine");

/**
 * Creates the administrator account, or rotates its password if it already
 * exists. Idempotent, and only ever writes the bcrypt hash - the plaintext
 * never reaches the database.
 *
 * Extracted from scripts/seedAdmin.js so the same code path the operator runs
 * is the one the test suite exercises.
 */
async function seedAdminAccount({ name, phoneNumber, password } = {}) {
  const adminName = name || config.adminSeed.name;
  const adminPhone = phoneNumber || config.adminSeed.phoneNumber;
  const adminPassword = password || config.adminSeed.password;

  if (!adminPhone || !adminPassword) {
    throw new Error(
      "ADMIN_PHONE and ADMIN_PASSWORD must be set in the environment before seeding an admin"
    );
  }

  if (!/^\d{10}$/.test(adminPhone)) {
    throw new Error("ADMIN_PHONE must contain exactly 10 digits");
  }

  if (adminPassword.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters");
  }

  const passwordHash = await bcrypt.hash(adminPassword, config.bcryptRounds);

  return Admin.findOneAndUpdate(
    { phoneNumber: adminPhone },
    {
      $set: {
        name: adminName,
        phoneNumber: adminPhone,
        passwordHash,
        role: ROLE.ADMIN
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

module.exports = { seedAdminAccount };
