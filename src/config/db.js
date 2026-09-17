const mongoose = require("mongoose");

const { config } = require("../config/env");
const {
  detectTransactionSupport,
  resetTransactionSupportCache
} = require("../utils/transactions");

async function connectDB(uri = config.mongoUri) {
  if (!uri) {
    throw new Error("MONGO_URI is not configured");
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 20
  });

  resetTransactionSupportCache();
  const transactional = await detectTransactionSupport();

  if (!config.isTest) {
    // eslint-disable-next-line no-console
    console.log(
      `MongoDB connected (transactions ${
        transactional ? "available" : "unavailable - using compensating updates"
      })`
    );
  }

  return mongoose.connection;
}

async function disconnectDB() {
  resetTransactionSupportCache();
  await mongoose.connection.close();
}

module.exports = connectDB;
module.exports.connectDB = connectDB;
module.exports.disconnectDB = disconnectDB;
