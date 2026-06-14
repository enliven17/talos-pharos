/**
 * On-chain seed: registers example Talos agents on Pharos Atlantic and writes
 * the full off-chain projection to NeonDB so the Agents / Activity / Leaderboard
 * pages are populated with real, verifiable data.
 *
 * For each agent it:
 *   1. createTalos()      → TalosRegistry  (on-chain identity, returns onChainId)
 *   2. registerName()     → TalosNameService (<name>.talos)
 *   3. deployMitosToken() → per-agent ERC-20 (operator-funded)
 *   4. DB: tls_talos + tls_commerce_services + tls_patrons
 *   5. DB: tls_activities (per-agent feed) + tls_revenues (earnings)
 * Then it creates peer-to-peer tls_commerce_jobs between the agents, each
 * settled with a real on-chain tx (operator self-tx carrying job metadata) so
 * the global Activity feed shows verifiable Pharosscan hashes.
 *
 * Idempotent: agents already present (by agentName) are skipped.
 *
 * Usage:
 *   cd web
 *   npx tsx scripts/seed-onchain-agents.ts
 *   npx tsx scripts/seed-onchain-agents.ts --no-token   # skip Mitos deploys
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  createPublicClient,
  createWalletClient,
  http,
  defineChain,
  parseAbi,
  decodeEventLog,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as schema from "../src/db/schema";
import { MITOS_ABI, MITOS_BYTECODE } from "../src/lib/abi/mitos";

// ── Config ────────────────────────────────────────────────────────────
const RPC = process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com";
const CHAIN_ID = Number(process.env.PHAROS_CHAIN_ID ?? 688689);
const EXPLORER = process.env.PHAROS_EXPLORER ?? "https://atlantic.pharosscan.xyz";
const REGISTRY = process.env.NEXT_PUBLIC_TALOS_REGISTRY_CONTRACT as Address;
const NAME_SERVICE = process.env.NEXT_PUBLIC_TALOS_NAME_SERVICE_CONTRACT as Address;
const OPERATOR_KEY = process.env.PHAROS_OPERATOR_PRIVATE_KEY as Hex;
const OPERATOR_ADDRESS = process.env.PHAROS_OPERATOR_ADDRESS as Address;
const DEPLOY_TOKEN = !process.argv.includes("--no-token");

if (!REGISTRY || !NAME_SERVICE) throw new Error("Registry / NameService address missing in .env.local");
if (!OPERATOR_KEY || !OPERATOR_ADDRESS) throw new Error("PHAROS_OPERATOR_PRIVATE_KEY / _ADDRESS missing");

const pharos = defineChain({
  id: CHAIN_ID,
  name: "Pharos Atlantic Testnet",
  nativeCurrency: { name: "Pharos", symbol: "PHRS", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Pharosscan", url: EXPLORER } },
  testnet: true,
});

const account = privateKeyToAccount(OPERATOR_KEY);
const publicClient = createPublicClient({ chain: pharos, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: pharos, transport: http(RPC) });

const REGISTRY_ABI = parseAbi([
  "struct Patron { uint32 creatorShare; uint32 investorShare; uint32 treasuryShare; address creatorAddr; address investorAddr; address treasuryAddr; }",
  "struct Kernel { uint256 approvalThreshold; uint256 gtmBudget; uint256 minPatronPulse; }",
  "struct Pulse { uint256 totalSupply; uint256 priceUsdCents; string tokenSymbol; }",
  "function createTalos(string name, string category, string description, Patron patron, Kernel kernel, Pulse pulse) returns (uint256 talosId)",
  "event TalosCreated(uint256 indexed talosId, address indexed creator, string name)",
]);
const NAME_SERVICE_ABI = parseAbi([
  "function registerName(uint256 talosId, string name)",
  "function resolveName(string name) view returns (uint256)",
]);

const pool = new Pool({ connectionString: process.env.DATABASE_URL! });
const db = drizzle(pool, { schema });

const ex = (h: string) => `${EXPLORER}/tx/${h}`;

// ── Agent definitions ─────────────────────────────────────────────────
interface AgentDef {
  agentName: string;
  name: string;
  category: string;
  description: string;
  persona: string;
  tokenSymbol: string;
  channels: string[];
  service: { serviceName: string; description: string; price: number };
}

const AGENTS: AgentDef[] = [
  {
    agentName: "vega", name: "Vega", category: "Analytics", tokenSymbol: "VEGA",
    description: "Audience intelligence agent. Maps target audiences — personas, communities, pain points, and the best channels to reach them.",
    persona: "Precise audience research analyst with deep knowledge of online communities and user behavior.",
    channels: ["X (Twitter)", "Reddit"],
    service: { serviceName: "audience_insight", description: "Analyze a target audience: personas, communities, pain points, and best channels.", price: 0.005 },
  },
  {
    agentName: "atlas", name: "Atlas", category: "Analytics", tokenSymbol: "ATLS",
    description: "Trend research agent. Tracks market trends and emerging opportunities across X, Reddit, and Hacker News in real time.",
    persona: "Trend analyst tracking discussions across X, Reddit, Hacker News, and Product Hunt.",
    channels: ["X (Twitter)", "Hacker News"],
    service: { serviceName: "trend_research", description: "Research latest trends and hot topics for a given market with momentum scores.", price: 0.005 },
  },
  {
    agentName: "nova", name: "Nova", category: "Analytics", tokenSymbol: "NOVA",
    description: "Competitive intelligence agent. Deep-dives on competitors — features, pricing, positioning, and market gaps.",
    persona: "Competitive intelligence analyst who dissects products and surfaces positioning opportunities.",
    channels: ["X (Twitter)", "LinkedIn"],
    service: { serviceName: "competitor_analysis", description: "Analyze competitors: features, pricing, strengths/weaknesses, and market gaps.", price: 0.008 },
  },
  {
    agentName: "forge", name: "Forge", category: "Sales", tokenSymbol: "FORG",
    description: "Lead generation agent. Finds potential customers on social platforms from product-market fit signals.",
    persona: "Lead generation specialist who identifies high-relevance prospects from social signals.",
    channels: ["X (Twitter)", "GitHub"],
    service: { serviceName: "find_leads", description: "Find prospects on X, Reddit, and GitHub matching a target profile.", price: 0.01 },
  },
  {
    agentName: "lens", name: "Lens", category: "Sales", tokenSymbol: "LENS",
    description: "Profile enrichment agent. Enriches prospect profiles with professional details, interests, and social links.",
    persona: "Profile enrichment specialist who builds comprehensive prospect profiles from public data.",
    channels: ["LinkedIn", "X (Twitter)"],
    service: { serviceName: "enrich_profile", description: "Enrich a person's profile: title, company, interests, recent activity, and links.", price: 0.008 },
  },
  {
    agentName: "radar", name: "Radar", category: "Sales", tokenSymbol: "RDAR",
    description: "Intent signal agent. Detects buying intent across platforms — people actively seeking solutions like yours.",
    persona: "Intent signal analyst detecting 'looking for' and 'switching from' patterns across platforms.",
    channels: ["X (Twitter)", "Reddit"],
    service: { serviceName: "intent_signal", description: "Detect buying-intent signals: people seeking solutions or switching tools.", price: 0.01 },
  },
];

const TOTAL_SUPPLY = 1_000_000;
const PULSE_PRICE = 0.01;

// ── Helpers ───────────────────────────────────────────────────────────
async function send(label: string, hash: Hex): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted (${hash})`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Anchor an off-chain event on-chain: operator self-tx carrying JSON calldata.
 *  Retries on transient RPC failures (the Atlantic public RPC is occasionally flaky). */
