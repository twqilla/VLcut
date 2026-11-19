# Development log

Status of each phase of the master specification. "Verified" means covered by an automated test that
was run and passed: 60 unit/integration tests (`npm test`, using real FFmpeg) and a 103-check
end-to-end run of the built **and packaged** app (`npm run e2e`) on Linux under Xvfb.

## Look and layout (redesign)

Black and deep navy surfaces (pure black behind the timeline, preview and header) with one bright blue
(`#2f80ff`) used as a thin inline. Corners are square everywhere. No logo or decorative header: a plain black bar with
← Projects, the project name, save state, a "More" menu (clips folder, split view, send to clip prep) and Export.
The timeline toolbar is Undo, Redo, Split, Delete and one "+ Add" menu (text, shape, effects layer, tracks,
duplicate, split screen). Previously: selected clips, the glowing
playhead, active tabs, focused fields and the primary buttons. Panels are rounded cards separated by
gaps that double as drag handles (a blue hairline appears under the pointer). Inter throughout.
Layout: the library (Media, Audio, Styles, Text, Captions, Effects, Transitions, History) sits on the
top left over the timeline; the preview is one tall column on the right that runs alongside both, with
Properties and the Assistant under it. The preview scales to the largest size that fits and keeps the
project's shape. All three splits are resizable and remembered. Lists in the wide library flow into columns.

## Phase 1: desktop foundation — done, verified
Electron + React + TypeScript. Projects: create, rename, duplicate, delete, autosave (1.5 s), Ctrl+S,
atomic writes, rolling backups, recovery from a corrupt file. Resizable, remembered panels.

## Phase 2: media import and playback — done, verified
File picker and drag-and-drop import, ffprobe metadata, source preview, waveforms (cached), a
`media://` protocol with range requests. Files the app cannot decode (ProRes, HEVC, MPEG-2…) get an
H.264 proxy automatically. Missing files are flagged and can be relinked.

**Clips tab**: the home screen has a second tab that watches a folder of recordings. Every video in it
(and in subfolders, four levels deep) is listed newest first with a thumbnail; a click plays it immediately (no project, no import), start and
end points can be marked and saved as a lossless trimmed copy beside the original, and one button opens
the clip (or just the marked part) on a timeline. The project references the original file, so there is
no export-then-import step. Verified end to end with a 120 fps clip.

**Split view**: the **Split view** button puts the project on the left half of the screen and opens its
clip-prep workspace on the right half. Clip prep is a full editor with five empty tracks, saved with the
project: pile clips onto any track, trim, split and adjust them, then select clips and press **Send to
project** (or Enter). They arrive at the main project's playhead with their trims, speed and effects, as
one undo step; the prep workspace keeps its copies. Clips can also be sent the other way, from the
project to clip prep (**Send to clip prep**), or **dragged** from one window's timeline onto the other's:
the receiving timeline shows the lane and the time where they will land, and they are dropped there.
Verified with a simulated mouse drag across the two windows. (Fixed on the way: a clip being dragged on
its own track lost the mouse after its first move.) Implemented as two windows of the same app, each a
complete editor, so nothing in the editing engine is special-cased. Verified end to end.

## Phase 3: timeline and editing engine — done, verified
Pure-function engine in `src/shared/timeline`: add, move (between tracks), trim, split, ripple cut,
duplicate, copy/paste, speed, reverse, tracks (add, delete, reorder, resize, mute, hide, lock),
snapping, frame-accurate positions, keyframes with easing for position, scale, rotation, opacity and
volume. Undo/redo with a labelled history panel.

## Phase 4: rendering and export — done, verified
One renderer for preview and export: a hidden window draws each frame with the preview's compositor
and pipes pixels to FFmpeg, which also mixes the audio (per-clip speed, reverse, volume keyframes,
fades, noise reduction, optional loudness normalisation). Progress, ETA, cancel, error text, no
partial files. The test renders a file and checks codec, size, frame rate, duration, audio and pixels.

