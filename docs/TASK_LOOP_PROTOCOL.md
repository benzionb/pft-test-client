# Post Fiat Task Loop Protocol

Complete technical specification for programmatic task loop automation.

## Overview

The Post Fiat Task Node orchestrates human-AI collaborative work through a structured task lifecycle. This document specifies the protocol for programmatic interaction with the Task Node API.

## Task Lifecycle State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TASK LIFECYCLE STATE MACHINE                        │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌──────────────┐
                              │   NO_TASK    │
                              │   (start)    │
                              └──────┬───────┘
                                     │
                    POST /api/chat/messages
                    content: "request a [type] task: [description]"
                                     │
                                     ▼
                              ┌──────────────┐
                              │   PROPOSED   │◄────────────────────────────┐
                              │  (pending)   │                             │
                              └──────┬───────┘                             │
                                     │                                     │
                    POST /api/tasks/{id}/accept                            │
                                     │                                     │
                                     ▼                                     │
                              ┌──────────────┐                             │
                              │ IN_PROGRESS  │                             │
                              │ (outstanding)│                             │
                              └──────┬───────┘                             │
                                     │                                     │
                    POST /api/tasks/{id}/evidence + submit                 │
                                     │                                     │
                                     ▼                                     │
                              ┌──────────────┐                             │
                              │   PENDING    │                             │
                              │ VERIFICATION │                             │
                              └──────┬───────┘                             │
                                     │                                     │
                    POST /api/tasks/{id}/verification/respond + submit     │
                                     │                                     │
                                     ▼                                     │
                    ┌────────────────┴────────────────┐                    │
                    ▼                                 ▼                    │
            ┌──────────────┐                  ┌──────────────┐             │
            │   REWARDED   │                  │   REFUSED    │─────────────┘
            │   (done!)    │                  │  (rejected)  │  (can retry)
            └──────────────┘                  └──────────────┘
```

## API Endpoints

### Authentication

All endpoints require JWT authentication:

```
Authorization: Bearer <jwt>
```

### Phase 1: Task Request

**Goal:** Get a task proposal from ODV

```http
POST /api/chat/messages
Content-Type: application/json

{
  "content": "request a personal task: Build the authentication module",
  "chat_type": "chat",
  "context_text": "My objectives..."
}
```

**Response:**
```json
{
  "message": {
    "id": "uuid",
    "classification_tag": "task_request_personal",
    "metadata": {
      "task": {
        "id": "task-uuid",
        "title": "...",
        "pft_offer": "2500"
      }
    }
  },
  "pending_assistant": true
}
```

**Magic Phrases:**
| Phrase Pattern | Classification |
|----------------|----------------|
| `request a personal task: [desc]` | `task_request_personal` |
| `request a network task: [desc]` | `task_request_network` |
| `request an alpha task: [desc]` | `task_request_alpha` |

### Phase 2: Task Acceptance

```http
POST /api/tasks/{taskId}/accept
```

**Response:**
```json
{
  "task": {
    "id": "...",
    "status": "in_progress"
  }
}
```

### Phase 3: Evidence Submission

#### Step 3.1: Upload Evidence

```http
POST /api/tasks/{taskId}/evidence
Content-Type: multipart/form-data

verification_type: text|url|code|file
artifact: <content or file>
x25519_pubkey: <encryption pubkey from account summary>
```

**Response:**
```json
{
  "cid": "bafkrei...",
  "evidence_id": "uuid"
}
```

#### Step 3.2: Prepare Pointer

```http
POST /api/pointers/prepare
Content-Type: application/json

{
  "cid": "bafkrei...",
  "task_id": "...",
  "kind": "TASK_SUBMISSION",
  "schema": 1,
  "flags": 1
}
```

**Response:**
```json
{
  "tx_json": {
    "TransactionType": "Payment",
    "Account": "...",
    "Destination": "rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7",
    "Amount": "1",
    "Memos": [...]
  }
}
```

#### Step 3.3: Sign and Submit XRPL Transaction

Sign the `tx_json` with your wallet and submit to the XRPL network. Extract `tx_hash` from the result.

#### Step 3.4: Submit to Task Node

```http
POST /api/tasks/{taskId}/submit
Content-Type: application/json

{
  "cid": "bafkrei...",
  "tx_hash": "ABCD1234...",
  "artifact_type": "text",
  "evidence_id": "uuid"
}
```

### Phase 4: Verification

#### Step 4.1: Poll for Question

```http
GET /api/tasks/{taskId}/verification
```

**Response (when ready):**
```json
{
  "submission": {
    "verification_ask": "What specific output did this produce?",
    "verification_status": "awaiting_response"
  }
}
```

**Verification Status Values:**
| Status | Meaning |
|--------|---------|
| `awaiting_prompt` | Question being generated |
| `awaiting_response` | Question ready, awaiting user response |
| `response_pending_tx` | Response submitted, awaiting transaction |
| `response_submitted` | Response and transaction complete |
| `approved` | Verification passed |
| `rejected` | Verification failed |

#### Step 4.2: Respond to Verification

```http
POST /api/tasks/{taskId}/verification/respond
Content-Type: multipart/form-data