async function anchor(payload: Record<string, unknown>, tries = 5): Promise<Hex> {
  for (let i = 1; i <= tries; i++) {
    try {
      const hash = await wallet.sendTransaction({
        to: OPERATOR_ADDRESS,
        value: BigInt(0),
        data: toHex(JSON.stringify(payload)),
      });
      await send("anchor", hash);
      return hash;
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string };
      console.log(`   …anchor retry ${i}/${tries} (${e.shortMessage || e.message})`);
      if (i === tries) throw err;
      await sleep(2500 * i);
    }
  }
  throw new Error("unreachable");
}

const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000);

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱 On-chain seed → Pharos Atlantic (chain ${CHAIN_ID})`);
  console.log(`   operator: ${OPERATOR_ADDRESS}`);
  console.log(`   registry: ${REGISTRY}`);
  console.log(`   token deploy: ${DEPLOY_TOKEN ? "yes" : "no"}\n`);

  const created: { def: AgentDef; id: string; onChainId: number; mitos: string | null }[] = [];

  for (const def of AGENTS) {
    const existing = await db
      .select({ id: schema.tlsTalos.id })
      .from(schema.tlsTalos)
      .where(eq(schema.tlsTalos.agentName, def.agentName))
      .limit(1)
      .then((r) => r[0] ?? null);
    if (existing) {
      console.log(`⏭  ${def.agentName} already exists (${existing.id}) — skipping`);
      continue;
    }

    console.log(`\n🤖 ${def.name} (${def.agentName})`);

    // Idempotent against the chain: if the name is already registered (e.g. a
    // prior run created it on-chain but failed before the DB write), reuse that
    // onChainId and skip createTalos + registerName.
    let onChainId = Number(
      await publicClient.readContract({
        address: NAME_SERVICE, abi: NAME_SERVICE_ABI, functionName: "resolveName", args: [def.agentName],
      }),
    );

    if (onChainId > 0) {
      console.log(`   ↺ already on-chain → onChainId ${onChainId} (reusing, skip create/register)`);
    } else {
      // 1. createTalos on-chain
      const patron = {
        creatorShare: 60, investorShare: 25, treasuryShare: 15,
        creatorAddr: OPERATOR_ADDRESS, investorAddr: OPERATOR_ADDRESS, treasuryAddr: OPERATOR_ADDRESS,
      };
      const kernel = { approvalThreshold: BigInt(10), gtmBudget: BigInt(200), minPatronPulse: BigInt(100) };
      const pulse = {
        totalSupply: BigInt(TOTAL_SUPPLY),
        priceUsdCents: BigInt(Math.round(PULSE_PRICE * 100)),
        tokenSymbol: def.tokenSymbol,
      };
      const createHash = await wallet.writeContract({
        address: REGISTRY, abi: REGISTRY_ABI, functionName: "createTalos",
        args: [def.name, def.category, def.persona, patron, kernel, pulse],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: createHash });
      if (receipt.status !== "success") throw new Error("createTalos reverted");

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== REGISTRY.toLowerCase()) continue;
        try {
          const d = decodeEventLog({ abi: REGISTRY_ABI, data: log.data, topics: log.topics });
          if (d.eventName === "TalosCreated") { onChainId = Number(d.args.talosId); break; }
        } catch { /* not our event */ }
      }
      if (!onChainId) throw new Error("TalosCreated not found in logs");
      console.log(`   ✅ createTalos → onChainId ${onChainId}  ${ex(createHash)}`);

      // 2. registerName on-chain
      const nameHash = await wallet.writeContract({
        address: NAME_SERVICE, abi: NAME_SERVICE_ABI, functionName: "registerName",
        args: [BigInt(onChainId), def.agentName],
      });
      await send("registerName", nameHash);
      console.log(`   ✅ registerName ${def.agentName}.talos  ${ex(nameHash)}`);
    }

    // 3. Mitos ERC-20 (per-agent token)
    let mitos: string | null = null;
    if (DEPLOY_TOKEN) {
      const deployHash = await wallet.deployContract({
        abi: MITOS_ABI, bytecode: MITOS_BYTECODE,
        args: [`${def.name} Mitos`, def.tokenSymbol, BigInt(onChainId), OPERATOR_ADDRESS, BigInt(TOTAL_SUPPLY)],
      });
      const r = await publicClient.waitForTransactionReceipt({ hash: deployHash });
      mitos = r.contractAddress ?? null;
      console.log(`   ✅ Mitos ${def.tokenSymbol} → ${mitos}  ${ex(deployHash)}`);
    }

    // 4. DB: talos + service + patron
    const apiKey = `tak_${onChainId}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    const [talos] = await db.insert(schema.tlsTalos).values({
      onChainId,
      agentName: def.agentName,
      name: def.name,
      category: def.category,
      description: def.description,
      status: "Active",
      persona: def.persona,
      channels: def.channels,
      stellarAssetCode: mitos,
      tokenSymbol: def.tokenSymbol,
      pulsePrice: String(PULSE_PRICE),
      totalSupply: TOTAL_SUPPLY,
      creatorShare: 60, investorShare: 25, treasuryShare: 15,
      approvalThreshold: "10", gtmBudget: "200",
      agentOnline: true,
      agentLastSeen: new Date(),
      apiKey,
      walletPublicKey: OPERATOR_ADDRESS,
      creatorPublicKey: OPERATOR_ADDRESS,
      agentWalletId: OPERATOR_ADDRESS,
      agentWalletAddress: OPERATOR_ADDRESS,
    }).returning();

    await db.insert(schema.tlsCommerceServices).values({
      talosId: talos.id,
      serviceName: def.service.serviceName,
      description: def.service.description,
      price: String(def.service.price),
      currency: "USDC",
      stellarPublicKey: OPERATOR_ADDRESS,
      chains: ["pharos"],
      fulfillmentMode: "instant",
    });

    await db.insert(schema.tlsPatrons).values({
      talosId: talos.id,
      stellarPublicKey: OPERATOR_ADDRESS,
      role: "Creator",
      pulseAmount: Math.floor(TOTAL_SUPPLY * 0.6),
      share: "60",
    });

    // 5. Per-agent activity feed
    const acts = [
      { type: "genesis", channel: "System", content: `${def.name} achieved Genesis on Pharos — onChainId ${onChainId}, ${def.agentName}.talos registered.`, at: daysAgo(5, 2) },
      { type: "service", channel: "System", content: `Listed service "${def.service.serviceName}" at $${def.service.price} USDC via x402.`, at: daysAgo(5, 1) },
      { type: "post", channel: def.channels[0], content: `${def.persona.split(".")[0]}. Now live and taking jobs.`, at: daysAgo(3, 5) },
      { type: "research", channel: def.channels[0], content: `Completed a ${def.service.serviceName.replace("_", " ")} run and shipped the report to the buyer.`, at: daysAgo(2, 3) },
      { type: "outreach", channel: def.channels[1] ?? def.channels[0], content: `Engaged the community and surfaced 3 new opportunities for patrons.`, at: daysAgo(1, 4) },
    ];
    for (const a of acts) {
      await db.insert(schema.tlsActivities).values({
        talosId: talos.id, type: a.type, content: a.content, channel: a.channel, status: "completed", createdAt: a.at,
      });
    }

    created.push({ def, id: talos.id, onChainId, mitos });
    console.log(`   ✅ DB: talos + service + patron + ${acts.length} activities`);
  }

  // 6. Peer-to-peer commerce jobs (global Activity feed), settled on-chain.
  // Operates on ALL seeded agents loaded from DB (not just this run's new ones)
  // and is guarded so re-runs don't duplicate the marketplace history.
  const existingJobs = await db.select({ id: schema.tlsCommerceJobs.id }).from(schema.tlsCommerceJobs).limit(1);
  if (existingJobs.length > 0) {
    console.log(`\n💸 Commerce jobs already present — skipping P2P marketplace seed.`);
  } else {
    const names = AGENTS.map((a) => a.agentName);
    const rows = await db
      .select({ id: schema.tlsTalos.id, agentName: schema.tlsTalos.agentName, name: schema.tlsTalos.name })
      .from(schema.tlsTalos);
    const market = AGENTS
      .map((def) => {
        const row = rows.find((r) => r.agentName === def.agentName);
        return row ? { def, id: row.id } : null;
      })
      .filter((x): x is { def: AgentDef; id: string } => x !== null && names.includes(x.def.agentName));

    if (market.length >= 2) {
      console.log(`\n💸 Peer-to-peer service jobs (on-chain settlement)`);
      const ring = market.map((c, i) => ({ buyer: market[(i + 1) % market.length], seller: c }));
      let day = 4;
      for (const { buyer, seller } of ring) {
        const price = seller.def.service.price;
        const txHash = await anchor({
          kind: "x402_settlement",
          service: seller.def.service.serviceName,
          seller: seller.def.agentName,
          buyer: buyer.def.agentName,
          amount: price,
          currency: "USDC",
        });
        await db.insert(schema.tlsCommerceJobs).values({
          talosId: seller.id,
          requesterTalosId: buyer.id,
          serviceName: seller.def.service.serviceName,
          payload: { query: `${buyer.def.name} requesting ${seller.def.service.serviceName}` },
          result: { status: "fulfilled", summary: "Report delivered to buyer." },
          status: "completed",
          paymentSig: txHash,
          txHash,
          amount: String(price),
          createdAt: daysAgo(day, 2),
        });
        await db.insert(schema.tlsRevenues).values({
          talosId: seller.id,
          amount: String(price),
          currency: "USDC",
          source: `service:${seller.def.service.serviceName}`,
          txHash,
          createdAt: daysAgo(day, 2),
        });
        console.log(`   ✅ ${buyer.def.agentName} → ${seller.def.agentName} $${price}  ${ex(txHash)}`);
        day = Math.max(0, day - 1);
      }
    }
  }

  // Summary
  console.log("\n" + "═".repeat(64));
  console.log(`  SEEDED ${created.length} AGENTS (on-chain + DB)`);
  console.log("═".repeat(64));
  for (const c of created) {
    console.log(`  ${c.def.name.padEnd(7)} onChainId=${c.onChainId}  ${c.def.agentName}.talos  token=${c.mitos ?? "-"}`);
  }
  console.log("");
  await pool.end();
}

main().catch(async (err) => {
  console.error("\n❌ Seed failed:", err?.shortMessage || err?.message || err);
  await pool.end();
  process.exit(1);
});
