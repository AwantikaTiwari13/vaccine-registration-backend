require("dotenv").config();

const connectDB = require("../src/config/db");
const { disconnectDB } = require("../src/config/db");
const { seedAdminAccount } = require("../src/services/seed.service");
const { assertRuntimeConfig } = require("../src/config/env");

/**
 * The assignment forbids an admin registration API, so this script is the only
 * way an administrator comes into existence. Credentials are read from the
 * environment - never hard-coded - and only a bcrypt hash is persisted.
 *
 *   npm run seed:admin
 */
async function run() {
  assertRuntimeConfig();
  await connectDB();

  const admin = await seedAdminAccount();

  // eslint-disable-next-line no-console
  console.log(
    `Admin seeded: ${admin.name} (${admin.phoneNumber}). Password hash stored; plaintext was not persisted.`
  );

  await disconnectDB();
  return admin;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Admin seeding failed:", error.message);
      process.exit(1);
    });
}

module.exports = run;
