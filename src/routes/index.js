const express = require("express");

const authRoutes = require("./auth.routes");
const userRoutes = require("./user.routes");
const slotRoutes = require("./slot.routes");
const bookingRoutes = require("./booking.routes");
const adminRoutes = require("./admin.routes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/slots", slotRoutes);
router.use("/bookings", bookingRoutes);
router.use("/admin", adminRoutes);

module.exports = router;
