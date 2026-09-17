const { maskAadhar } = require("../../src/utils/mask");
const ApiError = require("../../src/utils/apiError");
const { buildUserFilter } = require("../../src/services/admin.service");
const { VACCINATION_STATUS } = require("../../src/constants/vaccine");

describe("maskAadhar", () => {
  it("keeps only the last four digits", () => {
    expect(maskAadhar("123456789012")).toBe("XXXXXXXX9012");
  });

  it("returns null for anything that is not a usable Aadhar string", () => {
    expect(maskAadhar(undefined)).toBeNull();
    expect(maskAadhar(null)).toBeNull();
    expect(maskAadhar(123456789012)).toBeNull();
    expect(maskAadhar("12")).toBeNull();
  });
});

describe("ApiError", () => {
  it("carries a status code and a machine-readable code", () => {
    const error = ApiError.conflict("full", "SLOT_FULL");
    expect(error).toBeInstanceOf(Error);
    expect(error.statusCode).toBe(409);
    expect(error.code).toBe("SLOT_FULL");
  });

  it("exposes the expected factory status codes", () => {
    expect(ApiError.badRequest("x").statusCode).toBe(400);
    expect(ApiError.unauthorized("x").statusCode).toBe(401);
    expect(ApiError.forbidden("x").statusCode).toBe(403);
    expect(ApiError.notFound("x").statusCode).toBe(404);
  });
});

describe("buildUserFilter", () => {
  it("is empty when no filters are supplied", () => {
    expect(buildUserFilter({})).toEqual({});
  });

  it("builds each filter independently", () => {
    expect(buildUserFilter({ age: 30 })).toEqual({ age: 30 });
    expect(buildUserFilter({ pincode: "226001" })).toEqual({
      pincode: "226001"
    });
    expect(
      buildUserFilter({ vaccinationStatus: VACCINATION_STATUS.NONE })
    ).toEqual({ vaccinationStatus: "NONE" });
  });

  it("combines filters", () => {
    expect(
      buildUserFilter({
        age: 30,
        pincode: "226001",
        vaccinationStatus: VACCINATION_STATUS.FULLY_VACCINATED
      })
    ).toEqual({
      age: 30,
      pincode: "226001",
      vaccinationStatus: "FULLY_VACCINATED"
    });
  });

  it("supports an age range, and lets an exact age take precedence", () => {
    expect(buildUserFilter({ minAge: 18, maxAge: 45 })).toEqual({
      age: { $gte: 18, $lte: 45 }
    });
    expect(buildUserFilter({ minAge: 18 })).toEqual({ age: { $gte: 18 } });
    expect(buildUserFilter({ age: 30, minAge: 18, maxAge: 45 })).toEqual({
      age: 30
    });
  });
});
