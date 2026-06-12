"""EVM / Pharos operations — delegates to Web API and reads chain via JSON-RPC.

The Prime Agent never holds private keys. Read operations (native PHRS
balance) query the Pharos RPC directly via ``eth_getBalance``. Write
operations (token transfers) are forwarded to the Talos Web server, which
holds the agent's key and signs server-side.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from rich.console import Console

# Pharos Atlantic Testnet RPC (native gas token: PHRS)
_RPC_URL = os.getenv("PHAROS_RPC_URL", "https://atlantic.dplabs-internal.com")

# PHRS native token uses 18 decimals (EVM standard for native gas).
_WEI = 10**18

console = Console()


class EvmKit:
    """Proxy for Pharos (EVM) operations via Talos Web API + JSON-RPC.

    Read operations use the public Pharos RPC (no key needed).
    Write operations are forwarded to Web, which handles signing.
    """

    def __init__(self, api_client: Any):
        self._api = api_client
        self._initialized = False

    async def initialize(self) -> None:
        if self._initialized:
            return
        self._initialized = True
        console.print("[green]Pharos proxy ready (via Web API + JSON-RPC).[/green]")

    @property
    def available(self) -> bool:
        return self._initialized

    async def _rpc_call(self, method: str, params: list[Any]) -> Any:
        """Make a JSON-RPC call to the Pharos node."""
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                _RPC_URL,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            )
            if r.status_code == 200:
                data = r.json()
                if "result" in data:
                    return data["result"]
                return {"error": data.get("error", "RPC call failed")}
            return {"error": f"RPC HTTP {r.status_code}"}

    async def get_balance(self, account_id: str = "") -> dict[str, Any]:
        """Query native PHRS balance via eth_getBalance (public RPC)."""
        try:
            talos = await self._api.get_talos(self._api._talos_id)
            acct = account_id or (
                (talos.get("walletAddress") or talos.get("agentAddress", ""))
                if talos
                else ""
            )
            if not acct:
                return {"error": "No EVM address configured"}
            result = await self._rpc_call("eth_getBalance", [acct, "latest"])
            if isinstance(result, dict) and "error" in result:
                return {"error": f"RPC query failed: {result['error']}"}
            # result is a hex-encoded wei string, e.g. "0x1bc16d674ec80000"
            wei = int(result, 16)
            return {"balance_phrs": wei / _WEI, "wei": wei, "account": acct}
        except Exception as e:
            return {"error": f"Balance query failed: {e}"}

    async def get_token_balance(self, account_id: str, token_id: str) -> dict[str, Any]:
        """Query an ERC-20 token balance for an account.

        Delegated to Web, which knows token decimals/addresses. Read path
        for arbitrary ERC-20s is server-side to avoid hardcoding ABIs here.
        """
        try:
            wallet = await self._api.get_agent_wallet()
            balances = (wallet or {}).get("balances") if wallet else None
            if isinstance(balances, dict) and token_id in balances:
                return {
                    "balance": float(balances[token_id]),
                    "token_id": token_id,
                    "account": account_id,
                }
            return {"balance": 0, "token_id": token_id, "account": account_id}
        except Exception as e:
            return {"error": f"Token balance query failed: {e}"}

    async def transfer_native(self, to_account: str, amount: float) -> dict[str, Any]:
        """Request a native PHRS transfer via Web API (Web handles signing)."""
        try:
            result = await self._api.request_transfer(
                to_account=to_account, amount=amount, currency="PHRS"
            )
            if result and "error" not in result:
                return {"status": "submitted", "to": to_account, "amount": amount}
            return result or {"error": "Transfer request failed"}
        except Exception as e:
            return {"error": f"Transfer failed: {e}"}
