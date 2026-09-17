/**
 * Centralised environment configuration.
 *
 * Everything that varies between machines/deployments is read here exactly
 * once, validated, and exported as a frozen object. No other module reads
 * `process.env` for business configuration, which keeps configuration errors
 * loud and local.
 */

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isTest = nodeEnv === "test";

const config = {
  nodeEnv,
  isProduction,
  isTest,
  port: int(process.env.PORT, 5000),

  mongoUri: process.env.MONGO_URI || "",

  jwtSecret: process.env.JWT_SECRET || (isTest ? "test-only-jwt-secret" : ""),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "1d",
  bcryptRounds: int(process.env.BCRYPT_ROUNDS, isTest ? 4 : 12),

  adminSeed: {
    name: process.env.ADMIN_NAME || "System Admin",
    phoneNumber: process.env.ADMIN_PHONE || "",
    password: process.env.ADMIN_PASSWORD || ""
  },

  vaccinationStart: process.env.VACCINATION_START || "2024-11-01",
  vaccinationEnd: process.env.VACCINATION_END || "2024-11-30",

  // Mock time is NEVER honoured in production, regardless of the flag value.
  allowMockTime: !isProduction && bool(process.env.ALLOW_MOCK_TIME, isTest)
};

/**
 * Called by the HTTP entrypoint and by the seed scripts. Fails fast instead of
 * letting the process start with a missing secret and 500 on first request.
 */
function assertRuntimeConfig() {
  const missing = [];
  if (!config.mongoUri) missing.push("MONGO_URI");
  if (!config.jwtSecret) missing.push("JWT_SECRET");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Copy .env.example to .env and fill them in."
    );
  }

  if (config.isProduction && config.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }
}

module.exports = { config, assertRuntimeConfig };
