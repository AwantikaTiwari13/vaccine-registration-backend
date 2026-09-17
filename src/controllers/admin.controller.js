const {
  listUsers,
  getDailySlotStatistics
} = require("../services/admin.service");

async function getUsers(req, res, next) {
  try {
    const { age, minAge, maxAge, pincode, vaccinationStatus, page, limit } =
      req.query;

    const data = await listUsers(
      {
        age: age === undefined ? undefined : Number(age),
        minAge: minAge === undefined ? undefined : Number(minAge),
        maxAge: maxAge === undefined ? undefined : Number(maxAge),
        pincode,
        vaccinationStatus
      },
      {
        page: page === undefined ? 1 : Number(page),
        limit: limit === undefined ? 50 : Number(limit)
      }
    );

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

async function getSlotStatistics(req, res, next) {
  try {
    const data = await getDailySlotStatistics(req.query.date);

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getUsers, getSlotStatistics };
