# Analyzer v1 Fixture 策略

第一批真实 fixture 来自 `main/logs/20260715_1_afd_ui_reanalysis`。该目录是 `20260703_4_qwen3_coder_480b_send_trace` 的事实数据副本，并使用 2026-07-15 的 analyzer 重新计算；`reanalysis_source.json` 明确记录 simulation 未重跑。它用于验证当前 analyzer v1 的真实差异，不用于伪造尚不存在的数据源。

## 目录与范围

```text
fixtures/analyzer-v1/afd-qwen3-duration-reached/
├── summary.json
├── raw/
│   ├── params.json
│   └── run_meta.json
├── reanalysis_source.json
├── reports/
│   ├── analyzer_timing.json
│   └── <subject reports>
└── payloads/
    └── <subject payloads>
```

第一批保留 SLO general/detailed、throughput、utilization、batch、kernel throughput、kernel input distribution、kernel time share、workload conservation 和 KV occupancy，以及 reanalysis provenance，共 25 个 analyzer/source JSON；另有 1 个 fixture metadata。`manifest.json` 和 `preset.json` 暂不复制：展开后的 `params.json` 才是该 run 的事实配置。

## 裁剪规则

- SLO CDF：每条 1000 点等距裁至 64 点，`x/y_pct` 同步裁剪并保留首尾。
- Batch scatter：每 pool 4000 点等距裁至 128 点，并更新 `plotted_points`；`num_calls` 保留精确原值。
- Throughput、utilization、kernel throughput、conservation、KV：当前体积有界，首批完整保留。
- `run_meta` 保留全部 48 GPU、10 worker 和重复 worker id，用来验证复合身份。
- 不复制 parquet 或 `raw/gpu_cluster`。

裁剪脚本必须确定性执行，并在 fixture 中记录源 run、源文件相对路径与裁剪方式；不得手工改数字使图表“更好看”。

## 状态覆盖

真实样例自然覆盖：

- `ready`：可用的 analyzer subjects
- `unavailable`：SLO detailed；timing 为 `ok`，但 report/payload 明确 unavailable
- `unavailable`：kernel input distribution；原 simulation 尚未记录 `slot_backend/slot_input`
- `ready`：kernel time share，包括 overall/pool/worker 组合

以下状态单独放在 `fixtures/synthetic-states/`，并标记 synthetic：

- `pending`：descriptor 的 analysis lifecycle 尚未结束
- `failed`：timing 中 subject 失败且无对应 artifact
- `incompatible`：已知 subject 使用 UI 不支持的 schema version

transport/network error 用 repository mock 表达，不制造 JSON 文件。

状态映射不能只看 `analyzer_timing.status`：

```text
timing ok + report.available=false  → unavailable
timing ok + subject schema 可解码   → ready
timing failed                       → failed
registry 有、timing/files 均没有    → not_generated
analysis 未结束                     → pending
版本或结构无法安全解析              → incompatible
```

## v1 envelope 差异

subject payload 的 availability 位置不统一：可能在 `payload.available`、`payload.meta.available`，也可能在 ready payload 中完全缺失。每个 subject 必须有自己的 Zod schema/adapter；report 的顶层 `available` 只作为该 subject 判定的一部分。

`run_meta.schema_version: 3`、run descriptor `protocol_version: 1` 和 subject `schema_version: 1` 是三套独立版本，不得混用。

## 单位不变量

- utilization、KV `*_pct`（当前命名）和 PCA ratio 是 0–1 fraction；展示时才乘 100。
- conservation `delta_pct` 与 kernel time `share_pct` 是 0–100 percent。
- TTFT/E2E 是 ms，TPOT 是 ms/token；throughput 是 token/s。
- `t_*_ms` 是 ms，`tick_dt_us` 是 µs，`wall_s` 是宿主秒。
- KV projected occupancy 和 utilization 数据质量检查不得被 UI clamp；超界值需要诊断提示。当前刷新 fixture 已验证 utilization 为 10 workers（attn 8 / ffn 2）。
- kernel throughput 在 `n=0` 时统计值为 null，schema 必须允许 null。

## 身份解析

真实样例同时存在 `attn/0` 与 `ffn/0`。`run_meta.workers[].pool_tag` 对部分 FFN worker 可能是 null，因此 artifact adapter 不能只依赖该字段；应结合 numeric pool、展开后的 pool 配置或 `comm_groups.owner_pool` 解析 pool tag，最终统一生成 `WorkerRef` 和 `WorkerKey`。
