const express = require("express");
const helmet = require("helmet");
const morgan = require("morgan");

const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/errorHandler");
const { mountMockTime } = require("./middleware/mockTime");
const { globalLimiter } = require("./middleware/rateLimit");
const { config } = require("./config/env");
const {
  VACCINATION_START,
  VACCINATION_END,
  SLOT_CAPACITY,
  SLOTS_PER_DAY
} = require("./constants/vaccine");

const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "16kb" }));
app.use(globalLimiter);

if (!config.isTest) {
  app.use(morgan("dev"));
}

// Registered only outside production and only when ALLOW_MOCK_TIME=true.
const mockTimeEnabled = mountMockTime(app);

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: "ok",
      environment: config.nodeEnv,
      mockTimeEnabled,
      drive: {
        start: VACCINATION_START,
        end: VACCINATION_END,
        slotsPerDay: SLOTS_PER_DAY,
        dosesPerSlot: SLOT_CAPACITY
      }
    }
  });
});

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
