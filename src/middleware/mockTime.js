const ApiError = require("../utils/apiError");
const { isMockTimeEnabled, runWithTime } = require("../utils/clock");

const MOCK_TIME_HEADER = "x-mock-time";

/**
 * Optional deterministic clock for a single request.
 *
 * The assignment pins the drive to November 2024, so time-dependent behaviour
 * (slot lapsing, the 24-hour modification window) cannot be exercised against
 * the real clock without either moving the dates or waiting. This header lets
 * tests and local demos say "pretend it is 2024-11-01T09:00:00Z" for one
 * request, leaving the assignment's dates untouched.
 *
 * It is mounted only when `isMockTimeEnabled()` is true, which requires
 * ALLOW_MOCK_TIME=true *and* NODE_ENV !== "production". In production the
 * middleware is never registered at all, so the header is inert - not merely
 * ignored by a runtime branch that could be flipped.
 */
function mockTime(req, res, next) {
  const raw = req.headers[MOCK_TIME_HEADER];

  if (!raw) return next();

  const parsed = new Date(Array.isArray(raw) ? raw[0] : raw);

  if (Number.isNaN(parsed.getTime())) {
    return next(
      ApiError.badRequest(
        `'${MOCK_TIME_HEADER}' must be a valid ISO-8601 date-time`,
        "INVALID_MOCK_TIME"
      )
    );
  }

  res.setHeader("x-mock-time-applied", parsed.toISOString());
  return runWithTime(parsed, next);
}

function mountMockTime(app) {
  if (isMockTimeEnabled()) {
    app.use(mockTime);
    return true;
  }
  return false;
}

module.exports = { mockTime, mountMockTime, MOCK_TIME_HEADER };
