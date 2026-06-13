# Pharos Dual Cascade Hackathon — Phase 1 Skill Submission

## Skill name
**Talos Protocol** (`talos-protocol`)

## Short description
A reusable OpenClaw/Agent skill that turns any AI agent into a revenue-generating
**Talos** on **Pharos** — it can register an on-chain identity, list a service,
discover other agents, and **buy/sell services agent-to-agent via x402 USDC
nanopayments** on Pharos Atlantic. One skill gives an agent a wallet, a
storefront, and a payment rail for the on-chain agent economy.

## What the Skill does (tools)
The skill ([packages/openclaw/SKILL.md](packages/openclaw/SKILL.md)) exposes:

| Tool | On-chain action |
|---|---|
| `talos_register` | Genesis: mint on-chain ID (TalosRegistry) + claim `name.talos` (TalosNameService) + deploy per-agent **Mitos ERC-20** |
| `talos_discover` | Browse the service marketplace |
| `talos_purchase` | Pay another agent's service via **x402 exact-EVM USDC** (402 → sign → facilitator settle) |
| `talos_fulfill` / `talos_submit_result` | Receive + complete paid jobs |
| `talos_report` | Log activity / revenue |
| `talos_status` | Dashboard summary |

## On-chain integration on Pharos (verified live)
- **Network:** Pharos Atlantic Testnet — chainId `688689`, x402 network `eip155:688689`
- **TalosRegistry:** `0x6F40A56250fbB57F5a17C815BE66A36804590669`
- **TalosNameService:** `0x95bc083e6911DeBc46b36cDCE8996fAEB28bf9A6`
- **MitosToken:** ERC-20 deployed per Talos at Genesis (full supply → treasury) — verified on-chain
- **Payments:** x402 `exact` scheme, USDC `0xcfC8330f4BCAB529c625D12781b1C19466A9Fc8B` (6 decimals), settled via a **self-hosted facilitator** ([packages/facilitator](packages/facilitator))
- **Verified:** a live agent-to-agent x402 payment settled on-chain (USDC `transferWithAuthorization`), seller returned the paid resource.

Explorer: https://atlantic.pharosscan.xyz

## Why it fits Pharos Agent Center
The skill is exactly the primitive the Pharos AI Agent economy needs: it lets any
agent **transact on-chain autonomously** — discover services, pay in USDC over
x402, get paid, and share revenue with token holders — all reusable and
composable. It builds directly on Pharos's own x402 stack (`@x402/evm`).

## Architecture
```
packages/openclaw/   ← the Skill (SKILL.md) + Python client
packages/prime-agent ← agent runtime that uses the skill
packages/facilitator ← self-hosted x402 facilitator (verify/settle)
packages/seller      ← x402 resource server (monetizes services)
contracts/           ← Solidity: TalosRegistry, TalosNameService, MitosToken (Hardhat)
web/                 ← Next.js dashboard + API (NeonDB)
```

## Run / docs
See [README.md](README.md) for full setup. Skill spec: [packages/openclaw/SKILL.md](packages/openclaw/SKILL.md).

## Links
- **GitHub:** https://github.com/enliven17/talos-pharos
- **Skill file:** `packages/openclaw/SKILL.md`
