/**
 * Application-level error carrying an HTTP status and a stable machine-readable
 * code. Anything thrown that is not an ApiError is treated as an unexpected
 * failure by the error handler and reported as a generic 500.
 */
class ApiError extends Error {
  constructor(statusCode, message, code = "ERROR", details = undefined) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    Error.captureStackTrace(this, ApiError);
  }

  static badRequest(message, code = "BAD_REQUEST", details) {
    return new ApiError(400, message, code, details);
  }

  static unauthorized(message, code = "UNAUTHORIZED") {
    return new ApiError(401, message, code);
  }

  static forbidden(message, code = "FORBIDDEN") {
    return new ApiError(403, message, code);
  }

  static notFound(message, code = "NOT_FOUND") {
    return new ApiError(404, message, code);
  }

  static conflict(message, code = "CONFLICT") {
    return new ApiError(409, message, code);
  }
}

module.exports = ApiError;
