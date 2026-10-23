const path = require("node:path");

function requiredConfiguration(name) {
  const value = (process.env[name] || "").trim();
  if (!value) throw new Error(`missing controlled-test configuration: ${name}`);
  return value;
}

function configuredExecutablePath(name) {
  const value = requiredConfiguration(name);
  if (!path.isAbsolute(value)) throw new Error(`controlled-test path must be absolute: ${name}`);
  return value;
}

function configuredBridgeAuthorization() {
  const value = requiredConfiguration("ERC_CHAIN_BRIDGE_AUTHORIZATION_ID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error("invalid controlled bridge authorization identifier");
  }
  return value;
}

module.exports = {
  requiredConfiguration,
  configuredExecutablePath,
  configuredBridgeAuthorization
};
