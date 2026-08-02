# VibeSim Visualization UI

The browser application for exploring VibeSim simulations, timing predictions,
kernel profiles, kernel measurements, and Agent conversations. The production
React application lives in `app/`; the HTML files under `design/` and the
root-level `design-*.html` files are visual references, not runtime entry points.

For a complete deployment, clone the
[`VibeSimWorkspace`](https://github.com/serendipity-zk/VibeSimWorkspace)
meta-repository and follow its `reproduce.md`. That repository pins compatible
revisions of VibeSim, VibeSimAgent, and this UI.

## Runtime architecture

The browser uses one same-origin Vite entry point and two backend services:

```text
browser
  -> Vite
       -> /api/v1/*       Rust Analyzer (read-only result resources)
       -> /api/*          VibeSimAgent FastAPI backend (workspaces and conversations)
```

The ownership boundary is deliberate:

- Rust Analyzer discovers and serves simulation runs/sweeps, timing
  predictions, kernel profile curves, kernel measurement summaries/plots, and
  GPU hardware limits.
- VibeSimAgent owns workspace, conversation, turn, job-lifecycle, and
  conversation-to-result relationships. Its `/api/jobs` response is only an
  ownership overlay; it never reparses result artifacts.
- The UI joins those two catalogs by stable Analyzer resource ID.

The entry page supports existing results, new Agent conversations, and resumed
conversations. Run, aggregate sweep, timing-prediction, kernel-profile,
kernel-measurement, and Agent
views share the same workspace shell and selectable evidence protocol.

## Local development

Requirements: Node.js 22, npm, a built/runnable Analyzer, and the Agent backend.
From the common parent containing `main/`, `user-facing-ui/`, and `viz-ui/`, run:

```bash
# Terminal 1: conversation backend
cd user-facing-ui
UV_CACHE_DIR="$TMPDIR/uv-cache-user-facing-ui" \
  uv run uvicorn backend.app:app --host 127.0.0.1 --port 8765
```

```bash
# Terminal 2: read-only result service
cd main
cargo run -p analyzer --release -- serve \
  --bind 127.0.0.1:8787 \
  --workspace-registry ../agent-workspaces/registry.json
```

```bash
# Terminal 3: browser entry
cd viz-ui/app
npm ci
npm run dev:live
```

Open `http://127.0.0.1:5177`. `dev:live` proxies `/api/v1` to
`http://127.0.0.1:8787` and conversation routes to
`http://127.0.0.1:8765`. Override them with `ANALYZER_PROXY_TARGET` and
`CONVERSATION_PROXY_TARGET`.

Plain `npm run dev` uses the checked-in Analyzer fixture for deterministic UI
development and tests. It is not the integrated production data path.

The dev server binds to `127.0.0.1` by default. For trusted remote access,
provide both an explicit bind address and browser-facing host allowlist:

```bash
VIBESIM_UI_HOST=0.0.0.0 \
VIBESIM_UI_ALLOWED_HOSTS=ui.example.internal \
npm run dev:live
```

Do not use an unrestricted Vite host allowlist. If the Analyzer proxy target is
not loopback, pass the corresponding `--allow-host` value to Analyzer as well.

## Validation

```bash
cd app
npm run format:check
npm run typecheck
npm run lint
npm run fixture:check
npm run test:unit
npm run test:e2e
npm run build
npm run size:check
```

Playwright covers desktop and mobile layouts, console/page errors, and axe
accessibility checks. Failure artifacts are written under
`.artifacts/playwright-test/`. `fixture:check` validates the checked-in fixture's
descriptor/catalog revisions; `size:check` checks an existing `dist/`, while
`npm run size` builds first.

## Repository map

```text
viz-ui/
├── app/                    React + TypeScript + Vite application
├── docs/                   data, citation, and frontend architecture contracts
├── fixtures/analyzer-v1/   bounded deterministic Analyzer test fixture
├── scripts/                fixture extraction and validation
├── design/                 visual explorations only
├── design-*.html           earlier visual prototypes only
└── WORKPLAN.md             historical decisions and remaining work
```

Start with `docs/frontend-architecture.md` for code ownership and
`docs/data-protocol.md` for the Analyzer boundary.
