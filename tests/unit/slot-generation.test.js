const { generateSlotDefinitions } = require("../../src/services/slot.service");
const {
  SLOT_CAPACITY,
  SLOTS_PER_DAY,
  VACCINATION_START,
  VACCINATION_END
} = require("../../src/constants/vaccine");

describe("slot generation", () => {
  const slots = generateSlotDefinitions();

  it("derives 14 slots per day from the assignment's parameters", () => {
    expect(SLOTS_PER_DAY).toBe(14);
  });

  it("generates exactly 420 slots for the 30-day drive", () => {
    expect(slots).toHaveLength(420);
  });

  it("represents 4,200 total doses", () => {
    const totalDoses = slots.reduce((sum, slot) => sum + slot.capacity, 0);
    expect(totalDoses).toBe(4200);
    expect(SLOT_CAPACITY).toBe(10);
  });

  it("covers every day of the drive with 14 slots", () => {
    const byDate = slots.reduce((acc, slot) => {
      acc[slot.date] = (acc[slot.date] || 0) + 1;
      return acc;
    }, {});

    const dates = Object.keys(byDate).sort();
    expect(dates).toHaveLength(30);
    expect(dates[0]).toBe(VACCINATION_START);
    expect(dates[dates.length - 1]).toBe(VACCINATION_END);
    dates.forEach((date) => expect(byDate[date]).toBe(14));
  });

  it("starts each day at 10:00 AM and ends at 05:00 PM", () => {
    const firstOfDay = slots.filter((slot) => slot.date === "2024-11-01");

    expect(firstOfDay[0].startTime).toBe("10:00 AM");
    expect(firstOfDay[0].endTime).toBe("10:30 AM");
    expect(firstOfDay[0].startAt.toISOString()).toBe(
      "2024-11-01T10:00:00.000Z"
    );

    expect(firstOfDay[13].startTime).toBe("04:30 PM");
    expect(firstOfDay[13].endTime).toBe("05:00 PM");
    expect(firstOfDay[13].endAt.toISOString()).toBe("2024-11-01T17:00:00.000Z");
  });

  it("produces contiguous 30-minute windows with no gaps or overlaps", () => {
    const firstOfDay = slots.filter((slot) => slot.date === "2024-11-01");

    for (let i = 0; i < firstOfDay.length; i += 1) {
      const durationMinutes =
        (firstOfDay[i].endAt - firstOfDay[i].startAt) / 60000;
      expect(durationMinutes).toBe(30);

      if (i > 0) {
        expect(firstOfDay[i].startAt.getTime()).toBe(
          firstOfDay[i - 1].endAt.getTime()
        );
      }
    }
  });

  it("never emits a slot outside 10:00-17:00", () => {
    slots.forEach((slot) => {
      const startMinutes =
        slot.startAt.getUTCHours() * 60 + slot.startAt.getUTCMinutes();
      expect(startMinutes).toBeGreaterThanOrEqual(600);
      expect(startMinutes).toBeLessThan(1020);
      expect(slot.endAt.getTime()).toBeLessThanOrEqual(
        new Date(`${slot.date}T17:00:00.000Z`).getTime()
      );
    });
  });

  it("has a unique startAt for every slot", () => {
    const unique = new Set(slots.map((slot) => slot.startAt.toISOString()));
    expect(unique.size).toBe(slots.length);
  });

  it("is deterministic - two runs produce identical output", () => {
    const again = generateSlotDefinitions();
    expect(JSON.stringify(again)).toBe(JSON.stringify(slots));
  });

  it("honours an explicit narrower range", () => {
    const twoDays = generateSlotDefinitions("2024-11-01", "2024-11-02");
    expect(twoDays).toHaveLength(28);
  });
});
