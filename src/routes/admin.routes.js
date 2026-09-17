const express = require("express");

const {
  getUsers,
  getSlotStatistics
} = require("../controllers/admin.controller");
const { authenticate, requireAdmin } = require("../middleware/auth");
const validate = require("../middleware/validate");
const {
  adminUserFilterValidation,
  dateQueryValidation
} = require("../utils/validation");

const router = express.Router();

router.use(authenticate, requireAdmin);

router.get("/users", adminUserFilterValidation, validate, getUsers);
router.get("/slots", dateQueryValidation, validate, getSlotStatistics);

module.exports = router;
