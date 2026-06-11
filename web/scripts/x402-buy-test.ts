/**
 * Live x402 buyer test — pays a seller's paid endpoint with real USDC on Pharos.
 * Usage: PHAROS_OPERATOR_PRIVATE_KEY=0x.. tsx scripts/x402-buy-test.ts http://127.0.0.1:4021/data
 */
import { purchasePaidService } from "../src/lib/evm-x402";
import type { Hex } from "viem";

const KEY = process.env.PHAROS_OPERATOR_PRIVATE_KEY as Hex | undefined;
const url = process.argv[2] || "http://127.0.0.1:4021/data";

async function main() {
  if (!KEY) {
    console.error("set PHAROS_OPERATOR_PRIVATE_KEY");
    process.exit(1);
  }
  console.log(`[buyer] paying ${url} ...`);
  const r = await purchasePaidService(KEY, url, { method: "GET" });
  console.log("[buyer] result:");
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(2);
}

main().catch((e) => {
  console.error("[buyer] ERROR:", e);
  process.exit(1);
});
