const express = require("express");

const { getProfile } = require("../controllers/user.controller");
const { authenticate, requireUser } = require("../middleware/auth");

const router = express.Router();

router.get("/me", authenticate, requireUser, getProfile);

module.exports = router;
