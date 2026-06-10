import { NextRequest } from "next/server";

// POST /api/talos/:id/sign — DEPRECATED on Pharos.
//
// The Stellar flow pre-signed an x402 payment header. The x402 EVM "exact"
// scheme cannot pre-sign: the buyer must receive the 402 challenge first and
// sign over it. Use POST /api/talos/:id/purchase instead, which performs the
// full handshake server-side with the agent's key.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json(
    {
      error: "Endpoint deprecated on Pharos (EVM x402 cannot pre-sign).",
      use: `POST /api/talos/${id}/purchase`,
    },
    { status: 410 },
  );
}
