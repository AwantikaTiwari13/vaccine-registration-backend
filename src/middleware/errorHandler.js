const mongoose = require("mongoose");

const ApiError = require("../utils/apiError");
const { config } = require("../config/env");

const DUPLICATE_FIELD_MESSAGES = {
  phoneNumber: "This phone number is already registered",
  aadharNo: "This Aadhar number is already registered",
  startAt: "A slot already exists at this time"
};

function notFound(req, res, next) {
  next(
    ApiError.notFound(
      `Route not found: ${req.method} ${req.originalUrl}`,
      "ROUTE_NOT_FOUND"
    )
  );
}

/**
 * Single exit point for every failure.
 *
 * Known, expected failures are translated into a stable
 * { success, error: { code, message } } envelope. Anything unrecognised is
 * logged server-side and reported as a bare 500 - stack traces, driver
 * messages and connection strings never reach the client. Stacks are only
 * attached to the response outside production, where they are a debugging aid
 * rather than a disclosure.
 */
/* eslint-disable-next-line no-unused-vars */
function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {})
      }
    });
  }

  // Mongoose schema validation (a defence-in-depth layer behind the
  // express-validator checks at the edge).
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: Object.values(err.errors).map((item) => ({
          field: item.path,
          message: item.message
        }))
      }
    });
  }

  // Malformed ObjectId or a value that cannot be cast to its schema type.
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_IDENTIFIER",
        message: `Invalid value for '${err.path}'`
      }
    });
  }

  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    return res.status(409).json({
      success: false,
      error: {
        code: "DUPLICATE_KEY",
        message:
          DUPLICATE_FIELD_MESSAGES[field] ||
          "A record with the same unique value already exists",
        ...(field ? { details: { field } } : {})
      }
    });
  }

  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      error: {
        code: "INVALID_JSON",
        message: "Request body is not valid JSON"
      }
    });
  }

  if (!config.isTest) {
    // eslint-disable-next-line no-console
    console.error("[unhandled-error]", err);
  }

  return res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      ...(config.isProduction ? {} : { debug: err && err.message })
    }
  });
}

module.exports = { notFound, errorHandler };
