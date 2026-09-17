require("dotenv").config();

const app = require("./src/app");
const connectDB = require("./src/config/db");
const { config, assertRuntimeConfig } = require("./src/config/env");

async function startServer() {
  try {
    assertRuntimeConfig();
    await connectDB();

    const server = app.listen(config.port, () => {
      // eslint-disable-next-line no-console
      console.log(
        `Vaccine Registration API listening on http://localhost:${config.port} (${config.nodeEnv})`
      );
    });

    const shutdown = (signal) => {
      // eslint-disable-next-line no-console
      console.log(`${signal} received, shutting down`);
      server.close(() => process.exit(0));
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Failed to start server:", error.message);
    process.exit(1);
  }
}

startServer();
