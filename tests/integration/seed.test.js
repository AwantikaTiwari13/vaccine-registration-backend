const bcrypt = require("bcryptjs");

const { seedSlots } = require("../../src/services/slot.service");
const { seedAdminAccount } = require("../../src/services/seed.service");
const {
  connectTestDB,
  disconnectTestDB,
  clearCollections
} = require("../support/db");
const Slot = require("../../src/models/Slot");
const Admin = require("../../src/models/Admin");

beforeAll(connectTestDB);
afterAll(disconnectTestDB);

describe("slot seed script", () => {
  beforeEach(async () => {
    await Slot.deleteMany({});
  });

  it("creates exactly 420 slots and 4,200 doses on a clean database", async () => {
    const result = await seedSlots();

    expect(result.generated).toBe(420);
    expect(result.inserted).toBe(420);
    expect(result.totalSlots).toBe(420);
    expect(result.totalDoses).toBe(4200);
  });

  it("is idempotent across three runs", async () => {
    await seedSlots();
    const second = await seedSlots();
    const third = await seedSlots();

    expect(second.inserted).toBe(0);
    expect(third.inserted).toBe(0);
    expect(await Slot.countDocuments({})).toBe(420);
  });

  it("fills a gap without duplicating what already exists", async () => {
    await seedSlots();
    await Slot.deleteMany({ date: "2024-11-15" });
    expect(await Slot.countDocuments({})).toBe(406);

    const result = await seedSlots();

    expect(result.inserted).toBe(14);
    expect(await Slot.countDocuments({})).toBe(420);
  });
});

describe("admin seed script", () => {
  beforeEach(async () => {
    await clearCollections([Admin]);
  });

  it("creates an admin whose password is stored only as a bcrypt hash", async () => {
    const admin = await seedAdminAccount({
      name: "Seeded Admin",
      phoneNumber: "9111111111",
      password: "SuperSecret123"
    });

    const stored = await Admin.findById(admin._id).select("+passwordHash");

    expect(stored.role).toBe("ADMIN");
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored.passwordHash).not.toContain("SuperSecret123");
    expect(await bcrypt.compare("SuperSecret123", stored.passwordHash)).toBe(
      true
    );
  });

  it("is idempotent and rotates the password rather than duplicating", async () => {
    await seedAdminAccount({
      name: "Seeded Admin",
      phoneNumber: "9111111111",
      password: "SuperSecret123"
    });
    await seedAdminAccount({
      name: "Seeded Admin",
      phoneNumber: "9111111111",
      password: "RotatedSecret456"
    });

    expect(await Admin.countDocuments({ phoneNumber: "9111111111" })).toBe(1);

    const stored = await Admin.findOne({ phoneNumber: "9111111111" }).select(
      "+passwordHash"
    );
    expect(await bcrypt.compare("RotatedSecret456", stored.passwordHash)).toBe(
      true
    );
    expect(await bcrypt.compare("SuperSecret123", stored.passwordHash)).toBe(
      false
    );
  });

  it.each([
    [{ phoneNumber: "123", password: "SuperSecret123" }, /10 digits/],
    [{ phoneNumber: "9111111111", password: "short" }, /at least 8/],
    [{ phoneNumber: "", password: "SuperSecret123" }, /must be set/]
  ])("rejects invalid seed input %o", async (input, pattern) => {
    await expect(
      seedAdminAccount({ name: "X", ...input })
    ).rejects.toThrow(pattern);
  });
});
