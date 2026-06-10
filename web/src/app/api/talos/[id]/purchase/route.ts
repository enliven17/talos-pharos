import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsCommerceJobs, tlsRevenues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { purchasePaidService } from "@/lib/evm-x402";
import { purchaseSchema, parseBody } from "@/lib/schemas";
import type { Hex } from "viem";

/**
 * POST /api/talos/:id/purchase — x402 buyer flow on Pharos.
 *
 * Replaces the legacy Stellar /sign endpoint. The EVM "exact" scheme cannot
 * pre-sign, so the Web server performs the full handshake server-side with the
 * agent's key: request → 402 challenge → sign exact-EVM USDC authorization →
 * retry. Returns the seller's response plus the x402 payment receipt.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const auth = await verifyAgentApiKey(request, id);
    if (!auth.ok) return auth.response;

    const parsed = await parseBody(request, purchaseSchema);
    if (parsed.error) return parsed.error;
    const { url, method, body, maxAmount, sellerTalosId, serviceType } = parsed.data;

    // Approval-threshold guard (best-effort cap; exact price is known only after 402).
    const talos = await db
      .select({ approvalThreshold: tlsTalos.approvalThreshold })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (maxAmount && talos && maxAmount > Number(talos.approvalThreshold)) {
      return Response.json(
        {
          error: "maxAmount exceeds approval threshold. Create an approval request first.",
          maxAmount,
          threshold: Number(talos.approvalThreshold),
        },
        { status: 403 },
      );
    }

    // Agent private key lives server-side only (never in the DB).
    const agentKey = process.env[`TALOS_AGENT_SECRET_${id}`];
    if (!agentKey) {
      return Response.json(
        { error: "Agent key not configured for this TALOS" },
        { status: 503 },
      );
    }

    const init: RequestInit = { method };
    if (method === "POST" && body) {
      init.body = JSON.stringify(body);
      init.headers = { "Content-Type": "application/json" };
    }

    const result = await purchasePaidService(agentKey as Hex, url, init);

    if (!result.ok) {
      return Response.json(
        { error: result.error ?? "Purchase failed", status: result.status, data: result.data },
        { status: 502 },
      );
    }

    // Payment settled on-chain via the facilitator. If a seller Talos was named,
    // record a fulfillment job + revenue for it (marketplace bookkeeping). The
    // x402 settlement is the on-chain proof; paymentSig is a unique reference.
    let jobId: string | null = null;
    if (sellerTalosId) {
      const sig = `x402:${id}:${sellerTalosId}:${Date.now()}`;
      const amount = String(maxAmount ?? 0);
      try {
        const [job] = await db.transaction(async (tx) => {
          const [j] = await tx
            .insert(tlsCommerceJobs)
            .values({
              talosId: sellerTalosId,
              requesterTalosId: id,
              serviceName: serviceType ?? "service",
              payload: body ?? {},
              paymentSig: sig,
              txHash: sig,
              amount,
              status: "pending",
            })
            .returning();
          await tx.insert(tlsRevenues).values({
            talosId: sellerTalosId,
            amount,
            currency: "USDC",
            source: "commerce",
            txHash: sig,
          });
          return [j];
        });
        jobId = job.id;
      } catch (err) {
        console.error("purchase: job/revenue record failed (payment already settled):", err);
      }
    }

    return Response.json({
      status: "purchased",
      httpStatus: result.status,
      jobId,
      data: result.data,
      receipt: result.receipt,
    });
  } catch (err) {
    console.error("Purchase error:", err);
    return Response.json({ error: "Purchase failed" }, { status: 500 });
  }
}
