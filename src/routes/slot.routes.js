const express = require("express");

const { getAvailableSlots } = require("../controllers/slot.controller");
const { authenticate, requireUser } = require("../middleware/auth");
const validate = require("../middleware/validate");
const { dateQueryValidation } = require("../utils/validation");

const router = express.Router();

router.get(
  "/available",
  authenticate,
  requireUser,
  dateQueryValidation,
  validate,
  getAvailableSlots
);

module.exports = router;
