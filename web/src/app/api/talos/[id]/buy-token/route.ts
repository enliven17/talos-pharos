import { db } from "@/db";
import { tlsTalos, tlsPatrons, tlsRevenues } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getAccountInfo, sendErc20, OPERATOR_KEY } from "@/lib/evm";

/**
 * Buy Mitos tokens from a Talos (Pharos / ERC-20).
 *
 * Flow:
 * 1. Verify buyer's EVM account
 * 2. Calculate total cost (amount * pricePerToken)
 * 3. Verify txHash is present (USDC payment already submitted by client)
 * 4. Send Mitos (ERC-20) from operator/treasury to buyer (server-side)
 * 5. Record patron status if buyer meets minimum threshold
 * 6. Record revenue
 *
 * NOTE: talos.stellarAssetCode column is repurposed to hold the Mitos ERC-20
 * contract address (0x...). tokenSymbol holds the symbol.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const { buyerPublicKey, amount, txHash } = body as {
    buyerPublicKey?: string;
    amount?: number;
    txHash?: string;
  };

  if (!buyerPublicKey || typeof buyerPublicKey !== "string") {
    return NextResponse.json({ error: "buyerPublicKey (0x...) is required" }, { status: 400 });
  }
  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }
  if (!txHash) {
    return NextResponse.json({ error: "txHash is required — submit USDC payment first" }, { status: 400 });
  }

  const talos = await db.query.tlsTalos.findFirst({ where: eq(tlsTalos.id, id) });
  if (!talos) {
    return NextResponse.json({ error: "TALOS not found" }, { status: 404 });
  }

  const pricePerToken = Number(talos.pulsePrice);
  if (pricePerToken <= 0) {
    return NextResponse.json({ error: "Token is not available for purchase" }, { status: 400 });
  }

  const totalCost = Math.round(amount * pricePerToken * 1e6) / 1e6;

  // Verify buyer's EVM account is reachable
  const accountInfo = await getAccountInfo(buyerPublicKey);
  if (!accountInfo.exists) {
    return NextResponse.json(
      { error: `EVM account ${buyerPublicKey} is not reachable` },
      { status: 400 },
    );
  }

  // ── Send Mitos (ERC-20) from operator/treasury to buyer ────────────
  let mitosTxHash: string | null = null;
  const mitosToken = talos.stellarAssetCode; // repurposed: Mitos ERC-20 address (0x...)

  if (mitosToken && mitosToken.startsWith("0x")) {
    if (!OPERATOR_KEY) {
      return NextResponse.json(
        { error: "PHAROS_OPERATOR_PRIVATE_KEY not configured" },
        { status: 500 },
      );
    }
    try {
      const r = await sendErc20(OPERATOR_KEY, mitosToken, buyerPublicKey, String(amount), 18);
      mitosTxHash = r.txHash;
    } catch (err) {
      console.error("[buy-token] Mitos transfer failed:", err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: "Failed to send Mitos tokens to buyer. Purchase cancelled." },
        { status: 500 },
      );
    }
  }

  // ── Patron threshold check ─────────────────────────────────────────
  const minForPatron = talos.minPatronPulse ?? 100;

  const existingPatron = await db.query.tlsPatrons.findFirst({
    where: and(
      eq(tlsPatrons.talosId, id),
      eq(tlsPatrons.stellarPublicKey, buyerPublicKey),
    ),
  });

  const currentPulseAmount = existingPatron?.pulseAmount ?? 0;
  const newPulseAmount = currentPulseAmount + amount;
  const becomesPatron = newPulseAmount >= minForPatron;

  if (becomesPatron) {
    if (existingPatron) {
      await db
        .update(tlsPatrons)
        .set({ pulseAmount: newPulseAmount, updatedAt: new Date() })
        .where(eq(tlsPatrons.id, existingPatron.id));
    } else {
      await db.insert(tlsPatrons).values({
        talosId: id,
        stellarPublicKey: buyerPublicKey,
        role: "patron",
        share: "0",
        pulseAmount: newPulseAmount,
        status: "active",
      });
    }
  } else if (existingPatron) {
    await db
      .update(tlsPatrons)
      .set({ pulseAmount: newPulseAmount, updatedAt: new Date() })
      .where(eq(tlsPatrons.id, existingPatron.id));
  }

  // ── Record revenue ─────────────────────────────────────────────────
  await db.insert(tlsRevenues).values({
    talosId: id,
    amount: String(totalCost),
    currency: "USDC",
    source: "token_sale",
    txHash,
  });

  const tokenSymbol = talos.tokenSymbol ?? "MITOS";

  return NextResponse.json({
    success: true,
    txHash,
    mitosTxHash,
    tokenSymbol,
    amount,
    pricePerToken,
    totalCost,
    currency: "USDC",
    buyerPublicKey,
    totalPulseHeld: newPulseAmount,
    patronStatus: becomesPatron
      ? existingPatron
        ? "updated"
        : "registered"
      : `pending (need ${minForPatron - newPulseAmount} more ${tokenSymbol})`,
    message: `Successfully purchased ${amount.toLocaleString()} ${tokenSymbol} for ${totalCost.toFixed(2)} USDC`,
  });
}
