const { MongoMemoryReplSet } = require("mongodb-memory-server");

/**
 * Starts a single-node MongoDB replica set for the integration suite.
 *
 * A replica set rather than a standalone: the slot-change flow uses a
 * multi-document transaction, which standalone `mongod` refuses. MongoDB Atlas
 * is always a replica set, so this matches production behaviour.
 */
module.exports = async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" }
  });

  global.__MONGO_REPLSET__ = replSet;
  process.env.MONGO_URI = replSet.getUri("vaccine_registration_test");
  process.env.NODE_ENV = "test";
  process.env.ALLOW_MOCK_TIME = "true";
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "integration-test-jwt-secret-value";
};
