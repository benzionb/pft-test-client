# PFT CLI Client

A programmatic command-line interface for interacting with the [Post Fiat Task Node](https://tasknode.postfiat.org). This CLI enables automated task discovery, acceptance, evidence submission, and verification response handling.

## Features

- **Authentication**: JWT-based authentication with the Task Node
- **Task Management**: List, accept, and track tasks programmatically
- **Chat Integration**: Request tasks and receive proposals via the AI chat interface
- **Evidence Submission**: Upload evidence with IPFS pinning and on-chain transaction signing
- **Verification Handling**: Respond to verification requests with automatic transaction submission
- **Transaction Signing**: Built-in XRPL transaction signing via wallet seed or mnemonic

## Requirements

- **Node.js 18+** (required for `fetch`, `FormData`, and `Blob` APIs)
- A Post Fiat Task Node account with JWT token
- (For signing) Wallet seed or 24-word mnemonic

## Installation

```bash
# Clone the repository
git clone https://github.com/benzionb/pft-test-client.git
cd pft-test-client/ts

# Install dependencies
npm install

# Build
npm run build
```

### Global Installation (Optional)

```bash
npm link
# Now you can use `pft-cli` from anywhere
```

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PFT_TASKNODE_JWT` | Yes | JWT token from Task Node authentication |
| `PFT_WALLET_SEED` | For signing | XRPL wallet seed (starts with `s`) |
| `PFT_WALLET_MNEMONIC` | For signing | 24-word recovery phrase (alternative to seed) |
| `PFT_TASKNODE_URL` | No | Task Node API URL (default: `https://tasknode.postfiat.org`) |
| `PFT_TASKNODE_CONTEXT` | No | Default context text for chat messages |
| `PFT_TASKNODE_TIMEOUT_MS` | No | Request timeout in milliseconds (default: 30000) |

### Persistent Configuration

Save settings to `~/.pft-tasknode/config.json`:

```bash
# Save JWT token
pft-cli auth:set-token "<your-jwt-token>"
```

## CLI Commands

### Authentication

```bash
# Save JWT token to config
pft-cli auth:set-token "<jwt>"

# Check authentication status and account summary
pft-cli auth:status
```

### Task Management

```bash
# Get task summary with counts
pft-cli tasks:summary

# List tasks by status (outstanding, pending, rewarded, refused)
pft-cli tasks:list --status outstanding

# Get full task details
pft-cli tasks:get <task-id>

# Accept a pending task
pft-cli tasks:accept <task-id>

# Watch a task until completion (polls every 15s by default)
pft-cli tasks:watch <task-id> --interval 30
```

### Chat & Task Requests

```bash
# Send a chat message
pft-cli chat:send --content "Hello" --context "My context..."

# Request a task and wait for the proposal
pft-cli chat:send --content "request a network task: Build something" --context "..." --wait

# Check for pending task proposals
pft-cli chat:pending-task

# List recent chat messages
pft-cli chat:list --limit 10
```

### Evidence Submission

```bash
# Submit URL evidence
PFT_WALLET_SEED="<seed>" pft-cli evidence:submit \
  --task-id "<task-id>" \
  --type url \
  --content "https://github.com/user/repo"

# Submit text evidence
PFT_WALLET_SEED="<seed>" pft-cli evidence:submit \
  --task-id "<task-id>" \
  --type text \
  --content "My evidence text..."

# Submit file evidence
PFT_WALLET_SEED="<seed>" pft-cli evidence:submit \
  --task-id "<task-id>" \
  --type file \
  --file "./screenshot.png"
```

### Verification Response

```bash
# Respond to a verification request
PFT_WALLET_SEED="<seed>" pft-cli verify:respond \
  --task-id "<task-id>" \
  --type text \
  --response "Here is the specific code you requested..."
```

## Programmatic Usage

```typescript
import { PFTClient, TaskNodeApi, TransactionSigner } from "pft-test-client";

// Simple client for IPFS pinning and transaction submission
const client = new PFTClient(process.env.PFT_WALLET_SEED!);
const payload = new Uint8Array(Buffer.from(JSON.stringify({ data: "example" })));
const { cid, txHash } = await client.pinAndSubmit(payload, process.env.WEB3_STORAGE_TOKEN!);

// Full Task Node API client
const api = new TaskNodeApi(process.env.PFT_TASKNODE_JWT!);
const summary = await api.getTasksSummary();
const task = await api.getTask("task-id");
await api.acceptTask("task-id");

// Transaction signing
const signer = new TransactionSigner({ 
  mnemonic: process.env.PFT_WALLET_MNEMONIC 
});
const txHash = await signer.signAndSubmit(txJson);
```

## Task Workflow

Complete workflow for programmatic task completion:

```bash
# 1. Request a task
pft-cli chat:send --content "request a network task: ..." --context "..." --wait
# Output shows task_id if proposal detected

# 2. Accept the task
pft-cli tasks:accept <task-id>

# 3. Do the work...

# 4. Submit evidence
PFT_WALLET_SEED="..." pft-cli evidence:submit --task-id <id> --type url --content "https://..."

# 5. Handle verification (if requested)
PFT_WALLET_SEED="..." pft-cli verify:respond --task-id <id> --type text --response "..."

# 6. Wait for reward
pft-cli tasks:watch <task-id>
```

## Development

```bash
# Build
npm run build

# Type-check including tests
npm run build:test

# Run tests
npm test
```

## Architecture

```
ts/
├── src/
│   ├── cli.ts           # CLI entry point (commander.js)
│   ├── config.ts        # Configuration management
│   ├── tasknode_api.ts  # Task Node API client
│   ├── client.ts        # High-level PFT client
│   ├── signer.ts        # XRPL transaction signer
│   ├── transaction.ts   # Transaction building
│   ├── pointer.ts       # Memo encoding (protobuf-style)
│   ├── ipfs.ts          # IPFS pinning via web3.storage
│   ├── validation.ts    # Input validation
│   └── utils.ts         # Shared utilities
├── test/
│   └── pointer.test.ts  # Unit tests
└── dist/                # Compiled output
```

## Pending Submissions Recovery

If a transaction fails after evidence upload (e.g., network error during signing), the CLI saves the pending submission locally:

```bash
# List stuck submissions
pft-cli pending:list

# Resume a failed evidence submission
pft-cli pending:resume --task-id <id> --type evidence

# Resume a failed verification response
pft-cli pending:resume --task-id <id> --type verification_response

# Clear a stuck submission without completing
pft-cli pending:clear --task-id <id> --type evidence
```

Pending submissions are stored in `~/.pft-tasknode/pending/`.

## API Debugging with mitmproxy

To capture and analyze Task Node API traffic for debugging or reverse engineering:

### Setup

```bash
# Install mitmproxy (one-time)
pip3 install mitmproxy

# Start the proxy (saves traffic to flow file)
mitmdump --listen-port 8080 \
  -w ~/captures/session_$(date +%Y%m%d_%H%M%S).flow \
  > /tmp/mitmdump.log 2>&1 &

# Launch Chrome with proxy configured
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --proxy-server="localhost:8080" \
  --ignore-certificate-errors \
  --user-data-dir="/tmp/chrome-proxy-profile" \
  "https://tasknode.postfiat.org"
```

### Monitor Traffic

```bash
# Watch live traffic
tail -f /tmp/mitmdump.log | grep tasknode

# Export to HAR for analysis
mitmdump -n -r ~/captures/session_*.flow --set hardump=./export.har
```

### Analyze HAR File

```python
import json

with open('export.har') as f:
    har = json.load(f)

for entry in har['log']['entries']:
    req = entry['request']
    if 'tasknode' in req['url']:
        print(f"{req['method']} {req['url']}")
        if req.get('postData'):
            print(f"  Body: {req['postData'].get('text', '')[:200]}")
```

This method captures all HTTP/HTTPS traffic including request/response bodies, headers, and WebSocket messages.

## Notes

- Default endpoints point to Post Fiat testnet
- Memo encoding follows observed protocol patterns
- Transaction signing requires either `PFT_WALLET_SEED` or `PFT_WALLET_MNEMONIC`

## License

MIT License - see [LICENSE](./LICENSE)