**Frame blending**: a per-clip switch (Speed section) that mixes the two source frames a moment falls
between, so slow motion looks smooth instead of steppy. Applied in the export; the preview shows single
frames. Verified on a black/white flicker clip at half speed: grey (about 130) with it, pure black or
white without.

**Motion blur on export, with interpolini**: the editor's motion blur is now [interpolini](https://github.com/Z1xus/interpolini)
(GPL-3.0). interpolini interpolates footage to a very high frame rate with RIFE (AI) or SVP on the graphics
card and blends it back down with a weighted average. The export dialog exposes its own settings under its own
names (engine, interpolation fps, intensity, weighting with its eight options, gamma, duplicate removal, half-size
search, speed, tuning, algorithm) with its own defaults, and a chart of how the frames of one blend are weighted.
How it works: for each stretch of footage the timeline uses, the editor trims a plain copy, runs
`interpolini-cli -g -j -s ...` on it, reads its JSON progress lines, and uses the blurred file it returns as the
footage for that export. The program is downloaded on request (Windows: Export dialog, "Download interpolini";
it is not bundled in the installer) or found on the PATH.
**Verified:** the blend weights are a port of interpolini's own `weights.rs`, checked against that code
compiled from its source for 1,728 combinations (identical to 12 decimal places); the command line and reply
parsing against the contract in interpolini's `crates/cli/src/main.rs`; the whole flow in an end-to-end test
using a **stand-in program** that follows that contract.
**Not verified:** a render by the real interpolini. It needs a graphics card with Vulkan and downloads AI models
on first run, and could not be run in this build environment. The Windows build runs the real program's `--version`,
`--help` and a trial render as a check (see the workflow log). Limits: only the footage is blurred (text and
graphics added in the editor are not); speed changes and reverse are applied after the blur; failures from
interpolini stop the export with its own message rather than being skipped. The earlier FFmpeg-based blur has
been removed; "Quick" (blending moments of the timeline) remains as a separate, much simpler option.

**Blurred clips, no export needed**: a clip's Properties have a *Motion blur* section (and a library file has
"Make a blurred copy"). It runs interpolini once on just the part of the file the clip uses (plus half a
second each side), keeps the result on disk, and points the clip at it, so the blur shows in the preview
at once and the export simply uses it. The original stays in the project; Undo and "Remove blur" put the
clip back exactly. Sound is kept (muxed back from the original). The same part with the same settings is
reused instantly. The export's own interpolini mode skips clips that are already blurred. Several selected
clips can be blurred in one go; progress and Cancel are shown. A blurred copy is a normal library file that
can be dragged onto the timeline. Verified with the stand-in program (the real one needs a graphics card).
**Cut accuracy:** the footage is trimmed by re-encoding, not by stream copy, so cuts are frame-accurate even
when far from a keyframe (tested on a video with one keyframe in 4 seconds). Only the "Fast export" and the
Clips tab's "Save trimmed copy" copy streams and so start on a keyframe. The blurred copy has the project's
frame rate, so inside it a cut lands on that rate's frames.

**Remove audio from clips**: per clip (Audio section of Properties), for the selection or all video clips
(Audio tab), through the assistant ("remove the audio from the clips"), or automatically for new clips
(checkbox in the Audio tab). Lossless fast export honours it (stream copy with no audio).

**Cutting to the music**: snare detection (kick, snare and hi-hat bands compared; tested on eight random
synthetic drum tracks, 12 of 12 each with no strays; **not tested on real recorded music**, where
softer or layered snares may be missed). Beat and snare marks show on the timeline ruler (snares in red),
clips and the playhead snap to them (Beats and Snares buttons), **Auto-cut** chops the main track on
every beat, every 2nd or 4th beat, or every snare (with a slight alternating punch-in so cuts are
visible), and existing cuts can be snapped to snares. The assistant understands "auto cut to the beat",
"cut on the snares", "snap the cuts to the snare".

