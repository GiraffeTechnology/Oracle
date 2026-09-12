require("@nomicfoundation/hardhat-ethers");

module.exports = {
  solidity: "0.8.26",
  paths: {
    sources: "./erc-8415/contracts",
    tests: "./erc-8415/test",
    cache: "./.hardhat/cache",
    artifacts: "./.hardhat/artifacts"
  },
  networks: { hardhat: { chainId: 31337 } }
};

