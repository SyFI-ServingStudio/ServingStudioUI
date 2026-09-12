# Deployment

## Local development

Follow the [workspace setup guide](https://github.com/SyFI-VibeSim/VibeSimWorkspace/blob/main/reproduce.md)
to build and configure compatible services. From the configured workspace root,
`just start` launches the stack; `just services-status` reports its status and
`just stop` stops its service sessions.

For an independent frontend, run `npm ci` and `npm run dev` from `app/`.
Vite uses these settings:

| Setting | Default | Purpose |
| --- | --- | --- |
| `ANALYZER_PROXY_TARGET` | `http://127.0.0.1:8787` | Analyzer address. |
| `CONVERSATION_PROXY_TARGET` | `http://127.0.0.1:8765` | Agent address. |
| `VIBESIM_UI_HOST` | `127.0.0.1` | Development bind address. |
| `VIBESIM_UI_ALLOWED_HOSTS` | Vite defaults | Comma-separated allowed hostnames. |

The default port is 5177. Choose a free port with
`npm run dev -- --port PORT --strictPort`. On shared hosts, follow the workspace
port convention. For remote development, configure the bind address and hostname
allowlist. Use a named tmux session for a persistent server.

## Production hosting

From `app/`:

```bash
npm ci
npm run build
```

Publish `app/dist/` through a static web server. Configure same-origin reverse
proxy routes, preserving each request path:

| Route | Destination |
| --- | --- |
| `/api/analyzer/v1/*` | Analyzer catalogs, descriptors, payloads, plots, and hardware data. |
| `/api/agent/v1/*` | Agent workspaces, conversations, turns, jobs, and files. |
| Application assets | Static files from `app/dist/`. |

Disable proxy buffering for Agent streams and allow long-lived connections.
Apply authentication and access control at the HTTP entry point. The Agent tools
token does not replace browser access control; see the
[Agent operations guide](https://github.com/SyFI-VibeSim/VibeSimAgent/blob/agent-http-api/doc/service-operations.md)
for authentication boundaries and runner networking.

Vite's development proxy is not included in `dist/`. Neither `npm run dev` nor
`npm run preview` is a production server. No `VITE_ANALYZER_API_BASE` build flag
is required: the application reads the versioned Analyzer API and has no bundled
fixture mode.

Vite also forwards `/api/dev` to Analyzer for development profiling. This
diagnostics route is not required for production result browsing.