**Sharp pixels (nearest-neighbour) scaling**: a project setting (and an export checkbox) that enlarges
footage with hard blocky pixels instead of smoothing, for pixel art, game capture and low-resolution
clips. Used by the preview and the export. Verified on a checkerboard in both. Footage is otherwise
scaled up smoothly; there is no AI upscaler.

**Fast export (no re-encoding)**: when the timeline is only straight cuts of one file (or matching
files) on one track, the export dialog offers a stream copy, like a dedicated lossless cutter. Quality
and frame rate are exactly the source's (tested with 240 fps footage: video packet sizes match the source's),
and it takes seconds. Each cut starts on the keyframe at or before the chosen point, so a cut can begin
slightly early; when it is unavailable the dialog says why. Projects and exports also accept 120 and 240 fps.

## Phase 5: effects and transitions — done, verified
30 effects with parameters (colour, split tone, black & white, sepia, invert, colour wash, blur, motion
blur, tilt-shift, zoom blur, glow, vignette, grain, flicker, letterbox, pixelate, scan lines, VHS, light
leak, spotlight, RGB separation, glitch, wave, mirror, tile, shake, zoom pulse, strobe, spin, slow
push-in). Effects stack in order on a clip, and 14 ready-made **stacks** (VHS Tape, Old Film, Noir, Dream,
Music Video, Impact Hit, Neon Night, Vaporwave, Security Cam, Golden Hour, Miniature, Broken Signal,
Spotlight Focus, Kaleidoscope) add a combination in one click on top of what is there; a clip's stack
can be saved as your own. A test applies all of them to one clip at once and checks for errors.
17 transitions, 11 text animations, effects layers, clip masks (ellipse / rectangle, feather, invert) and
animated shape clips (box, circle, line with fade, grow and draw-on). 12 bundled open-licence fonts.

**Added for the full-spec pass:** text layouts (curved along an arc, scattered words at their own size
and angle, pseudo-3D tilt); connector-curve and tile-row shapes that draw on and pop in; split-screen
layouts (side by side, top and bottom, grid) that crop and place selected clips to fill their cells;
hand-drawn masks (click corners on the preview) and animated masks (the mask glides to an end position
and size over the clip); resize (Shift-drag or scroll) and rotate (Ctrl-drag) on the preview;
custom font files; imported images placed inside text or captions as icons by writing {name};
natural motion blur on export (several moments averaged per frame); 16-step speed ramps.

## Phase 6: editing style engine — done, verified
Ten styles in `src/shared/styles`: Cinematic, Editorial, Hype, Analog, Luxury, Glitch, plus four
derived from the reference screenshots (Studio Warm, Neon Product, Kinetic Type, Explainer Pop; see
`STYLE_REFERENCES.md`). Applying a style writes editable content: a Look effects layer, per-clip camera
movement, transitions, typography for titles and captions, synthesised sound effects on cuts, fades,
music ducking, and beat-synced cuts. Live thumbnails, strength control, save your own variation.

## Phase 7: subtitles and audio — done; speech recognition NOT verified here
Verified: caption generation from word timings, captions following edits, ten caption designs,
per-word correction, active-word highlight and box, `.srt` import, `.srt`/`.vtt` export, waveforms,
volume keyframes, fades, ducking, normalisation, noise reduction, beat detection, six synthesised
sound effects with an Audio tab to place them at the playhead and run the audio tools, multiple audio tracks.
**Not verified:** the whisper.cpp integration end to end. This build environment cannot reach the
model or program downloads, so only the output parser is tested (against the documented JSON shape).
The in-app "Download and set up" button, the pinned Windows download URL and real transcription need
a first run on a real machine.

## Phase 8: AI assistant — done, verified (built-in planner); local model path NOT verified
Offline rule-based planner covering the eight example requests and more; plans run through the same
editing tools as the UI; each step is its own undo entry, can be undone individually, and a restore
point is written to disk first. Unknown requests are answered honestly instead of guessed.
**Not verified:** the optional Ollama path (prompting and validation are tested with fixtures; no
real model was available).

