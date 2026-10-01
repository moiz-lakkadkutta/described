# nova lite json echoes input

Task attempted: Generate SDH captions with Amazon Nova Lite (`amazon.nova-lite-v1:0`, Bedrock Converse, temperature 0):
send the captions plus audio-description cues as JSON and get back the captions with sound tags and speaker IDs.
Steps:
  1. System prompt (packages/pipeline/src/prompts.ts) ends with: "Reply with JSON only:
     {"cues":[{"id","start","end","text","speaker"?,"sound"?}]}".
  2. User message: a JSON envelope `{"language", "captions", "descriptions"}`.
  3. Called Converse with `inferenceConfig.temperature = 0`, no `toolConfig`.
  4. Parsed the reply and mapped `parsed.cues`.
Expected: A JSON object of the shape `{"cues":[…]}`.
Actual: Nova Lite echoed the input envelope `{"language","captions","descriptions"}` back, with sound tags appended to
the description texts instead of inserted as caption cues. `parsed.cues` was undefined and `parsed.cues.map` threw,
crashing the SDH step (step 08) of the pipeline.
Cause: A "JSON only" instruction in the prompt is not enforced; without a tool configuration nothing constrains the
reply to the requested schema.
Severity: Medium — crashed the pipeline's text step; output shape cannot be trusted from a prompt alone.
Workaround: Zod-validated parse of the reply with a fallback to the plain captions as the SDH track when the shape is
wrong (commit 1ceb48c). Next step: send the schema as a forced tool.
Suggestion: Per the Nova user guide, Nova applies constrained decoding whenever a `toolConfig` is passed, and a forced
`toolChoice: {tool: {name}}` makes the reply follow the tool's input schema; Bedrock also documents
`outputConfig.textFormat` (JSON schema) on Converse, with per-model support listed on the model cards. Two asks:
(1) state on the Nova prompting pages that "JSON only" prompts are not constrained and point to the forced-tool pattern
right there; (2) list Nova v1 (Lite/Pro) support for `outputConfig.textFormat` explicitly in the structured-output
page, so a plain-JSON response format does not need a tool wrapper.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); AWS CLI 2.x; @aws-sdk v3 (core 3.978.0); Node 22.19; AWS account on the
Free plan, upgraded to the Paid plan on 2026-10-01. Pipeline run on Sintel 1:30–2:30. Observed 2026-10-01.
Links: https://docs.aws.amazon.com/nova/latest/userguide/concept-chapter-servicename.html ;
https://docs.aws.amazon.com/bedrock/latest/userguide/structured-output.html
