import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

/**
 * Pharos Atlantic Testnet
 *   Chain ID : 688689
 *   RPC      : https://atlantic.dplabs-internal.com
 *   Explorer : https://atlantic.pharosscan.xyz/
 *   Native   : PHRS
 */
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    pharosAtlantic: {
      url: process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com",
      chainId: 688689,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  // Block explorer verification (Pharosscan). Update apiURL/browserURL if Pharos
  // publishes an Etherscan-compatible verify endpoint.
  etherscan: {
    apiKey: {
      pharosAtlantic: process.env.PHAROSSCAN_API_KEY ?? "no-key-needed",
    },
    customChains: [
      {
        network: "pharosAtlantic",
        chainId: 688689,
        urls: {
          apiURL: "https://atlantic.pharosscan.xyz/api",
          browserURL: "https://atlantic.pharosscan.xyz/",
        },
      },
    ],
  },
};

export default config;
