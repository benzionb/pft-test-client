# PFT Task Node — System Research & API Landscape

> **Created:** 2026-02-11
> **Last updated:** 2026-02-11
> **Purpose:** Comprehensive reverse-engineering of the Post Fiat Task Node system, scoring mechanics, and API surface. All findings derived from traffic capture analysis via mitmproxy.

---

## Table of Contents

1. [Methodology](#methodology)
2. [API Surface](#api-surface)
3. [Leaderboard & Ranking System](#leaderboard--ranking-system)
4. [Alignment Score](#alignment-score)
5. [Sybil Score](#sybil-score)
6. [Task Classification & Rewards](#task-classification--rewards)
7. [NFT System](#nft-system)
8. [Messaging & Contacts](#messaging--contacts)
9. [XRPL Infrastructure](#xrpl-infrastructure)
10. [Open Questions](#open-questions)

---

## Methodology

All findings are derived from HTTP traffic captured via **mitmproxy** intercepting browser requests to `tasknode.postfiat.org`. We have no access to the backend source code.

**Capture setup:**
- mitmproxy (`mitmweb`) listening on `localhost:8080` with a custom addon (`capture_addon.py`)
- Chrome launched with `--proxy-server="localhost:8080" --ignore-certificate-errors`
- Traffic logged as JSONL with full request/response bodies

**Capture sessions analyzed:**
| File | Date | Lines | Notes |
|------|------|-------|-------|
| `traffic_20260129_152309.jsonl` | Jan 29 | ~50MB | Initial API discovery, full task loop |
| `traffic_20260208_001319.jsonl` | Feb 8 | ~2.8MB | JWT capture, basic navigation |
| `traffic_20260210_170431.jsonl` | Feb 10 | ~100KB | Leaderboard, profile, NFTs, messaging |

**Additional analysis:**
- Regression analysis on leaderboard data (20 active users, R²=1.000)
- Formula reverse-engineering via numpy least squares

---

## API Surface

### Complete Endpoint Map

All endpoints discovered across capture sessions, organized by domain.

#### Authentication

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/auth/github/start?redirect=...` | Initiate GitHub OAuth flow (302 → GitHub) |
| `GET` | `/api/auth/github/callback?code=...&state=...` | GitHub OAuth callback (302 → `/auth/callback?token=<jwt>`) |
| `GET` | `/api/auth/x/start?redirect=...` | Initiate X/Twitter OAuth flow |
| `GET` | `/api/auth/x/callback?state=...&code=...` | X/Twitter OAuth callback |
| `GET` | `/auth/callback?token=<jwt>&provider=...&eligible=true` | Frontend callback (stores JWT in localStorage) |

**JWT format:** `eyJhbG...<base64-payload>...<signature>`
**Payload contains:** `sub` (user UUID), `provider` ("github" or "x"), `exp` (expiry timestamp)
**Expiry:** ~7 days from issuance

#### Account & Profile

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/account/summary` | `user`, `providers`, `provider_metrics`, `active_wallet_balance_drops`, `consent`, `activity_settings`, `wallets`, `active_wallet`, `tasknode_encryption_pubkey` | Full account state |
| `GET` | `/api/profile/settings` | `settings` | Profile visibility, PFP mode, NFT settings |
| `GET` | `/api/profile/avatar` | `avatar` | IPFS-hosted avatar with generation metadata |
| `GET` | `/api/profile/runs?field=nft_image&latest=true&limit=1` | `runs` | Profile generation run history |
| `POST` | `/api/profile/runs` | `run`, `already_queued`, `fields` | Trigger profile generation (body: `{field, force}`) |

#### Tasks

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/tasks/summary` | `tasks`, `counts`, `rewarded_total_pft`, `alignment` | **Primary endpoint** — all tasks + alignment data |
| `GET` | `/api/tasks/rewarded?limit=10` | `tasks`, `total`, `limit`, `offset` | Paginated rewarded tasks |
| `GET` | `/api/tasks/refused?limit=10` | `tasks`, `total`, `limit`, `offset` | Paginated refused tasks |
| `GET` | `/api/tasks/{id}` | `task` | Individual task details (note: reward fields unpopulated here) |
| `POST` | `/api/tasks/{id}/accept` | `task` | Accept a pending task |
| `GET` | `/api/tasks/{id}/verification` | `submission`, `debug` | Verification status and question |
| `GET` | `/api/tasks/{id}/forensics` | `task`, `timeline`, `history`, `latest_submission` | Full task forensics |
| `GET` | `/api/tasks/rewards/daily?days=28` | `daily`, `categoryTotals`, `days` | Daily reward breakdown by category |
| `GET` | `/api/context/latest` | `context_doc_cid`, `context_version`, `latest`, `wallet_address`, `wallet_id` | Current context document |
| `GET` | `/api/context/revisions?limit=20` | `revisions` | Context revision history |
| `GET` | `/api/context/task-history` | `task_history` | Task history for context |

#### Evidence & Verification

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `POST` | `/api/tasks/{id}/evidence` | `cid`, `evidence_id`, `image_description` | Upload evidence to IPFS |
| `POST` | `/api/pointers/prepare` | `tx_json`, `from_address`, `destination`, `amount_drops`, `fee_drops`, `reserve_drops`, `available_drops`, `memo_type`, `memo_format`, `memo_data`, `pointer` | Prepare XRPL transaction for submission |
| `POST` | `/api/tasks/{id}/submit` | `task`, `submission` | Submit evidence (body: `{cid, tx_hash, artifact_type, evidence_id}`) |
| `POST` | `/api/tasks/{id}/verification/respond` | `submission`, `evidence` | Submit verification response |
| `POST` | `/api/tasks/{id}/verification/submit` | `submission` | Submit verification tx (body: `{cid, tx_hash, artifact_type, evidence_id}`) |

#### Chat

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/chat/messages?type=chat&limit=30` | `messages` | Recent chat messages |
| `POST` | `/api/chat/messages` | `message`, `pending_assistant` | Send message (body: `{content, chat_type, context_text}`) |

#### Leaderboard

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/leaderboard` | `rows`, `generated_at`, `as_of_date`, `as_of_timestamp` | Full network leaderboard |

#### Wallet & Transactions

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/wallet/transactions?limit=20` | `wallet_address`, `transactions`, `next_marker`, `has_more` | Paginated wallet transactions |
| `POST` | `/api/wallets/activate` | `wallet_address` | Activate a wallet (body: `{wallet_address}`) |
| `POST` | `/api/transactions/submit` | `tx_hash`, `engine_result` | Submit signed transaction (body: `{signed_tx_blob, source}`) |

#### Messaging

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/contacts` | `contacts`, `self_message_key`, `self_message_key_tx_hash` | Contact list |
| `POST` | `/api/contacts` | `contact` | Add contact (body: `{wallet_address, label}`) |
| `GET` | `/api/inbox` | `threads`, `last_tx_hash` | Message threads with unread counts |

#### NFTs

| Method | Path | Response Keys | Description |
|--------|------|---------------|-------------|
| `GET` | `/api/nfts/gallery` | `nfts` | User's NFT gallery |
| `POST` | `/api/nfts/prepare-mint` | `mint_id`, `tx_json`, `image_cid`, `metadata_cid` | Prepare NFT mint (body: `{image_url, name, description}`) |
| `POST` | `/api/nfts/confirm-mint` | `success`, `nft` | Confirm mint after tx (body: `{mint_id, tx_hash, nft_token_id}`) |
| `POST` | `/api/nfts/profile-picture` | — | Set NFT as profile picture (body: `{mint_id}`) |

#### Error Reporting

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/client-errors` | Client-side error reporting (body: `{request_id, method, path, status, error_type, error_message, page_path, user_agent, wallet_address}`) |

---

## Leaderboard & Ranking System

**Source:** `GET /api/leaderboard`
**Snapshot:** 37 users as of 2026-02-11

### Leaderboard Row Schema

```json
{
  "user_id": "uuid",
  "wallet_address": "rXXX...",
  "is_public": true,
  "is_primary": true,
  "is_published": false,
  "published_at": null,
  "summary": "<LLM-generated summary>",
  "weekly_rewards": 65037.5,
  "monthly_rewards": 190287.5,
  "weekly_tasks": 11,
  "monthly_tasks": 33,
  "alignment_score": 80,
  "alignment_tier": "Active Contributor",
  "sybil_score": 60,
  "sybil_risk": "Moderate",
  "leaderboard_score_week": 65,
  "leaderboard_score_month": 64,
  "nft_image_url": "ipfs://bafybei...",
  "capabilities": ["<LLM-generated capability descriptions>"],
  "expert_knowledge": [{"domain": "<inferred domain>"}, ...]
}
```

### Ranking Formula (Reverse-Engineered)

Derived via least-squares regression on 20 active users. **R² = 1.000** (perfect fit).

```
leaderboard_score_month ≈ 0.652 × alignment_score
                        + 0.099 × sybil_score
                        + 0.008 × monthly_tasks
                        + 0.030 × (monthly_rewards / 1000)
                        + 0.081 (intercept)
```

**Factor importance:**

| Factor | Coefficient | Standalone R² | Interpretation |
|--------|-------------|---------------|----------------|
| `alignment_score` | 0.652 | 0.864 | **Dominant factor** — 86% of variance |
| `sybil_score` | 0.099 | 0.224 | Trust/legitimacy bonus |
| `monthly_rewards` | 0.030 / 1K PFT | 0.254 | Small earnings contribution |
| `monthly_tasks` | 0.008 | 0.330 | Negligible — quantity barely matters |

**Key insight:** The #4 earner by PFT (`rDqf4now`, 800K PFT, 97 tasks) ranks below users with 190K PFT because alignment_score is only 21 vs. 80 for #1. Quality and trust dominate over volume.

### Full Leaderboard Snapshot (Feb 11, 2026)

| Rank | Wallet | LB Score | Align | Sybil | Mo Tasks | Mo Rewards | Tier |
|------|--------|----------|-------|-------|----------|------------|------|
| 1 | rPo8GkCA... | 64 | 80 | 60 | 33 | 190,288 | Active Contributor |
| 2 | rXXXXXXX... | 57 | 64 | 51 | 52 | 329,095 | Contributor |
| 3 | rHTgM9rZ... | 51 | 65 | 47 | 18 | 122,675 | Contributor |
| 4 | rDqf4now... | 43 | 21 | 47 | 97 | 800,824 | Early |
| 5 | r9oHNN14... | 34 | 41 | 35 | 17 | 124,200 | Ramping |
| 6 | rDAokUXB... | 33 | 40 | 62 | 5 | 34,000 | Ramping |
| 7 | rpyTMcAK... | 30 | 33 | 48 | 22 | 107,910 | Early |
| 8 | rnmLkDT2... | 30 | 25 | 34 | 52 | 332,675 | Early |
| 9 | rfo5PXej... | 28 | 32 | 48 | 14 | 90,250 | Early |
| 10 | r4r2Kfe7... | 26 | 32 | 45 | 4 | 11,750 | Early |

*27 additional users with scores 1-26 (mostly Inactive tier)*

---

## Alignment Score

**Source:** `GET /api/tasks/summary` → `response.alignment`

Alignment is the single most important number in the system. It is an **LLM-evaluated score** that determines your leaderboard rank and potentially your reward multipliers.

### Full Alignment Object (Our Account)

```json
{
  "weights": {
    "alpha": 0.4,
    "network": 0.5,
    "personal": 0.1,
    "default": 0.1
  },
  "evidence": {
    "sybil_risk": "Elevated",
    "sybil_score": 51,
    "recent_chat_count": 20,
    "context_updates_30d": 2,
    "recent_chat_count_30d": 133,
    "rewarded_task_count_30d": 52,
    "rewarded_task_count_all_time": 52
  },
  "freshness": {
    "computed_at": "2026-02-11T00:53:37.355Z"
  },
  "confidence": "medium",
  "cutoff_reason": "sybil_penalty_22pct",
  "cutoff_applied": true,
  "alignment_score": 64,
  "alignment_tier": "Contributor",
  "raw_dollar_value": 82000,
  "final_dollar_value": 63960,
  "sybil_penalty_pct": 22,
  "target_pft_month": 20000,
  "weighted_monthly_pft": "<computed-weighted-amount>",
  "model_reasoning_text": "<LLM-generated qualitative assessment of the user's contributions, capabilities, sybil risk interpretation, and overall value to the network>",
  "weekly_counts": {"alpha": 0, "network": "<n>", "personal": "<n>", "total": "<n>"},
  "monthly_counts": {"alpha": 0, "network": "<n>", "personal": "<n>", "total": "<n>"},
  "weekly_rewards_total": "<pft-amount>",
  "monthly_rewards_total": "<pft-amount>",
  "weekly_rewards_by_category": {"network": "<amt>", "personal": "<amt>", "total": "<amt>"},
  "monthly_rewards_by_category": {"network": "<amt>", "personal": "<amt>", "total": "<amt>"}
}
```

### Alignment Computation Pipeline

Based on the data, the alignment pipeline works as follows:

```
1. GATHER EVIDENCE
   ├── Task counts (by category, weekly/monthly/all-time)
   ├── Reward totals (by category)
   ├── Sybil score + risk level
   ├── Chat activity (recent + 30d)
   ├── Context document updates (30d)
   └── Provider metrics (GitHub, X/Twitter)

2. COMPUTE WEIGHTED PFT
   weighted_monthly_pft = Σ(category_rewards × category_weight)
   Example: network_rewards × 0.5 + personal_rewards × 0.1 = weighted_total
   
   Category weights:
     network:  0.5  (most valued)
     alpha:    0.4  (expert intelligence)
     personal: 0.1  (self-improvement)
     default:  0.1  (uncategorized)

3. LLM EVALUATION
   An LLM receives the evidence blob + presumably task history/evidence
   Outputs:
     - model_reasoning_text (qualitative assessment)
     - raw_dollar_value (e.g., 82,000)
     - confidence level ("medium")

4. APPLY SYBIL PENALTY
   final_dollar_value = raw_dollar_value × (1 - sybil_penalty_pct / 100)
   Example: 82,000 × (1 - 0.22) = 63,960

5. DERIVE SCORE
   alignment_score ≈ round(final_dollar_value / 1000)
   Example: 63,960 / 1000 ≈ 64

6. ASSIGN TIER
   Based on alignment_score (see tier table below)
```

### Alignment Tier Bands

Derived from 37 leaderboard users:

| Tier | Score Range | Users | Description |
|------|------------|-------|-------------|
| Active Contributor | 80+ | 1 | Top-tier, sustained high-quality output |
| Contributor | 64-65 | 2 | Consistent, verified contributions |
| Ramping | 40-41 | 2 | Building momentum, proving value |
| Early | 21-33 | 12 | Active but still establishing trust |
| Inactive | 0-7 | 20 | No recent meaningful activity |

### What Drives Alignment Up

From the LLM reasoning and data patterns:
- **Network tasks** (0.5 weight) — building infrastructure, tooling, ecosystem
- **Verifiable evidence** — GitHub repos, live URLs, specific technical details
- **Diverse capabilities** — engineering + strategy + content
- **Context document maintenance** — shows active engagement
- **Social proof** — verified accounts, follower counts feed into sybil score which reduces penalty

### What Hurts Alignment

- **High sybil risk** — directly applies percentage penalty (22% in our case)
- **Personal-only tasks** — only 0.1 weight vs. 0.5 for network
- **Low context updates** — suggests passive engagement
- **Volume without quality** — the LLM evaluates verifiability, not just quantity

---

## Sybil Score

**Sources:**
- `GET /api/account/summary` → `provider_metrics` (inputs)
- `GET /api/tasks/summary` → `alignment.evidence.sybil_score` (output)
- `GET /api/leaderboard` → `rows[].sybil_score`, `rows[].sybil_risk` (network-wide)

### What It Measures

The sybil score assesses how likely a user is a **real, unique human** rather than a bot or duplicate account. Higher score = more trusted.

### Input Data (Provider Metrics)

The system pulls metrics from linked social accounts:

**X/Twitter metrics:**
```json
{
  "verified": true,
  "verified_type": "blue",
  "posts_count": "<count>",
  "listed_count": "<count>",
  "followers_count": "<count>",
  "following_count": "<count>",
  "account_created_at": "<iso-date>"
}
```

**GitHub metrics:**
```json
{
  "email_verified": true,
  "gists_count": "<count>",
  "followers_count": "<count>",
  "following_count": "<count>",
  "repositories_count": "<count>",
  "account_created_at": "<iso-date>"
}
```

### Likely Scoring Factors

Based on cross-referencing scores across the leaderboard:

| Factor | Signal | Weight (inferred) |
|--------|--------|-------------------|
| Account age | Older = harder to fake | High |
| Follower count | Social proof of real identity | High |
| Verification status | Twitter Blue, email verified | Medium |
| Post history | Active real account vs. dormant shell | Medium |
| Multiple providers | Both GitHub + X linked | Medium |
| Activity velocity | Very high velocity flags as suspicious | Negative |

### Sybil Risk Bands

Derived from 37 leaderboard users:

| Risk Level | Score Range | Users | Sybil Penalty (est.) |
|------------|-----------|-------|---------------------|
| Moderate | 60-62 | 2 | ~15-18% |
| Elevated | 43-52 | 12 | ~20-25% |
| High Risk | 11-39 | 23 | ~30-50%+ |

**Note:** We only have one confirmed penalty mapping: sybil_score=51 → sybil_penalty_pct=22. The penalty likely scales inversely with score.

### Impact on Ranking

Sybil score affects the leaderboard in two ways:
1. **Direct contribution** to leaderboard_score (coefficient ~0.099)
2. **Indirect penalty** on alignment_score via sybil_penalty_pct

---

## Task Classification & Rewards

### Task Categories & Weights

| Category | Weight | Trigger Phrase | Description |
|----------|--------|----------------|-------------|
| `network` | **0.5** | "request a network task" | Advances Post Fiat ecosystem |
| `alpha` | **0.4** | "request an alpha task" | Expert intelligence / market info |
| `personal` | **0.1** | "request a personal task" | Self-improvement based on context |
| `default` | **0.1** | — | Uncategorized |

### Chat Classification System

Messages are classified by an LLM (`google/gemini-3-flash-preview`) into one of 11 tags:

| Tag | Description |
|-----|-------------|
| `task_request_network` | Explicit network task request |
| `task_request_personal` | Explicit personal task request |
| `task_request_alpha` | Explicit alpha task request |
| `task_discussion_network` | Exploring a network task idea |
| `task_discussion_personal` | Exploring a personal task idea |
| `task_discussion_alpha` | Exploring an alpha task idea |
| `clarity_app` | Questions about the Task Node UX/product |
| `clarity_post_fiat` | Questions about PFT token/ecosystem |
| `brainstorming` | Ideation without task framing |
| `ODV` | ODV persona invocation |
| `motivation` | Request for motivation/pep talk |

**Key rule:** `task_request_*` requires explicit phrasing like "request a task", "generate a task", "give me a task". Without these triggers, the system classifies as `task_discussion_*` (no task generated).

### Reward Tiers

Tasks are evaluated and rewards can be upgraded or downgraded from the initial offer:

| Tier | Typical Multiplier | Description |
|------|-------------------|-------------|
| `exceptional` | >1.5x | Outstanding, exceeded expectations |
| `very_good` | ~1.1-1.5x | Strong contribution, quality work |
| `good` | ~1.0x | Met expectations |
| `standard` | ~0.8-1.0x | Acceptable but unremarkable |
| `minimal` | ~0.1x | Barely met requirements |

### Alpha Task Scoring — Sybil Similarity & Novelty

Alpha tasks are scored on **novelty**, not thoroughness. The verifier computes a "sybil similarity" score that measures how closely the submission resembles publicly available information. High sybil similarity = consensus narrative = lower reward.

**Observed example (Feb 2026):**
- Task: "Analyze Divergent GPU Lifecycle Strategies: Cloud vs Frontier Labs"
- Initial offer: 3,200 PFT
- Actual reward: 1,050 PFT (score: 52, tier: average)
- Verifier feedback: "Sybil similarity is high (0.85), indicating this is a consensus narrative. Novelty score is capped accordingly."
- Root cause: Evidence was backed entirely by public web sources (eBay listings, news articles, analyst reports). The proprietary insight (from an NVIDIA director) was diluted by confirmatory public data.

**Lessons for maximizing alpha task rewards:**
1. **Lead with proprietary framing** — emphasize what you know from non-public sources (conversations, insider access, direct observation) rather than what Google can confirm
2. **Don't over-cite public sources** — the verifier penalizes submissions that look like web research compilations. Public data points should support, not constitute, the analysis
3. **Novelty > thoroughness** — a short, sharp insight the verifier can't find via search scores higher than a comprehensive but publicly-derivable analysis
4. **The sybil similarity check is automated** — likely compares submission text against web search results. Unique framing and original synthesis reduce similarity score

### Daily Rewards Endpoint

`GET /api/tasks/rewards/daily?days=28` provides per-day breakdown:

```json
{
  "daily": [
    {
      "date": "2026-02-03",
      "total": 54550,
      "personal": 0,
      "network": 54550,
      "alpha": 0,
      "tasks_personal": 0,
      "tasks_network": 8,
      "tasks_alpha": 0
    }
  ],
  "categoryTotals": {
    "personal": {"tasks": "<count>", "pft": "<amount>"},
    "network": {"tasks": "<count>", "pft": "<amount>"},
    "alpha": {"tasks": 0, "pft": 0}
  },
  "days": 28
}
```

---

## NFT System

**Endpoints:** `/api/nfts/gallery`, `/api/nfts/prepare-mint`, `/api/nfts/confirm-mint`, `/api/nfts/profile-picture`

### NFT Mint Flow

```
1. POST /api/nfts/prepare-mint
   Body: { image_url, name, description }
   Response: { mint_id, tx_json, image_cid, metadata_cid }
   
2. Sign tx_json with wallet (client-side XRPL signing)

3. POST /api/transactions/submit
   Body: { signed_tx_blob, source }
   Response: { tx_hash, engine_result }

4. POST /api/nfts/confirm-mint
   Body: { mint_id, tx_hash, nft_token_id }
   Response: { success, nft }

5. (Optional) POST /api/nfts/profile-picture
   Body: { mint_id }
   Sets NFT as profile picture
```

### Profile Settings (NFT-related)

```json
{
  "pfp_mode": "auto_nft",
  "nft_auto_enabled": true,
  "nft_auto_last_run_date": "2026-02-11",
  "nft_auto_next_run_date": "2026-02-12"
}
```

The system supports **auto NFT generation** — profile pictures are automatically generated and can be minted.

### Avatar Generation

`GET /api/profile/avatar` returns an IPFS-hosted avatar:
```json
{
  "avatar": {
    "image_url": "https://pft-ipfs-testnet-node-1.fly.dev/ipfs/bafybei...",
    "generated_at": "2026-02-11T00:30:33.250Z",
    "source": "auto"
  }
}
```

`POST /api/profile/runs` with `{field: "nft_image", force: true}` triggers regeneration.

---

## Messaging & Contacts

### Contacts

`GET /api/contacts` returns:
```json
{
  "contacts": [
    {
      "id": "uuid",
      "wallet_address": "rXXX...",
      "owner_wallet_address": "rYYY...",
      "label": null,
      "notes": null
    }
  ],
  "self_message_key": "...",
  "self_message_key_tx_hash": "..."
}
```

`POST /api/contacts` adds a contact: `{wallet_address, label}`

### Inbox

`GET /api/inbox` returns threaded messages:
```json
{
  "threads": [
    {
      "id": "uuid",
      "contact_id": "uuid",
      "unread_count": 0,
      "last_message_at": "2026-02-05T13:47:10.000Z",
      "wallet_address": "rXXX..."
    }
  ],
  "last_tx_hash": "..."
}
```

---

## XRPL Infrastructure

### Network Configuration

| Component | URL | Port | Status (Feb 11) |
|-----------|-----|------|-----------------|
| TaskNode API | `https://tasknode.postfiat.org` | 443 | **Up** |
| XRPL RPC (scanner) | `wss://rpc.testnet.postfiat.org` | 6007 | **Down** |
| XRPL RPC (signing) | `wss://rpc.testnet.postfiat.org` | 6008 | **Down** |
| IPFS Gateway | `https://pft-ipfs-testnet-node-1.fly.dev/ipfs/` | 443 | Up |

**Note:** Both XRPL ports (6007, 6008) were refusing connections as of Feb 11, 2026. This blocks evidence submission and verification (requires on-chain transactions) but does not affect API-only operations (tasks, chat, leaderboard).

### Key Addresses

| Address | Role |
|---------|------|
| `rwdm72S9YVKkZjeADKU2bbUMuY4vPnSfH7` | Memo/submission receiver |
| `rGBKxoTcavpfEso7ASRELZAMcCMqKa8oFk` | Primary reward wallet |
| `rKt4peDozpRW9zdYGiTZC54DSNU3Af6pQE` | Secondary reward wallet |
| `rJNwqDPKSkbqDPNoNxbW6C3KCS84ZaQc96` | Additional reward wallet |
| `rnQUEEg8yyjrwk9FhyXpKavHyCRJM9BDMW` | PFT token issuer |

### Transaction Flow (Evidence Submission)

```
1. Upload evidence → IPFS → get CID
2. POST /api/pointers/prepare → get unsigned tx_json
3. Sign tx_json locally (XRPL wallet)
4. Submit signed tx to XRPL node (wss://rpc.testnet.postfiat.org:6008)
5. POST /api/tasks/{id}/submit with {cid, tx_hash, artifact_type, evidence_id}
```

### Pointer Memo Encoding

XRPL transactions use protobuf-style memo encoding:
- **MemoType:** `70662e707472` ("pf.ptr")
- **MemoFormat:** `7634` ("v4")
- **MemoData:** Protobuf-encoded fields (CID, schema, kind, flags)

---

## Open Questions

### Unknowns About Alignment

1. **What exact prompt does the LLM receive?** We see the output (`model_reasoning_text`) but not the input prompt.
2. **How does `raw_dollar_value` map to the 0-100 score?** The `÷1000` relationship is approximate. Is there a cap?
3. **Does the LLM see actual task evidence/descriptions** or just aggregate statistics?
4. **How does `target_pft_month: 20,000` factor in?** It's returned but its role is unclear.
5. **What determines `confidence`?** We've only seen "medium".
6. **How often is alignment recomputed?** The `freshness.computed_at` timestamp suggests periodic recalculation.

### Unknowns About Sybil

1. **Exact formula for sybil scoring.** Likely a weighted combination of provider metrics, but we can't confirm without more data points.
2. **How sybil_penalty_pct maps from sybil_score.** We have one data point: score=51 → penalty=22%. Is this linear? Step function?
3. **Is there a "Low Risk" tier above Moderate?** Highest observed score is 62.
4. **Does task velocity directly feed into sybil?** The model reasoning suggests it might.

### Unknowns About Leaderboard

1. **Is the regression formula exact or approximate?** R²=1.000 on 20 points fits perfectly, but there could be rounding or edge cases we haven't observed.
2. **Are there hidden factors** not exposed in the API response?
3. **How are `capabilities` and `expert_knowledge` generated?** Likely LLM-derived from task history.

### Endpoints Not Yet Explored

- `POST /api/transactions/submit` — Generic signed transaction submission (vs. evidence-specific flow)
- WebSocket connections — We haven't captured real-time data channels
- Admin/privileged endpoints — May exist but are not discoverable via normal user traffic

---

## Appendix: Capture Methodology

### Traffic Capture Setup

```bash
# Start mitmproxy with addon
/Users/zion_1/Library/Python/3.12/bin/mitmweb \
  -s agent_integrations/pft_tasknode/captures/capture_addon.py \
  --set web_open_browser=false \
  --set console_eventlog_verbosity=info

# Enable system proxy (routes all macOS traffic)
networksetup -setwebproxy Wi-Fi localhost 8080
networksetup -setsecurewebproxy Wi-Fi localhost 8080

# OR launch dedicated Chrome instance (preferred)
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --proxy-server="localhost:8080" \
  --ignore-certificate-errors \
  --user-data-dir="/tmp/chrome-mitm" \
  "https://tasknode.postfiat.org"

# IMPORTANT: Disable proxy when done
networksetup -setwebproxystate Wi-Fi off
networksetup -setsecurewebproxystate Wi-Fi off
```

### JWT Extraction from Captured Traffic

```bash
# Find Bearer token in JSONL traffic
grep -o 'Bearer eyJ[A-Za-z0-9_\-\.]*' traffic_YYYYMMDD_HHMMSS.jsonl | head -1 | sed 's/Bearer //'

# Set in pft-cli
npx pft-cli auth:set-token "<jwt>"
```

### Analysis Scripts

Regression analysis performed with numpy:
```python
import numpy as np
# X = [alignment_score, sybil_score, monthly_tasks, monthly_rewards/10000]
# y = leaderboard_score_month
coeffs, _, _, _ = np.linalg.lstsq(X_with_intercept, y, rcond=None)
# R² = 1.000
```

---

*This document represents our best understanding of the PFT Task Node system based on API traffic analysis. The backend is closed-source; all findings are empirical.*
