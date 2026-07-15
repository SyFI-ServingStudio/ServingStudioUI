# Analyzer → UI 数据协议方向

本文记录 UI 接入现有 Rust analyzer 的边界。它不是对当前 JSON 的重新发明，而是一个兼容层设计：先可靠读取 analyzer v1，再逐步把同一合同固化到 Rust 类型和 schema 中。

## 1. 数据所有权

UI 可以读取：

- `summary.json`：运行级结果与关键计数
- `raw/params.json`、`raw/run_meta.json`：参数、部署与运行元数据
- `reports/*.json`：面向人或轻量摘要的 subject 结果
- `payloads/*.json`：面向可视化的有界数据
- `traces/*.pftrace*`：Perfetto trace
- `raw/cost_manifest/**`：在后端适配为 cost-tree 数据，不建议由浏览器自行遍历

UI 不应读取：

- `raw/*.parquet` 或 `raw/gpu_cluster/**` 等大体积事实表
- analyzer 内部临时文件
- 运行目录之外的可变 preset 或 workload 文件作为历史事实来源

原因是浏览器不适合扫描大表，而且外部 preset/trace 会随时间变化，无法保证 run 可复现。

## 2. 当前 v1 的实际约束

现有输出带 `schema_version: 1`，但各 subject envelope 并不完全一致：有些把 `available` 放在顶层，有些放在 `meta`，另一些以空数组表达无结果。因此 v1 必须按 subject 分别校验和适配，不能只写一个宽松的通用 JSON 类型。

已确认可接入的 subject 包括：

- SLO
- throughput
- utilization
- batch
- kernel throughput
- conservation
- KV cache
- kernel input distribution（新版本 analyzer）
- kernel time share（新版本 analyzer）

较旧 run 可能没有后来新增的 subject。不存在文件和 `available: false` 也不是同一件事。

## 3. 稳定领域标识

worker id 仅在 pool 内唯一。领域层必须使用复合标识：

```ts
export interface WorkerRef {
  poolTag: string;
  workerId: string;
}

export type WorkerKey = string & { readonly __workerKey: unique symbol };
```

wire JSON 中的数值 `worker_id` 由 repository 统一规范化为字符串；组件不同时处理两种 id 类型。任何按 `worker_id` 单独建 map 或聚合的实现都可能混淆 AFD 的 attention/FFN worker。UI 路由、query key、选择状态和图表 series id 均应使用统一 helper 生成的复合键。

analyzer utilization 曾只用 `worker_id` 做部分映射和 SQL 聚合，导致跨 pool 同号 worker 被覆盖或合并。该问题已在 2026-07-15 修复：SQL、roster、bin 聚合均使用 `(pool_tag, worker_id)`，真实重分析样例恢复为 10 个 worker（attn 8、ffn 2）。UI 保留 `pool_tag` 做精确筛选，也不通过 clamp 隐藏异常值。

## 4. 运行描述

现有运行目录缺少一个专为发现和加载设计的稳定入口。建议新增独立 run descriptor，而不是改变 analyzer 现有 root `manifest.json` 的语义：

```json
{
  "protocol_version": 1,
  "run_id": "20260703_4_qwen3_coder_480b_send_trace",
  "kind": "simulation",
  "model_name": "model/config/qwen3_coder_480b.json",
  "deployment": "afd",
  "lifecycle": {
    "simulation": "complete",
    "analysis": "complete"
  },
  "summary": { "href": "summary.json" },
  "model": { "href": "artifacts/model.json" },
  "topology": { "href": "artifacts/topology.json" },
  "subjects": {
    "throughput": {
      "status": "ready",
      "schema_version": 1,
      "report_href": "reports/throughput.json",
      "payload_href": "payloads/throughput.json"
    },
    "backpressure": {
      "status": "not_generated"
    }
  },
  "traces": {
    "perfetto": { "status": "ready", "href": "traces/run.pftrace.gz" }
  }
}
```

`protocol_version` 描述 descriptor；每个 subject 的 `schema_version` 描述其 payload。两者独立演进。

## 5. 状态模型

