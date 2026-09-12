<p align="center">
  <img src="app/public/servingstudio-symbol.svg" alt="ServingStudio logo" width="64">
</p>

<h1 align="center">ServingStudio UI</h1>

<p align="center">
  <strong>A web workspace for Agent-driven experiments and interactive performance analysis.</strong>
</p>

<p align="center">
  <a href="#key-features">Features</a> ·
  <a href="#repository-map">Repository map</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/README.md">Documentation</a>
</p>

---

ServingStudio UI is the web workspace for running and understanding LLM serving
experiments. Work with ServingStudio Agent to plan and run experiments,
follow its progress, and explore the results through interactive visualizations.
Compare deployments, examine execution details, and check predictions against
measured performance.

[ServingStudio Sim](https://github.com/SyFI-ServingStudio/ServingStudioSim) supplies the Analyzer and
numerical results; [ServingStudio Agent](https://github.com/SyFI-ServingStudio/ServingStudioAgent)
manages experiment execution and conversation history. Move between conversations
and analysis with shared result context and citations that link answers to evidence.

## 📣 News

- **September 2026:** ServingStudio UI is now available!

---

<a id="key-features"></a>

## ✨ Key features

### Result views

Six result views cover configuration exploration, execution analysis, and
measurement.

- 📊 **Simulation sweeps.** Compare workload and deployment configurations in
  heatmaps, then open individual runs for detailed analysis.
- 🔎 **Simulation runs.** Follow execution from cluster and pool to worker,
  iteration, and kernel. Inspect throughput, latency, memory, utilization,
  timelines, and optimality.
- ⏱️ **Timing predictions.** Inspect offline predictions for explicit batch
  shapes. Expand the CostTree to see how model operations and kernels
  contribute to execution time.
- ⚖️ **Framework alignment.** Compare simulated and measured execution through
  paired iterations, operation mappings, timing breakdowns, and end-to-end
  performance.
- 📈 **Kernel profiles.** Explore kernel performance curves across input shapes
  and compare the available profiling series.
- 🔬 **Kernel measurements.** Inspect individual measurement results through
  metric summaries and plots.

### 💬 Agent integration

Work with ServingStudio Agent in a full conversation page or alongside an analysis
view to plan experiments, follow execution, and investigate results.

- **Choose a connection.** Select a configured provider, model, and its supported
  reasoning effort.
- **Ask with context.** Carry the current Analyzer selection into a conversation
  to investigate the relevant result.
- **Follow experiments.** Open managed job results from the conversation and
  navigate from evidence citations to the corresponding analysis.
- **Resume your work.** Reopen conversation history and reconnect to ongoing
  turns after a refresh.

A shared catalog brings together results and conversations across workspaces.
Light, dark, and paper themes are available throughout the application.
Provider availability comes from the Agent backend's
[configuration](https://github.com/SyFI-ServingStudio/ServingStudioAgent/blob/agent-http-api/doc/providers.md).

---

<a id="repository-map"></a>

## 🗂️ Repository map

```text
ServingStudioUI/
├── app/
│   ├── src/
│   │   ├── app/          Application shell and Agent integration
│   │   ├── artifacts/    Typed Analyzer resources and data access
│   │   ├── layouts/      Result view composition
│   │   ├── location/     Navigation and result selection
│   │   ├── panels/       Analysis views and conversations
│   │   ├── session/      Agent API and streamed conversation state
│   │   └── ui/           Shared controls and themes
│   ├── e2e/              Browser tests
│   └── public/           Application assets
└── docs/                 Architecture, protocols, and deployment
```

---

<a id="quick-start"></a>

## 🚀 Quick start

> [!TIP]
> **Recommended: set up through [ServingStudio](https://github.com/SyFI-ServingStudio/ServingStudio).**
> It pins compatible simulator, Analyzer, Agent, and UI revisions and provides
> shared build and service commands. Follow its
> [setup guide](https://github.com/SyFI-ServingStudio/ServingStudio/blob/main/reproduce.md)
> for the complete application, then use `just start` to launch the local stack.

### Requirements

- **Node.js 22**, **npm**, and **Git** for frontend development and builds.
- A running **ServingStudio Analyzer** to browse results.
- **ServingStudio Agent** with a configured provider and runner to use conversations.

The frontend itself does not require a GPU. Simulator and Agent prerequisites
are covered by the workspace setup guide.

### 1. Install and run

For a standalone UI checkout, with backend services already running:

```bash
git clone https://github.com/SyFI-ServingStudio/ServingStudioUI.git
cd ServingStudioUI/app
npm ci

# Set these to the addresses of your existing services.
ANALYZER_PROXY_TARGET=http://127.0.0.1:8787 \
CONVERSATION_PROXY_TARGET=http://127.0.0.1:8765 \
npm run dev -- --port 5177 --strictPort
```

Open the localhost URL printed by Vite. Select an unused port if 5177 is occupied.
The application reads live Analyzer resources; it does not include a standalone
sample-data mode. See [deployment](docs/deployment.md) for remote-access settings.

### 2. Explore a result

Open an existing result from the catalog. For a new installation, run the
[Llama 3 8B example](https://github.com/SyFI-ServingStudio/ServingStudioSim#quick-start) in the
ServingStudio Sim checkout served by Analyzer, then refresh the catalog. Open the run to
inspect execution, or open Agent alongside it to investigate the selected result.

### 3. Build for production

From `app/`:

```bash
npm run build
```

Serve `app/dist/` through a static web server and proxy `/api/analyzer/v1/` to
Analyzer and `/api/agent/v1/` to ServingStudio Agent. Preserve Agent streaming responses
and apply access control at the deployment boundary. See the
[deployment guide](docs/deployment.md) for the routing contract.

---

## 📚 Documentation

| Guide | Covers |
| --- | --- |
| [Application development](app/README.md) | Dependencies, commands, and tests. |
| [Deployment](docs/deployment.md) | Development proxies, static hosting, and API routing. |
| [Frontend architecture](docs/frontend-architecture.md) | Code ownership, state, and rendering contracts. |
| [Analyzer data protocol](docs/data-protocol.md) | Resource identities and payload contracts. |
| [Agent integration](docs/inquiry-wiring.md) | Conversations, execution, and result relationships. |
| [Evidence citations](docs/citation-dsl.md) | Selectable evidence and navigation from Agent messages. |
| [Themes](docs/themes.md) | Theme selection and shared visual tokens. |
