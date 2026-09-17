const mongoose = require("mongoose");

const connectDB = require("../../src/config/db");
const { disconnectDB } = require("../../src/config/db");
const User = require("../../src/models/User");
const Admin = require("../../src/models/Admin");
const Slot = require("../../src/models/Slot");
const Booking = require("../../src/models/Booking");

const MODELS = [User, Admin, Slot, Booking];

/**
 * Connects and *waits for index builds to finish*. Without this, the unique
 * index tests are a race: mongoose builds indexes in the background and an
 * early insert can succeed before the unique constraint exists.
 */
async function connectTestDB() {
  await connectDB(process.env.MONGO_URI);
  await Promise.all(MODELS.map((model) => model.init()));
}

async function disconnectTestDB() {
  await disconnectDB();
}

/** Wipes documents but keeps indexes, which is much faster than dropping. */
async function clearCollections(models = MODELS) {
  await Promise.all(models.map((model) => model.deleteMany({})));
}

/** Resets reservation counters without re-seeding 420 slots. */
async function resetSlotCounters() {
  await Slot.updateMany({}, { $set: { bookedCount: 0 } });
}

/** Between-test reset used by every integration suite. */
async function resetState() {
  await clearCollections([User, Admin, Booking]);
  await resetSlotCounters();
}

module.exports = {
  mongoose,
  MODELS,
  connectTestDB,
  disconnectTestDB,
  clearCollections,
  resetSlotCounters,
  resetState
};
