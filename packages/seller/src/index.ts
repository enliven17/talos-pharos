/**
 * x402 resource (seller) server for Talos on Pharos Atlantic Testnet.
 *
 * Monetizes Talos service endpoints: a buyer hits a route, receives HTTP 402
 * with payment requirements, signs an exact-EVM USDC authorization, retries,
 * and the request is fulfilled. Verification + on-chain settlement are
 * delegated to our self-hosted facilitator (packages/facilitator).
 *
 * Stack (matches docs.pharos.xyz/developer-guide/x402):
 *   @x402/core/server      → x402ResourceServer, HTTPFacilitatorClient
 *   @x402/evm/exact/server → ExactEvmScheme (custom USDC money parser)
 *   @x402/express          → paymentMiddleware
 *
 * On payment success, the route forwards the request to the Talos Web
 * fulfillment API (TALOS_API_URL) so the selling agent actually does the work.
 */

import express from "express";
import { config } from "dotenv";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware } from "@x402/express";

config();

const PORT = Number(process.env.PORT ?? 4021);
const NETWORK = process.env.X402_NETWORK ?? "eip155:688689";
const NET = NETWORK as `${string}:${string}`;
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const USDC_ADDRESS = process.env.USDC_ADDRESS;
const USDC_NAME = process.env.USDC_NAME ?? "USDC";
const PAY_TO = process.env.PAY_TO_ADDRESS as `0x${string}` | undefined;
const TALOS_API_URL = process.env.TALOS_API_URL;

if (!FACILITATOR_URL || !USDC_ADDRESS) {
  console.error("FATAL: set FACILITATOR_URL and USDC_ADDRESS");
  process.exit(1);
}
if (!PAY_TO || !PAY_TO.startsWith("0x") || PAY_TO.length !== 42) {
  console.error("FATAL: set a valid PAY_TO_ADDRESS (0x...)");
  process.exit(1);
}

// Facilitator client → our self-hosted facilitator.
const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);

// Custom USDC config for Pharos Atlantic (6 decimals, EIP-3009 "version 2").
const evmScheme = new ExactEvmScheme();
evmScheme.registerMoneyParser(async (amount: number, network: string) => {
  if (network === NETWORK) {
    return {
      amount: Math.round(amount * 1e6).toString(),
      asset: USDC_ADDRESS,
      extra: { token: USDC_NAME, name: USDC_NAME, version: "2" },
    };
  }
  return null; // fall through to next parser
});
resourceServer.register(NETWORK as `${string}:${string}`, evmScheme);

const app = express();
app.use(express.json());

// Free endpoints
app.get("/health", (_req, res) => {
  res.json({ status: "ok", network: NETWORK, payTo: PAY_TO, usdc: USDC_ADDRESS });
});

// Paid endpoints — priced in USDC, settled via the facilitator.
app.use(
  paymentMiddleware(
    {
      // Marketplace: any Talos service, priced dynamically from the web API.
      // All payments route to PAY_TO (operator/treasury); the web records the
      // revenue against the seller Talos and creates the fulfillment job.
      "POST /buy/:talosId": {
        accepts: {
          scheme: "exact",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          price: (async (ctx: any) => {
            const m = String(ctx?.path ?? "").match(/\/buy\/([^/?]+)/);
            const talosId = m?.[1];
            if (!talosId || !TALOS_API_URL) return "0";
            try {
              const r = await fetch(`${TALOS_API_URL}/api/talos/${talosId}/service`);
              if (!r.ok) return "0";
              const data = (await r.json()) as { price?: number | string };
              return String(data.price ?? "0");
            } catch {
              return "0";
            }
          }) as unknown as string,
          network: NET,
          payTo: PAY_TO,
        },
        description: "Talos marketplace service (dynamic price)",
        mimeType: "application/json",
      },
      "POST /service/:serviceType": {
        accepts: {
          scheme: "exact",
          price: process.env.SERVICE_PRICE ?? "0.05",
          network: NET,
          payTo: PAY_TO,
        },
        description: "Talos agent service",
        mimeType: "application/json",
      },
      "GET /data": {
        accepts: {
          scheme: "exact",
          price: "0.001",
          network: NET,
          payTo: PAY_TO,
        },
        description: "Demo paid data endpoint",
        mimeType: "application/json",
      },
    },
    resourceServer,
  ),
);

// Demo paid endpoint (proves the x402 flow end-to-end)
app.get("/data", (_req, res) => {
  res.json({ message: "paid ok", ts: Date.now(), network: NETWORK });
});

// Marketplace paywall — reached only after x402 payment is verified + settled.
// Returns the settlement proof (X-PAYMENT-RESPONSE) so the caller (web /purchase)
// can record the fulfillment job against the seller Talos.
app.post("/buy/:talosId", (req, res) => {
  const settlement = res.getHeader("x-payment-response") ?? null;
  res.json({ paid: true, talosId: req.params.talosId, settlement, ts: Date.now() });
});

// Talos service endpoint — after payment, forward to Web fulfillment.
app.post("/service/:serviceType", async (req, res) => {
  const { serviceType } = req.params;
  if (!TALOS_API_URL) {
    return res.json({ status: "paid", serviceType, note: "TALOS_API_URL not set; payment settled, no fulfillment forward" });
  }
  try {
    const r = await fetch(`${TALOS_API_URL}/api/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceType, payload: req.body }),
    });
    const data = await r.json().catch(() => ({}));
    res.json({ status: "fulfilled", serviceType, result: data });
  } catch (err) {
    res.status(502).json({ status: "paid_fulfillment_failed", error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`[seller] x402 resource server on :${PORT}`);
  console.log(`[seller] network=${NETWORK} payTo=${PAY_TO} facilitator=${FACILITATOR_URL}`);
});
