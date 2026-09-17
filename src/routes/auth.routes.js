const express = require("express");

const {
  register,
  login,
  adminLogin
} = require("../controllers/auth.controller");
const validate = require("../middleware/validate");
const {
  registerValidation,
  loginValidation
} = require("../utils/validation");
const { authLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/register", authLimiter, registerValidation, validate, register);
router.post("/login", authLimiter, loginValidation, validate, login);
router.post("/admin/login", authLimiter, loginValidation, validate, adminLogin);

module.exports = router;
