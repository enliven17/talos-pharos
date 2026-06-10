import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsPlaybooks, tlsPlaybookPurchases, tlsRevenues } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// POST /api/playbooks/:id/purchase — Record a playbook purchase after x402 payment.
//
// The buyer pays the seller via the x402 EVM flow (POST /api/talos/:id/purchase →
// purchasePaidService), then calls this endpoint with the settled `txHash` to
// claim access. Mirrors the buy-token settle-then-record model. `txHash`
// uniqueness provides replay protection.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Authenticate buyer via Bearer API key
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json(
        { error: "Missing Authorization header. Use: Bearer <api_key>" },
        { status: 401 },
      );
    }
    const apiKeyToken = authHeader.slice(7);
    const buyer = await db
      .select({ id: tlsTalos.id })
      .from(tlsTalos)
      .where(eq(tlsTalos.apiKey, apiKeyToken))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!buyer) {
      return Response.json({ error: "Invalid API key" }, { status: 403 });
    }

    const body = await request.json();
    const { buyerPublicKey, txHash } = body as { buyerPublicKey?: string; txHash?: string };

    if (!buyerPublicKey || !txHash) {
      return Response.json(
        { error: "buyerPublicKey and txHash (settled x402 payment) are required" },
        { status: 400 },
      );
    }

    const playbook = await db
      .select()
      .from(tlsPlaybooks)
      .where(eq(tlsPlaybooks.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!playbook) {
      return Response.json({ error: "Playbook not found" }, { status: 404 });
    }
    if (playbook.status !== "active") {
      return Response.json({ error: "Playbook is not available for purchase" }, { status: 400 });
    }

    // Replay prevention — settled txHash must be unique
    const existingBySig = await db
      .select({ id: tlsPlaybookPurchases.id })
      .from(tlsPlaybookPurchases)
      .where(eq(tlsPlaybookPurchases.txHash, txHash))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (existingBySig) {
      return Response.json({ error: "Payment tx already used (replay detected)" }, { status: 409 });
    }

    // Check for duplicate purchase (same buyer + same playbook)
    const existing = await db
      .select()
      .from(tlsPlaybookPurchases)
      .where(
        and(
          eq(tlsPlaybookPurchases.playbookId, id),
          eq(tlsPlaybookPurchases.buyerPublicKey, buyerPublicKey),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);
    if (existing) {
      return Response.json({ error: "Already purchased this playbook" }, { status: 409 });
    }

    // Payment was already verified + settled by the facilitator during the x402
    // buyer flow; we record the resulting on-chain txHash here.

    // Record purchase + revenue
    const [purchase] = await db
      .insert(tlsPlaybookPurchases)
      .values({ playbookId: id, buyerPublicKey, txHash })
      .returning();

    await db.insert(tlsRevenues).values({
      talosId: playbook.talosId,
      amount: playbook.price,
      currency: playbook.currency,
      source: "playbook_sale",
      txHash,
    });

    return Response.json(purchase, { status: 201 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
