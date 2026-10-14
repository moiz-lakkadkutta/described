# Nova Lite at temperature 0 gives different replies to the same request

Task attempted: Generate rich captions (SDH) with Amazon Nova Lite (`amazon.nova-lite-v1:0`, Bedrock Converse, forced `emit_sdh`
tool, `inferenceConfig.temperature = 0`) and get the same result when a title is re-run.
Steps:
  1. Built one request from Sintel 1:30–2:30's 11 captions and 8 description cues (packages/pipeline/src/prompts.ts `sdhRequest`).
  2. Sent the identical request twice, seconds apart.
  3. Compared the two `toolUse.input` objects.
Expected: The same reply twice. Temperature 0 is usually read as greedy decoding.
Actual: Two different replies: the first called a cue "fire glows", the second "darkness"; "bearded man holds" became "bearded man
holds staff", and so on. On Tears of Steel the same captions gave no usable additions on the first run and five cues on a `--from text`
re-run, so whether a title shipped a Rich captions track depended on the run.
Severity: Medium. A re-run could add or drop an accessibility track with nothing changed, and a reviewer could not reproduce a result.
Workaround: Pass `topK: 1` through `additionalModelRequestFields: { inferenceConfig: { topK: 1 } }` as well as temperature 0. Cache
each window's reply under a hash of the whole request (`work/{slug}/cache/sdh/`), so a re-run reads the stored reply instead of sampling
again. Every addition is still checked against evidence (packages/pipeline/src/prompts.ts `mergeSdh`).
Suggestion: State on the Nova inference-parameters page whether temperature 0 is greedy, and if it is not, say what to set for
repeatable output (topK 1, a seed). Bedrock Converse has no `seed` field for Nova.
Environment: Apple Silicon Mac, Darwin 25.2 (macOS 26); @aws-sdk/client-bedrock-runtime 3.x; Node 22.19; us-east-1. Observed 2026-10-14.
Links: https://docs.aws.amazon.com/nova/latest/userguide/using-converse-api.html (topK through additionalModelRequestFields) ;
https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html
