# nova pro hallucinated on-screen text

Task attempted: Generate per-shot audio descriptions with Amazon Nova Pro video understanding (`amazon.nova-pro-v1:0`,
Bedrock Converse, video from an S3 URI) on Sintel 1:30–2:30.
Steps:
  1. System prompt (packages/pipeline/src/prompts.ts) includes: "Read on-screen text verbatim, introduced with
     "Words appear:"."
  2. Sent the clip to Nova Pro via Converse and collected one description per shot.
  3. Checked each description against the frames.
Expected: "Words appear: …" only where text is actually on screen; Sintel 1:30–2:30 has no on-screen text.
Actual: Two descriptions narrated text that is not in the video:
  - "Words appear: The milk is good." on a shot of a bowl of milk.
  - "Words appear: You have no idea what you're dealing with." on a near-black frame.
Cause: Not confirmed. The instruction to read on-screen text appears to prompt the model to produce text even when
none is present.
Severity: High — for an audio-description product, narrating text that is not on screen misleads blind and low-vision
viewers, who have no way to check it.
Workaround: None yet. Candidates: make on-screen text a separate field that must be empty when no text is visible, and
cross-check claimed text with OCR on the shot's frames before it is voiced.
Suggestion: Document text-reading (OCR) accuracy and hallucination behaviour for Nova video understanding on the
video modality page, and recommend a prompt pattern for "read text only if present". A per-segment confidence, or an
explicit "no text visible" signal, would let callers drop unsupported claims.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); AWS CLI 2.x; @aws-sdk v3 (core 3.978.0); Node 22.19; AWS account on the
Free plan, upgraded to the Paid plan on 2026-10-01. Pipeline run on Sintel 1:30–2:30. Observed 2026-10-01.
Links: https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html

## Update 2026-10-01
Cause confirmed: the prompt's unconditional rule "Read on-screen text verbatim, introduced with "Words appear:"" invited
invention. Reproducible: re-running the same near-black shot with the unchanged prompt produced a third, different
invented sentence (`Words appear: "The only way out is through"`).
Fix verified on video input at temperature 0: the text rule is now conditioned on legibility ("only if letters are
clearly legible in the frames … Never invent text") and the prompt has an explicit darkness rule. The black shot became
"Darkness. A faint red glow." and the real "SINTEL" title card was still read ("Words appear: "SINTEL". …").
Decision record: docs/decisions/0003-gate-c.md. The suggestion to Amazon stands: document that Nova video understanding
can invent on-screen text when a prompt asks for it unconditionally, recommend the conditioned pattern, and provide an
OCR-confidence or "no text visible" signal so callers can drop unsupported text.
