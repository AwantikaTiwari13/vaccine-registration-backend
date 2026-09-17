require("dotenv").config();

const connectDB = require("../src/config/db");
const { disconnectDB } = require("../src/config/db");
const { seedSlots } = require("../src/services/slot.service");
const { assertRuntimeConfig } = require("../src/config/env");
const {
  VACCINATION_START,
  VACCINATION_END,
  SLOTS_PER_DAY,
  SLOT_CAPACITY
} = require("../src/constants/vaccine");

/**
 * Idempotent slot seed. Safe to run repeatedly: it upserts on the unique
 * `startAt`, and only ever writes `bookedCount` on insert, so existing
 * reservations are never reset.
 */
async function run() {
  assertRuntimeConfig();
  await connectDB();

  const result = await seedSlots();

  /* eslint-disable no-console */
  console.log("Slot seeding complete");
  console.log(`  drive window   : ${VACCINATION_START} .. ${VACCINATION_END}`);
  console.log(`  slots per day  : ${SLOTS_PER_DAY}`);
  console.log(`  doses per slot : ${SLOT_CAPACITY}`);
  console.log(`  generated      : ${result.generated}`);
  console.log(`  newly inserted : ${result.inserted}`);
  console.log(`  already present: ${result.matched}`);
  console.log(`  total slots    : ${result.totalSlots}`);
  console.log(`  total doses    : ${result.totalDoses}`);
  /* eslint-enable no-console */

  await disconnectDB();
  return result;
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error("Slot seeding failed:", error.message);
      process.exit(1);
    });
}

module.exports = run;
