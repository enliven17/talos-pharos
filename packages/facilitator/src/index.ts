/**
 * Self-hosted x402 facilitator for Talos on Pharos Atlantic Testnet.
 *
 * Exposes the x402 facilitator HTTP contract used by resource (seller) servers:
 *   POST /verify    — verify a signed payment payload (no chain write)
 *   POST /settle    — submit the EIP-3009 transfer on-chain, returns tx hash
 *   GET  /supported — schemes/networks this facilitator supports
 *   GET  /health    — liveness
 *
 * Network: eip155:688689 · USDC = exact-EVM (EIP-3009) settlement.
 * The facilitator wallet (FACILITATOR_PRIVATE_KEY) pays gas (PHRS) for settle.
 *
 * Built on the official stack: @x402/core/facilitator + @x402/evm/exact/facilitator.
 */

import express from "express";
import { config } from "dotenv";
import { createWalletClient, http, publicActions } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { pharosAtlantic } from "./chain.js";

config();

const PORT = Number(process.env.PORT ?? 4020);
const RPC_URL = process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";
const NETWORK = process.env.X402_NETWORK ?? "eip155:688689";
const PRIVATE_KEY = process.env.FACILITATOR_PRIVATE_KEY as `0x${string}` | undefined;

if (!PRIVATE_KEY || !PRIVATE_KEY.startsWith("0x")) {
  console.error("FATAL: set FACILITATOR_PRIVATE_KEY (0x...) — funds gas (PHRS) for settle.");
  process.exit(1);
}

// Signer pays for on-chain settlement and is used for read/verify.
// FacilitatorEvmSigner wants a *synchronous* getAddresses() plus read+write
// methods, so we wrap a viem wallet client (extended with publicActions) in a
// thin adapter that matches that shape.
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({
  account,
  chain: pharosAtlantic,
  transport: http(RPC_URL),
}).extend(publicActions);

const signer = {
  getAddresses: () => [account.address] as readonly `0x${string}`[],
  readContract: (args: Parameters<typeof wallet.readContract>[0]) => wallet.readContract(args),
  verifyTypedData: (args: Parameters<typeof wallet.verifyTypedData>[0]) =>
    wallet.verifyTypedData(args),
  writeContract: (args: Parameters<typeof wallet.writeContract>[0]) =>
    wallet.writeContract(args),
  sendTransaction: (args: Parameters<typeof wallet.sendTransaction>[0]) =>
    wallet.sendTransaction(args),
  waitForTransactionReceipt: (args: Parameters<typeof wallet.waitForTransactionReceipt>[0]) =>
    wallet.waitForTransactionReceipt(args),
  getCode: (args: Parameters<typeof wallet.getCode>[0]) => wallet.getCode(args),
};

const facilitator = new x402Facilitator();
registerExactEvmScheme(facilitator, {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  signer: signer as any,
  networks: NETWORK as `${string}:${string}`,
});

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK, facilitator: account.address });
});

app.get("/supported", (_req, res) => {
  res.json(facilitator.getSupported());
});

app.post("/verify", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      isValid: false,
      invalidReason: err instanceof Error ? err.message : String(err),
    });
  }
});

app.post("/settle", async (req, res) => {
  try {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    res.json(result);
  } catch (err) {
    res.status(400).json({
      success: false,
      errorReason: err instanceof Error ? err.message : String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`[facilitator] x402 facilitator listening on :${PORT}`);
  console.log(`[facilitator] network=${NETWORK} signer=${account.address}`);
});
