import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "crypto";
import { recoverMessageAddress, type Hex } from "viem";
import { regenerateKeySchema, parseBody } from "@/lib/schemas";

// POST /api/talos/:id/regenerate-key — Regenerate API key (invalidates old key)
// Requires an EVM (EIP-191 personal_sign) signature proving wallet ownership.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const parsed = await parseBody(request, regenerateKeySchema);
    if (parsed.error) return parsed.error;

    const { stellarPublicKey, signature, message } = parsed.data;

    // Verify the message contains the TALOS ID to prevent replay across TALOSes
    if (!message.includes(id)) {
      return Response.json(
        { error: "Signature message must contain the TALOS ID" },
        { status: 400 }
      );
    }

    const talos = await db.query.tlsTalos.findFirst({
      where: eq(tlsTalos.id, id),
    });

    if (!talos) {
      return Response.json({ error: "TALOS not found" }, { status: 404 });
    }

    // Only the creator wallet can regenerate
    if (
      talos.walletPublicKey !== stellarPublicKey &&
      talos.creatorPublicKey !== stellarPublicKey
    ) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Verify EVM (EIP-191) signature proves wallet ownership
    try {
      const recovered = await recoverMessageAddress({
        message,
        signature: signature as Hex,
      });
      if (recovered.toLowerCase() !== stellarPublicKey.toLowerCase()) {
        return Response.json({ error: "Invalid signature" }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Invalid signature" }, { status: 403 });
    }

    const newApiKey = `tlk_${randomBytes(24).toString("hex")}`;

    await db
      .update(tlsTalos)
      .set({ apiKey: newApiKey })
      .where(eq(tlsTalos.id, id));

    return Response.json({ apiKey: newApiKey });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
