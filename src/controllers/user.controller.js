const { maskAadhar } = require("../utils/mask");
const {
  getUserWithCurrentStatus,
  eligibleDoseFor
} = require("../services/vaccination.service");
const { listUserBookings } = require("../services/booking.service");

/**
 * The authenticated user's own profile, current vaccination status, the dose
 * they may book next, and their bookings. Aadhaar is returned masked; the
 * password hash is never selected.
 */
async function getProfile(req, res, next) {
  try {
    const user = await getUserWithCurrentStatus(req.auth.id, {
      includeAadhar: true
    });
    const bookings = await listUserBookings(req.auth.id);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          phoneNumber: user.phoneNumber,
          age: user.age,
          pincode: user.pincode,
          aadharNo: maskAadhar(user.aadharNo),
          vaccinationStatus: user.vaccinationStatus,
          createdAt: user.createdAt
        },
        eligibleDose: eligibleDoseFor(user.vaccinationStatus),
        bookings
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getProfile };
