const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const {
  app,
  request,
  createUserAndLogin,
  seedAllSlots
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const User = require("../../src/models/User");
const Slot = require("../../src/models/Slot");
const { config } = require("../../src/config/env");

beforeAll(async () => {
  await connectTestDB();
  await Slot.deleteMany({});
  await seedAllSlots();
});
afterAll(disconnectTestDB);
beforeEach(resetState);

const PROTECTED = [
  ["get", "/api/users/me"],
  ["get", "/api/slots/available?date=2024-11-05"],
  ["get", "/api/bookings"],
  ["post", "/api/bookings"],
  ["get", "/api/admin/users"],
  ["get", "/api/admin/slots?date=2024-11-05"]
];

describe("authentication", () => {
  it.each(PROTECTED)("%s %s rejects a missing token", async (method, path) => {
    const response = await request(app)[method](path);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_MISSING");
  });

  it.each(PROTECTED)("%s %s rejects a garbage token", async (method, path) => {
    const response = await request(app)
      [method](path)
      .set("Authorization", "Bearer not.a.real.token");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_INVALID");
  });

  it("rejects a token without the Bearer scheme", async () => {
    const { token } = await createUserAndLogin();

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", token);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_MISSING");
  });

  it("rejects an expired token with a distinct code", async () => {
    const { user } = await createUserAndLogin();
    const expired = jwt.sign({ sub: String(user.id), role: "USER" }, config.jwtSecret, {
      expiresIn: "-1s"
    });

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${expired}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a token signed with a different secret", async () => {
    const { user } = await createUserAndLogin();
    const forged = jwt.sign(
      { sub: String(user.id), role: "USER" },
      "a-completely-different-secret"
    );

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${forged}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("TOKEN_INVALID");
  });

  it("rejects a structurally valid token for a user that no longer exists", async () => {
    const { token, user } = await createUserAndLogin();
    await User.deleteOne({ _id: user.id });

    const response = await request(app)
      .get("/api/users/me")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("PRINCIPAL_NOT_FOUND");
  });

  it("rejects a self-issued token that merely claims the ADMIN role", async () => {
    const { user } = await createUserAndLogin();
    const forged = jwt.sign(
      { sub: String(user.id), role: "ADMIN" },
      config.jwtSecret
    );

    const response = await request(app)
      .get("/api/admin/users")
      .set("Authorization", `Bearer ${forged}`);

    // The id is looked up in the admins collection, where it does not exist.
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("PRINCIPAL_NOT_FOUND");
  });
});

describe("error responses", () => {
  it("returns a structured 404 for an unknown route", async () => {
    const response = await request(app).get("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: "ROUTE_NOT_FOUND",
        message: "Route not found: GET /api/does-not-exist"
      }
    });
  });

  it("never leaks a stack trace or a connection string", async () => {
    const { token } = await createUserAndLogin();

    const responses = await Promise.all([
      request(app).get("/api/does-not-exist"),
      request(app).post("/api/auth/login").send({}),
      request(app)
        .post("/api/bookings")
        .set("Authorization", `Bearer ${token}`)
        .send({ slotId: String(new mongoose.Types.ObjectId()) })
    ]);

    responses.forEach((response) => {
      const body = JSON.stringify(response.body);
      expect(body).not.toMatch(/at Object\.|node_modules|\.js:\d+:\d+/);
      expect(body).not.toContain("mongodb://");
      expect(body).not.toContain("mongodb+srv://");
      expect(body).not.toContain(config.jwtSecret);
    });
  });

  it("uses a consistent error envelope", async () => {
    const response = await request(app).post("/api/auth/login").send({});

    expect(response.body).toHaveProperty("success", false);
    expect(response.body).toHaveProperty("error.code");
    expect(response.body).toHaveProperty("error.message");
  });

  it("sets hardening headers and hides the framework", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("health endpoint", () => {
  it("reports the drive configuration", async () => {
    const response = await request(app).get("/health");

    expect(response.body.data.drive).toEqual({
      start: "2024-11-01",
      end: "2024-11-30",
      slotsPerDay: 14,
      dosesPerSlot: 10
    });
  });
});
