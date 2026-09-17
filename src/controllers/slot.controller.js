const { listAvailableSlots } = require("../services/slot.service");

async function getAvailableSlots(req, res, next) {
  try {
    const data = await listAvailableSlots(req.auth.id, req.query.date);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getAvailableSlots };