## Phase 9: performance, testing, polish — partly done
Done: background analysis queue, proxies, cached waveforms, streaming decode for long files, preview
quality setting, cached clip thumbnails on the timeline, packaged build tested.
Export speed: profiling showed 145 ms of every 195 ms frame went on seeking, because a seek decodes
from the previous keyframe. The exporter now first makes a visually lossless, all-keyframe copy of only
the footage the timeline uses, and encodes in parallel with drawing. Measured on the 4-core, no-GPU
test machine: 1080p went from about 5 to about 17 frames per second, and the 720p test export from 30 s
to 6 s. The copies live in a temporary folder and are deleted when the export ends.
Storage: the home screen lists what the app stores (projects, proxies, waveforms, thumbnails, speech
models, sound effects) with sizes and clear buttons for the caches.
**Resuming an interrupted export**: the picture is encoded in parts of 240 frames in a `.parts` folder
beside the output. If the export is interrupted (crash, power cut, closing the app) the finished parts
stay, and exporting the same project with the same settings to the same file continues from there; the
dialog says how many parts were reused. A deliberate cancel deletes them. Verified by killing the render
window mid-export and exporting again.

## Phase 10: effects, text, compositing, camera, sound, assistant, settings
Each item below has a unit test and, where it has a screen, an end-to-end check; the notes say what the test proves.
- **Effects (33 + 9 + 5)**: blur, distortion, light, colour and texture families, compositing effects (key,
  shadows, stroke, corners, reflection, corner pin, LUT) and camera effects. The end-to-end run renders every
  one on a real frame and fails on any error or blank picture. *Datamosh is a look-alike (blocks dragged along
  motion-like vectors), not real codec datamoshing.*
- **Transitions (17 new)**: every one has its own behaviour (a test rejects any that fall back to a plain fade).
- **Text**: fonts by category, fills, glow, extrusion, distortion, per-letter animations, exit animations.
  Verified for errors and by looking at renders; not pixel-asserted.
- **Compositing**: blend modes, track matte (verified: corner goes black through a text matte), chroma key,
  LUT import/export (verified: an imported inverting LUT inverts the picture; an exported grade is a valid
  33³ `.cube`), scopes.
- **Motion analysis** (`src/shared/analysis/motion.ts`): median-of-blocks shift estimation with sub-pixel
  refinement. Tested against footage rendered with *exactly known* shake: stabilising removes most of the
  shake in both directions, and the tracker follows a point to within 0.6 % of the frame. Not tested on real
  handheld footage. Face and object tracking, depth maps and 3-D camera solving are not possible without ML
  models and are not built.
- **Rotoscoping**: polygon masks with keyed shapes and draggable corners. **Keyframe curves**: custom Bézier.
- **Sound**: each effect is defined once and yields both FFmpeg filters (export, tested on real audio:
  bass raises low tones, echoes arrive on time, pitch doubles the frequency, centre removal removes the
  centre) and Web Audio nodes (live preview, not measured). Pitch shift and voice enhance are export-only.
  Vocal "isolation" is centre-channel extraction, not AI separation.
- **Text-to-speech**: Windows (System.Speech), macOS (`say`) and Linux (espeak-ng). Only Linux was run;
  Windows and macOS are command-construction tests (text and voice never reach a command line).
- **Audio visualiser**: FFT spectrum (tested against pure tones), five styles, drawn in preview and export.
- **Assistant**: 25 new tools, lexicons for every effect / transition / animation / font, recipes and 90
  presets; every preset is run through the planner in a test. Steps that analyse footage (stabilise, reframe,
  hyperlapse) run after the others in the app. *Rule-based: it understands many phrasings, not all.*
- **Settings**: themes and layout are validated (imported theme files cannot inject CSS), saved, and
  checked in the running app (light theme recolours panels, layout moves panels, reset works).

