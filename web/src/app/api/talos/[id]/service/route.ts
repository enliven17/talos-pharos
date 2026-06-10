import { NextRequest } from "next/server";
import { db } from "@/db";
import { tlsTalos, tlsCommerceServices, tlsCommerceJobs, tlsRevenues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyAgentApiKey } from "@/lib/auth";
import { fulfillInstant } from "@/lib/fulfillment";
import { registerServiceSchema, parseBody } from "@/lib/schemas";

const X402_NETWORK = process.env.X402_NETWORK ?? "eip155:688689";

// GET /api/talos/:id/service — Returns 402 with payment details (x402 storefront)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [service, talos] = await Promise.all([
      db
        .select()
        .from(tlsCommerceServices)
        .where(eq(tlsCommerceServices.talosId, id))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({ agentWalletAddress: tlsTalos.agentWalletAddress })
        .from(tlsTalos)
        .where(eq(tlsTalos.id, id))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    if (!service) {
      return Response.json({ error: "No service registered for this TALOS" }, { status: 404 });
    }

    // payee: use service stellarPublicKey if set, otherwise fall back to agent wallet
    const payee = service.stellarPublicKey || talos?.agentWalletAddress;
    if (!payee) {
      return Response.json({ error: "No payment address configured for this TALOS" }, { status: 500 });
    }

    // x402-payable endpoint on the shared seller resource server.
    const sellerUrl = (process.env.SELLER_PUBLIC_URL ?? "http://localhost:4021").replace(/\/$/, "");

    // Return 402 Payment Required with x402 Pharos payment details
    return Response.json(
      {
        price: Number(service.price),
        currency: service.currency,
        payee,
        chains: service.chains,
        network: X402_NETWORK,
        asset: "USDC",
        serviceName: service.serviceName,
        description: service.description,
        fulfillmentMode: service.fulfillmentMode,
        talosId: id,
        serviceUrl: `${sellerUrl}/buy/${id}`,
      },
      { status: 402 }
    );
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/talos/:id/service — Submit x402 payment + create commerce job
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 1. Authenticate requester TALOS via API key (check early)
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json(
        { error: "Missing Authorization header. Use: Bearer <api_key>" },
        { status: 401 }
      );
    }
    const apiKeyToken = authHeader.slice(7);
    const requester = await db
      .select({ id: tlsTalos.id })
      .from(tlsTalos)
      .where(eq(tlsTalos.apiKey, apiKeyToken))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!requester) {
      return Response.json({ error: "Invalid API key" }, { status: 403 });
    }

    // 1b. Read body once (request body can only be consumed once)
    const requestBody = await request.json().catch(() => ({})) as Record<string, unknown>;

    // 2. Settled x402 payment proof. The buyer pays the seller via the x402 EVM
    // flow (facilitator verifies + settles on-chain); the resulting tx hash is
    // passed here as proof. Accept it from the body or the X-PAYMENT-RESPONSE header.
    const txHash =
      (typeof requestBody.txHash === "string" && requestBody.txHash) ||
      request.headers.get("x-payment-response") ||
      "";
    if (!txHash) {
      return Response.json(
        { error: "Missing settled payment txHash (from the x402 purchase flow)" },
        { status: 400 }
      );
    }

    const [service, providerTalos] = await Promise.all([
      db
        .select()
        .from(tlsCommerceServices)
        .where(eq(tlsCommerceServices.talosId, id))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select({ agentWalletAddress: tlsTalos.agentWalletAddress })
        .from(tlsTalos)
        .where(eq(tlsTalos.id, id))
        .limit(1)
        .then((r) => r[0] ?? null),
    ]);

    if (!service) {
      return Response.json({ error: "No service registered for this TALOS" }, { status: 404 });
    }

    const expectedPayee = service.stellarPublicKey || providerTalos?.agentWalletAddress;
    if (!expectedPayee) {
      return Response.json(
        { error: "No payment address configured for this TALOS" },
        { status: 500 }
      );
    }

    // 3. Replay prevention — settled txHash must be unique
    const existingJob = await db
      .select({ id: tlsCommerceJobs.id })
      .from(tlsCommerceJobs)
      .where(eq(tlsCommerceJobs.paymentSig, txHash))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (existingJob) {
      return Response.json({ error: "Payment tx already used (replay detected)" }, { status: 409 });
    }

    // 4. Create commerce job + fulfill
    const payload = (requestBody.payload ?? requestBody) as Record<string, unknown>;

    if (service.fulfillmentMode === "instant") {
      // Instant mode: server calls external API and returns result synchronously
      let result: Record<string, unknown>;
      try {
        result = await fulfillInstant(service.serviceName, payload ?? {});
      } catch (fulfillErr) {
        console.error("Service fulfillment failed:", fulfillErr);
        return Response.json(
          { error: "Service fulfillment failed" },
          { status: 502 }
        );
      }

      // Atomic: job + revenue recorded together — if either fails, both roll back.
      // Payment (on-chain) already happened; DB must not partially record it.
      const [job] = await db.transaction(async (tx) => {
        const [job] = await tx
          .insert(tlsCommerceJobs)
          .values({
            talosId: id,
            requesterTalosId: requester.id,
            serviceName: service.serviceName,
            payload: payload ?? undefined,
            result,
            paymentSig: txHash,
            txHash,
            amount: service.price,
            status: "completed",
          })
          .returning();

        await tx.insert(tlsRevenues).values({
          talosId: id,
          amount: service.price,
          currency: service.currency ?? "USDC",
          source: "commerce",
          txHash,
        });

        return [job];
      });

      return Response.json(
        { id: job.id, jobId: job.id, status: "completed", result, txHash },
        { status: 201 }
      );
    }

    // Async mode: create pending job for agent to fulfill via polling
    // Revenue is recorded when the job is fulfilled, not on creation
    const [job] = await db
      .insert(tlsCommerceJobs)
      .values({
        talosId: id,
        requesterTalosId: requester.id,
        serviceName: service.serviceName,
        payload: payload ?? undefined,
        paymentSig: txHash,
        txHash,
        amount: service.price,
        status: "pending",
      })
      .returning();

    return Response.json(
      { id: job.id, jobId: job.id, status: "pending", txHash },
      { status: 201 }
    );
  } catch (err: unknown) {
    // Catch unique constraint violation on paymentSig (replay race condition)
    const e = err as Record<string, unknown>;
    if (e?.code === "23505" && String(e?.constraint ?? "").includes("paymentSig")) {
      return Response.json({ error: "Payment token already used (replay detected)" }, { status: 409 });
    }
    console.error("Service POST error:", err);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/talos/:id/service — Register or update commerce service (upsert)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const auth = await verifyAgentApiKey(request, id);
    if (!auth.ok) return auth.response;

    const parsed = await parseBody(request, registerServiceSchema);
    if (parsed.error) return parsed.error;

    const { serviceName, description, price, stellarPublicKey, chains, fulfillmentMode } = parsed.data;

    // Get agent wallet as fallback for stellarPublicKey
    const talos = await db
      .select({ agentWalletAddress: tlsTalos.agentWalletAddress })
      .from(tlsTalos)
      .where(eq(tlsTalos.id, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    const servicePublicKey = stellarPublicKey || talos?.agentWalletAddress;
    if (!servicePublicKey) {
      return Response.json(
        { error: "stellarPublicKey is required (no agent wallet available as fallback)" },
        { status: 400 }
      );
    }

    // Check if service already exists for this TALOS
    const existing = await db
      .select({ id: tlsCommerceServices.id })
      .from(tlsCommerceServices)
      .where(eq(tlsCommerceServices.talosId, id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (existing) {
      // Update existing service
      const [updated] = await db
        .update(tlsCommerceServices)
        .set({
          serviceName,
          description: description ?? null,
          price: String(price),
          stellarPublicKey: servicePublicKey,
          chains: chains ?? ["pharos"],
          fulfillmentMode: fulfillmentMode ?? "async",
        })
        .where(eq(tlsCommerceServices.talosId, id))
        .returning();
      return Response.json(updated);
    }

    // Create new service
    const [service] = await db
      .insert(tlsCommerceServices)
      .values({
        talosId: id,
        serviceName,
        description: description ?? null,
        price: String(price),
        stellarPublicKey: servicePublicKey,
        chains: chains ?? ["stellar"],
        fulfillmentMode: fulfillmentMode ?? "async",
      })
      .returning();

    return Response.json(service, { status: 201 });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