verification_type: text
response: "The output was..."
x25519_pubkey: <encryption pubkey>
```

**Response:**
```json
{
  "submission": { "verification_status": "response_pending_tx" },
  "evidence": {
    "cid": "bafkrei...",
    "evidence_id": "uuid"
  }
}
```

#### Step 4.3: Submit Verification Transaction

Same flow as evidence: prepare pointer → sign → submit

```http
POST /api/tasks/{taskId}/verification/submit
Content-Type: application/json

{
  "cid": "bafkrei...",
  "tx_hash": "EFGH5678...",
  "artifact_type": "text",
  "evidence_id": "uuid"
}
```

### Phase 5: Reward

Poll task status until terminal:

```http
GET /api/tasks/{taskId}
```

**Terminal states:** `rewarded`, `refused`, `cancelled`

**Rewarded Response:**
```json
{
  "task": {
    "status": "rewarded",
    "pft_offer_actual": "6250.00",
    "reward_tier_final": "very_good",
    "reward_score": "90",
    "reward_tx_hash": "IJKL9012..."
  }
}
```

## Transaction Format

### Pointer Memo Encoding

XRPL Payment transactions carry pointer memos with this structure:

| Field | Type | Value |
|-------|------|-------|
| MemoType | hex | `70662e707472` ("pf.ptr") |
| MemoFormat | hex | `7634` ("v4") |
| MemoData | hex | Protobuf-encoded pointer |

### MemoData Protobuf Fields

```
Field 1 (string): CID - IPFS content identifier
Field 2 (varint): Schema version (1)
Field 3 (varint): Kind (6 = TASK_SUBMISSION)
Field 4 (varint): Flags (1)
Field 8 (varint): Reserved (1)
```

### Destination Address

All pointer transactions are sent to:
```
rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7
```

## Timing Expectations

| Transition | Typical | Maximum |
|------------|---------|---------|
| Request → Proposal | 2-5s | 30s |
| Accept → In Progress | <1s | 5s |
| Evidence → Verification Q | 10-60s | 5 min |
| Verification R → Reward | 30s-5min | 30 min |

**Total loop time:** 5-15 minutes typical

## Error Recovery

### Pending Submissions

If transaction signing fails after evidence upload, save CID and evidence_id locally:

```json
{
  "task_id": "...",
  "type": "evidence",
  "cid": "bafkrei...",
  "evidence_id": "uuid",
  "artifact_type": "text",
  "created_at": "2026-01-30T..."
}
```

To resume:
1. Prepare new pointer with saved CID
2. Sign and submit transaction
3. Call submit endpoint with saved values

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Invalid token format` | JWT expired or malformed | Re-authenticate |
| `Transaction failed: tec*` | XRPL transaction error | Check wallet balance, retry |
| `Missing encryption key` | No x25519_pubkey in request | Fetch from account summary |
| `Verification response awaiting signature` | Response already submitted | Use pending recovery |

## Task Types

| Type | Weight | Purpose |
|------|--------|---------|
| `personal` | 0.10 | Self-improvement, individual goals |
| `network` | 0.50 | Post Fiat protocol/ecosystem |
| `alpha` | 0.40 | Expert network contributions |

## Reward Tiers

| Tier | Score | Typical Multiplier |
|------|-------|-------------------|
| `exceptional` | 95+ | ~1.2x |
| `very_good` | 85-94 | ~2.5x |
| `good` | 70-84 | ~1.5x |
| `standard` | 50-69 | 1x |
| `minimal` | <50 | <1x |

## SDK Usage

```typescript
import { TaskNodeApi, TaskLoopRunner, TransactionSigner } from "pft-cli-client";

const api = new TaskNodeApi(process.env.PFT_TASKNODE_JWT!);
const signer = new TransactionSigner({ mnemonic: process.env.PFT_WALLET_MNEMONIC });
const runner = new TaskLoopRunner(api, signer, { verbose: true });

// Full automated loop
const result = await runner.runFullLoop(
  { type: "personal", description: "Build feature X", context: "My goals..." },
  { type: "text", content: "Feature X completed" },
  (question) => `Answer to: ${question}`
);

console.log(result.status); // "rewarded" or "refused"
```

## References

- Task Node: https://tasknode.postfiat.org
- XRPL Testnet: wss://rpc.testnet.postfiat.org:6008
- GitHub: https://github.com/benzionb/pft-test-client
