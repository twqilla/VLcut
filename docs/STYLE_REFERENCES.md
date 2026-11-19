# Style references

Notes from the user's reference screenshots (three of five videos seen so far; stills only, no motion
or sound). These are principles to translate into original styles in Phase 6, not designs to copy.

## A. Warm editorial explainer ("raw vs edited" split)
- Type: heavy grotesque sans paired with an italic serif inside the same headline; small monospace
  labels on chips ("RAW" on dark, highlight label on amber).
- Palette: warm olive-brown background, cream text, one amber accent.
- Composition: side-by-side before/after cards; full-screen typographic cards with mixed word sizes,
  HUD-style mono metadata in corners, a thin progress bar.
- Captions: word-by-word reveal, one keyword tinted in the accent colour; words can follow a curved path.

## B. Dark product demo with neon glow
- Palette: near-black with a single saturated green and soft glow.
- Motion: interface pieces float in over footage as if in 3D space; pill-shaped tabs.
- Captions: word-by-word reveal where inline icons replace some words.

## C. Kinetic typography in depth
- Type: words placed at different depths, sizes and angles around the subject; strong size hierarchy
  with one emphasised word; a hand-drawn scribble word as an accent; mixed fonts per word.
- Palette: saturated warm orange / red scenes.
- Stated rules visible in one frame: story first then style, every cut lands on a beat, text moves in
  3D and is never flat, a sound for every motion.

## Engine requirements these imply
- Per-word caption timing with per-word style (colour, font, size) and inline images.
- Text on a path and text with 3D perspective transforms.
- Font pairing (sans + italic serif + mono) as a first-class style property.
- Split-screen / card layouts, corner HUD labels, progress bars as reusable graphics.
- Beat-synced cuts and a sound effect hook on every animation.

## D. Explainer diagram over talking head (fourth reference)
- Layout: 9:16 split, animated diagram panel on top, talking head below.
- Graphics: rounded-square app-icon tiles in a row with soft coloured rim glow and numbered badges;
  simplified mock browser windows; a mascot connected to interface elements by glowing curved lines
  with small pill labels; lock icons with status chips.
- Palette: deep navy-black with dim vignette; each element carries one accent (teal, violet, orange, blue).
- Captions: bold uppercase white with heavy black outline, the active word on a solid red-pink box.

Adds to engine requirements: split-screen layout presets, icon-tile rows with staggered entrance,
connector lines that draw on, active-word background box captions.
