# Described — demo video script (2:45)

Draft for DESC-012 (W1-G). Structure from the hackathon runbook §10 (video script template, 2:45) and §9 (definition of
done: < 3:00, public on YouTube or Vimeo, shows the app working on the device). Recording, cut and upload are the
human's. Upload to YouTube as **Public**: the hackathon rules require the video to be publicly visible, so Unlisted is not
enough (deadline Fri 23 Oct 2026, 12:00 PDT). Refreshed 2026-10-23 (main `9d7d7ac`). Every number in the voice-over is sourced in the
right-hand column or in [Sources](#sources); change a number only together with its source.

**Rules for the cut**

- Target 2:40–2:55 (runbook week 5); hard limit < 3:00 (runbook §9).
- Burn captions into the video itself (DESC-012 ticket; runbook §10 note). The film's own narration and the voice-over
  are both captioned; mark Described's narration as `[Narration]` so a viewer can tell it from the voice-over.
- At least two shots are a camera on a tripod pointed at the TV with the remote in frame (runbook §10 note). Screen
  captures (`adb exec-out screencap`, `scrcpy`) are only for the diagrams and close-ups, never for the core loop.
- In the core loop the voice-over **stops** whenever Described's narration plays. The narration is the product; do not
  talk over it.
- Credit the films on screen: a lower third or end card with each Blender film's CC-BY sentence (as in Settings → About &
  licenses), e.g. "Tears of Steel © 2012 Blender Foundation, CC-BY 3.0." The hackathon FAQ says brief, properly attributed
  CC footage is typically fine.
- Wording (decision 0002): say "described" and "on/off". The voice-over may say "AI-drafted" once, in the honest-limits
  line — the app itself never says "AI".

