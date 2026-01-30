# PFT Test Client (TypeScript)

World‑class reference implementation for the Task Node SDK client:
- Hashes payloads before IPFS pinning
- Pins to IPFS via web3.storage
- Encodes pointer memo (protobuf‑style)
- Builds XRP transaction JSON
- Signs and submits via `xrpl`

## Install
```bash
cd ts
npm install
```

## Requirements
- Node.js 18+ (for `fetch`, `FormData`, and `Blob`)

## CLI
```bash
# Build
npm run build

# Optional: type-check tests
npm run build:test

# Save JWT
node dist/cli.js auth:set-token "<jwt>"

# List tasks
node dist/cli.js tasks:summary

# Submit evidence end-to-end
PFT_WALLET_SEED="<seed>" node dist/cli.js evidence:submit \
  --task-id "<task-id>" \
  --type url \
  --content "https://example.com"

# Configure request timeout (milliseconds)
PFT_TASKNODE_TIMEOUT_MS=45000 node dist/cli.js tasks:summary

# Respond to verification
PFT_WALLET_SEED="<seed>" node dist/cli.js verify:respond \
  --task-id "<task-id>" \
  --type text \
  --response "My verification response"
```

## Example
```ts
import { PFTClient } from "./src/client.js";
import fs from "fs";

const client = new PFTClient(process.env.PFT_WALLET_SEED!);
const payload = new Uint8Array(fs.readFileSync("payload.json"));
const { cid, txHash } = await client.pinAndSubmit(payload, process.env.WEB3_STORAGE_TOKEN!);

console.log({ cid, txHash });
```

## Notes
- Defaults point to testnet
- Destination address comes from Task Node pointer behavior
- Memo encoding is based on observed payloads and should be validated against canonical schema
