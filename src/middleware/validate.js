const { validationResult } = require("express-validator");

function validate(req, res, next) {
  const errors = validationResult(req);

  if (errors.isEmpty()) {
    return next();
  }

  return res.status(400).json({
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: errors.array().map((error) => ({
        field: error.path,
        message: error.msg
      }))
    }
  });
}

module.exports = validate;
