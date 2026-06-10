import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsRevenues } from "@/db/schema";
import { and, eq, sum } from "drizzle-orm";
import { sendErc20, getErc20Balance, OPERATOR_KEY, OPERATOR_ADDRESS, BURN_ADDRESS } from "@/lib/evm";

/**
 * POST /api/talos/:id/revenue/buyback
 *
 * Treasury buyback on Pharos: burn Mitos (ERC-20) by sending to the burn sink,
 * and record the USDC spent as a negative revenue (treasury expense).
 *
 * Body: { requesterPublicKey, usdcAmount, mitosAmount }
 *
 * NOTE: talos.stellarAssetCode column is repurposed to hold the Mitos ERC-20
 * contract address (0x...).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { requesterPublicKey, usdcAmount, mitosAmount } = body as {
      requesterPublicKey?: string;
      usdcAmount?: number;
      mitosAmount?: number;
    };

    if (!requesterPublicKey) {
      return Response.json({ error: "requesterPublicKey is required" }, { status: 400 });
    }
    if (!usdcAmount || usdcAmount <= 0) {
      return Response.json({ error: "usdcAmount must be positive" }, { status: 400 });
    }
    if (!mitosAmount || mitosAmount <= 0) {
      return Response.json({ error: "mitosAmount must be positive" }, { status: 400 });
    }

    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    const isCreator = requesterPublicKey.toLowerCase() === talos.creatorPublicKey?.toLowerCase();
    const isOperator = OPERATOR_ADDRESS && requesterPublicKey.toLowerCase() === OPERATOR_ADDRESS.toLowerCase();
    if (!isCreator && !isOperator) {
      return Response.json({ error: "Only creator or operator can trigger buyback" }, { status: 403 });
    }

    const mitosToken = talos.stellarAssetCode; // Mitos ERC-20 address (0x...)
    if (!mitosToken?.startsWith("0x")) {
      return Response.json({ error: "No Mitos token configured for this TALOS" }, { status: 400 });
    }
    if (!OPERATOR_KEY) {
      return Response.json({ error: "PHAROS_OPERATOR_PRIVATE_KEY not configured" }, { status: 500 });
    }

    // Burn Mitos: send to the burn sink (MitosToken has no burn()).
    const { txHash } = await sendErc20(OPERATOR_KEY, mitosToken, BURN_ADDRESS, String(mitosAmount), 18);

    // Record as negative revenue (treasury expense)
    await db.insert(tlsRevenues).values({
      talosId: id,
      amount: String(-usdcAmount),
      currency: "USDC",
      source: "buyback",
      txHash,
    });

    const tokenSymbol = talos.tokenSymbol ?? "MITOS";
    return Response.json({
      success: true,
      txHash,
      mitosBurned: mitosAmount,
      usdcSpent: usdcAmount,
      message: `Buyback: burned ${mitosAmount.toLocaleString()} ${tokenSymbol} tokens. tx: ${txHash.slice(0, 12)}...`,
    });
  } catch (err) {
    console.error("[buyback]", err instanceof Error ? err.message : err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Buyback failed" },
      { status: 500 },
    );
  }
}

/**
 * GET /api/talos/:id/revenue/buyback — preview: treasury balance + buyback stats.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
    if (!talos) return Response.json({ error: "TALOS not found" }, { status: 404 });

    const [revenueResult, buybackResult] = await Promise.all([
      db.select({ total: sum(tlsRevenues.amount) }).from(tlsRevenues).where(eq(tlsRevenues.talosId, id)),
      db.select({ total: sum(tlsRevenues.amount) })
        .from(tlsRevenues)
        .where(and(eq(tlsRevenues.talosId, id), eq(tlsRevenues.source, "buyback"))),
    ]);

    const totalRevenue = parseFloat(revenueResult[0]?.total ?? "0");
    const totalBuyback = Math.abs(parseFloat(buybackResult[0]?.total ?? "0"));
    const treasuryShare = talos.treasuryShare ?? 15;
    const investorShare = talos.investorShare ?? 25;
    const treasuryBalance = (totalRevenue * treasuryShare) / 100;

    // On-chain Mitos balance of the operator/treasury
    let operatorMitosBalance = 0;
    const mitosToken = talos.stellarAssetCode;
    if (mitosToken?.startsWith("0x") && OPERATOR_ADDRESS) {
      const bal = await getErc20Balance(mitosToken, OPERATOR_ADDRESS, 18);
      operatorMitosBalance = parseFloat(bal);
    }

    return Response.json({
      totalRevenue,
      treasuryBalance,
      treasurySharePercent: treasuryShare,
      investorSharePercent: investorShare,
      totalBuybackExecuted: totalBuyback,
      operatorMitosBalance,
      tokenSymbol: talos.tokenSymbol ?? "MITOS",
      circulatingSupply: talos.totalSupply - operatorMitosBalance,
    });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
