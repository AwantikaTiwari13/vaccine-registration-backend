const {
  app,
  request,
  uniqueUser,
  registerUser,
  seedAdmin,
  DEFAULT_ADMIN
} = require("../support/helpers");
const {
  connectTestDB,
  disconnectTestDB,
  resetState
} = require("../support/db");
const User = require("../../src/models/User");

beforeAll(connectTestDB);
afterAll(disconnectTestDB);
beforeEach(resetState);

describe("POST /api/auth/register", () => {
  it("registers a user and returns 201 without any sensitive field", async () => {
    const payload = uniqueUser();

    const response = await request(app).post("/api/auth/register").send(payload);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user).toMatchObject({
      name: payload.name,
      phoneNumber: payload.phoneNumber,
      age: payload.age,
      pincode: payload.pincode,
      vaccinationStatus: "NONE"
    });

    const serialised = JSON.stringify(response.body);
    expect(serialised).not.toContain(payload.password);
    expect(serialised).not.toContain("passwordHash");
    expect(serialised).not.toContain(payload.aadharNo);
    expect(response.body.data.user.aadharNo).toBe(
      `XXXXXXXX${payload.aadharNo.slice(-4)}`
    );
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    const payload = uniqueUser();
    await request(app).post("/api/auth/register").send(payload);

    const stored = await User.findOne({ phoneNumber: payload.phoneNumber })
      .select("+passwordHash +aadharNo")
      .lean();

    expect(stored.passwordHash).toBeDefined();
    expect(stored.passwordHash).not.toBe(payload.password);
    expect(stored.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(stored.aadharNo).toBe(payload.aadharNo);
  });

  it("rejects a duplicate phone number with 409", async () => {
    const { payload } = await registerUser();

    const response = await request(app)
      .post("/api/auth/register")
      .send(uniqueUser({ phoneNumber: payload.phoneNumber }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_KEY");
    expect(response.body.error.message).toMatch(/phone number/i);
  });

  it("rejects a duplicate Aadhar number with 409", async () => {
    const { payload } = await registerUser();

    const response = await request(app)
      .post("/api/auth/register")
      .send(uniqueUser({ aadharNo: payload.aadharNo }));

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("DUPLICATE_KEY");
    expect(response.body.error.message).toMatch(/aadhar/i);
  });

  it("enforces uniqueness at the database level even under a race", async () => {
    const payload = uniqueUser();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).post("/api/auth/register").send(payload)
      )
    );

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);
    expect(await User.countDocuments({ phoneNumber: payload.phoneNumber })).toBe(
      1
    );
  });

  it.each([
    ["missing name", { name: undefined }, "name"],
    ["short name", { name: "A" }, "name"],
    ["missing phone", { phoneNumber: undefined }, "phoneNumber"],
    ["9-digit phone", { phoneNumber: "123456789" }, "phoneNumber"],
    ["11-digit phone", { phoneNumber: "12345678901" }, "phoneNumber"],
    ["non-numeric phone", { phoneNumber: "98765abcde" }, "phoneNumber"],
    ["missing age", { age: undefined }, "age"],
    ["zero age", { age: 0 }, "age"],
    ["over-max age", { age: 200 }, "age"],
    ["non-integer age", { age: "thirty" }, "age"],
    ["missing pincode", { pincode: undefined }, "pincode"],
    ["5-digit pincode", { pincode: "22600" }, "pincode"],
    ["missing aadhar", { aadharNo: undefined }, "aadharNo"],
    ["11-digit aadhar", { aadharNo: "12345678901" }, "aadharNo"],
    ["missing password", { password: undefined }, "password"],
    ["short password", { password: "Ab1" }, "password"],
    ["letters-only password", { password: "abcdefgh" }, "password"]
  ])("rejects %s with 400", async (_label, override, field) => {
    const payload = uniqueUser();
    Object.entries(override).forEach(([key, value]) => {
      if (value === undefined) delete payload[key];
      else payload[key] = value;
    });

    const response = await request(app).post("/api/auth/register").send(payload);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
    expect(response.body.error.details.map((d) => d.field)).toContain(field);
  });

  it("rejects a malformed JSON body with 400", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .set("Content-Type", "application/json")
      .send("{ not json");

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_JSON");
  });
});

describe("POST /api/auth/login", () => {
  it("returns a token for valid credentials", async () => {
    const { payload } = await registerUser();

    const response = await request(app).post("/api/auth/login").send({
      phoneNumber: payload.phoneNumber,
      password: payload.password
    });

    expect(response.status).toBe(200);
    expect(typeof response.body.data.token).toBe("string");
    expect(response.body.data.token.split(".")).toHaveLength(3);
    expect(response.body.data.user.vaccinationStatus).toBe("NONE");
    expect(JSON.stringify(response.body)).not.toContain(payload.password);
  });

  it("rejects a wrong password with 401", async () => {
    const { payload } = await registerUser();

    const response = await request(app).post("/api/auth/login").send({
      phoneNumber: payload.phoneNumber,
      password: "WrongPassword123"
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("gives the same answer for an unknown phone number (no enumeration)", async () => {
    const { payload } = await registerUser();

    const unknown = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "7999999999", password: "Password123" });

    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: payload.phoneNumber, password: "Nope12345" });

    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
  });

  it("validates the login payload", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ phoneNumber: "abc" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("POST /api/auth/admin/login", () => {
  it("logs in a seeded admin", async () => {
    await seedAdmin();

    const response = await request(app).post("/api/auth/admin/login").send({
      phoneNumber: DEFAULT_ADMIN.phoneNumber,
      password: DEFAULT_ADMIN.password
    });

    expect(response.status).toBe(200);
    expect(response.body.data.admin.role).toBe("ADMIN");
    expect(typeof response.body.data.token).toBe("string");
  });

  it("rejects wrong admin credentials with 401", async () => {
    await seedAdmin();

    const response = await request(app).post("/api/auth/admin/login").send({
      phoneNumber: DEFAULT_ADMIN.phoneNumber,
      password: "TotallyWrong1"
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("does not let a normal user log in through the admin endpoint", async () => {
    const { payload } = await registerUser();

    const response = await request(app).post("/api/auth/admin/login").send({
      phoneNumber: payload.phoneNumber,
      password: payload.password
    });

    expect(response.status).toBe(401);
  });

  it("exposes no admin registration route", async () => {
    const response = await request(app)
      .post("/api/auth/admin/register")
      .send(DEFAULT_ADMIN);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
  });
});