**Vega.** The runbook template asks for a moment of Vega and a moment of Fire OS (runbook §9, §10 "show the same title
on the Vega stick"). Described ships on Fire OS only; the Vega build is deferred
([decision 0004](decisions/0004-vega-deferred.md)), which the hackathon allows ("Fire OS *or* Vega OS",
[decision 0004](decisions/0004-vega-deferred.md) §Decision 1). The video has **no Vega moment**; it says so in one
sentence (beat 5) and the description links decision 0004.

**Universal search.** The template's 0:15 beat ("voice search the title → your app appears") needs Fire TV catalog
integration, which is available to select partners only
([fire-os-bindings §1](platform/fire-os-bindings.md#1-catalog-integration),
[friction log](friction/2026-10-01-fire-tv-catalog-integration-is-partner-only.md)). The video opens the app from Your
Apps & Channels and shows a deep link from `adb`, and says in beat 5 that search is not there.

---

## Beats

| Time | Beat | Picture | Voice-over / sound | Source for every claim |
|---|---|---|---|---|
| 0:00–0:15 | **1. Problem, one number** | Black, then a still of a film frame with the soundtrack only. Title card: "Most video has no audio description." | "Describing a film by hand costs fifteen to seventy-five dollars a minute. So most video never gets described. In the EU, the services people watch through must now be accessible." | $15–75 / min: [3Play Media](https://www.3playmedia.com/blog/how-much-does-audio-description-cost/). EU: [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng), applies from 28 June 2025 to "services providing access to audiovisual media services". |
| 0:15–0:35 | **2. On the device** | **Tripod shot A**: the TV with the Fire TV Stick home screen, remote in hand. Open Your Apps & Channels → Described. First-run panel 1 is spoken by the app voice. Cut to a second angle: Home with the hero "▶ Play with description". Optional insert (screen capture): terminal running `adb shell am start -a android.intent.action.VIEW -d "described://play/<slug>"` and the TV jumping straight into the Player. | "This is Described on a Fire TV Stick. Description is on by default — the first thing it says is that. It opens from Your Apps, or from a deep link." | Fire TV Stick AFTSS, Fire OS 7.7.1.6: [0001](decisions/0001-week0-gates.md) Gate A. On by default: [PLAN non-negotiables](PLAN.md). Deep link format: [fire-os-bindings §2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents). |
| 0:35–1:35 | **3. The core loop, uninterrupted** | **Tripod shot B**, one take if possible. (a) Play with description → a silent shot; the soundtrack dips and the narration speaks; status line bottom-left reads "Description on · Ruth · Captions". (b) Press **Menu** → track sheet: Audio — Original · Audio description; Captions — Off · Captions · Rich captions · Description text. Select **Original**: narration gone. Select **Audio description** again: "Description on" is announced. Choose **Captions** (Tears of Steel has no Rich-captions track). Cutaway, shot B3 (Extended mode off): the whole Sintel at 3:23 with **Rich captions** chosen; `[creature roars]` appears on its own, no dialogue caption on screen (or 5:33, `[woman gasps]`). (c) An extended cue: the film pauses, the ochre bar runs across the bottom while the description is spoken, the film resumes. | Voice-over only in the gaps, ≤ 3 short lines: "The soundtrack ducks nine decibels and the description speaks in the gap between dialogue." … "Menu shows the tracks. Audio description is a second audio track, marked as description in the stream, so Fire TV's own audio-track selector switches to it." … "When there's more to say than the gap allows, Extended mode pauses the film, speaks, and carries on." Let at least 20 s of this beat be the film and its narration alone. | Duck −9 dB, measured 9.03 dB: [0001](decisions/0001-week0-gates.md) §Local dry runs 2. Track names: `packages/shared-ui/src/strings.ts`. Fire TV's track selector is the switch (the player changes HLS audio rendition, Original → AD in 0.5–0.6 s): [PLAN](PLAN.md), [0001](decisions/0001-week0-gates.md) Gate A. Audio rendition with `public.accessibility.describes-video`: [0004](decisions/0004-vega-deferred.md) §Decision 3, [0001](decisions/0001-week0-gates.md) §1. Extended mode / WCAG 1.2.7: [README](../README.md), [DESC-007 device check](device-checks/DESC-007.md). Rich captions on Sintel, `[creature roars]` 3:23 and `[woman gasps]` 5:33: [titles](titles.md) "Published state", [0018](decisions/0018-sdh-trim.md). |
| 1:35–2:05 | **4. How it is built** (30 s, diagram over footage) | Animated diagram over a dimmed loop of the film: Shots → **Qwen3-VL on Bedrock** describes (3–6 key frames per shot) and verifies → **Nova Lite** fits the words into gaps → **DeepSeek v3.2 on Bedrock** joins the cues into one narration → **Polly** generative voice speaks → **ffmpeg** ducks the soundtrack → **Shaka Packager** → HLS on S3 + CloudFront → Fire TV's audio-track selector. Small caption under the diagram: "Quality gate passed: 82.8 % usable (held-out clip 77.4 %), three blind model raters". | "Each shot goes to Qwen3-VL on Amazon Bedrock, which checks its draft against the frames. We tested four models on the same shots, and Qwen won. Nova Lite fits the words into the gaps, DeepSeek on Bedrock joins them into one narration, and Polly's generative voice speaks. With three blind model raters, it passed our quality gate at eighty-three percent, seventy-seven on an untuned clip. End to end it costs about nine cents a minute of film." | Four models on 29 shots: [0003](decisions/0003-gate-c.md) §Replacement bake-off. Gate C g13: 24 / 29 = 82.8 % (Sintel), held-out 24 / 31 = 77.4 % (Tears of Steel), 3 blind Claude raters, bar 70 %: [evaluation.md](evaluation.md#gate-c-results), [0017](decisions/0017-narrative-pass.md) (g13 re-used g12's describe output). ≈ $0.086 / min with the generative voice, list prices: [docs/aws.md](aws.md#cost-per-title). Direct Bedrock calls, no agent: [0005](decisions/0005-describe-direct-bedrock.md). |
| 2:05–2:30 | **5. Ecosystem and open source** | Screen: the vega-media-kit repo page (MIT badge, release tag), then `infra/` (CDK) in an editor, then the `docs/friction/` folder list. | "The player, cue overlay and Fire TV bindings live in vega-media-kit, an open-source library we wrote for this — shared with our second entry, Lingo. The AWS stack is CDK. Every place the tools hurt is a friction log in the repo — like Fire TV search, which is partner-only. Vega OS support is experimental; why is written down in decision 0004." | Kit: [README](../README.md), [0004](decisions/0004-vega-deferred.md). CDK: [docs/aws.md](aws.md). Partner-only search: [fire-os-bindings §1](platform/fire-os-bindings.md#1-catalog-integration), [friction log](friction/2026-10-01-fire-tv-catalog-integration-is-partner-only.md). Friction logs: [docs/friction/](friction/) (28 logs on 2026-10-19; recount only if the number is spoken or shown). Lingo: keep the clause only if Lingo is submitted. |
| 2:30–2:45 | **6. Who it is for, what's next** | **Tripod shot C**: someone on the sofa with the remote, the film playing with description. End card: Described · https://github.com/moiz-lakkadkutta/described · "Try it: the APK is in release v0.1.0" (https://github.com/moiz-lakkadkutta/described/releases/tag/v0.1.0) · "Human-authored description remains the gold standard." · CC-BY credits for the films shown. | "Described is for blind and low-vision viewers, and for every library and broadcaster with video that has no description. It is AI-drafted, for the long tail. Human description is still the gold standard." | Users: PLAN §1 (internal plan, linked from [docs/PLAN.md](PLAN.md)). Honest positioning: [README](../README.md) note, PLAN §12. |

Voice-over length: 288 words (counted 2026-10-23; dashes not counted) at ~150 wpm ≈ 1:55 of speech in 2:45, which leaves the core loop room to be heard. The cut
stays under 3:00.

**Device shots to record (need the stick, a camera and the remote):** A, A2, B, B2, B3, C, and optionally VoiceView (≈ 8 s,
VoiceView reading a focused title) and "Alexa, pause" (≈ 5 s, only if check 14 passes). **Screen or motion graphics only:**
D, E, F.

---

## Shot list

| # | Shot | Capture | Where it is used | Notes |
|---|---|---|---|---|
| A | **[DEVICE]** Fire TV home → Your Apps & Channels → Described → first-run panel 1 (spoken) → Home | **Device, tripod**, remote in frame | Beat 2 | Reset first run in Settings before the take. The prompt clips were published on 2026-10-14 (`pnpm pipeline prompts --run`, [titles](titles.md)), so the panel speaks. TODO(human): shoot. |
| A2 | **[DEVICE]** Deep link into the Player | Screen capture of the terminal + device, tripod | Beat 2 insert | `adb shell am start -a android.intent.action.VIEW -d "described://play/<slug>"` ([fire-os-bindings §2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents)). TODO(human): shoot. |
| B | **[DEVICE]** Core loop: play with description → duck → Menu → Original / Audio description → captions → extended pause with the ochre bar | **Device, tripod**, one take, remote in frame | Beat 3 | Title: `tears-of-steel-40-100` (14 cues, 5 extended). In title time: narration over a silent shot at 0:31 (the smoking cityscape), then the extended pause at 0:43 (the "Dr Amstelwijk" headline); other extended cues at 0:00, 0:08, 0:17 and 0:59. The whole `sintel` (18 extended) is the alternative. Times are from the published `descriptions.vtt`; check them on the stick. Record the TV's audio through a line-out or a close mic, not the camera mic. |
| B3 | **[DEVICE]** Rich captions on the whole Sintel | **Device, tripod** (close enough to read the captions) | Beat 3 cutaway (≈ 5 s) | Title `sintel`; Menu → Captions → Rich captions, then seek to just before 3:23 (`[creature roars]`) or 5:33 (`[woman gasps]`). Turn Extended mode off for B3: both sound cues start exactly on extended cues (3:23.125 and 5:33.745), so the film would pause. The sound caption appears on its own, with no dialogue caption on screen (the next captions start at 3:26.05 and 5:38.49). Only the two Sintel titles have Rich captions, two sound cues each ([titles](titles.md)); music is never tagged, so do not say it is. |
| B2 | **[DEVICE]** Close-up of the status line and the ochre bar | Device, tripod (close) or `adb exec-out screencap -p` stills | Beat 3 cutaways | Screencap may come back black for video surfaces ([friction log](friction/2026-09-26-adb-screencap-black.md)) — prefer the camera. |
| C | **[DEVICE]** Viewer on the sofa, film with description | **Device, tripod**, wide | Beat 6 | TODO(human): who appears on camera, and their consent. |
| D | Pipeline diagram (animated) | Screen / motion graphics | Beat 4 | Boxes and labels exactly as in beat 4; arrow ends at "Fire TV audio-track selector". TODO(human): make it. |
| E | vega-media-kit repo page, `infra/`, `docs/friction/` | Screen capture | Beat 5 | Show the kit's `v0.2.0` release tag and the npm package `@moiz0309/vega-media-kit@0.2.0` (both published 2026-10-15). |
| F | Title cards and end card | Screen / editor | Beats 1, 6 | End card: the repo URL, the v0.1.0 release URL and the films' CC-BY credits (beat 6). |

Audio switch note: switching Original ↔ Audio description fades the sound down, holds a short silence while the
player changes track, and fades back up — about 450 ms in all (TASKS.md DESC-006; before the fade, Gate A measured a
0.5–0.6 s stall, [0001](decisions/0001-week0-gates.md)). If a click or stall is audible in take B, keep it — do not cut
around it in a way that hides it.

## TODO(human) before recording

- [ ] Confirm Lingo is being submitted; if not, cut "shared with our second entry, Lingo" from beat 5.
- [ ] Person on camera for shot C and their consent; who records the voice-over.
- [ ] Optional device shots: VoiceView reading a focused title; "Alexa, pause" only if RUN-2026-10 check 14 passes (voice fix merged in #86; device re-check pending).
- [ ] Final cut length 2:40–2:55 (hard limit < 3:00); burned captions checked against the voice-over text above; CC-BY
      credits on screen.
- [ ] Upload to YouTube as **Public** (not Unlisted); paste the URL into [submission.md](submission.md) and the README.

## Sources

- Hackathon runbook §9, §10 (internal team document, linked from [docs/PLAN.md](PLAN.md); not a public source)
- Decisions [0001](decisions/0001-week0-gates.md), [0003](decisions/0003-gate-c.md), [0004](decisions/0004-vega-deferred.md), [0005](decisions/0005-describe-direct-bedrock.md), [0017](decisions/0017-narrative-pass.md); [evaluation.md](evaluation.md#gate-c-results); [docs/aws.md](aws.md); [titles](titles.md); [fire-os-bindings](platform/fire-os-bindings.md)
- 3Play Media, "How Much Does Audio Description Cost?" — https://www.3playmedia.com/blog/how-much-does-audio-description-cost/ ("ranging from $15 to $75 per minute")
- Directive (EU) 2019/882 (European Accessibility Act) — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng ("They shall apply those measures from 28 June 2025"; scope includes "services providing access to audiovisual media services")
