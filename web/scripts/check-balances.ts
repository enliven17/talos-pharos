/**
 * Check PHRS (native) + USDC (ERC-20) balances for addresses on Pharos Atlantic.
 *
 * Usage: tsx scripts/check-balances.ts 0xabc... 0xdef...
 */
import { createPublicClient, http, defineChain, formatUnits, getAddress } from "viem";

const RPC_URL = process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";
const USDC_ADDRESS = process.env.USDC_ADDRESS as `0x${string}` | undefined;
const USDC_DECIMALS = Number(process.env.USDC_DECIMALS ?? 6);

const pharosAtlantic = defineChain({
  id: 688689,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  testnet: true,
});

const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function main() {
  const addresses = process.argv.slice(2);
  if (addresses.length === 0) {
    console.error("Usage: tsx scripts/check-balances.ts <0xaddr> [<0xaddr> ...]");
    process.exit(1);
  }

  const client = createPublicClient({ chain: pharosAtlantic, transport: http(RPC_URL) });

  for (const raw of addresses) {
    const addr = getAddress(raw);
    const native = await client.getBalance({ address: addr });
    console.log(`\n${addr}`);
    console.log(`  PHRS: ${formatUnits(native, 18)}`);

    if (USDC_ADDRESS) {
      const usdc = await client.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [addr],
      });
      console.log(`  USDC: ${formatUnits(usdc, USDC_DECIMALS)}`);
    } else {
      console.log("  USDC: (set USDC_ADDRESS to check)");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
