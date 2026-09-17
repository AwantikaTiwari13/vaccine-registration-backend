const bcrypt = require("bcryptjs");

const User = require("../models/User");
const Admin = require("../models/Admin");
const ApiError = require("../utils/apiError");
const { signToken } = require("../utils/jwt");
const { config } = require("../config/env");
const { ROLE } = require("../constants/vaccine");
const { maskAadhar } = require("../utils/mask");

/**
 * User registration.
 *
 * Uniqueness is enforced by unique indexes on `phoneNumber` and `aadharNo`; the
 * pre-check below exists only to return a field-specific message in the common
 * case. If two requests race past it, the index still wins and the duplicate
 * key error is translated to a 409 by the error handler.
 *
 * The password is hashed with bcrypt and the plaintext is never stored, logged
 * or echoed back.
 */
async function register(req, res, next) {
  try {
    const { name, phoneNumber, age, pincode, aadharNo, password } = req.body;

    const existing = await User.findOne({
      $or: [{ phoneNumber }, { aadharNo }]
    })
      .select("+aadharNo phoneNumber")
      .lean();

    if (existing) {
      const duplicateField =
        existing.phoneNumber === phoneNumber ? "phoneNumber" : "aadharNo";

      throw ApiError.conflict(
        duplicateField === "phoneNumber"
          ? "This phone number is already registered"
          : "This Aadhar number is already registered",
        "DUPLICATE_KEY",
        { field: duplicateField }
      );
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);

    const user = await User.create({
      name,
      phoneNumber,
      age,
      pincode,
      aadharNo,
      passwordHash
    });

    return res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        user: {
          id: user._id,
          name: user.name,
          phoneNumber: user.phoneNumber,
          age: user.age,
          pincode: user.pincode,
          aadharNo: maskAadhar(aadharNo),
          vaccinationStatus: user.vaccinationStatus,
          createdAt: user.createdAt
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Login by phone number + password.
 *
 * The same message is returned for an unknown phone number and a wrong
 * password, so the endpoint cannot be used to enumerate registered numbers.
 */
async function login(req, res, next) {
  try {
    const { phoneNumber, password } = req.body;

    const user = await User.findOne({ phoneNumber }).select("+passwordHash");

    // Compared even when the user is missing so the response time does not
    // reveal whether the phone number exists.
    const passwordMatches = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");

    if (!user || !passwordMatches) {
      throw ApiError.unauthorized(
        "Invalid phone number or password",
        "INVALID_CREDENTIALS"
      );
    }

    const token = signToken({ sub: String(user._id), role: ROLE.USER });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: config.jwtExpiresIn,
        user: {
          id: user._id,
          name: user.name,
          phoneNumber: user.phoneNumber,
          vaccinationStatus: user.vaccinationStatus
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Admin login. There is deliberately no admin registration endpoint - admin
 * documents are created only by `npm run seed:admin`.
 */
async function adminLogin(req, res, next) {
  try {
    const { phoneNumber, password } = req.body;

    const admin = await Admin.findOne({ phoneNumber }).select("+passwordHash");

    const passwordMatches = admin
      ? await bcrypt.compare(password, admin.passwordHash)
      : await bcrypt.compare(password, "$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");

    if (!admin || !passwordMatches) {
      throw ApiError.unauthorized(
        "Invalid admin credentials",
        "INVALID_CREDENTIALS"
      );
    }

    const token = signToken({ sub: String(admin._id), role: ROLE.ADMIN });

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      data: {
        token,
        tokenType: "Bearer",
        expiresIn: config.jwtExpiresIn,
        admin: {
          id: admin._id,
          name: admin.name,
          phoneNumber: admin.phoneNumber,
          role: admin.role
        }
      }
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { register, login, adminLogin };
