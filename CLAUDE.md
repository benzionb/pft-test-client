# PFT Test Client - Agent Context

A TypeScript CLI for programmatic interaction with the [Post Fiat Task Node](https://tasknode.postfiat.org). This enables AI agents to discover, accept, complete, and get rewarded for tasks.

## Quick Setup (For Agents)

Run these commands in order:

```bash
cd ts
npm install
npm run build
```

Then guide the user through credential setup (see below).

## Getting Credentials

### 1. JWT Token (Required)

The JWT authenticates with the Task Node API. To obtain:

1. User opens https://tasknode.postfiat.org in browser
2. User logs in with their Post Fiat account
3. User opens DevTools (F12) → Network tab
4. User clicks any action on the page to trigger an API request
5. User finds a request to `tasknode.postfiat.org` and copies the `Authorization: Bearer <jwt>` header value

Save the JWT:
```bash
npx pft-cli auth:set-token "<jwt>"
```

Or set environment variable:
```bash
export PFT_TASKNODE_JWT="<jwt>"
```

**Note:** JWTs expire after ~24 hours. User will need to refresh periodically.

### 2. Wallet Mnemonic (Required for Transactions)

The mnemonic signs XRPL transactions for evidence submission and verification responses.

To obtain:
1. User opens the Post Fiat mobile app
2. User goes to Settings → Export Seed
3. User copies the 24-word recovery phrase

Set environment variable:
```bash
export PFT_WALLET_MNEMONIC="word1 word2 word3 ... word24"
```

**Security:** Never commit or log the mnemonic. The CLI reads it only from environment variables.

## Verify Setup

```bash
npx pft-cli auth:status
```

Expected output includes:
- `authenticated: true`
- Account address (starts with `r`)
- PFT balance
- Task counts

If you see "JWT expired or invalid", guide user to get a fresh token.

## Interactive Setup Wizard

For guided setup with prompts:

```bash
npm run setup
```

This walks through npm install, build, and credential configuration.

## Repository Structure

```
pft-test-client/
├── CLAUDE.md          # This file (agent context)
├── ts/                # TypeScript CLI source
│   ├── src/
│   │   ├── cli.ts           # CLI entry point (all commands)
│   │   ├── tasknode_api.ts  # Task Node API client
│   │   ├── config.ts        # Configuration management
│   │   ├── loop.ts          # TaskLoopRunner (high-level orchestrator)
│   │   ├── signer.ts        # XRPL transaction signing
│   │   └── ...
│   ├── scripts/
│   │   └── setup.ts         # Interactive setup wizard
│   ├── package.json
│   └── dist/                # Compiled output
└── docs/
    └── TASK_LOOP_PROTOCOL.md  # Detailed protocol documentation
```

## Common CLI Commands

### Authentication
| Command | Description |
|---------|-------------|
| `npx pft-cli auth:status` | Check auth status and account summary |
| `npx pft-cli auth:set-token "<jwt>"` | Save JWT to config |

### Task Management
| Command | Description |
|---------|-------------|
| `npx pft-cli tasks:summary` | Get task counts by status |
| `npx pft-cli tasks:list --status outstanding` | List tasks needing work |
| `npx pft-cli tasks:list --status pending` | List tasks awaiting acceptance |
| `npx pft-cli tasks:get <id>` | Get full task details |
| `npx pft-cli tasks:accept <id>` | Accept a proposed task |
| `npx pft-cli tasks:watch <id>` | Poll until task completes |

### Chat & Task Requests
| Command | Description |
|---------|-------------|
| `npx pft-cli chat:send --content "message" --context "..."` | Send chat message |
| `npx pft-cli chat:send --content "request a network task: Build X" --context "..." --wait` | Request task and wait for proposal |
| `npx pft-cli chat:pending-task` | Check for pending task proposals |

### Evidence & Verification
| Command | Description |
|---------|-------------|
| `npx pft-cli evidence:submit --task-id <id> --type url --content "https://..."` | Submit URL evidence |
| `npx pft-cli evidence:submit --task-id <id> --type text --content "..."` | Submit text evidence |
| `npx pft-cli evidence:submit --task-id <id> --type file --file ./path` | Submit file evidence |
| `npx pft-cli verify:status <id>` | Check verification status |
| `npx pft-cli verify:wait <id>` | Wait for verification question |
| `npx pft-cli verify:respond --task-id <id> --type text --response "..."` | Respond to verification |

### Automated Testing
| Command | Description |
|---------|-------------|
| `npx pft-cli loop:test --type personal` | Run full E2E task loop (5-6 min) |

## Task Workflow

Complete lifecycle for a task:

```bash
# 1. Request a task
npx pft-cli chat:send \
  --content "request a network task: Build a feature" \
  --context "I am an AI agent..." \
  --wait

# 2. Accept the proposed task
npx pft-cli tasks:accept <task-id>

# 3. Do the work...

# 4. Submit evidence
npx pft-cli evidence:submit \
  --task-id <task-id> \
  --type url \
  --content "https://github.com/user/repo/commit/abc123"

# 5. Wait for and respond to verification question
npx pft-cli verify:wait <task-id>
npx pft-cli verify:respond \
  --task-id <task-id> \
  --type text \
  --response "The answer to your question is..."

# 6. Watch for reward
npx pft-cli tasks:watch <task-id>
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PFT_TASKNODE_JWT` | Yes | JWT token from Task Node |
| `PFT_WALLET_MNEMONIC` | For signing | 24-word recovery phrase |
| `PFT_WALLET_SEED` | For signing | Alternative: XRPL seed (starts with `s`) |
| `PFT_TASKNODE_URL` | No | API URL (default: https://tasknode.postfiat.org) |
| `PFT_TASKNODE_CONTEXT` | No | Default context for chat messages |

## Troubleshooting

### "JWT expired or invalid"
```bash
# Get fresh JWT from browser DevTools, then:
npx pft-cli auth:set-token "<new-jwt>"
```

### "PFT_WALLET_SEED or PFT_WALLET_MNEMONIC is required"
```bash
# Set mnemonic for transaction signing:
export PFT_WALLET_MNEMONIC="word1 word2 ... word24"
```

### "Got discussion instead of task"
Use explicit trigger phrases:
- `request a personal task: [description]`
- `request a network task: [description]`
- `request an alpha task: [description]`

### Build errors
```bash
cd ts
rm -rf node_modules dist
npm install
npm run build
```

### Transaction failed
- XRPL transactions take ~4 seconds to finalize
- Check wallet has XRP for fees
- If error contains `tesSUCCESS`, it actually succeeded

## For Developers

### Build & Test
```bash
cd ts
npm install
npm run build      # Compile TypeScript
npm run build:test # Type-check including tests
npm test           # Run unit tests
```

### Architecture
- `cli.ts` - Commander.js CLI with all command definitions
- `tasknode_api.ts` - HTTP client for Task Node REST API
- `loop.ts` - TaskLoopRunner orchestrates full task lifecycle
- `signer.ts` - XRPL transaction signing via xrpl.js
- `pointer.ts` - Protobuf-style memo encoding for on-chain pointers

### Adding Commands
1. Add command in `src/cli.ts` using Commander.js pattern
2. Implement logic in appropriate module
3. Update this CLAUDE.md with new command
