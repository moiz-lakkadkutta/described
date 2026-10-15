# 0015 — Narration is complete sentences: articles, a verb, a capital letter and a full stop

Status: proposed 2026-10-15 (human approved one text-quality round before the next Gate C)
Ticket: DESC-033 · Follows: 0003 (Gate C), 0010 (verify pass), 0011 (fit shortener sentences), 0013 (legible text)

## Problem

Gate C g11 failed narrowly — sintel-90-210 19 / 29 and the held-out Tears of Steel 6:30–8:30 20 / 30, against a bar of 21 — and
most fails were text quality, not wrong facts:

- dropped articles: "Man holds staff.", "Small tan dragon bleeds on rooftop.", "… climbs rooftop";
- a lowercase start with no full stop: "a young woman with short red hair, in a grey tank top, in brown trousers climbs rooftop";
- verbless lines: "A man's face pressed against a mechanical device.", "Ornate clock tower with golden dials, debris flying.",
  "Dim, smoky chamber with glowing lines.";
- a misread quote kept by verify: `Words appear: "CULP, I LOVE YOUR HAND"` where the frames show "CELIA, I LOVE YOUR … HAND", partly hidden.

verify.json of both runs shows the verify pass returned almost every telegraphic draft unchanged: its prompt told it to return the
draft unchanged when every detail is visible, so it never added the articles it was allowed to add.

## Decision

1. **Describe prompt** (prompts.ts, `COMPLETE_SENTENCES_RULE`, one line after the present-tense rule): "Write complete
   present-tense sentences: each has a verb and its articles ("a", "the"), starts with a capital letter and ends with a full stop."
   No example sentence — only single words are quoted (a quoted sentence is one the model copies). `DESCRIBE_CACHE_VERSION` 3.
2. **Verify prompt** (verifyPrompt.ts): "Write complete sentences with articles and a verb … to fix the grammar you may add only
   a, an, the, is, are (German: the articles, ist, sind), even when every detail is visible", and the draft is returned unchanged
   only when it is already complete sentences. The word cap line says the added grammar words do not count. The text-clause rule
   gains: any doubt about any letter, or any word even partly hidden, means the whole clause becomes "Words appear." /
   "Text erscheint.". `VERIFY_PROMPT_VERSION` 5.
3. **Verify guard** (04b-verify `checkVerified`): articles and is / are were already free linking words, so "Man holds staff." →
   "A man holds a staff." and "A man's face pressed …" → "A man's face is pressed …" pass. New: a **pure grammar fix** — a reply
   whose only added words are `GRAMMAR` words (a, an, the, is, are; der … eines, ist, sind), no other linking word and no
   "visible" — may go past the shot's word cap by those words, up to `MAX_ADDED_WORDS` (3) over the draft, so a draft already at
   its budget can still become a sentence. Every other guard is unchanged: no new content word, no has / have, names, negations
   and protected words kept, order kept, on-screen text kept or replaced whole. Any other reply keeps the cap.
4. **polishCue(text, language)** (packages/pipeline/src/polishCue.ts, pure): collapses spaces (none before , . ; : ! ?),
   capitalises the first letter of each sentence in the language's locale, and makes the cue end with . ! or ? (a trailing , ; :
   dash or ellipsis becomes a full stop; after a closing quote the full stop goes outside it, unless the quote itself ends with
   . ! ? or …). Quoted text and the text of every on-screen text clause are never touched. It never changes a word. Called in
   two places only: 06-voice, on the text sent to Polly (the stored cue text and the clip sidecar keep the unpolished text, so a
   clip's reuse check is unchanged), and 08-text, on the text written to descriptions.vtt.

## Not changed

05-fit's shortener (article-keeping), sentenceGuard, 04c scenes and 05b-edit belong to the scene / fit / voice work running in
parallel and are not touched here. The DescriptionCue rows the API serves are written from cues.json, so their text is not
polished; the app reads descriptions.vtt and the audio, which are.

## Consequences

- The next Gate C re-runs describe (cache version 3) and verify (prompt version 5) on both clips; about 60 Qwen3-VL calls each.
- A clip voiced before this decision whose cue text is unchanged is reused as it is (the sidecar compares the unpolished text);
  a new Gate C copy starts with no clips, so this matters only for re-runs of an old work dir.
