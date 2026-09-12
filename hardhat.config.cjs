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
    sources: "./erc-8415/contracts",
    tests: "./erc-8415/test",
    cache: "./.hardhat/cache",
    artifacts: "./.hardhat/artifacts"
  },
  networks: { hardhat: { chainId: 31337 } }
};

