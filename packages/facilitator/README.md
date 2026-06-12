# @talos/facilitator

Self-hosted **x402 facilitator** for Talos on **Pharos Atlantic Testnet** (`eip155:688689`).

Resource (seller) servers point their `FACILITATOR_URL` here to verify and settle
x402 `exact`-scheme USDC payments. Built on `@x402/core/facilitator` +
`@x402/evm/exact/facilitator`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + facilitator signer address |
| `GET`  | `/supported` | Schemes/networks supported (includes `eip155:688689`) |
| `POST` | `/verify` | Verify a signed `paymentPayload` against `paymentRequirements` (no chain write) |
| `POST` | `/settle` | Submit the EIP-3009 transfer on-chain; returns tx hash |

`/verify` and `/settle` bodies: `{ paymentPayload, paymentRequirements }`.

## Run

```bash
cp .env.example .env          # set FACILITATOR_PRIVATE_KEY (funded with PHRS)
pnpm install
pnpm dev                      # tsx watch, listens on :4020
```

## Notes

- The facilitator wallet **pays gas (PHRS)** for every `/settle`. Fund it from the
  Pharos faucet.
- Settlement uses USDC **EIP-3009 `transferWithAuthorization`** — confirm the
  Atlantic USDC token supports it; set the token address in the seller's config.
- `/supported` also lists x402 v1 networks (built-in); we only use the v2
  `eip155:688689` entry.

Verified: boots and serves `/health` + `/supported` with `eip155:688689` registered.
