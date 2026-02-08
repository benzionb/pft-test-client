# Post Fiat Task Node SDK (Client Core)

This package provides core building blocks for:
- IPFS pinning
- Pointer memo encoding
- XRP transaction construction
- Transaction signing and submission

## What is implemented
- Pointer memo encoding based on **observed** Task Node memo payloads
- IPFS pinning via local IPFS HTTP API or web3.storage
- XRP transaction builder with memo payload
- Signing and submission via xrpl-py

## What is *not* fully verified
- The pointer memo schema is derived from observed memos and may change.
- Governance message schemas are not part of this SDK.
- No official SDK compatibility guarantees (reverse engineered).

## Defaults (explicit)
- XRPL RPC: wss://ws.testnet.postfiat.org
- Destination: rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7
- Amount: 1 drop
- IPFS endpoint: http://127.0.0.1:5001

Override these defaults in your own integration.

## Quick usage
```python
from sdk import PFTClient

client = PFTClient(wallet_seed="YOUR_SEED")
cid, tx = await client.pin_and_build_pointer(b"hello world")
tx_hash = client.sign_and_submit(tx)
```

## Safety Notes
- Wallet seed is handled in memory. Use secure key storage in production.
- Do not log API tokens or wallet seeds.
- Validate destination address and network before submitting.

## Testing
The included tests are self-contained and do not require network access.
