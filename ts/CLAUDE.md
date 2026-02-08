# PFT CLI - AI Agent Documentation

> **Created:** 2026-02-01
> **Last updated:** 2026-02-01
> **Purpose:** Comprehensive documentation for AI agents using the Post Fiat Task Node CLI

## Overview

The PFT CLI (`pft-cli`) is a programmatic interface to the [Post Fiat Task Node](https://tasknode.postfiat.org). It enables automated task discovery, acceptance, evidence submission, verification response handling, and reward tracking—all through the command line.

**Key capabilities:**
- Request tasks via AI chat ("magic phrases")
- Accept proposed tasks and track status
- Submit evidence with automatic XRPL transaction signing
- Handle verification questions
- Poll for rewards
- Recover from failed submissions

---

## Quick Start

### Installation

```bash
cd ts
npm install && npm run build
```

### Setup (Interactive Wizard)

```bash
npx pft-cli setup
# or
npm run setup
```

The wizard guides you through:
1. Building the CLI
2. Configuring JWT token
3. Setting up wallet mnemonic
4. Verifying the configuration

### Manual Setup

Set these environment variables:

```bash
# Required for all commands
export PFT_TASKNODE_JWT="eyJ..."

# Required for signing (evidence submission, verification response)
export PFT_WALLET_MNEMONIC="word1 word2 ... word24"
# OR
export PFT_WALLET_SEED="sXXX..."
```

**Getting credentials:**

| Credential | How to Get |
|------------|------------|
| JWT | Open https://tasknode.postfiat.org → DevTools (F12) → Network → Copy `Authorization: Bearer <jwt>` header |
| Mnemonic | Post Fiat app → Settings → Export Seed |

---

## Task Loop Workflow

This is the **critical section** for understanding the complete task lifecycle:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                            TASK LOOP WORKFLOW                                │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   REQUEST ──► ACCEPT ──► WORK ──► EVIDENCE ──► VERIFY ──► REWARD            │
│                                                                              │
│   [chat:send]  [tasks:accept]     [evidence:submit]  [verify:respond]       │
│                                                       [verify:wait]          │
│                                                       [tasks:watch]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Commands

#### 1. Request a Task

```bash
npx pft-cli chat:send \
  --content "request a network task: Build feature X for the protocol" \
  --context "I am working on Y and my goal is Z" \
  --wait
```

The `--wait` flag polls until the assistant responds with a task proposal. Output includes `task_proposal.task_id` if a task is proposed.

**Magic phrases that trigger immediate task generation:**

| Phrase Pattern | Classification |
|----------------|----------------|
| `request a personal task: [description]` | `task_request_personal` |
| `request a network task: [description]` | `task_request_network` |
| `request an alpha task: [description]` | `task_request_alpha` |

#### 2. Accept the Task

```bash
npx pft-cli tasks:accept <taskId>
```

Status changes from `pending` → `in_progress`.

#### 3. Do the Work

(This is the human/agent work phase. Build the thing, write the code, etc.)

#### 4. Submit Evidence

```bash
npx pft-cli evidence:submit \
  --task-id <taskId> \
  --type url \
  --content "https://github.com/user/repo/pull/123"
```

Evidence types: `text`, `url`, `code`, `file`

For file uploads:
```bash
npx pft-cli evidence:submit \
  --task-id <taskId> \
  --type file \
  --file "./screenshot.png"
```

#### 5. Wait for Verification Question

```bash
npx pft-cli verify:wait <taskId> --timeout 300 --interval 15
```

Polls until the verification question is generated. Output includes `verification_ask`.

#### 6. Respond to Verification

```bash
npx pft-cli verify:respond \
  --task-id <taskId> \
  --type text \
  --response "The task ID is <taskId>. Here is the specific output you asked for..."
```

**Important:** Verification responses should directly address the question. Include the task ID when asked.

#### 7. Watch Until Rewarded

```bash
npx pft-cli tasks:watch <taskId> --interval 15
```

Polls until status is `rewarded`, `refused`, or `cancelled`. Output includes final task details with reward amount.

### Automated Full Loop

For testing or simple tasks, use the automated loop:

```bash
# Minimal test (1 PFT reward)
npx pft-cli loop:test --type personal

# Custom task
npx pft-cli loop:run \
  --type personal \
  --description "Your task description" \
  --context "Your context" \
  --evidence "Your evidence text" \
  --verification-response "Your verification answer"
```

---

## Command Reference

### Authentication

| Command | Description | Example |
|---------|-------------|---------|
| `auth:status` | Check JWT validity and account summary | `npx pft-cli auth:status` |
| `auth:set-token <jwt>` | Save JWT to config file | `npx pft-cli auth:set-token "eyJ..."` |

### Tasks

| Command | Description | Example |
|---------|-------------|---------|
| `tasks:summary` | Get task counts by status | `npx pft-cli tasks:summary` |
| `tasks:list --status <status>` | List tasks (outstanding/pending/rewarded/refused/cancelled) | `npx pft-cli tasks:list --status outstanding` |
| `tasks:get <taskId>` | Get full task details | `npx pft-cli tasks:get abc123` |
| `tasks:accept <taskId>` | Accept a pending task | `npx pft-cli tasks:accept abc123` |
| `tasks:watch <taskId>` | Poll until rewarded/refused | `npx pft-cli tasks:watch abc123 --interval 30` |

### Chat

| Command | Description | Example |
|---------|-------------|---------|
| `chat:send --content <msg>` | Send chat message | `npx pft-cli chat:send --content "hello" --context "..."` |
| `chat:send --wait` | Send and wait for response | `npx pft-cli chat:send --content "..." --context "..." --wait` |
| `chat:list --limit <n>` | List recent messages | `npx pft-cli chat:list --limit 10` |
| `chat:pending-task` | Check for pending task proposals | `npx pft-cli chat:pending-task` |

### Evidence

| Command | Description | Example |
|---------|-------------|---------|
| `evidence:submit` | Upload and submit evidence | `npx pft-cli evidence:submit --task-id abc --type url --content "https://..."` |

**Options:**
- `--task-id <id>` (required)
- `--type <type>` (required): `text`, `url`, `code`, `file`
- `--content <content>`: For text/url/code
- `--file <path>`: For file uploads
- `--artifact-json <json>`: Raw JSON artifact

### Verification

| Command | Description | Example |
|---------|-------------|---------|
| `verify:status <taskId>` | Get verification status | `npx pft-cli verify:status abc123` |
| `verify:wait <taskId>` | Poll for verification question | `npx pft-cli verify:wait abc123 --timeout 300` |
| `verify:respond` | Submit verification response | `npx pft-cli verify:respond --task-id abc --type text --response "..."` |

### Pending Submissions (Recovery)

| Command | Description | Example |
|---------|-------------|---------|
| `pending:list` | List failed/incomplete submissions | `npx pft-cli pending:list` |
| `pending:resume` | Resume a pending submission | `npx pft-cli pending:resume --task-id abc --type evidence` |
| `pending:clear` | Clear without completing | `npx pft-cli pending:clear --task-id abc --type verification_response` |

### Loop Automation

| Command | Description | Example |
|---------|-------------|---------|
| `loop:test` | Run E2E test with minimal reward | `npx pft-cli loop:test --type personal` |
| `loop:run` | Run custom task loop | `npx pft-cli loop:run --type network --description "..." --context "..." --evidence "..." --verification-response "..."` |

### Global Options

| Option | Description |
|--------|-------------|
| `-q, --quiet` | Suppress progress messages, output only JSON to stdout |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PFT_TASKNODE_JWT` | Yes | - | JWT token for authentication |
| `PFT_WALLET_MNEMONIC` | For signing | - | 24-word recovery phrase |
| `PFT_WALLET_SEED` | For signing | - | XRPL wallet seed (alternative to mnemonic) |
| `PFT_TASKNODE_URL` | No | `https://tasknode.postfiat.org` | Task Node API URL |
| `PFT_CONTEXT_TEXT` | No | - | Default context for chat messages |
| `PFT_TASKNODE_TIMEOUT_MS` | No | `30000` | Request timeout in milliseconds |

---

## Credential Storage

### Config File Location

```
~/.pft-tasknode/config.json
```

**Structure:**
```json
{
  "jwt": "eyJ...",
  "baseUrl": "https://tasknode.postfiat.org",
  "contextText": "My default context...",
  "timeoutMs": 30000
}
```

**Security:**
- File permissions set to `0o600` (owner read/write only)
- Mnemonic is NOT stored in config (use environment variable)
- JWT tokens expire after ~24 hours

### Pending Submissions Storage

```
~/.pft-tasknode/pending/
├── <taskId>-evidence.json
└── <taskId>-verification_response.json
```

Used for recovery when transactions fail mid-submission.

---

## Common Patterns

### Requesting Different Task Types

```bash
# Personal task (self-improvement, individual goals)
npx pft-cli chat:send \
  --content "request a personal task: Learn about X and document findings" \
  --context "My goal is to improve my skills in Y" \
  --wait

# Network task (Post Fiat protocol/ecosystem)
npx pft-cli chat:send \
  --content "request a network task: Build integration for protocol feature X" \
  --context "I have experience with Y and Z" \
  --wait

# Alpha task (expert network contributions)
npx pft-cli chat:send \
  --content "request an alpha task: Analyze market conditions for X" \
  --context "I have expertise in Y" \
  --wait
```

### Handling Verification Questions

The verification question tests that you actually completed the work. Common patterns:

```bash
# 1. Check what the question is
npx pft-cli verify:status <taskId>

# 2. Or wait for it if not ready
npx pft-cli verify:wait <taskId> --timeout 300

# 3. Respond directly addressing the question
npx pft-cli verify:respond \
  --task-id <taskId> \
  --type text \
  --response "Task ID: <taskId>. The output of my work was X. It demonstrates Y because Z."
```

**Tips for good verification responses:**
- Always include the task ID
- Directly answer what was asked
- Reference specific outputs or artifacts
- Be concise but complete

### Resuming Failed Submissions

If evidence upload succeeds but transaction signing fails:

```bash
# Check what's stuck
npx pft-cli pending:list

# Resume evidence submission
npx pft-cli pending:resume --task-id <taskId> --type evidence

# Resume verification response
npx pft-cli pending:resume --task-id <taskId> --type verification_response

# Or clear and start fresh
npx pft-cli pending:clear --task-id <taskId> --type evidence
```

### Checking Task Progress

```bash
# Quick summary
npx pft-cli tasks:summary

# List all outstanding (in_progress) tasks
npx pft-cli tasks:list --status outstanding

# Get full details of a specific task
npx pft-cli tasks:get <taskId>

# Check verification status
npx pft-cli verify:status <taskId>
```

### Quiet Mode for Scripting

Use `-q` or `--quiet` to suppress progress messages and get clean JSON output:

```bash
npx pft-cli -q tasks:list --status outstanding | jq '.tasks[0].id'
```

---

## Troubleshooting

### Authentication Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `JWT missing` | No JWT configured | `export PFT_TASKNODE_JWT="<jwt>"` or `npx pft-cli auth:set-token "<jwt>"` |
| `JWT expired or invalid` | Token expired (~24h lifetime) | Get fresh token from Task Node |
| `Access forbidden` | JWT lacks permission | Re-authenticate with correct account |

### Wallet Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `PFT_WALLET_SEED or PFT_WALLET_MNEMONIC is required` | No wallet credentials | `export PFT_WALLET_MNEMONIC="word1 word2 ... word24"` |
| `Transaction failed: tec*` | XRPL error | Check wallet balance, retry |

### Task Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Got discussion instead of task` | ODV needs clarification | Use explicit "request a [type] task: [specific description]" |
| `No task proposal in response` | Message not classified as task request | Include more context, use magic phrase |
| `Verification question never arrives` | Still generating | `npx pft-cli verify:wait <id> --timeout 300` |

### Submission Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Pending submission exists` | Previous attempt incomplete | `pending:resume` or `pending:clear` |
| `Verification response awaiting signature` | Response submitted but tx failed | Use `pending:resume --type verification_response` |
| `Missing encryption key` | No x25519_pubkey in account | Check account status with `auth:status` |

### Common Recovery Flow

```bash
# 1. Check if anything is stuck
npx pft-cli pending:list

# 2. Check task status
npx pft-cli tasks:get <taskId>

# 3. Check verification status
npx pft-cli verify:status <taskId>

# 4. Resume or clear as needed
npx pft-cli pending:resume --task-id <taskId> --type evidence
# or
npx pft-cli pending:clear --task-id <taskId> --type evidence
```

---

## Timing Expectations

| Phase | Typical | Maximum |
|-------|---------|---------|
| Request → Proposal | 2-5 seconds | 30 seconds |
| Accept → In Progress | <1 second | 5 seconds |
| Evidence → Verification Question | 10-60 seconds | 5 minutes |
| Verification Response → Reward | 30 seconds - 5 minutes | 30 minutes |
| **Total loop time** | **5-15 minutes** | **45 minutes** |

---

## Task Types & Reward Tiers

### Task Types

| Type | Weight | Purpose |
|------|--------|---------|
| `personal` | 0.10 | Self-improvement, individual goals |
| `network` | 0.50 | Post Fiat protocol/ecosystem |
| `alpha` | 0.40 | Expert network contributions |

### Reward Tiers

| Tier | Score | Typical Multiplier |
|------|-------|-------------------|
| `exceptional` | 95+ | ~1.2x |
| `very_good` | 85-94 | ~2.5x |
| `good` | 70-84 | ~1.5x |
| `standard` | 50-69 | 1x |
| `minimal` | <50 | <1x |

---

## SDK/Programmatic Usage

```typescript
import { TaskNodeApi, TaskLoopRunner, TransactionSigner } from "pft-test-client";

// Initialize clients
const api = new TaskNodeApi(process.env.PFT_TASKNODE_JWT!);
const signer = new TransactionSigner({ mnemonic: process.env.PFT_WALLET_MNEMONIC });

// Full automated loop
const runner = new TaskLoopRunner(api, signer, { verbose: true });
const result = await runner.runFullLoop(
  { type: "personal", description: "Build X", context: "My goals..." },
  { type: "text", content: "Evidence of completion" },
  (question) => `Answer: ${question}` // or static string
);

console.log(result.status); // "rewarded" or "refused"
console.log(result.pft);    // "1000" (PFT reward)
```

---

## References

- **Task Node**: https://tasknode.postfiat.org
- **XRPL Testnet**: wss://ws.testnet.postfiat.org
- **Protocol Spec**: `docs/TASK_LOOP_PROTOCOL.md`
- **README**: `ts/README.md`
