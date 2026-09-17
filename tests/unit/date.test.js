const {
  parseDateOnly,
  isValidDateString,
  isValidDriveDate,
  buildSlotInstant,
  addDays,
  dayBounds,
  formatClockTime,
  hoursBetween,
  canModifyBooking,
  hasSlotLapsed,
  isWithinOperatingHours
} = require("../../src/utils/date");

describe("date utilities", () => {
  describe("parseDateOnly", () => {
    it("accepts a well formed date", () => {
      expect(parseDateOnly("2024-11-01").toISOString()).toBe(
        "2024-11-01T00:00:00.000Z"
      );
    });

    it("rejects malformed input", () => {
      expect(parseDateOnly("01-11-2024")).toBeNull();
      expect(parseDateOnly("2024/11/01")).toBeNull();
      expect(parseDateOnly("not-a-date")).toBeNull();
      expect(parseDateOnly("")).toBeNull();
      expect(parseDateOnly(undefined)).toBeNull();
      expect(parseDateOnly(20241101)).toBeNull();
    });

    it("rejects impossible calendar dates", () => {
      expect(parseDateOnly("2024-11-31")).toBeNull();
      expect(parseDateOnly("2023-02-29")).toBeNull();
      expect(parseDateOnly("2024-13-01")).toBeNull();
    });

    it("accepts a real leap day", () => {
      expect(isValidDateString("2024-02-29")).toBe(true);
    });
  });

  describe("isValidDriveDate", () => {
    it("accepts the inclusive boundaries of the drive", () => {
      expect(isValidDriveDate("2024-11-01")).toBe(true);
      expect(isValidDriveDate("2024-11-30")).toBe(true);
      expect(isValidDriveDate("2024-11-15")).toBe(true);
    });

    it("rejects dates outside the drive", () => {
      expect(isValidDriveDate("2024-10-31")).toBe(false);
      expect(isValidDriveDate("2024-12-01")).toBe(false);
      expect(isValidDriveDate("2025-11-15")).toBe(false);
    });
  });

  describe("formatClockTime", () => {
    it("renders 12-hour clock labels", () => {
      expect(formatClockTime(10, 0)).toBe("10:00 AM");
      expect(formatClockTime(11, 30)).toBe("11:30 AM");
      expect(formatClockTime(12, 0)).toBe("12:00 PM");
      expect(formatClockTime(12, 30)).toBe("12:30 PM");
      expect(formatClockTime(13, 0)).toBe("01:00 PM");
      expect(formatClockTime(17, 0)).toBe("05:00 PM");
    });
  });

  describe("addDays / buildSlotInstant / dayBounds", () => {
    it("crosses a month boundary correctly", () => {
      expect(addDays("2024-11-30", 1)).toBe("2024-12-01");
      expect(addDays("2024-10-31", 1)).toBe("2024-11-01");
    });

    it("builds UTC instants", () => {
      expect(buildSlotInstant("2024-11-01", 10, 30).toISOString()).toBe(
        "2024-11-01T10:30:00.000Z"
      );
    });

    it("produces half-open day bounds", () => {
      const bounds = dayBounds("2024-11-05");
      expect(bounds.start.toISOString()).toBe("2024-11-05T00:00:00.000Z");
      expect(bounds.end.toISOString()).toBe("2024-11-06T00:00:00.000Z");
    });
  });

  describe("canModifyBooking - the 24 hour rule", () => {
    const slotStart = new Date("2024-11-10T10:00:00.000Z");

    it("allows a change more than 24 hours before the slot", () => {
      expect(canModifyBooking(slotStart, new Date("2024-11-09T09:59:59.000Z")))
        .toBe(true);
      expect(canModifyBooking(slotStart, new Date("2024-11-08T10:00:00.000Z")))
        .toBe(true);
    });

    it("rejects a change at exactly 24 hours before the slot", () => {
      expect(canModifyBooking(slotStart, new Date("2024-11-09T10:00:00.000Z")))
        .toBe(false);
    });

    it("rejects a change less than 24 hours before the slot", () => {
      expect(canModifyBooking(slotStart, new Date("2024-11-09T10:00:01.000Z")))
        .toBe(false);
      expect(canModifyBooking(slotStart, new Date("2024-11-10T09:00:00.000Z")))
        .toBe(false);
    });

    it("rejects a change after the slot has started", () => {
      expect(canModifyBooking(slotStart, new Date("2024-11-10T10:30:00.000Z")))
        .toBe(false);
    });

    it("measures hours precisely", () => {
      expect(
        hoursBetween(
          new Date("2024-11-09T10:00:00.000Z"),
          new Date("2024-11-10T10:00:00.000Z")
        )
      ).toBe(24);
    });
  });

  describe("hasSlotLapsed", () => {
    const slotEnd = new Date("2024-11-01T10:30:00.000Z");

    it("is false during the slot", () => {
      expect(hasSlotLapsed(slotEnd, new Date("2024-11-01T10:29:59.000Z"))).toBe(
        false
      );
    });

    it("is true exactly at the slot end", () => {
      expect(hasSlotLapsed(slotEnd, new Date("2024-11-01T10:30:00.000Z"))).toBe(
        true
      );
    });

    it("is true after the slot end", () => {
      expect(hasSlotLapsed(slotEnd, new Date("2024-11-01T11:00:00.000Z"))).toBe(
        true
      );
    });
  });

  describe("isWithinOperatingHours", () => {
    it("accepts valid slot starts", () => {
      expect(isWithinOperatingHours("2024-11-01T10:00:00.000Z")).toBe(true);
      expect(isWithinOperatingHours("2024-11-01T16:30:00.000Z")).toBe(true);
    });

    it("rejects times outside 10:00-17:00 or off the 30-minute grid", () => {
      expect(isWithinOperatingHours("2024-11-01T09:30:00.000Z")).toBe(false);
      expect(isWithinOperatingHours("2024-11-01T17:00:00.000Z")).toBe(false);
      expect(isWithinOperatingHours("2024-11-01T10:15:00.000Z")).toBe(false);
    });
  });
});
