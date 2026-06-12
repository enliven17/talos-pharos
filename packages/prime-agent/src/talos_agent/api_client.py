"""Web API client — all communication between Local Agent and Talos Web."""

from __future__ import annotations

from typing import Any

import httpx

from talos_agent.config import Settings


class TalosAPIClient:
    def __init__(self, settings: Settings):
        self._base = settings.talos_api_url.rstrip("/")
        self._talos_id = settings.talos_id
        self._client = httpx.AsyncClient(
            base_url=self._base,
            headers={
                "Authorization": f"Bearer {settings.talos_api_key}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

    # ── Talos Config ──────────────────────────────────────

    async def get_talos(self, talos_id: str) -> dict | None:
        r = await self._client.get(f"/api/talos/{talos_id}")
        if r.status_code == 200:
            return r.json()
        return None

    async def get_talos_me(self) -> dict | None:
        """Resolve Talos from API key — no Talos ID needed."""
        r = await self._client.get("/api/talos/me")
        if r.status_code == 200:
            return r.json()
        return None

    # ── Activity Reporting ─────────────────────────────────

    async def report_activity(
        self, talos_id: str, *, type_: str, content: str, channel: str
    ) -> dict | None:
        r = await self._client.post(
            f"/api/talos/{talos_id}/activity",
            json={"type": type_, "content": content, "channel": channel},
        )
        if r.status_code in (200, 201):
            return r.json()
        return None

    # ── Status ─────────────────────────────────────────────

    async def update_status(self, talos_id: str, *, online: bool) -> None:
        await self._client.patch(
            f"/api/talos/{talos_id}/status",
            json={"agentOnline": online},
        )

    # ── Revenue ────────────────────────────────────────────

    async def report_revenue(
        self, talos_id: str, *, amount: float, source: str, tx_hash: str | None = None
    ) -> dict | None:
        r = await self._client.post(
            f"/api/talos/{talos_id}/revenue",
            json={"amount": amount, "currency": "USDC", "source": source, "txHash": tx_hash},
        )
        if r.status_code in (200, 201):
            return r.json()
        return None

    # ── Approvals ──────────────────────────────────────────

    async def create_approval(
        self,
        talos_id: str,
        *,
        type_: str,
        title: str,
        description: str | None = None,
        amount: float | None = None,
    ) -> dict | None:
        r = await self._client.post(
            f"/api/talos/{talos_id}/approvals",
            json={"type": type_, "title": title, "description": description, "amount": amount},
        )
        if r.status_code in (200, 201):
            return r.json()
        return None

    async def get_approvals(self, talos_id: str, status: str | None = None) -> list[dict]:
        params: dict[str, Any] = {}
        if status:
            params["status"] = status
        r = await self._client.get(f"/api/talos/{talos_id}/approvals", params=params)
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else data.get("approvals", [])
        return []

    async def get_approval(self, talos_id: str, approval_id: str) -> dict | None:
        r = await self._client.get(f"/api/talos/{talos_id}/approvals/{approval_id}")
        if r.status_code == 200:
            return r.json()
        return None

    # ── Agent Wallet (EVM / Pharos) ───────────────────────────

    async def get_agent_wallet(self) -> dict | None:
        """Fetch agent wallet info (walletId, 0x address) from Web."""
        r = await self._client.get(f"/api/talos/{self._talos_id}/wallet")
        if r.status_code == 200:
            return r.json()
        return None

    async def create_agent_wallet(self) -> dict | None:
        """Create an EVM/Pharos wallet for this Talos if one doesn't exist."""
        r = await self._client.post(f"/api/talos/{self._talos_id}/wallet")
        if r.status_code in (200, 201):
            return r.json()
        return None

    # ── x402 Buyer Flow (server-side handshake) ────────────

    async def purchase(
        self,
        *,
        url: str,
        method: str = "GET",
        body: dict | None = None,
        max_amount: float | None = None,
        seller_talos_id: str | None = None,
        service_type: str | None = None,
    ) -> dict:
        """Run the full x402 buyer flow server-side.

        POSTs to /api/talos/{id}/purchase. The Web server performs the
        complete x402 handshake (402 → sign with the agent's EVM key →
        settle on Pharos) and returns ``{status, httpStatus, data, receipt}``
        where ``receipt`` carries the settled tx info (e.g. txHash).

        This replaces the legacy two-step sign + submit_commerce flow.
        """
        if not self._talos_id:
            return {"error": "talos_id not set"}
        payload: dict[str, Any] = {"url": url, "method": method}
        if body is not None:
            payload["body"] = body
        if max_amount is not None:
            payload["maxAmount"] = max_amount
        if seller_talos_id is not None:
            payload["sellerTalosId"] = seller_talos_id
        if service_type:
            payload["serviceType"] = service_type
        r = await self._client.post(
            f"/api/talos/{self._talos_id}/purchase", json=payload
        )
        if r.status_code in (200, 201):
            return r.json()
        try:
            return r.json()
        except Exception:
            return {"error": f"Purchase failed with status {r.status_code}"}

    # ── Legacy / Deprecated ────────────────────────────────

    async def sign_payment(
        self,
        *,
        payee: str,
        amount: int,
        asset_code: str = "USDC",
        asset_issuer: str | None = None,
    ) -> dict | None:
        """DEPRECATED. The Stellar /sign endpoint now returns HTTP 410.

        The x402 buyer flow is performed server-side via :meth:`purchase`.
        Kept only for backward compatibility; do not call.
        """
        return {"error": "sign_payment is deprecated; use purchase() (server-side x402)"}

    # ── Commerce / x402 ────────────────────────────────────

    async def get_service(self, talos_id: str, service_type: str | None = None) -> httpx.Response:
        """GET service endpoint (provider metadata / paid-service entrypoint)."""
        params = {}
        if service_type:
            params["type"] = service_type
        return await self._client.get(f"/api/talos/{talos_id}/service", params=params)

    async def submit_commerce(
        self,
        talos_id: str,
        *,
        tx_hash: str,
        payload: dict | None = None,
    ) -> dict | None:
        """Create a commerce job from a SETTLED payment proof.

        POSTs ``{txHash, payload}`` to /api/talos/{id}/service. The
        ``txHash`` comes from the receipt returned by :meth:`purchase`.
        (The old X-PAYMENT header flow has been removed — payment is now
        settled server-side before this call.)
        """
        r = await self._client.post(
            f"/api/talos/{talos_id}/service",
            json={"txHash": tx_hash, "payload": payload},
        )
        if r.status_code in (200, 201):
            return r.json()
        try:
            return r.json()
        except Exception:
            return {"error": f"Commerce submission failed with status {r.status_code}"}

    async def discover_services(
        self, category: str | None = None, target: str | None = None
    ) -> list[dict]:
        params: dict[str, Any] = {"self": self._talos_id}
        if category:
            params["category"] = category
        if target:
            params["target"] = target
        r = await self._client.get("/api/services", params=params)
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else data.get("data", [])
        return []

    async def register_service(
        self,
        talos_id: str,
        *,
        service_name: str,
        description: str,
        price: float,
        wallet_address: str | None = None,
    ) -> dict | None:
        """Register or update this Talos's x402 service on the marketplace."""
        payload: dict[str, Any] = {
            "serviceName": service_name,
            "description": description,
            "price": price,
        }
        if wallet_address:
            payload["walletAddress"] = wallet_address
        r = await self._client.put(f"/api/talos/{talos_id}/service", json=payload)
        if r.status_code in (200, 201):
            return r.json()
        return None

    # ── Transfers (EVM / Pharos) ───────────────────────────

    async def request_transfer(
        self,
        *,
        to_account: str,
        amount: float,
        currency: str = "USDC",
        token_id: str | None = None,
    ) -> dict | None:
        """Execute an ERC-20 USDC (or other token) transfer via Web API."""
        payload: dict[str, Any] = {
            "to": to_account,
            "amount": amount,
            "currency": currency,
        }
        if token_id:
            payload["tokenId"] = token_id
        r = await self._client.post(
            f"/api/talos/{self._talos_id}/transfer", json=payload
        )
        if r.status_code in (200, 201):
            return r.json()
        try:
            return r.json()
        except Exception:
            return {"error": f"Transfer failed with status {r.status_code}"}

    # ── Jobs ───────────────────────────────────────────────

    async def get_pending_jobs(self) -> list[dict]:
        r = await self._client.get("/api/jobs/pending")
        if r.status_code == 200:
            data = r.json()
            return data if isinstance(data, list) else data.get("jobs", [])
        return []

    async def submit_job_result(self, job_id: str, result: dict) -> dict | None:
        r = await self._client.post(f"/api/jobs/{job_id}/result", json={"result": result})
        if r.status_code in (200, 201):
            return r.json()
        return None

    async def get_job_result(self, job_id: str) -> dict | None:
        r = await self._client.get(f"/api/jobs/{job_id}/result")
        if r.status_code == 200:
            return r.json()
        return None

    # ── Playbooks ──────────────────────────────────────────

    async def publish_playbook(
        self,
        *,
        title: str,
        category: str,
        channel: str,
        description: str,
        price: float,
        tags: list[str] | None = None,
        content: dict | None = None,
        impressions: int = 0,
        engagement_rate: float = 0,
        conversions: int = 0,
        period_days: int = 30,
    ) -> dict | None:
        """Publish a Playbook to the marketplace."""
        r = await self._client.post(
            "/api/playbooks",
            json={
                "title": title,
                "category": category,
                "channel": channel,
                "description": description,
                "price": price,
                "tags": tags or [],
                "content": content,
                "impressions": impressions,
                "engagementRate": engagement_rate,
                "conversions": conversions,
                "periodDays": period_days,
            },
        )
        if r.status_code in (200, 201):
            return r.json()
        return None

    # ── Lifecycle ──────────────────────────────────────────

    async def close(self) -> None:
        await self._client.aclose()
