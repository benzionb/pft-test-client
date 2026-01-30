# Task Node Proto Schema

This folder contains the Task Node domain schema derived from reverse
engineered API traffic and task generation metadata.

## Observed (from captures)

- Task lifecycle fields from `/api/tasks/summary` and `/api/tasks/{id}`
- Verification requests from `/api/tasks/{id}/verification`
- Task generation payloads from `metadata.odv.task_generation` in
  `/api/chat/messages`

## Not Observed (explicit gaps)

- Governance payloads (votes, proposals, validator governance)
- Canonical on-chain memo/protobuf format

`GovernanceMessage` in `pft_tasknode.proto` is speculative and should
be replaced once governance traffic is captured.

## Evidence

This file supports the Task Node task:
\"Define Protobuf Schemas for Post Fiat SDK Messaging\"
