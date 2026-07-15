# Task: Embed the Perfetto trace viewer (iframe + postMessage) in this app

## Context
`viz-ui/app` (your current directory) is a **React 18 + TypeScript + Vite 5 + MUI 5 (+ @emotion) + Zustand** SPA with an editorial / warm-paper theme. It visualizes VibeSim simulator results on fake data. Charts use ECharts. Validate with `npm run typecheck` and `npm run build`. A dev server already runs elsewhere (tmux, port 5177) with HMR — **do not start a dev server**.

Goal: add an embedded **Perfetto trace viewer** so a user can open the run's full per-worker execution trace inside the site.

## Conventions to follow (match these exactly)
- Theme: `src/theme.ts` exports `tokens` (paper, tile, tile2, leafbg, ink, sub, sub2, hair, teal, terra, gold, olive, violet, shadow, shadowLift, serif, body, mono, ease). Read all colors/fonts from `tokens`.
- Component style: study `src/components/ChartCard.tsx`, `src/components/TimelineBand.tsx`, `src/components/EChart.tsx`. Match the look: themed MUI `Paper` (rounded, `tokens.hair` border, `tokens.shadow`), serif titles (`tokens.serif`), mono sub-labels (`tokens.mono`), teal accents, subtle hover.
- Store: `src/store.ts` (Zustand `useViz()`), with selectors `currentRun`, `cursorSeconds`. You do NOT need store state for v1 (see the cursor-sync note).
- Vite: `vite.config.ts` uses `base: './'`. Files in `public/` are served at `import.meta.env.BASE_URL`.
- No new dependencies. TypeScript is strict — type everything (`MessageEvent`, refs, unions); avoid `any` (prefer `unknown` + narrowing). Keep concise, future-facing comments consistent with the codebase.

## Assets already in place (do NOT recreate)
- `public/pd_smoke.pftrace.gz` (~56 KB) — small sample trace (default).
- `public/afd_smoke.pftrace.gz` (~2.3 MB) — larger AFD-run sample.
Both are real VibeSim `analyze trace` outputs: native Perfetto **TrackEvent protobuf, gzip-compressed**. Perfetto auto-inflates gzip, so post the raw `.gz` ArrayBuffer as-is.

## Build: `src/components/PerfettoTrace.tsx` (new)
A self-contained, full-width themed `Paper`:
- Header row: serif title **"Execution trace"**, mono sub **"Perfetto · per-worker slice timeline"**, controls on the right.
- **Collapsed by default.** A toggle button ("Open trace ▸" / "Close ▾"). The `<iframe>` is **only mounted when expanded** (lazy — so the external Perfetto UI and its consent modal don't load until the user asks). Collapsing unmounts the iframe.
- Trace selector: two themed pill buttons — **`pd_smoke` (default)** and **`afd_smoke`** — as a small union-typed state. Switching re-posts the newly selected trace.
- A "reload" icon button that re-posts the current trace.
- The iframe: `src="https://ui.perfetto.dev/#!/?mode=embedded"`, `width: 100%`, height ~620px, `border: none`, `title="Perfetto"`, inside a rounded `Box` with a `tokens.hair` border.
- A status line shown while connecting ("connecting to Perfetto…") that hides once the trace is posted (optionally then show "loaded <name>").

### Perfetto embedding protocol — implement EXACTLY
- Keep `useRef<HTMLIFrameElement | null>` for the iframe and a ref for the interval id, plus a `ready` ref/flag.
- On mount/expand and whenever the selected trace changes, run the handshake in a `useEffect`:
  - `const w = iframe.contentWindow`. If already `ready`, just fetch + post the new buffer. Otherwise:
  - `setInterval(() => w.postMessage('PING', '*'), 100)`.
  - Add a `window` `'message'` listener; readiness is `evt.source === iframe.contentWindow && evt.data === 'PONG'` (match by **source**, not origin — Perfetto posts `PONG` to `'*'`). On PONG: `clearInterval`, set `ready = true`, then fetch + post the trace.
  - Fetch: `const buffer = await (await fetch(`${import.meta.env.BASE_URL}${file}`)).arrayBuffer();`
  - Post: `w.postMessage({ perfetto: { buffer, title, fileName: file, keepApiOpen: true, localOnly: false } }, '*');`
    - `keepApiOpen: true` keeps the UI's listener alive so you can swap traces without reloading the iframe.
    - `localOnly: false` re-enables Perfetto's download/share (optional).
  - The channel is **unbuffered** — you MUST PING until PONG before posting, or the trace is silently dropped.
- Swap-trace case: if the iframe is already `ready` (kept open via `keepApiOpen`), just fetch + post the new buffer — no new handshake.
- Cleanup: the effect's return must `clearInterval` and `removeEventListener`. Guard `iframe`/`contentWindow` null. On collapse, unmount the iframe and reset `ready` so reopening re-handshakes cleanly. Ensure no duplicate intervals or listeners.

## Integrate: `src/App.tsx` (minimal edit)
- Import `PerfettoTrace` and render it ONCE, right AFTER the temporal-bands `<Stack>` (the `<TimelineBand/>` + `<IterationBand/>` block) and BEFORE `Section idx="02"` (the scope-adaptive stage). Wrap in `<Box sx={{ mt: 2 }}>` (or reuse the local `Section` helper with an index glyph like "✦" and title "Execution trace"). One import + one render site — nothing else.

## Hard constraints (must respect)
- `targetOrigin: '*'` for all posts; match incoming by `evt.source === iframe.contentWindow`.
- Do NOT add `Cross-Origin-Opener-Policy` / COEP headers anywhere (COOP: same-origin breaks postMessage; Vite dev sets none — keep it that way).
- The app is served from a remote hostname, so Perfetto shows a one-time "trust this source" consent modal on first open — this is EXPECTED; do not try to suppress or work around it.
- **Do NOT implement cursor→viewport sync in v1.** The bundled sample traces use their own ns time base, unrelated to the app's fake `cursorMs`. Leave a short code comment: once a backend serves the *current run's own* trace, sync by posting `{ perfetto: { timeStart, timeEnd, viewPercentage } }` (values in SECONDS) driven by `cursorSeconds(state)`.

## Validate (run and report)
- `npm run typecheck` → must pass clean.
- `npm run build` → must succeed.
Report a short summary of the files changed and any caveats.
