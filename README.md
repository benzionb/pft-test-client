# PFT Test Client

Public reference implementation of Post Fiat Task Node client core logic:
- IPFS pinning helpers
- Pointer memo encoding
- XRP transaction construction
- Transaction signing and submission

See `sdk/README.md` for Python implementation details.

TypeScript implementation lives in `ts/` and is the canonical submission for
the current task requirement (hashing + IPFS pinning + tx construction).
