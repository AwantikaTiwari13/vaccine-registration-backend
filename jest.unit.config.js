/**
 * Unit tests only - pure logic, no database, no globalSetup. Runs anywhere,
 * including machines with no MongoDB available.
 */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/unit/**/*.test.js"],
  testTimeout: 15000,
  verbose: true
};