## Phase 11: editor visuals
Icon set (35 line icons) replacing letter buttons on the toolbar, track headers and transport; film-strip
thumbnails on video and image clips (at most three FFmpeg thumbnail jobs at a time, cached) with badges for
speed, reverse, freeze, effects, sound effects, blend and removed sound; collapsible library (slim tab row);
preview focus mode (key F); foldable Properties sections remembered between sessions; row-height cycling on
tracks; an empty-timeline hint; focus rings and reduced-motion support. Checked in the running app (frame
strips load, library collapses and reopens, focus mode enlarges the preview, sections fold and persist) and
by looking at screenshots.
Follow-up: the transport bar is a grid with Play on its own centred row (measured: exactly centred); track rows grow
up to 2× to use spare timeline height (toggle in the toolbar); the preview shows scale and rotate handles for the
selected clip (text and shapes are boxed by where their pixels are; rotation snaps to 15° unless Alt is held);
tooltips show the name plus the shortcut as key caps. Not done: handles for several selected clips at once, and
motion on panel changes beyond the library and button transitions.

## Phase 12: batch commands, Minecraft font, drag readout
- **Batch assistant commands** (`shared/agent/batch.ts`, parsed by `planner3.ts`): "cut all clips to 7 seconds"
  (keep the start, end or middle; later clips slide left so no gaps; handles speed, reversed clips, keyframes),
  "make every photo 3 seconds", "split every 10 seconds", "remove clips shorter than 2 seconds", sort by
  length/name, shuffle, fade every clip, fill the frame (no black bars), "remove all text / captions / shapes /
  layers / transitions". The rules blank the words they use, so "render each clip for tiktok" does not also
  turn the frame vertical. The old whole-timeline "trim it to 30 seconds" is unchanged.
- **Render with a configuration**: "render each clip at 1080p 60fps h265", "export each clip for TikTok",
  "export the project in 4k". One save dialog picks the folder; each clip becomes its own file
  (`03 - clipname.mp4`) through the normal exporter, with progress in the assistant panel. Words like 4k, 60fps,
  hevc, "small file" override the preset's details. Verified end to end: two files, 480 p, 6 s and 12 s.
- 18 premade prompts in a new "Batch edits" group. 18 new unit tests, 6 new end-to-end checks.
- **Minecraft font** (Monocraft, SIL OFL; licence in `docs/licenses`), a Minecraft text look and starter tile,
  and the assistant understands "Minecraft title". 74 distinct fonts now.
- **Distance from the centre while dragging**: dragging an element, scaling, rotating or moving a mask corner
  shows a small readout (`X +120 px (+6.3 %)`, "centred" when exact) and centre guides.
- Not verified: render-each-clip on Windows; clips that are only audio are rendered as audio-only video files.

## Phase 13: clean transitions with adjustable timing
- 14 new transitions: motion-blur whips (left/right/up/down), RGB whip, beat shake, beat punch, flash shake,
  slam zoom, zoom blur in/out, spin blur, glide, shake slide. Shakes are deterministic (noise of progress), so
  preview and export match.
