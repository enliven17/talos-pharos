/**
 * x402 payments on Pharos (EVM) — port of stellar-x402.ts.
 *
 * Uses the official x402 EVM stack (@x402/fetch + @x402/evm), the same one
 * documented for Pharos Atlantic at docs.pharos.xyz/developer-guide/x402.
 *
 *   Network identifier : eip155:688689 (Pharos Atlantic Testnet)
 *   Scheme             : "exact" (EVM, USDC 6 decimals)
 *   Facilitator        : self-hosted (@x402/core/facilitator) — see infra/facilitator
 *
 * ── Architecture note (changed from Stellar) ─────────────────────────────────
 * The Stellar flow pre-signed a payment header and returned it to the agent.
 * The x402 EVM "exact" scheme CANNOT pre-sign: the buyer must first receive the
 * 402 challenge (amount, payTo, nonce, validBefore, asset) and sign over it.
 * So the buyer side is an interactive wrapped-fetch performed server-side with
 * the agent's key. The old /api/talos/:id/sign split is replaced by a
 * /api/talos/:id/purchase route that calls `purchasePaidService` below.
 */

import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/** x402 network identifier for Pharos Atlantic. */
export const X402_NETWORK = process.env.X402_NETWORK ?? "eip155:688689";

/** Self-hosted facilitator base URL (used by the seller/resource side). */
export const FACILITATOR_URL = process.env.FACILITATOR_URL ?? "";

export interface PurchaseResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Decoded x402 payment receipt (tx hash etc.) if the server returned one. */
  receipt: unknown | null;
  error?: string;
}

/**
 * BUYER — call a paid x402 endpoint, paying in USDC with the agent's key.
 *
 * Performs the full x402 handshake: request → 402 challenge → sign exact-EVM
 * authorization over USDC → retry with X-PAYMENT. This is the core of
 * `talos_purchase`. The agent key is loaded server-side (never in the DB).
 *
 * @param agentPrivateKey 0x EVM private key of the buying agent
 * @param url             Seller's paid endpoint
 * @param init            Optional fetch init (method, body, headers)
 */
export async function purchasePaidService(
  agentPrivateKey: Hex,
  url: string,
  init?: RequestInit,
): Promise<PurchaseResult> {
  try {
    const signer = privateKeyToAccount(agentPrivateKey);

    const client = new x402Client();
    client.register(X402_NETWORK as `${string}:${string}`, new ExactEvmScheme(signer));

    const fetchWithPayment = wrapFetchWithPayment(fetch, client);
    const res = await fetchWithPayment(url, init);

    let receipt: unknown | null = null;
    const header =
      res.headers.get("x-payment-response") ?? res.headers.get("X-PAYMENT-RESPONSE");
    if (header) {
      try {
        receipt = decodePaymentResponseHeader(header);
      } catch {
        receipt = null;
      }
    }

    const contentType = res.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json")
      ? await res.json()
      : await res.text();

    return { ok: res.ok, status: res.status, data, receipt };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      data: null,
      receipt: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Convert a human USDC amount to base units (6 decimals) for Pharos USDC.
 * Matches the money parser registered in the Pharos x402 example.
 */
export function usdcToBaseUnits(amount: number | string): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Math.round(n * 1e6).toString();
}

/**
 * SELLER side (monetizing a Talos service endpoint) is implemented with the
 * x402 EVM *server* stack:
 *
 *   import { paymentMiddleware, x402ResourceServer } from "@x402/express";
 *   import { ExactEvmScheme } from "@x402/evm/exact/server";
 *   import { HTTPFacilitatorClient } from "@x402/core/server";
 *
 * Because that middleware targets Express (not Next.js route handlers), the
 * resource server + self-hosted facilitator run as a dedicated service under
 * `packages/facilitator` (TODO). Until then, sellers verify/settle by calling
 * the facilitator's documented HTTP contract: POST {FACILITATOR_URL}/verify
 * and /settle, GET /supported. See PHAROS_MIGRATION_PLAN.md §Faz 2.
 */
