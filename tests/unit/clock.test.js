const {
  now,
  runWithTime,
  setFixedTime,
  clearFixedTime
} = require("../../src/utils/clock");

describe("clock abstraction", () => {
  afterEach(() => clearFixedTime());

  it("returns real time when no override is active", () => {
    const before = Date.now();
    const value = now().getTime();
    const after = Date.now();

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it("honours a process-wide fixed time", () => {
    setFixedTime("2024-11-01T09:00:00.000Z");
    expect(now().toISOString()).toBe("2024-11-01T09:00:00.000Z");
  });

  it("clears a process-wide fixed time", () => {
    setFixedTime("2024-11-01T09:00:00.000Z");
    clearFixedTime();
    expect(now().getFullYear()).toBeGreaterThan(2024);
  });

  it("returns a fresh Date each call so callers cannot mutate the clock", () => {
    setFixedTime("2024-11-01T09:00:00.000Z");
    const first = now();
    first.setUTCFullYear(1999);
    expect(now().toISOString()).toBe("2024-11-01T09:00:00.000Z");
  });

  it("scopes a request-level override to its own async context", async () => {
    setFixedTime("2024-11-01T09:00:00.000Z");

    const scoped = await runWithTime("2024-11-20T12:00:00.000Z", async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return now().toISOString();
    });

    expect(scoped).toBe("2024-11-20T12:00:00.000Z");
    expect(now().toISOString()).toBe("2024-11-01T09:00:00.000Z");
  });

  it("keeps concurrent scoped clocks independent", async () => {
    const [a, b] = await Promise.all([
      runWithTime("2024-11-05T10:00:00.000Z", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return now().toISOString();
      }),
      runWithTime("2024-11-25T16:00:00.000Z", async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return now().toISOString();
      })
    ]);

    expect(a).toBe("2024-11-05T10:00:00.000Z");
    expect(b).toBe("2024-11-25T16:00:00.000Z");
  });
});

describe("mock time is inert in production", () => {
  it("isMockTimeEnabled() is false when NODE_ENV=production", () => {
    jest.resetModules();
    const previousEnv = process.env.NODE_ENV;
    const previousFlag = process.env.ALLOW_MOCK_TIME;

    process.env.NODE_ENV = "production";
    process.env.ALLOW_MOCK_TIME = "true";

    // eslint-disable-next-line global-require
    const clock = require("../../src/utils/clock");
    expect(clock.isMockTimeEnabled()).toBe(false);

    // setFixedTime must also be a no-op in production
    clock.setFixedTime("1999-01-01T00:00:00.000Z");
    expect(clock.now().getFullYear()).toBeGreaterThan(2000);

    process.env.NODE_ENV = previousEnv;
    process.env.ALLOW_MOCK_TIME = previousFlag;
    jest.resetModules();
  });

  it("the mock-time middleware is not mounted in production", () => {
    jest.resetModules();
    const previousEnv = process.env.NODE_ENV;
    const previousFlag = process.env.ALLOW_MOCK_TIME;

    process.env.NODE_ENV = "production";
    process.env.ALLOW_MOCK_TIME = "true";

    // eslint-disable-next-line global-require
    const { mountMockTime } = require("../../src/middleware/mockTime");
    const fakeApp = { used: [], use(fn) { this.used.push(fn); } };

    expect(mountMockTime(fakeApp)).toBe(false);
    expect(fakeApp.used).toHaveLength(0);

    process.env.NODE_ENV = previousEnv;
    process.env.ALLOW_MOCK_TIME = previousFlag;
    jest.resetModules();
  });
});
