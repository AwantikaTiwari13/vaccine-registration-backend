const { AsyncLocalStorage } = require("node:async_hooks");
const { config } = require("../config/env");

/**
 * Time abstraction.
 *
 * Every piece of time-dependent business logic calls `now()` instead of
 * `new Date()`. That makes slot lapsing, the 24-hour modification rule and
 * "slot already started" checks deterministically testable without waiting for
 * real time to pass, and without moving the assignment's fixed November 2024
 * dates.
 *
 * Two override mechanisms exist, both inert in production:
 *
 *  1. Request-scoped (`runWithTime`) - driven by the `x-mock-time` header via
 *     src/middleware/mockTime.js. Uses AsyncLocalStorage so concurrent requests
 *     never see each other's clock.
 *  2. Process-wide (`setFixedTime`) - for unit tests that call services
 *     directly without going through HTTP.
 */
const store = new AsyncLocalStorage();

let processFixedTime = null;

function now() {
  const scoped = store.getStore();
  if (scoped && scoped.now instanceof Date) {
    return new Date(scoped.now.getTime());
  }
  if (processFixedTime instanceof Date) {
    return new Date(processFixedTime.getTime());
  }
  return new Date();
}

/** Run `fn` with a request-scoped fixed clock. */
function runWithTime(date, fn) {
  return store.run({ now: new Date(date) }, fn);
}

/** Set (or clear, with `null`) the process-wide clock override. */
function setFixedTime(date) {
  if (config.isProduction) return;
  processFixedTime = date === null || date === undefined ? null : new Date(date);
}

function clearFixedTime() {
  processFixedTime = null;
}

/** Mock time is only ever available outside production and behind a flag. */
function isMockTimeEnabled() {
  return config.allowMockTime === true && config.isProduction === false;
}

module.exports = {
  now,
  runWithTime,
  setFixedTime,
  clearFixedTime,
  isMockTimeEnabled
};
