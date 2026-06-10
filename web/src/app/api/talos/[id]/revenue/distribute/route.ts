import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsPatrons, tlsRevenues } from "@/db/schema";
import { eq, and, sum } from "drizzle-orm";
import { sendUSDC, OPERATOR_KEY, OPERATOR_ADDRESS } from "@/lib/evm";

/**
 * POST /api/talos/:id/revenue/distribute
 *
 * Distribute accumulated treasury USDC to Mitos holders proportionally (Pharos).
 * Requires PHAROS_OPERATOR_PRIVATE_KEY (operator holds the agent treasury).
 *
 * Body: { requesterPublicKey } — must be creator or operator (0x...)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { requesterPublicKey } = body as { requesterPublicKey?: string };

    if (!requesterPublicKey) {
      return Response.json({ error: "requesterPublicKey is required" }, { status: 400 });
    }

    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    // Only creator or operator can distribute
    const isCreator = requesterPublicKey.toLowerCase() === talos.creatorPublicKey?.toLowerCase();
    const isOperator = OPERATOR_ADDRESS && requesterPublicKey.toLowerCase() === OPERATOR_ADDRESS.toLowerCase();
    if (!isCreator && !isOperator) {
      return Response.json({ error: "Only the creator or operator can trigger distribution" }, { status: 403 });
    }

    const revenueResult = await db
      .select({ total: sum(tlsRevenues.amount) })
      .from(tlsRevenues)
      .where(eq(tlsRevenues.talosId, id));
    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");

    if (totalRevenue <= 0) {
      return Response.json({ error: "No revenue to distribute" }, { status: 400 });
    }

    const patrons = await db
      .select()
      .from(tlsPatrons)
      .where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active")));

    if (patrons.length === 0) {
      return Response.json({ error: "No active patrons to distribute to" }, { status: 400 });
    }

    const totalPulse = patrons.reduce((s, p) => s + p.pulseAmount, 0);
    if (totalPulse === 0) {
      return Response.json({ error: "Total Mitos held by patrons is 0" }, { status: 400 });
    }

    const investorShare = talos.investorShare ?? 25; // % to patrons
    const distributableAmount = (totalRevenue * investorShare) / 100;

    if (!OPERATOR_KEY) {
      return Response.json({ error: "PHAROS_OPERATOR_PRIVATE_KEY not configured" }, { status: 500 });
    }

    const transfers: { patron: string; amount: number; txHash: string }[] = [];
    const errors: { patron: string; error: string }[] = [];

    for (const patron of patrons) {
      const shareRatio = patron.pulseAmount / totalPulse;
      // USDC has 6 decimals — round to 6 dp.
      const patronAmount = Math.floor(distributableAmount * shareRatio * 1e6) / 1e6;
      if (patronAmount < 0.000001) continue; // dust

      try {
        const result = await sendUSDC(OPERATOR_KEY, patron.stellarPublicKey, patronAmount.toFixed(6));
        transfers.push({ patron: patron.stellarPublicKey, amount: patronAmount, txHash: result.txHash });
      } catch (err) {
        errors.push({
          patron: patron.stellarPublicKey,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    return Response.json({
      success: true,
      totalRevenue,
      distributableAmount,
      investorSharePercent: investorShare,
      transfers,
      errors,
      message: `Distributed ${distributableAmount.toFixed(2)} USDC (${investorShare}% of ${totalRevenue.toFixed(2)} USDC treasury) to ${transfers.length} patrons`,
    });
  } catch (err) {
    console.error("[revenue/distribute]", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/talos/:id/revenue/distribute — preview without executing.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    const [revenueResult, patrons] = await Promise.all([
      db.select({ total: sum(tlsRevenues.amount) }).from(tlsRevenues).where(eq(tlsRevenues.talosId, id)),
      db.select().from(tlsPatrons).where(and(eq(tlsPatrons.talosId, id), eq(tlsPatrons.status, "active"))),
    ]);

    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");
    const investorShare = talos.investorShare ?? 25;
    const distributableAmount = (totalRevenue * investorShare) / 100;
    const totalPulse = patrons.reduce((s, p) => s + p.pulseAmount, 0);

    const breakdown = patrons.map((p) => ({
      stellarPublicKey: p.stellarPublicKey,
      pulseAmount: p.pulseAmount,
      sharePercent: totalPulse > 0 ? ((p.pulseAmount / totalPulse) * 100).toFixed(2) : "0",
      estimatedUsdc: totalPulse > 0
        ? ((distributableAmount * p.pulseAmount) / totalPulse).toFixed(6)
        : "0",
    }));

    return Response.json({
      totalRevenue,
      distributableAmount,
      investorSharePercent: investorShare,
      treasuryRetained: totalRevenue - distributableAmount,
      breakdown,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