- Every transition (old ones too) now has **start ease** and **end ease** (0 = abrupt, 1 = very soft; a cubic
  Bézier timing curve with a live curve drawing in the Inspector), plus **strength** (scales blur/shake/smear).
  Together with the duration this makes any transition faster/snappier or smoother. Old projects are unchanged
  (no ease set = the transition's own curve); the clean ones start with a curve that suits them.
- Not verified: how the clean transitions look to a person on real footage (tested numerically: every one
  starts hidden/off-screen, ends settled, never produces NaN; and in the Inspector end to end).

## Phase 14: libraries, recording, shortcuts, groups, templates, stock, nesting
- **Sound library** (Sounds tab): 48 sounds synthesised with FFmpeg on first use (whooshes, hits, drums incl. 808/kick/snare/hat,
  risers, drops, UI sounds, glitch, tape). Search, categories, preview, add at playhead, "add sounds to my transitions"
  (each transition gets a fitting sound just ahead of it) and assistant commands ("add a bass drop sound at the end").
- **Looks and overlays** (Looks tab): 23 colour looks computed from formulas into 21³ lookup tables (applied through the existing LUT
  effect, with an intensity), and 11 overlay clips drawn with FFmpeg formulas (light leaks, film burn, streak, grain, dust, flashes,
  glitch bars, VHS) that go on their own track, scaled to fill the frame, blended with Screen/Overlay. Both free of licences.
- **Voice-over recording** from the microphone onto an audio track (device list, level meter, countdown, play along). The
  permission handler now allows only audio capture, full screen and copying.
- **Keyboard shortcut editor** (Settings → Shortcuts, `?` opens it): change, add, remove, reset, conflict prompt; tooltips follow the keys.
- **Live preview of pitch shift and voice enhance** (AudioWorklet granular pitch shifter; the hiss remover of voice enhance is still export-only).
  Needed `assetsInlineLimit: 0` so the worklet stays a real file under the content-security policy.
- **Group handles** for multi-selection: move, scale and turn several clips together about the group's centre.
- **Templates** (Templates tab): 18 intros, lower thirds, titles, end cards and social prompts, built from ordinary text and shape clips
  so every part stays editable; assistant: `Add the neon sign template saying "Night Owls"`.
- **Stock browser** (Stock tab): Pexels and Pixabay with the person's own free API key (kept in the main process, encrypted with the system
  keychain when available); only the providers' own https hosts are contacted; credits can be copied.
- **Nesting**: several clips are rendered into one clip (normal export quality) and the originals are kept inside it, so Unnest restores
  them; moving the nested clip moves the restored group. Ctrl+G / Ctrl+Shift+G.
