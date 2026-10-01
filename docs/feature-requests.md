# Feature requests (with priority)

| Priority | Platform | Request | Why |
|---|---|---|---|
| P1 | AWS (Transcribe / Bedrock Nova) | An AWS-native audio-event (sound classification) capability — e.g. Transcribe returning labelled non-speech events with timestamps, or Nova audio understanding — to feed `[sound]` cues in rich captions. | Transcribe gives speech only, no audio-event labels, so our rich-caption sound tags stay sparse (Nova Lite guesses them from text and invents non-sounds). P1, not P0: captions and descriptions ship without it, but SDH quality for deaf and hard-of-hearing viewers is capped until it exists. |
