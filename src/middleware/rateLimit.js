const rateLimit = require("express-rate-limit");

const { config } = require("../config/env");

/**
 * Login and registration are the only unauthenticated write endpoints, which
 * makes them the natural target for credential stuffing. The limiter is
 * disabled under NODE_ENV=test so the suite can hammer these routes.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many attempts. Please try again later."
      }
    })
});

const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (req, res) =>
    res.status(429).json({
      success: false,
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Too many requests. Please slow down."
      }
    })
});

module.exports = { authLimiter, globalLimiter };