- Fixed: Settings re-opened itself whenever a project was opened after pressing `?`; the project list collapsed when the storage list was open.
- **Not verified:** the Stock browser against the live services (needs internet and a key; the parsing, host checks, downloads and
  error handling are tested with fake responses); microphone recording on a real Windows microphone (tested with Chromium's fake device);
  how the overlays, looks and templates look to a person (tested numerically and in the UI, not judged by eye).
- **Known limits:** a nested clip is a rendered video (no transparency), so a text-only group is blended with Screen; effects added to a nested
  clip are lost on Unnest. Pitch shift in the preview is not sample-identical to the export.

## Phase 15: licences and legal notices
- `THIRD_PARTY_NOTICES.md` generated from the shipped packages (`scripts/gen-notices.mjs`; fails on any licence that is not MIT/ISC/BSD/Apache/OFL),
  covering FFmpeg (GPL build, x264/x265), Electron/Chromium, whisper.cpp and its models, interpolini, Monocraft and 73 fonts.
  The installer carries `legal/` (licence, notices, every distinct font licence text, privacy, FFmpeg version) and Settings → About shows them.
- The Windows build regenerates the notices, records the FFmpeg version line (it holds the source commit) and publishes `VLcut-source.zip`
  as an artifact, so the GPL's source requirement is met for the installer.
- `NOTICE`, `docs/PRIVACY.md`, README legal section. Built-in names that were third-party trademarks were made generic
  ("Warm film", "Green film", "Blocky game"); the words people type (kodak, minecraft) still work.
- Stock tab shows the Pexels/Pixabay attribution their API terms ask for. Tests (`tests/legal.test.ts`) fail if a dependency is added without notices.
- Not legal advice. Not checked: trademark registries for "VLcut" (a quick web search found nothing, which is not clearance), patent pools for H.264/H.265.

## Phase 16: simpler editing, removable everything, drag and drop, more voices
- **Drag and drop from the computer:** files and folders (up to 500 media files, a few folders deep) dropped anywhere in the editor go into the
  library, onto the timeline when dropped there (one after another from the drop point), and on the start screen the first file opens as a
  new project. Before this, a drop outside the Media panel made the window navigate to the file. Tested with real OS-style drops through the
  debugging protocol.
- **Tags under clips (CapCut-style):** effects, colour looks, sound effects, the transition, speed, freeze, stabilising, reframe, mask, blend,
  fades, removed sound and noise reduction show as coloured bars under the clip, each with an × (and an eye to switch effects off). Hide them
  with the sparkle button. `shared/timeline/tags.ts`, unit tested.
- **Cannot-be-undone fixes found by audit:** captions had no way off (added "Remove all captions", per-file choice of whose speech to use,
  "Forget" for a recognised transcript, Cancel for recognition and the model download, and the speech models can be cleared from Storage);
  freeze frame, auto reframe / tracked point, stabilising, speed, "remove audio from all clips" (new "Bring the audio back") now all have an
  undo-in-one-click through the tags.
- **Text editor window:** opens over the preview when text is added or double-clicked (timeline or preview): words, font, size, colour, bold,
  italic, capitals, alignment, outline, shadow, 12 looks, animations in/out, top/middle/bottom, start and length, start/end at the playhead,
  duplicate, delete. Clicking text or a picture in the preview now selects it.
- **Right-click menu on clips:** edit text, split, duplicate, copy, paste, remove/bring back sound, remove all effects, nest/unnest, delete.
- **Voice-overs:** 15 styles (narrator, announcer, deep, higher, kid, chipmunk, monster, robot, phone, megaphone, old radio, cathedral, cave,
  studio clean, as-is) and a pitch control on top of any voice; a Listen button; and 13 optional natural voices (Piper, downloaded on request).
- **Not verified:** the natural-voice downloads against the real servers (the install, speaking and removal are tested with a stand-in
  program and a fake download); Piper's licence and each voice's licence are the voice makers', shown by the "info" link.
- A render loop (React error 185) from a selector that returned a new object each time was caught by the end-to-end run and fixed.

## Phase 17: features removed to keep the project clear of third-party terms
- The stock footage and photo browser (Pexels, Pixabay) was removed, together with its key handling and credits.
- The natural voices (Piper) and the voice styles were removed; voice-overs use the voices that come with the computer (Windows speech).
- The Sounds library tab and the assistant's sound-library commands were removed; the few built-in sounds the editing styles use remain.

## Not built yet
- Custom user-defined transitions, nested sequences, and a separate low-resolution editing proxy for very
  large files (proxies exist only for files the app cannot decode).
- Real-time audio effects for pitch shift and voice enhance in the preview.
- A keyboard-shortcut editor, auto-update, first-run tour, crash recovery prompt.
- Continuous (keyframed) speed curves: speed ramps are built from sixteen stepped pieces instead, which
  keeps sound and export exact.
- Preview editing uses drags with modifier keys (move, Shift to resize, Ctrl to rotate); there are no
  visible corner handles.
- Object recognition without an extra program. Search finds camera movement (push-in, pull-out, pans,
  tilts) on its own; to find objects and places ("the building") it needs a vision model running in the
  free Ollama app, which then describes each shot. **Not verified with a real model**: the test uses a
  stand-in server that answers like Ollama.
- SQLite: project data is plain JSON by decision (see ARCHITECTURE.md). OpenCV and Remotion are not
  used; analysis runs on FFmpeg and the motion engine is the app's own.

## Not verified anywhere
- **Code signing.** The build signs itself once a certificate is configured (docs/SIGNING.md) and then
  checks the signature; without one it stays unsigned. No real certificate has been used yet.
- **Running on Windows.** The installer workflow (`.github/workflows/windows.yml`) builds successfully
  on GitHub's Windows machine (typecheck, FFmpeg bundling, NSIS installer, about 190 MB), but nobody has
  installed and used the result yet. All behavioural testing was on Linux.
- Drag and drop from the OS and from the library onto the timeline (not scriptable in the test).
- Reversed clips preview without sound. Volume above 100% now plays in the preview too, but no test
  measures the loudness.

## References
Screenshots from four of the five reference videos were received and analysed; the fifth was not.
