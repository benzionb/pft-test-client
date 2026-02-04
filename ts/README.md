# PFT CLI Client

A programmatic command-line interface for the [Post Fiat Task Node](https://tasknode.postfiat.org). Enables automated task discovery, acceptance, evidence submission, and verification handling.

> **For AI Agents:** See [CLAUDE.md](../CLAUDE.md) for comprehensive agent documentation.

## Quick Start (Beta Testers)

```bash
# Clone and build
git clone https://github.com/benzionb/pft-test-client.git
cd pft-test-client/ts
npm install && npm run build

# Interactive setup wizard (recommended)
npx pft-cli auth:setup
```

The setup wizard guides you through configuring your JWT token and wallet mnemonic. All credentials are stored locally in `~/.pft-tasknode/` and **never transmitted**.

## Features

- **Interactive Setup**: Guided credential configuration with optional encryption
- **Task Management**: List, accept, and track tasks programmatically
- **Chat Integration**: Request tasks via AI chat ("magic phrases")
- **Evidence Submission**: Upload evidence with IPFS pinning and XRPL signing
- **Verification Handling**: Respond to verification questions automatically
- **Transaction Signing**: Built-in XRPL signing via mnemonic or seed
- **Pending Recovery**: Resume failed submissions

## Requirements

- **Node.js 18+** (for `fetch`, `FormData`, `Blob` APIs)
- Post Fiat Task Node account with JWT token
- Wallet mnemonic (24 words) for transaction signing

## Manual Configuration

If you prefer not to use the setup wizard:

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PFT_TASKNODE_JWT` | Yes | JWT token from Task Node |
| `PFT_WALLET_MNEMONIC` | For signing | 24-word recovery phrase |
| `PFT_WALLET_SEED` | For signing | XRPL wallet seed (alternative to mnemonic) |
| `PFT_TASKNODE_URL` | No | API URL (default: `https://tasknode.postfiat.org`) |
| `PFT_TASKNODE_CONTEXT` | No | Default context text for chat messages |
| `PFT_TASKNODE_TIMEOUT_MS` | No | Request timeout in milliseconds (default: 30000) |

### Persistent Configuration

Credentials are stored in `~/.pft-tasknode/config.json` (with 600 permissions):

```bash
# Interactive setup (recommended)
npx pft-cli auth:setup

# Or save JWT manually
npx pft-cli auth:set-token "<jwt>"
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

## E2E Testing

The CLI includes a full end-to-end test harness that validates the complete task loop.

### Quick Start

```bash
# Set credentials
export PFT_TASKNODE_JWT="<your-jwt>"
export PFT_WALLET_MNEMONIC="<24-word-phrase>"

# Run the full E2E task loop (requests task, submits evidence, handles verification, waits for reward)
pft-cli loop:test --type personal
```

This single command runs the **complete task lifecycle** from request to reward, typically taking 5-6 minutes.

### What Success Looks Like

```
=== STARTING E2E TEST LOOP ===
Type: personal

[TaskLoop] Sending: "request a personal task: [E2E TEST - 1 PFT ONLY] Auto..."
[TaskLoop] Task proposed: abc12345-6789-... - "Echo Task ID for E2E Test"
[TaskLoop] Accepting task: abc12345-6789-...
[TaskLoop] Task accepted. Status: in_progress
[TaskLoop] Task ID: abc12345-6789-...
[TaskLoop] Verification type: text
[TaskLoop] Verification criteria: "Provide the task ID to confirm completion"
[TaskLoop] Uploading evidence (type: text)
[TaskLoop] Evidence uploaded. CID: bafkrei...
[TaskLoop] Signing transaction...
[TaskLoop] Transaction submitted: A1B2C3D4...
[TaskLoop] Evidence submitted successfully
[TaskLoop] Waiting for verification question...
[TaskLoop] [15s] verification_status: generating_question
[TaskLoop] [30s] verification_status: awaiting_response
[TaskLoop] Verification question: "Please confirm the task ID..."

*** AUTO-RESPONDING TO VERIFICATION ***
Question: Please confirm the task ID...
Original criteria: Provide the task ID to confirm completion

[TaskLoop] Responding to verification...
[TaskLoop] Saved pending (CID: bafkrei...)
[TaskLoop] Signing verification transaction...
[TaskLoop] Transaction submitted: E5F6G7H8...
[TaskLoop] Verification response submitted successfully
[TaskLoop] Watching for final status...
[TaskLoop] [15s] status: pending_verification
[TaskLoop] [30s] status: rewarded
[TaskLoop] Task completed: rewarded
[TaskLoop] Reward: 1 PFT (minimal)

=== E2E TEST COMPLETE ===
Status: rewarded
Reward: 1 PFT (minimal)
{
  "id": "abc12345-6789-...",
  "title": "Echo Task ID for E2E Test",
  "status": "rewarded",
  "pft": "1",
  "rewardTier": "minimal"
}
```

### What E2E Tests Validate

1. **Authentication** - JWT validation, account summary retrieval
2. **Task Request** - "Magic phrase" triggers `task_request_*` classification
3. **Task Acceptance** - Status changes to `in_progress`
4. **Evidence Submission** - Upload, XRPL signing, Task Node submission
5. **Verification** - Question polling, response submission
6. **Reward** - Final status polling until `rewarded` or `refused`

### Automated Loop Commands

```bash
# Run full automated test (minimal reward task)
pft-cli loop:test --type personal

# Run custom task loop with your own parameters
pft-cli loop:run \
  --type personal \
  --description "Build something" \
  --context "My context..." \
  --evidence "Here is my evidence" \
  --verification-response "Here is my verification response"

# Wait for verification question
pft-cli verify:wait <task-id> --timeout 300 --interval 15

# Check verification status
pft-cli verify:status <task-id>
```

### Timed E2E Test (Development)

For detailed step-by-step timing analysis:

```bash
npx tsx scripts/timed_e2e.ts
```

This outputs a breakdown showing how long each phase takes (useful for debugging/optimization).

### Magic Phrases

To trigger immediate task generation (bypassing discussion), use these patterns:

| Phrase | Classification |
|--------|----------------|
| `request a personal task: [description]` | `task_request_personal` |
| `request a network task: [description]` | `task_request_network` |
| `request an alpha task: [description]` | `task_request_alpha` |
| `generate a task for [description]` | `task_request_*` |
| `give me a task to [description]` | `task_request_*` |

### Troubleshooting

**"JWT missing" or "Invalid JWT token"**
- Get a fresh JWT from https://tasknode.postfiat.org (open DevTools → Network → find any API request → copy `Authorization: Bearer <jwt>`)
- Set via: `export PFT_TASKNODE_JWT="<jwt>"` or `pft-cli auth:set-token "<jwt>"`
- JWTs expire after ~24 hours

**"PFT_WALLET_SEED or PFT_WALLET_MNEMONIC is required"**
- For signing transactions, you need wallet credentials
- Get your mnemonic from the Post Fiat app (Settings → Export Seed)
- Set via: `export PFT_WALLET_MNEMONIC="word1 word2 ... word24"`

**"Got discussion instead of task"**
- Use explicit trigger phrase: `request a [type] task: [specific description]`
- Include pre-scoped description so ODV doesn't need clarification

**"Transaction failed"**
- XRPL transactions take ~4 seconds to finalize
- Check wallet balance (need drops for transaction fees)
- If you see `tesSUCCESS` in the error, the transaction actually succeeded (this was a bug that's now fixed)

**"Verification question never arrives"**
- Poll for up to 5 minutes (`pft-cli verify:wait <id> --timeout 300`)
- Check task status with `pft-cli tasks:get <id>`

**"Verification response not ready for submission"**
- This is a timing issue - wait a few seconds and retry
- The CLI handles this automatically in `loop:test`

**"Pending submission exists"**
- Resume: `pft-cli pending:resume --task-id <id> --type evidence`
- Clear: `pft-cli pending:clear --task-id <id> --type evidence`

**Task gets "refused" or low reward**
- Make sure your evidence directly addresses the verification criteria
- Include the task ID in responses when asked
- The `loop:test` command dynamically builds responses from the task proposal

## Architecture

```
ts/
├── src/
│   ├── cli.ts           # CLI entry point (commander.js)
│   ├── config.ts        # Configuration management
│   ├── tasknode_api.ts  # Task Node API client
│   ├── loop.ts          # TaskLoopRunner - high-level orchestrator
│   ├── polling.ts       # Polling utilities for async state waits
│   ├── client.ts        # High-level PFT client
│   ├── signer.ts        # XRPL transaction signer
│   ├── transaction.ts   # Transaction building
│   ├── pointer.ts       # Memo encoding (protobuf-style)
│   ├── pending.ts       # Pending submission recovery
│   ├── ipfs.ts          # IPFS pinning via web3.storage
│   ├── validation.ts    # Input validation
│   └── utils.ts         # Shared utilities
├── test/
│   ├── pointer.test.ts       # Unit tests
│   └── e2e_task_loop.test.ts # E2E integration tests
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

## Pointer Memo Encoding

Task submissions use XRPL Payment transactions with encoded memos. The memo format is protobuf-style binary encoding:

### Memo Structure

| Field | Type | Description |
|-------|------|-------------|
| MemoType | hex | `70662e707472` = "pf.ptr" (Post Fiat Pointer) |
| MemoFormat | hex | `7634` = "v4" (version) |
| MemoData | hex | Protobuf-encoded pointer data |

### MemoData Encoding (Protobuf-style)

```
Field 1 (string): CID - IPFS content identifier (e.g., "bafkrei...")
Field 2 (varint): Schema version (typically 1)
Field 3 (varint): Kind - 6 = TASK_SUBMISSION
Field 4 (varint): Flags (typically 1)
Field 8 (varint): Unknown/reserved (typically 1)
```

### Wire Format

Each field is encoded as:
- **Key**: `(field_number << 3) | wire_type` as varint
- **Value**: 
  - wire_type 0 (varint): value as varint
  - wire_type 2 (length-delimited): length as varint, then bytes

### Example

```typescript
import { encodePointerMemo } from "pft-test-client";

const memo = encodePointerMemo(
  "bafkreidwhi5ztzuqqnc3tu62tzqofhko5hnbhxfckmvboyrg7dz5sakgtu",
  "TASK_SUBMISSION",  // kind
  1,                  // schema
  1,                  // flags
  1                   // unknown8
);

// Result: Uint8Array that gets hex-encoded for MemoData
// 0a3b6261666b726569647768693574...
```

### Transaction Structure

```json
{
  "TransactionType": "Payment",
  "Account": "<your-wallet>",
  "Destination": "rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7",
  "Amount": "1",
  "Memos": [{
    "Memo": {
      "MemoType": "70662e707472",
      "MemoFormat": "7634",
      "MemoData": "<hex-encoded-pointer>"
    }
  }]
}
```

The destination address (`rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7`) is the Task Node's submission receiver.

## Changelog

### 2026-02-04: Reward Summary Fix

**Problem:** The individual task endpoint (`/api/tasks/{id}`) does not populate reward fields (`rewardSummary`, `rewardTier`, `rewardScore`, `txHash`). These fields are only available from the summary endpoint (`/api/tasks/summary`).

**Solution:** Added `getTaskRewardData(taskId)` method to `TaskNodeApi` that fetches from the summary endpoint and extracts reward data for a specific task.

**Changes:**
- `src/tasknode_api.ts`: Added `TaskRewardData` type and `getTaskRewardData()` method
- `src/cli.ts`: Updated `tasks:watch` to display tier, score, and reward summary after task completion
- `src/loop.ts`: Updated `watchUntilComplete()` to fetch full reward data from summary endpoint
- `src/index.ts`: Exported `TaskRewardData` type

**Usage:**
```typescript
const api = new TaskNodeApi(jwt);
const rewardData = await api.getTaskRewardData("task-id");
// Returns: { id, title, pft, rewardTier, rewardScore, rewardSummary, txHash, status }
```

## Notes

- Default endpoints point to Post Fiat testnet
- Transaction signing requires either `PFT_WALLET_SEED` or `PFT_WALLET_MNEMONIC`

## License

MIT License - see [LICENSE](./LICENSE)
