/**
 * Full suite: unit tests + integration tests.
 *
 * Integration tests run against an ephemeral MongoDB replica set started by
 * tests/support/globalSetup.js (mongodb-memory-server). A replica set - rather
 * than a standalone - is used because the slot-change flow uses a multi-document
 * transaction, which is exactly what MongoDB Atlas provides in production.
 *
 * `--runInBand` (set in the npm script) keeps every worker on the same database
 * so tests cannot interfere with each other's collections.
 */
module.exports = {
  testEnvironment: "node",
  globalSetup: "<rootDir>/tests/support/globalSetup.js",
  globalTeardown: "<rootDir>/tests/support/globalTeardown.js",
  testMatch: ["<rootDir>/tests/**/*.test.js"],
  testTimeout: 120000,
  collectCoverageFrom: ["src/**/*.js", "scripts/**/*.js"],
  verbose: true
};
