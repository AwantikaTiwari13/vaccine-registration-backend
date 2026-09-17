const mongoose = require("mongoose");

/**
 * Multi-document transactions require a replica set or sharded cluster.
 * MongoDB Atlas (including the free M0 tier) provides one; a bare local
 * `mongod` started as a standalone does not.
 *
 * Support is probed once per connection. When transactions are available the
 * slot-change flow runs inside one, which is the strongest guarantee. When they
 * are not, the same flow runs with atomic conditional updates plus explicit
 * compensation, which is still safe against oversubscription - it only widens
 * the window in which a crash could leave one extra reserved seat.
 */
let cachedSupport = null;

async function detectTransactionSupport() {
  if (cachedSupport !== null) return cachedSupport;

  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    cachedSupport = Boolean(info.setName || info.msg === "isdbgrid");
  } catch (error) {
    cachedSupport = false;
  }

  return cachedSupport;
}

function resetTransactionSupportCache() {
  cachedSupport = null;
}

/** Spreads into query options only when a session actually exists. */
function sessionOption(session) {
  return session ? { session } : {};
}

/**
 * Runs `fn(session)` inside a transaction when supported, otherwise runs
 * `fn(null)` directly. `fn` must be written so that it is correct in both
 * modes: use only atomic operators and compensate explicitly on failure.
 */
async function withOptionalTransaction(fn) {
  const supported = await detectTransactionSupport();

  if (!supported) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = {
  detectTransactionSupport,
  resetTransactionSupportCache,
  sessionOption,
  withOptionalTransaction
};
