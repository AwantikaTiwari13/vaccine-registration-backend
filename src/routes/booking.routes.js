const express = require("express");

const {
  create,
  list,
  getOne,
  update
} = require("../controllers/booking.controller");
const { authenticate, requireUser } = require("../middleware/auth");
const validate = require("../middleware/validate");
const {
  createBookingValidation,
  updateBookingValidation,
  bookingIdParamValidation
} = require("../utils/validation");

const router = express.Router();

router.use(authenticate, requireUser);

router.post("/", createBookingValidation, validate, create);
router.get("/", list);
router.get("/:bookingId", bookingIdParamValidation, validate, getOne);
router.patch(
  "/:bookingId",
  bookingIdParamValidation,
  updateBookingValidation,
  validate,
  update
);
// PUT accepted as an alias so either verb works for the same idempotent change.
router.put(
  "/:bookingId",
  bookingIdParamValidation,
  updateBookingValidation,
  validate,
  update
);

module.exports = router;