analyzer 侧状态：

- `pending`：运行或分析尚未完成
- `ready`：artifact 已生成且可读取
- `unavailable`：subject 不适用于该 run，或必要输入不存在
- `not_generated`：适用但尚未请求或旧 run 未生成
- `failed`：生成尝试失败，附带稳定错误码和可读原因

UI 适配器还可以产生 `incompatible`，表示拿到了 artifact，但版本或结构无法安全解析。

图表必须区分这些状态。只有有效的空集合才能显示 “0 records”；其他状态显示原因和可采取的动作。

## 6. Repository 边界

组件不得拼接日志路径或直接理解 analyzer 文件布局。建议的读取接口是：

```ts
interface AnalyzerRepository {
  listRuns(): Promise<RunSummary[]>;
  getRunDescriptor(runId: string): Promise<RunDescriptor>;
  getRunSummary(runId: string): Promise<RunSummaryArtifact>;
  getRunTopology(runId: string): Promise<Topology>;
  getSubject<K extends SubjectKind>(
    runId: string,
    kind: K,
  ): Promise<SubjectResult<SubjectPayloadByKind[K]>>;
  getWorkerCostTree(runId: string, worker: WorkerRef): Promise<CostTree>;
  getWorkerTimeline(runId: string, worker: WorkerRef): Promise<WorkerTimeline>;
  getIteration(
    runId: string,
    worker: WorkerRef,
    iterationId: string,
  ): Promise<IterationDetail>;
  getTrace(runId: string, kind: TraceKind): Promise<TraceResource>;
}
```

`getRunSummary` 与 `getRunTopology` 是有界、typed artifact read；它们不能返回组件用的整页 `Run` view-model。application 层负责把 descriptor、typed reads、各 subject 的 `SubjectResult` 和当前确实需要的 worker cost tree 组装为兼容视图。这样 HTTP repository 不会被迫 eager 返回所有 subject、worker tree 或 iteration 数据，且 unavailable/failed/incompatible 状态不会在组装前丢失。

active-run provider 自己拥有 run catalog bootstrap、默认目录选择、加载和错误状态。Zustand 只保存可空的 `runId` 与本地钻取选择，不能保存 fetched `Run` 对象，也不能通过反向解析序列化 worker key 恢复领域身份。

实现顺序：

1. `FixtureAnalyzerRepository`：可重复的开发和测试数据。
2. `ArtifactAnalyzerRepository`：验证本地导出的 descriptor/artifact 目录。
3. `HttpAnalyzerRepository`：通过 Rust 服务发现 run、加载 artifact，并按需查询高基数数据。

## 7. 加载策略

- model、simulation、trace overview、SLO、throughput、utilization 等聚合信息使用有界 JSON artifact。
- worker iteration index 按 worker 加载，可分块或分页。
- iteration detail 只在用户选择后加载。
- Perfetto 只传递可访问的 trace URL；UI 不复制 trace 内容进应用状态。
- query cache key 必须包含 run id、subject version，以及完整 `WorkerRef`。

## 8. 当前缺失的数据源

以下现有 UI 需求还没有可靠 analyzer artifact：

- 模型配置快照及 hidden size、layer/head/MoE 等 overview 字段
- 输入/输出长度分布和 arrival burstiness 所需的 offered workload 摘要
- worker、pool、cluster pending queue/backpressure 时间序列
- 面向交互的 worker iteration index 和 iteration detail

在数据补齐前，fixture 可以用于开发布局，但 fixture 字段必须标明来源为 synthetic，不能在真实 run 页面伪装成分析结果。

## 9. 演进规则

- Rust 端最终应使用 typed DTO，并生成或校验 JSON Schema；UI 端保留运行时校验。
- 添加可选字段属于向后兼容；删除、改名、改变单位或语义必须提升 subject schema version。
- 数值字段必须在 schema 或 definitions 中声明单位。
- analyzer 对大 run 仍须输出有界 payload；原始数据查询由后端执行。
- fixtures 必须来自真实 artifact 的最小裁剪或明确的 synthetic case，并覆盖 unavailable、failed、incompatible。
