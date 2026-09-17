const {
  deriveStatusFromMaxCompletedDose,
  eligibleDoseFor,
  resolveDose
} = require("../../src/services/vaccination.service");
const { VACCINATION_STATUS } = require("../../src/constants/vaccine");

const { NONE, FIRST_DOSE_COMPLETED, FULLY_VACCINATED } = VACCINATION_STATUS;

describe("vaccination state machine", () => {
  describe("deriveStatusFromMaxCompletedDose", () => {
    it("maps completed doses to a status", () => {
      expect(deriveStatusFromMaxCompletedDose(0)).toBe(NONE);
      expect(deriveStatusFromMaxCompletedDose(undefined)).toBe(NONE);
      expect(deriveStatusFromMaxCompletedDose(1)).toBe(FIRST_DOSE_COMPLETED);
      expect(deriveStatusFromMaxCompletedDose(2)).toBe(FULLY_VACCINATED);
    });
  });

  describe("eligibleDoseFor", () => {
    it("NONE may only book dose 1", () => {
      expect(eligibleDoseFor(NONE)).toBe(1);
    });

    it("FIRST_DOSE_COMPLETED may only book dose 2", () => {
      expect(eligibleDoseFor(FIRST_DOSE_COMPLETED)).toBe(2);
    });

    it("FULLY_VACCINATED may book nothing", () => {
      expect(eligibleDoseFor(FULLY_VACCINATED)).toBeNull();
    });
  });

  describe("resolveDose", () => {
    it("infers the dose when none is requested", () => {
      expect(resolveDose(NONE, undefined)).toBe(1);
      expect(resolveDose(FIRST_DOSE_COMPLETED, null)).toBe(2);
    });

    it("accepts a matching explicit dose", () => {
      expect(resolveDose(NONE, 1)).toBe(1);
      expect(resolveDose(FIRST_DOSE_COMPLETED, 2)).toBe(2);
    });

    it("rejects dose 2 before dose 1 is completed", () => {
      expect(() => resolveDose(NONE, 2)).toThrow(
        /only be booked after the first dose is completed/i
      );

      try {
        resolveDose(NONE, 2);
      } catch (error) {
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe("FIRST_DOSE_NOT_COMPLETED");
      }
    });

    it("rejects a repeat dose 1 once the first dose is completed", () => {
      try {
        resolveDose(FIRST_DOSE_COMPLETED, 1);
        throw new Error("expected a rejection");
      } catch (error) {
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe("FIRST_DOSE_ALREADY_COMPLETED");
      }
    });

    it("rejects every dose once fully vaccinated", () => {
      [undefined, 1, 2].forEach((dose) => {
        try {
          resolveDose(FULLY_VACCINATED, dose);
          throw new Error("expected a rejection");
        } catch (error) {
          expect(error.statusCode).toBe(409);
          expect(error.code).toBe("ALREADY_FULLY_VACCINATED");
        }
      });
    });
  });
});
