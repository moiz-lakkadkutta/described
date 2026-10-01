# 0005 — Describe step calls Bedrock directly; no Strands agent

Status: accepted 2026-10-01 (decided by the human)
Ticket: DESC-003 · Follows: 0003 (Gate C: Qwen3-VL 235B on key frames)

## Context

PLAN §3/§10 had a Strands agent drive describe → fit → voice, calling Nova Pro per shot. Gate C replaced Nova Pro with
Qwen3-VL 235B on 3–6 key frames, called through the Bedrock Converse API from `04-describe.ts`. The Strands agent was never
built (`src/agent/strands.ts` was a commented sketch; the SDK was not a dependency).

## Decision

The describe step calls Bedrock Converse directly, once per shot. No agent layer. `src/agent/` is removed.

- **Cost:** the Qwen3-VL calls are the same either way; an agent adds orchestrator-model calls (Nova Lite in the sketch) whose
  input grows with every tool turn. Direct calls add nothing on top of the descriptions.
- **Retries and cost tracking** come from pg-boss jobs (retry policy) and the per-job `costUsd` column (DESC-003), not an agent.
- **Cost rule:** no paid Bedrock, Transcribe or Polly run without the human's go-ahead; tests use recorded fixtures.

Docs: https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html ·
https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-qwen-qwen3-vl-235b-a22b.html
