"""DEPRECATED — legacy Stellar x402 client-driven signer.

This module previously asked the Web server to sign a Stellar x402 payment
authorization (the agent assembled an X-PAYMENT header and POSTed it back).

On Pharos (EVM) the entire x402 buyer handshake (402 → sign → settle) is
performed SERVER-SIDE via ``POST /api/talos/{id}/purchase`` and exposed by
``TalosAPIClient.purchase``. The agent never assembles payment headers and
never holds keys.

Nothing imports ``X402Signer`` anymore. The class is retained only as a
guard so any stray import fails loudly instead of silently signing.
"""

from __future__ import annotations

from typing import Any

_DEPRECATION = (
    "X402Signer is deprecated. The x402 buyer flow is now performed "
    "server-side via TalosAPIClient.purchase() (POST /api/talos/{id}/purchase)."
)


class X402Signer:
    """Deprecated. Use ``TalosAPIClient.purchase`` instead."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError(_DEPRECATION)
