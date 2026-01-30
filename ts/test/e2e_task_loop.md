# End-to-End Task Loop Test Plan

## Quick Start

```bash
# Prerequisites
export PFT_TASKNODE_JWT="<your-jwt>"
export PFT_WALLET_SEED="<your-seed>"

# Run test
npm run test:e2e
```

## Manual Test Steps

### Step 1: Request a Task (The Tricky Part)

The key is using the right phrasing to bypass the discussion flow:

```bash
# GOOD - triggers immediate generation
pft-cli chat:send \
  --content "request a personal task: Write a script that tests the CLI commands. Verification: paste the script output showing all commands work." \
  --context "I am testing programmatic task completion" \
  --wait
```

**What to look for:**
- `classification_tag: "task_request_personal"` (not `task_discussion_*`)
- Response contains `task.id`

If you get `task_discussion_*`, send a follow-up:
```bash
pft-cli chat:send --content "request a task" --wait
```

### Step 2: Accept the Task

```bash
TASK_ID="<id-from-step-1>"
pft-cli tasks:accept $TASK_ID
```

**Verify:** `pft-cli tasks:get $TASK_ID` shows `status: "outstanding"`

### Step 3: Submit Evidence

```bash
# Text evidence (simplest)
pft-cli evidence:submit \
  --task-id $TASK_ID \
  --type text \
  --content "Test completed. Output: All CLI commands returned expected results."

# URL evidence
pft-cli evidence:submit \
  --task-id $TASK_ID \
  --type url \
  --content "https://github.com/user/repo/commit/abc123"

# File evidence
pft-cli evidence:submit \
  --task-id $TASK_ID \
  --type file \
  --file ./screenshot.png
```

**Verify:** `pft-cli tasks:get $TASK_ID` shows `verificationStatus: "evidence_submitted"`

### Step 4: Wait for Verification Question

```bash
# Poll every 15 seconds
while true; do
  pft-cli tasks:get $TASK_ID --json | jq '.verificationAsk'
  sleep 15
done
```

**Typical wait:** 10-60 seconds

### Step 5: Respond to Verification

```bash
pft-cli verify:respond \
  --task-id $TASK_ID \
  --type text \
  --response "The script tested auth:status, tasks:list, chat:send, evidence:submit. All returned HTTP 200."
```

### Step 6: Wait for Reward

```bash
pft-cli tasks:watch $TASK_ID --interval 30
```

**Or manual polling:**
```bash
while true; do
  STATUS=$(pft-cli tasks:get $TASK_ID --json | jq -r '.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "rewarded" ] && break
  [ "$STATUS" = "refused" ] && break
  sleep 30
done
```

## Test Milestones

| # | Milestone | Endpoint | Success Criteria |
|---|-----------|----------|------------------|
| 1 | Request | `POST /api/chat/messages` | `classification_tag` = `task_request_*` |
| 2 | Proposal | `GET /api/chat/messages` | Response has `task.id` |
| 3 | Accept | `POST /api/tasks/{id}/accept` | `status` = `outstanding` |
| 4 | Evidence | `POST /api/tasks/{id}/submit` | `tx_hash` in response |
| 5 | Verif Q | `GET /api/tasks/{id}/verification` | `verificationAsk` populated |
| 6 | Verif R | `POST /api/tasks/{id}/verification/submit` | `tx_hash` in response |
| 7 | Reward | `GET /api/tasks/{id}` | `status` = `rewarded` |

## Common Failures

### "Got discussion instead of task"

**Symptom:** `classification_tag: "task_discussion_personal"`
**Fix:** Use explicit trigger phrase:
- `"request a personal task: [specific description]"`
- `"generate a task for [specific thing]"`
- `"give me a task to [specific action]"`

### "Transaction not confirmed"

**Symptom:** Submit endpoint returns error
**Fix:** Wait for XRPL transaction validation (~4 seconds)

### "Verification question never arrives"

**Symptom:** Stuck at `evidence_submitted` for >5 min
**Fix:** Check `/api/tasks/{id}/forensics` for timeline

### "Task refused"

**Symptom:** `status: "refused"`
**Fix:** Read `refusalReason`, improve evidence quality

## Expected Timing

| Transition | Typical | Max |
|------------|---------|-----|
| Request → Proposal | 2-5s | 30s |
| Accept → Outstanding | <1s | 5s |
| Evidence → Verif Q | 10-60s | 5min |
| Verif R → Reward | 30s-5min | 30min |

Total expected time: **5-10 minutes**

## Debug Commands

```bash
# Full task state
pft-cli tasks:get $TASK_ID --json | jq .

# Task timeline
curl -H "Authorization: Bearer $PFT_TASKNODE_JWT" \
  "$PFT_TASKNODE_URL/api/tasks/$TASK_ID/forensics" | jq .

# Recent chat
pft-cli chat:list --limit 5

# Account status
pft-cli auth:status
```

## Automated Test Script

See `test/e2e_task_loop.test.ts` for the full automated version.

```typescript
// Key assertions
expect(classification_tag).toBe("task_request_personal");
expect(task.id).toBeDefined();
expect(task.status).toBe("outstanding");
expect(verification.verificationAsk).toBeDefined();
expect(finalTask.status).toBe("rewarded");
```
