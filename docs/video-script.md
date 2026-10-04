# Described — demo video script (2:45)

Draft for DESC-012 (W1-G). Structure from the hackathon runbook §10 (video script template, 2:45) and §9 (definition of
done: < 3:00, public on YouTube or Vimeo, shows the app working on the device). Recording, cut and upload are the
human's (waves plan H13: record Oct 16–19, YouTube unlisted Oct 20). Every number in the voice-over is sourced in the
right-hand column or in [Sources](#sources); change a number only together with its source.

**Rules for the cut**

- Target 2:40–2:55 (runbook week 5); hard limit < 3:00 (runbook §9).
- Burn captions into the video itself (DESC-012 ticket; runbook §10 note). The film's own narration and the voice-over
  are both captioned; mark Described's narration as `[Narration]` so a viewer can tell it from the voice-over.
- At least two shots are a camera on a tripod pointed at the TV with the remote in frame (runbook §10 note). Screen
  captures (`adb exec-out screencap`, `scrcpy`) are only for the diagrams and close-ups, never for the core loop.
- In the core loop the voice-over **stops** whenever Described's narration plays. The narration is the product; do not
  talk over it.
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
Apps & Channels and shows a deep link from `adb`, and says that search is not there.

---

## Beats

| Time | Beat | Picture | Voice-over / sound | Source for every claim |
|---|---|---|---|---|
| 0:00–0:15 | **1. Problem, one number** | Black, then a still of a film frame with the soundtrack only. Title card: "Most video has no audio description." | "Describing a film by hand costs fifteen to seventy-five dollars a minute. So most video never gets described. In the EU, the services people watch through must now be accessible." | $15–75 / min: [3Play Media](https://www.3playmedia.com/blog/how-much-does-audio-description-cost/). EU: [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng), applies from 28 June 2025 to "services providing access to audiovisual media services". |
| 0:15–0:35 | **2. On the device** | **Tripod shot A**: the TV with the Fire TV Stick home screen, remote in hand. Open Your Apps & Channels → Described. First-run panel 1 is spoken by the app voice. Cut to a second angle: Home with the hero "▶ Play with description". Optional insert (screen capture): terminal running `adb shell am start -a android.intent.action.VIEW -d "described://play/<slug>"` and the TV jumping straight into the Player. | "This is Described on a Fire TV Stick. Description is on by default — the first thing it says is that. You can't find it in Fire TV search yet: catalog integration is for Amazon partners. It opens from Your Apps, or from a deep link." | Fire TV Stick AFTSS, Fire OS 7.7.1.6: [0001](decisions/0001-week0-gates.md) Gate A. On by default: [PLAN non-negotiables](PLAN.md). Deep link format: [fire-os-bindings §2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents). Partner-only: [fire-os-bindings §1](platform/fire-os-bindings.md#1-catalog-integration). |
| 0:35–1:35 | **3. The core loop, uninterrupted** | **Tripod shot B**, one take if possible. (a) Play with description → a silent shot; the soundtrack dips and the narration speaks; status line bottom-left reads "Description on · Joanna · Rich captions". (b) Press **Menu** → track sheet: Audio — Original · Audio description; Captions — Off · Captions · Rich captions · Description text. Select **Original**: narration gone. Select **Audio description** again: "Description on" is announced. Choose **Rich captions**: sound cues in brackets appear. (c) An extended cue: the film pauses, the ochre bar runs across the bottom while the description is spoken, the film resumes. | Voice-over only in the gaps, ≤ 3 short lines: "The soundtrack ducks nine decibels and the description speaks in the gap between dialogue." … "Menu shows the tracks. Audio description is a second audio track, marked as description in the stream itself." … "When there's more to say than the gap allows, Extended mode pauses the film, speaks, and carries on." Let at least 20 s of this beat be the film and its narration alone. | Duck −9 dB, measured 9.03 dB: [0001](decisions/0001-week0-gates.md) §Local dry runs 2. Track names: `packages/shared-ui/src/strings.ts`. Audio rendition with `public.accessibility.describes-video`: [0004](decisions/0004-vega-deferred.md) §Decision 3, [0001](decisions/0001-week0-gates.md) §1. Extended mode / WCAG 1.2.7: [README](../README.md), [DESC-007 device check](device-checks/DESC-007.md). |
| 1:35–2:05 | **4. How it is built** (30 s, diagram over footage) | Animated diagram over a dimmed loop of the film: Shots → **Qwen3-VL on Bedrock** (3–6 key frames per shot) → **Nova Lite** fits the words into gaps and writes rich captions → **Polly** speaks → **ffmpeg** ducks the soundtrack → **Shaka Packager** → HLS on S3 + CloudFront → Fire TV's audio-track selector. Small caption under Qwen3-VL: "72.4 % usable, two raters". | "Each shot goes to Qwen3-VL on Amazon Bedrock. We tested four models on the same twenty-nine shots; Qwen won, and it passed our quality gate at seventy-two percent. Nova Lite fits the words into the gaps, Polly speaks them, ffmpeg mixes, and the narration arrives through Fire TV's own audio-track selector. The description step costs about three cents for two minutes of film." | 72.4 %, 29 shots, four models compared: [0003](decisions/0003-gate-c.md) §Replacement bake-off, §Confirmation run. Gate threshold 70 %: [0001](decisions/0001-week0-gates.md) Gate C. ≈ $0.03 per 2 min (describe step only): [docs/aws.md](aws.md), [0003](decisions/0003-gate-c.md). Direct Bedrock calls, no agent: [0005](decisions/0005-describe-direct-bedrock.md). |
| 2:05–2:30 | **5. Ecosystem and open source** | Screen: the vega-media-kit repo page (MIT badge, release tag), then `infra/` (CDK) in an editor, then the `docs/friction/` folder list. | "The player, cue overlay and Fire TV bindings live in vega-media-kit, an open-source library we wrote for this — shared with our second entry, Lingo. The AWS stack is CDK. Every place the tools hurt is a friction log in the repo. Vega OS support is experimental; why is written down in decision 0004." | Kit: [README](../README.md), [0004](decisions/0004-vega-deferred.md). CDK: [docs/aws.md](aws.md). Friction logs: [docs/friction/](friction/) (16 logs on 2026-10-04 — TODO(human): recount before recording). |
| 2:30–2:45 | **6. Who it is for, what's next** | **Tripod shot C**: someone on the sofa with the remote, the film playing with description. End card: Described · GitHub URL · "Human-authored description remains the gold standard." | "Described is for blind and low-vision viewers, and for every library and broadcaster with video that has no description. It is AI-drafted, for the long tail. Human description is still the gold standard." | Users: PLAN §1 (internal plan, linked from [docs/PLAN.md](PLAN.md)). Honest positioning: [README](../README.md) note, PLAN §12. |

Voice-over length: ≈ 260 words at ~150 wpm ≈ 1:45 of speech in 2:45, which leaves the core loop room to be heard.

---

## Shot list

| # | Shot | Capture | Where it is used | Notes |
|---|---|---|---|---|
| A | Fire TV home → Your Apps & Channels → Described → first-run panel 1 (spoken) → Home | **Device, tripod**, remote in frame | Beat 2 | Reset first run in Settings before the take. The spoken prompt needs the Polly prompt clips (DESC-010 prompt-clip run); if they are not published, the panel is silent — cut "the first thing it says is that" from beat 2. TODO(human): shoot. |
| A2 | Deep link into the Player | Screen capture of the terminal + device, tripod | Beat 2 insert | `adb shell am start -a android.intent.action.VIEW -d "described://play/<slug>"` ([fire-os-bindings §2](platform/fire-os-bindings.md#2-launch-and-deep-link-intents)). TODO(human): shoot. |
| B | Core loop: play with description → duck → Menu → Original / Audio description → Rich captions → extended pause with the ochre bar | **Device, tripod**, one take, remote in frame | Beat 3 | Needs a published title with ≥ 1 extended cue — `sintel-90-210` has none ([DESC-007 device check §0](device-checks/DESC-007.md)). TODO(human): pick the title and the timestamp of a silent shot and an extended cue after the DESC-010 batch. Record the TV's audio through a line-out or a close mic, not the camera mic. |
| B2 | Close-up of the status line and the ochre bar | Device, tripod (close) or `adb exec-out screencap -p` stills | Beat 3 cutaways | Screencap may come back black for video surfaces ([friction log](friction/2026-09-26-adb-screencap-black.md)) — prefer the camera. |
| C | Viewer on the sofa, film with description | **Device, tripod**, wide | Beat 6 | TODO(human): who appears on camera, and their consent. |
| D | Pipeline diagram (animated) | Screen / motion graphics | Beat 4 | Boxes and labels exactly as in beat 4; arrow ends at "Fire TV audio-track selector". TODO(human): make it. |
| E | vega-media-kit repo page, `infra/`, `docs/friction/` | Screen capture | Beat 5 | Show the kit's release tag only once it exists (H11). |
| F | Title cards and end card | Screen / editor | Beats 1, 6 | End card URL: TODO(human). |

Crossfade note: switching Original ↔ Audio description is a hard cut until the kit's `setVolume` lands (TASKS.md
DESC-006; Gate A measured a 0.5–0.6 s stall on the switch, [0001](decisions/0001-week0-gates.md)). If the click or stall
is audible in take B, keep it — do not cut around it in a way that hides it.

## TODO(human) before recording

- [ ] Title and timestamps for shot B (a silent shot, an extended cue) — after the DESC-010 batch.
- [ ] Recount friction logs for beat 5; update the number only if it is spoken or shown.
- [ ] Confirm the kit is on npm with a release tag (H11) before showing it in shot E; otherwise show the GitHub repo only.
- [ ] Confirm Lingo is being submitted; if not, cut "shared with our second entry, Lingo" from beat 5.
- [ ] Person on camera for shot C and their consent; who records the voice-over.
- [ ] Final cut length 2:40–2:55; burned captions checked against the voice-over text above.
- [ ] YouTube unlisted upload Oct 20; paste the URL into [submission.md](submission.md).

## Sources

- Hackathon runbook §9, §10 (internal team document, linked from [docs/PLAN.md](PLAN.md); not a public source)
- Decisions [0001](decisions/0001-week0-gates.md), [0003](decisions/0003-gate-c.md), [0004](decisions/0004-vega-deferred.md), [0005](decisions/0005-describe-direct-bedrock.md); [docs/aws.md](aws.md); [fire-os-bindings](platform/fire-os-bindings.md)
- 3Play Media, "How Much Does Audio Description Cost?" — https://www.3playmedia.com/blog/how-much-does-audio-description-cost/ ("ranging from $15 to $75 per minute")
- Directive (EU) 2019/882 (European Accessibility Act) — https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng ("They shall apply those measures from 28 June 2025"; scope includes "services providing access to audiovisual media services")
