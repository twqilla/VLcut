# Architecture

Electron app in three layers, built with electron-vite.

| Layer | Path | Responsibility |
| --- | --- | --- |
| Main process | `src/main` | Files, FFmpeg, project storage. Everything that touches the disk. |
| Preload | `src/preload` | Exposes a typed `window.api` to the UI. The only bridge between the two. |
| Renderer | `src/renderer` | React UI. State lives in a Zustand store (`store.ts`). |
| Shared | `src/shared` | The project data model and the `Api` contract, imported by all layers. |

## Decisions

- **Project files are plain JSON** (`<userData>/projects/<id>/project.json`), not SQLite. Users can read,
  copy and back up their own files, and the format carries a `formatVersion` for migrations. SQLite will
  be added only if the searchable media index (Phase 9 analysis) needs it.
- **Saves are atomic** (write temp file, then rename) and keep up to 10 rolling backups, at most one per
  5 minutes. Loading falls back to the newest readable backup if the main file is corrupt.
- **Projects reference media by path** and never copy it. Missing files are flagged on load for relinking.
- **The renderer never gets raw file access.** Media loads through a `media://` protocol served by the
  main process, which supports seeking (range requests).
- **FFmpeg is resolved** from `resources/bin` in an installed build, else from the PATH. Bundling a
  Windows FFmpeg build is part of Phase 4. FFmpeg builds with x264/x265 are GPL, so the app is licensed
  GPL-3.0-or-later.
- **Remotion is not used**: its license requires a paid company license above a small team size, which
  conflicts with "completely free". Motion graphics will be rendered by our own canvas-based engine.

- **One renderer.** `src/renderer/src/engine/compositor.ts` draws a frame from a project and a time.
  The preview calls it on a clock; the exporter calls it per frame in a hidden window and pipes pixels
  to FFmpeg. Effects, transitions and text are implemented once.
- **Exports render from all-keyframe copies** of the used footage (`src/main/render/sources.ts`), since
  per-frame seeking in ordinary long-GOP files is several times slower. Preview uses the originals.
- **Everything is a pure edit.** Timeline operations, styles and assistant tools are functions
  `Project -> Project` in `src/shared`. The store wraps each in a history entry, which gives undo,
  per-step assistant undo (rewind and replay) and restore points for free.
- **Styles and the assistant write ordinary timeline content**, tagged with `origin: 'style'` so a new
  style replaces the old one without touching manual edits.
- **Sound effects are synthesised** with FFmpeg on first use, so no audio files are bundled or licensed.
- **Speech recognition** uses whisper.cpp (MIT) as an external program plus a model file, bundled or
  downloaded once. **Local language model** support (Ollama) is optional; the planner works without it.

## Module map

| Path | What lives there |
| --- | --- |
| `src/shared/timeline` | Data model defaults, timeline operations, keyframes |
| `src/shared/effects` | Effect, transition, text-animation and font registry |
| `src/shared/styles` | Style definitions |
| `src/shared/agent` | Editing tools (silence removal, montage, beat sync, captions, styles) and the planner |
| `src/shared/analysis` | Beat detection, shot description and rating, duplicate detection, search |
| `src/shared/render` | FFmpeg audio graph builder |
| `src/main` | Project store, media probing, proxies, waveforms, analysis, export, speech, sound effects |
| `src/renderer/src/engine` | Compositor, effects, transitions, text, media pool, player |
| `src/renderer/src/components` | Interface |

## Third-party licences

Electron (MIT), React (MIT), Zustand (MIT), FFmpeg (GPL build, external program), whisper.cpp (MIT,
external program), interpolini (GPL-3.0, external program downloaded on request; its blend weights are
ported from its weights.rs, credit: https://github.com/Z1xus/interpolini), fonts via Fontsource (SIL OFL 1.1; Permanent Marker is Apache-2.0).
