const { body, query, param } = require("express-validator");

const { VACCINATION_STATUS } = require("../constants/vaccine");
const { DATE_ONLY_PATTERN, isValidDateString } = require("./date");

const registerValidation = [
  body("name")
    .exists({ checkNull: true })
    .withMessage("Name is required")
    .bail()
    .isString()
    .withMessage("Name must be a string")
    .bail()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("Name must be between 2 and 100 characters"),
  body("phoneNumber")
    .exists({ checkNull: true })
    .withMessage("Phone number is required")
    .bail()
    .isString()
    .withMessage("Phone number must be a string of 10 digits")
    .bail()
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Phone number must contain exactly 10 digits"),
  body("age")
    .exists({ checkNull: true })
    .withMessage("Age is required")
    .bail()
    .isInt({ min: 1, max: 120 })
    .withMessage("Age must be an integer between 1 and 120")
    .toInt(),
  body("pincode")
    .exists({ checkNull: true })
    .withMessage("Pincode is required")
    .bail()
    .isString()
    .withMessage("Pincode must be a string of 6 digits")
    .bail()
    .trim()
    .matches(/^\d{6}$/)
    .withMessage("Pincode must contain exactly 6 digits"),
  body("aadharNo")
    .exists({ checkNull: true })
    .withMessage("Aadhar number is required")
    .bail()
    .isString()
    .withMessage("Aadhar number must be a string of 12 digits")
    .bail()
    .trim()
    .matches(/^\d{12}$/)
    .withMessage("Aadhar number must contain exactly 12 digits"),
  body("password")
    .exists({ checkNull: true })
    .withMessage("Password is required")
    .bail()
    .isString()
    .withMessage("Password must be a string")
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be between 8 and 128 characters")
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage("Password must contain at least one letter")
    .bail()
    .matches(/\d/)
    .withMessage("Password must contain at least one digit")
];

const loginValidation = [
  body("phoneNumber")
    .exists({ checkNull: true })
    .withMessage("Phone number is required")
    .bail()
    .isString()
    .withMessage("Phone number must be a string of 10 digits")
    .bail()
    .trim()
    .matches(/^\d{10}$/)
    .withMessage("Phone number must contain exactly 10 digits"),
  body("password")
    .exists({ checkNull: true })
    .withMessage("Password is required")
    .bail()
    .isString()
    .withMessage("Password must be a string")
    .bail()
    .notEmpty()
    .withMessage("Password is required")
];

const dateQueryValidation = [
  query("date")
    .exists({ checkNull: true })
    .withMessage("A 'date' query parameter is required")
    .bail()
    .matches(DATE_ONLY_PATTERN)
    .withMessage("Date must be in YYYY-MM-DD format")
    .bail()
    .custom((value) => isValidDateString(value))
    .withMessage("Date must be a valid calendar date")
];

const createBookingValidation = [
  body("slotId")
    .exists({ checkNull: true })
    .withMessage("slotId is required")
    .bail()
    .isMongoId()
    .withMessage("slotId must be a valid MongoDB ObjectId"),
  body("doseNumber")
    .optional({ nullable: true })
    .isInt({ min: 1, max: 2 })
    .withMessage("doseNumber must be either 1 or 2")
    .toInt()
];

const updateBookingValidation = [
  body("slotId")
    .exists({ checkNull: true })
    .withMessage("slotId is required")
    .bail()
    .isMongoId()
    .withMessage("slotId must be a valid MongoDB ObjectId")
];

const bookingIdParamValidation = [
  param("bookingId")
    .isMongoId()
    .withMessage("bookingId must be a valid MongoDB ObjectId")
];

const adminUserFilterValidation = [
  query("age")
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage("age must be an integer between 1 and 120"),
  query("minAge")
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage("minAge must be an integer between 1 and 120"),
  query("maxAge")
    .optional()
    .isInt({ min: 1, max: 120 })
    .withMessage("maxAge must be an integer between 1 and 120"),
  query("pincode")
    .optional()
    .matches(/^\d{6}$/)
    .withMessage("pincode must contain exactly 6 digits"),
  query("vaccinationStatus")
    .optional()
    .isIn(Object.values(VACCINATION_STATUS))
    .withMessage(
      `vaccinationStatus must be one of: ${Object.values(
        VACCINATION_STATUS
      ).join(", ")}`
    ),
  query("page")
    .optional()
    .isInt({ min: 1 })
    .withMessage("page must be a positive integer"),
  query("limit")
    .optional()
    .isInt({ min: 1, max: 200 })
    .withMessage("limit must be between 1 and 200"),
  query("minAge")
    .optional()
    .custom((value, { req }) => {
      const { maxAge } = req.query;
      if (maxAge !== undefined && Number(value) > Number(maxAge)) {
        throw new Error("minAge cannot be greater than maxAge");
      }
      return true;
    })
];

module.exports = {
  registerValidation,
  loginValidation,
  dateQueryValidation,
  createBookingValidation,
  updateBookingValidation,
  bookingIdParamValidation,
  adminUserFilterValidation
};
