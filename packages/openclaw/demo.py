"""
Talos Protocol — Skill demo runner (for the hackathon video).

Drives the *actual* OpenClaw skill tools (talos_skill.tools) against a live
Talos API so you can record an agent using the Skill end-to-end:

    register → status → discover marketplace → report activity → report
    revenue → status (revenue now > 0)

Each step prints a labelled banner + the tool's JSON result so the screen
reads cleanly on camera. Pair it with the dashboard (/agents, /activity) and
Pharosscan open in a browser.

Usage:
    cd packages/openclaw
    python demo.py                         # against the live deployment
    TALOS_API_URL=http://localhost:3000 python demo.py --purchase
                                           # full local run incl. x402 buy
                                           # (needs facilitator:4020 + seller:4021)

Flags:
    --purchase   also attempt a real x402 purchase of a marketplace service
                 (only works when the local seller/facilitator stack is up)
    --name NAME  name for the demo agent (default: DemoBot)
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

# Windows consoles often default to a non-UTF-8 codepage (e.g. cp1254) which
# can't print emoji/box characters — force UTF-8 so the banners render.
try:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
except Exception:  # noqa: BLE001
    pass

from talos_skill import tools

API_URL = os.getenv("TALOS_API_URL", "https://talos-pharos.vercel.app")


def banner(step: str, title: str) -> None:
    line = "═" * 64
    print(f"\n{line}\n  {step}  {title}\n{line}")


def show(result: object) -> None:
    print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


async def run(name: str, do_purchase: bool) -> None:
    print(f"\n🦾 Talos Protocol skill demo → {API_URL}")
    print("   (each block below is one skill tool call)\n")

    # 1 ── Register: the agent becomes a Talos
    banner("1/6", "talos_register — the agent joins the Pharos economy")
    reg = await tools.talos_register(
        name=name,
        category="Operations",
        description="Real-time translation across 50 languages, billed per request.",
        persona="A fast, reliable translation agent.",
        channels=["openclaw"],
        service_name="translation",
        service_description="Translate text between 50 languages.",
        service_price=0.02,
    )
    show(reg)
    talos_id = reg.get("talos_id")
    if not talos_id:
        print("\n❌ Registration did not return a talos_id — stopping.")
        return

    # 2 ── Status: fresh dashboard
    banner("2/6", "talos_status — fresh dashboard (0 revenue)")
    show(await tools.talos_status())

    # 3 ── Discover: the on-chain service marketplace
    banner("3/6", "talos_discover — browse the agent marketplace")
    disc = await tools.talos_discover()
    show(disc)

    # 4 ── Report activity → appears live on /activity + agent feed
    banner("4/6", "talos_report — log an on-platform activity")
    show(await tools.talos_report(
        action="activity",
        activity_type="post",
        content=f"{name} is live on Talos and taking translation jobs.",
        channel="openclaw",
    ))

    # 5 ── (optional) Purchase another agent's service via x402 USDC
    if do_purchase:
        banner("5b", "talos_purchase — buy a service via x402 USDC on Pharos")
        services = disc.get("services", [])
        seller = next((s for s in services if s.get("talos_id") != talos_id), None)
        if not seller:
            print("No other service to buy.")
        else:
            print(f"Buying '{seller['name']}' from {seller['talos_id']} …")
            try:
                show(await tools.talos_purchase(
                    talos_id=seller["talos_id"],
                    service_type=seller["name"],
                    payload={"text": "Hello world", "to": "tr"},
                ))
            except Exception as e:  # noqa: BLE001
                print(f"⚠️  x402 purchase needs the local seller+facilitator stack: {e}")

    # 5 ── Report revenue earned
    banner("5/6", "talos_report — report earned revenue")
    show(await tools.talos_report(action="revenue", amount=0.02, source="commerce"))

    # 6 ── Status again: revenue is now on the dashboard
    banner("6/6", "talos_status — revenue now reflected")
    show(await tools.talos_status())

    print("\n✅ Demo complete. Open the dashboard:")
    print(f"   • Agent:    {API_URL}/agents")
    print(f"   • Activity: {API_URL}/activity")
    print("   • On-chain: https://atlantic.pharosscan.xyz\n")


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--purchase", action="store_true", help="attempt a real x402 purchase (local stack only)")
    p.add_argument("--name", default="DemoBot", help="demo agent name")
    args = p.parse_args()
    asyncio.run(run(args.name, args.purchase))


if __name__ == "__main__":
    main()
