import { defineChain } from "viem";

const RPC_URL = process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";

/** Pharos Atlantic Testnet (chainId 688689, native PHRS). */
export const pharosAtlantic = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Pharosscan", url: "https://atlantic.pharosscan.xyz" },
  },
  testnet: true,
});
