# PFT Test Client

Programmatic client for the [Post Fiat Task Node](https://tasknode.postfiat.org). Enables automated task discovery, acceptance, evidence submission, verification handling, and reward collection.

## Quick Start (TypeScript)

```bash
cd ts && npm install && npm run build

# Set credentials
export PFT_TASKNODE_JWT="<your-jwt>"
export PFT_WALLET_MNEMONIC="<24-word-phrase>"

# Run a complete E2E task loop (5-6 minutes)
npx pft-cli loop:test --type personal
```

This single command executes the full task lifecycle: request → accept → evidence → verification → reward.

## Repository Structure

```
pft-test-client/
├── ts/                      # TypeScript CLI (recommended)
│   ├── src/
│   │   ├── cli.ts           # CLI entry point
│   │   ├── tasknode_api.ts  # Task Node API client
│   │   ├── loop.ts          # TaskLoopRunner orchestrator
│   │   ├── signer.ts        # XRPL transaction signing
│   │   ├── pointer.ts       # Memo encoding (protobuf-style)
│   │   └── ...
│   └── README.md            # Full TypeScript documentation
│
├── sdk/                     # Python SDK (legacy)
│   ├── client.py            # Core client
│   ├── pointer.py           # Memo encoding
│   └── README.md            # Python documentation
│
├── proto/                   # Protocol definitions
│   └── pft_tasknode.proto   # Protobuf schema reference
│
└── docs/
    └── TASK_LOOP_PROTOCOL.md  # Complete E2E protocol documentation
```

## Implementations

| Language | Location | Status | Features |
|----------|----------|--------|----------|
| **TypeScript** | `ts/` | ✅ Active | Full CLI, E2E loop, API client |
| Python | `sdk/` | 🔶 Legacy | Core signing, pointer encoding |

## Key Features

- **Complete Task Loop**: Request tasks, submit evidence, handle verification, collect rewards
- **Transaction Signing**: Built-in XRPL signing via seed or mnemonic
- **IPFS Pinning**: Automatic evidence upload to web3.storage
- **Pointer Encoding**: Protobuf-style memo encoding for on-chain submissions
- **Polling Utilities**: Smart polling for async state transitions
- **Pending Recovery**: Resume failed submissions from local storage

## Documentation

- **[TypeScript CLI Guide](ts/README.md)** - Full CLI reference and E2E testing
- **[Task Loop Protocol](docs/TASK_LOOP_PROTOCOL.md)** - Complete protocol specification
- **[Python SDK](sdk/README.md)** - Legacy Python implementation

## Task Loop Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     TASK LOOP LIFECYCLE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. REQUEST    "request a personal task: Build X"               │
│       ↓        → Magic phrase triggers task generation          │
│                                                                 │
│  2. ACCEPT     POST /api/tasks/{id}/accept                      │
│       ↓        → Status: pending → in_progress                  │
│                                                                 │
│  3. EVIDENCE   Upload → IPFS pin → XRPL tx → Submit             │
│       ↓        → Evidence linked on-chain                       │
│                                                                 │
│  4. VERIFY     Poll for question → Respond → XRPL tx → Submit   │
│       ↓        → AI evaluates evidence + response               │
│                                                                 │
│  5. REWARD     Poll until rewarded/refused                      │
│                → PFT tokens transferred on-chain                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Related Resources (Local)

If working in the `/Users/zion_1/Projects/` workspace:

| Resource | Location | Purpose |
|----------|----------|---------|
| **Context File** | `agent_integrations/pft_tasknode/CONTEXT.md` | Quick pickup guide with credentials |
| **System Prompts** | `agent_integrations/pft_tasknode/prompts/` | Leaked Task Node prompts |
| **Traffic Captures** | `agent_integrations/pft_tasknode/captures/` | HAR files for reference |
| **Chain Monitor** | `agent_integrations/pft_monitor/` | Blockchain scanning tools |
| **Research Docs** | `Vault/3.1 decentralized ai research/1. Priority/PFT/` | Deep dives, knowledge base |

## License

MIT License - see [LICENSE](ts/LICENSE)
