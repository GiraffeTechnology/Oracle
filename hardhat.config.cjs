require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true
    }
  },
  paths: {
    sources: "./erc-reference/contracts",
    tests: "./erc-reference/test",
    cache: "./erc-reference/cache",
    artifacts: "./erc-reference/artifacts"
  },
  networks: {
    hardhat: {
      chainId: 31337
    }
  }
};
