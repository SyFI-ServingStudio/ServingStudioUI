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

wire JSON 中的数值 `worker_id` 必须是 JavaScript safe integer，并由 repository 统一规范化为字符串；组件不同时处理两种 id 类型。超出 safe-integer 范围的身份必须由 analyzer 直接编码为十进制字符串，不能先经 JSON number 丢失精度。任何按 `worker_id` 单独建 map 或聚合的实现都可能混淆 AFD 的 attention/FFN worker。UI 路由、query key、选择状态和图表 series id 均应使用统一 helper 生成的复合键。

字符串形式的 `pool_tag`、`worker_id`、run id 和 resource key 是身份字段，decoder
不得 trim 或改写；只有数值 `worker_id` 被精确转换为十进制字符串。展示文本可以单独
规范化，但不能反向成为 cache/selection identity。

analyzer utilization 曾只用 `worker_id` 做部分映射和 SQL 聚合，导致跨 pool 同号 worker 被覆盖或合并。该问题已在 2026-07-15 修复：SQL、roster、bin 聚合均使用 `(pool_tag, worker_id)`，真实重分析样例恢复为 10 个 worker（attn 8、ffn 2）。UI 保留 `pool_tag` 做精确筛选，也不通过 clamp 隐藏异常值。

utilization schema v1 的顶层 `series` 保留逐时间 bin 的 pool average；新增的可选
`worker_series` 提供 `{key, label, pool_tag, worker_id, util}` worker 曲线。UI 必须兼容
没有 `worker_series` 的旧 v1 artifact；存在时以 worker 细线展示，并以同 pool 颜色的粗线
突出 `series` 中的 pool average。`meta.avg` 仍是每个 pool 的 run-average 标量，不是另一条
时序曲线。

wire 层 subject id 使用 analyzer `registry::SUBJECTS` 的 canonical token；UI
repository 必须通过显式表映射到领域名，不能从文件名或 camelCase 自动推断：

| analyzer subject id         | UI domain name            |
| --------------------------- | ------------------------- |
| `slo-general`               | `slo`                     |
| `throughput`                | `throughput`              |
| `utilization`               | `utilization`             |
| `kv-occupancy`              | `kv`                      |
| `batch`                     | `batch`                   |
| `kernel-throughput`         | `kernelThroughput`        |
| `workload-conservation`     | `conservation`            |
| `kernel-input-distribution` | `kernelInputDistribution` |
| `kernel-time-share`         | `kernelTimeShare`         |

`slo-detailed` 等尚无 UI consumer 的 registry subject 仍可出现在 descriptor；旧 UI
必须忽略未知 subject，而不是拒绝整个 run。descriptor 的 deployment 合同覆盖
`unified | pd | afd`，不能把 PD 降级显示成 unified。

`concurrency` 与 `backpressure` 是为未来有界 timeline artifact 预留的 wire id；它们
目前不属于 analyzer `registry::SUBJECTS`，服务不得在没有真实 artifact 时把它们标为
`ready`。

## 4. 运行描述

现有运行目录缺少一个专为发现和加载设计的稳定入口。新增独立 run
descriptor，而不是改变 analyzer 现有 root `manifest.json` 的复现语义。

### 4.1 Catalog

Rust 服务由显式配置的一个或多个 logs root 递归发现 run；浏览器不接收 logs root，
也不扫描文件系统。catalog route 固定为 `GET /api/v1/runs`：

```json
{
  "protocol_version": 1,
  "generated_at": "2026-07-15T05:11:53Z",
  "runs": [
    {
      "run_id": "r_01JZX8NQJ9YFJ5KQ7Q3T9F1M2P",
      "kind": "simulation",
      "display_name": "20260715_1_afd_ui_reanalysis",
      "descriptor_href": "runs/r_01JZX8NQJ9YFJ5KQ7Q3T9F1M2P/descriptor",
      "lifecycle": { "simulation": "complete", "analysis": "complete" },
      "updated_at": "2026-07-15T05:11:53Z"
    }
  ]
}
```

- `run_id` 是 server-issued、在同一配置中稳定的 opaque id；它不是 basename，
  也不能反向解析成路径。这样嵌套 sweep 中重复的 `simulation`、`tp2` 等 basename
  不会冲突。
- `display_name` 是面向人的 logs-root-relative label。selector 保存 `run_id`，只展示
  `display_name`。
- catalog 包含可描述的 pending/failed run；只有 cache-build 临时目录和完全没有 run
  sidecar 的壳目录被排除。列表按 `updated_at` 降序、再按 `run_id` 排序。
- `descriptor_href` 相对 catalog URL 解析。服务对 catalog 和 descriptor 返回
  `ETag`。catalog 在前台每 30 秒 conditional refetch，并在窗口重新聚焦时
  刷新。descriptor 在 simulation 或 analysis 为 `pending` 时每 2 秒刷新；
  terminal `complete`/`failed` 停止定时轮询，但仍在窗口聚焦时刷新。
  simulation 已完成而 analysis 仍为 `not_started` 可能是 launcher 在写入
  `.complete` 与发布 pipeline sidecar 之间的短暂竞态，也可能是长期
  `--no-analyze`；它复用 catalog 的 30 秒前台节奏，而不是持续 2 秒轮询。

### 4.2 Descriptor

`GET /api/v1/runs/{run_id}/descriptor` 返回下列合同；静态 artifact export 使用相同
JSON 作为 `run_descriptor.json`：

```json
{
  "protocol_version": 1,
  "run_id": "r_01JZX8NQJ9YFJ5KQ7Q3T9F1M2P",
  "kind": "simulation",
  "display_name": "20260715_1_afd_ui_reanalysis",
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
    "slo-general": {
      "status": "ready",
      "schema_version": 1,
      "report_href": "revisions/20260715T050953Z-7a31c2f/reports/slo-general",
      "payload_href": "revisions/20260715T050953Z-7a31c2f/payloads/slo-general"
    },
    "backpressure": {
      "status": "not_generated"
    }
  },
  "details": {
    "worker-cost-tree": {
      "status": "not_generated",
      "reason": "No versioned hierarchical worker CostTree query is available."
    },
    "worker-iteration-index": { "status": "not_generated" },
    "iteration-detail": { "status": "not_generated" }
  },
  "traces": {
    "perfetto": {
      "status": "ready",
      "href": "revisions/20260715T050953Z-7a31c2f/traces/perfetto"
    }
  },
  "analysis": {
    "revision": "20260715T050953Z-7a31c2f",
    "generated_at": "2026-07-15T05:09:53Z",
    "generator_version": "7a31c2f"
  }
}
```

`protocol_version` 描述 descriptor；每个 subject 的 `schema_version` 描述其 payload。两者独立演进。

`details` 中每一种高基数资源也拥有独立 `schema_version` 和 endpoint/index
`href`；不能借用 `kernel-time-share` 的版本。当前由 kernel-time-share worker
composition 投影的扁平 run aggregate 不是 hierarchical worker/iteration CostTree，
不得在 descriptor 中声称后者 ready。iteration index 必须分页，iteration detail 只在
用户选择后请求。

`analysis.revision` 标识一次完整 artifact generation。仅有 `.complete` 只能证明
simulation 完成，因为 launcher 在它之后才运行 analyzer；旧 schema v1 的语义修复也
必须通过 generator version/revision 区分，不能只依赖 `schema_version`。当
`lifecycle.analysis` 为 `complete` 时 `analysis` 必须存在；每次重新生成 artifact 都必须
发布新的 `revision`，即使 href 和 subject `schema_version` 没有变化。

HTTP descriptor 的 `topology` 是一个有界兼容 envelope，而不是浏览器直接读取两个
任意 raw 路径：

```json
{
  "schema_version": 1,
  "params": { "deployment": "afd" },
  "run_meta": { "num_gpus": 48, "workers": [] }
}
```

`params` 与 `run_meta` 保留 simulator 写出的原始 JSON，repository 解开 envelope 后继续
调用与静态 artifact 相同的 `parseAnalyzerV1Topology`。这样 topology resource 可以独立
版本化，同时不会产生第二套 deployment/worker 语义。

### 4.3 href 与错误边界

- JSON/trace href 必须是同源相对引用，按包含它的 catalog/descriptor URL 解析。
  protocol v1 拒绝绝对 URL、scheme-relative URL、反斜线、空 path segment、`..`、
  percent-encoded percent/dot/slash/backslash 等可逃逸形式。禁止 encoded percent 是为
  防止代理或 router 解码一层后产生 double-encoded traversal。
- 服务端先从 catalog 的 opaque id 解析受信 run，再 canonicalize resource，并验证最终
  路径仍在配置的 logs root 和该 run 下；URL 参数不得直接 `join` 到文件系统路径。
- artifact allowlist 只有 descriptor 声明的有界 JSON、trace 和明确的 detail endpoint。
  `raw/*.parquet`、`raw/gpu_cluster/**`、临时文件永不对浏览器开放。
- HTTP service 中所有 ready subject 和 trace href 必须位于 descriptor
  `analysis.revision` 对应的 `revisions/{revision}/...` 路径下。请求期间如果
  analyzer 已发布新 generation，旧 href 返回 `409` 和稳定 code
  `artifact_generation_changed`，调用方重新获取 descriptor；不允许回退到无
  revision 的固定路径。静态 export 可以使用其自身的不可变相对文件布局，
  但 descriptor schema 和 generation 一致性语义不变。
- ready resource 返回 404/损坏时，服务使用 RFC 9457 Problem Details 加稳定 `code`
  （如 `artifact_missing`、`artifact_incompatible`）。可选 subject 映射为其自己的
  failed/incompatible 状态；summary/topology 失败才阻止基础 run 页面。
- Analyzer artifact I/O 共用四许可、饱和即失败的 service semaphore。一个
  `HttpAnalyzerRepository` 必须让其共享的 HTTP JSON client 以 FIFO 调度所有 JSON
  请求，正在 fetch/消费 response 的请求不得超过 4 个；正常返回、transport 异常和
  decoder 异常都必须释放客户端许可。这个限制是单 client 的背压边界，不能替代服务端
  对其他 client 和 trace stream 的全局限制。
- 只有 `503`、Problem Details `code = artifact_read_busy` 且带有效 `Retry-After` 的响应
  可以由 HTTP JSON client 重试。client 按 delta-seconds 或标准 IMF-fixdate 格式等待，每次等待时
  不占用并发许可，之后从 FIFO 队尾重新进入；最多额外尝试 2 次（总计 3 次），且只接受
  最长 5 秒的建议等待。缺失、无效或更长的 `Retry-After` 直接保留原 transport error，
  不能为了本地上限而提前请求。其他 network/HTTP/JSON 错误不在该层重试。
- 每次实际尝试都从最新 cache 重建 `If-None-Match`；FIFO 和 busy retry 不得绕过既有的
  同源/API-root 校验、ETag/304 复用或 subject-local error mapping。

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

`getRunSummary` 与 `getRunTopology` 是有界、typed artifact read；它们不能返回组件用的整页 `Run` view-model。application 层只把 descriptor、summary 和 topology 组装为稳定的 core `Run`。每个 feature 通过 `useActiveRunSubject(name)` 单独订阅带 run id、schema version 和 analysis revision 的 Query cache entry；subject 不复制到 `Run`、Zustand 或一个全量 subjects context。这样 HTTP repository 不会被迫 eager 返回所有 subject、worker tree 或 iteration 数据，且 unavailable/failed/incompatible 状态不会在组装前丢失或牵连无关 feature 重绘。

active-run provider 自己拥有 run catalog bootstrap、默认目录选择、加载和错误状态。Zustand 只保存可空的 `runId` 与本地钻取选择，不能保存 fetched `Run` 对象，也不能通过反向解析序列化 worker key 恢复领域身份。

`lifecycle.simulation` 未完成或失败时，summary/topology core 尚不可用；
`lifecycle.analysis` pending/failed 不得遮住一个已经完成 simulation 的 core 页面。后者
只决定各 subject 的 pending/failed 状态及 descriptor 轮询，某个 subject ready 后按它的
schema version 与 `analysis.revision` 建立独立 query。

`ArtifactAnalyzerRepository` 和 `HttpAnalyzerRepository` 必须复用同一组
subject-specific decoders。前者验证静态 export；后者只增加 fetch、ETag、polling 和
受限 detail query，不能复制一套 schema。optional subject 的 transport/decoder 失败
不得 reject 整个 active run。repository 按 catalog/requested opaque id 获取 descriptor
后，必须精确验证 decoded `descriptor.runId === requestedRunId`；不得从
`descriptor_href` 反解或推断 run id。

实现边界：

1. `src/test/analyzerRepositoryFixture.ts`：只为测试提供 contract-faithful repository，不进入生产 bundle。
2. `ArtifactAnalyzerRepository`：验证本地导出的 descriptor/artifact 目录，也是普通开发模式的确定性数据源。
3. `HttpAnalyzerRepository`：通过 Rust 服务发现 run、加载 artifact，并按需查询高基数数据。

## 7. 加载策略

- model、simulation、trace overview、SLO、throughput、utilization 等聚合信息使用有界 JSON artifact。
- worker iteration index 按 worker 加载，可分块或分页。
- iteration detail 只在用户选择后加载。
- Perfetto 只传递可访问的 trace URL；UI 不复制 trace 内容进应用状态。
- query cache key 必须包含 run id、subject version、`analysis.revision`，以及完整
  `WorkerRef`。
- catalog/descriptor 的 pending 生命周期使用 conditional polling；run 切换后旧请求的
  晚返回只能进入旧 query key，不能覆盖当前 selection。
- 当前有界 aggregate JSON 读取尚不扩张 repository API 来贯穿 `AbortSignal`；这不阻塞
  现有有限 subject 集合。启用高基数 detail/window endpoint 前，HTTP scheduler 必须支持
  从 FIFO 中移除已取消的等待项，并中止对应的 in-flight fetch，避免 run 切换后继续消耗
  artifact 许可。

## 8. 当前缺失的数据源

以下现有 UI 需求还没有可靠 analyzer artifact：

- 模型配置快照及 hidden size、layer/head/MoE 等 overview 字段
- 输入/输出长度分布和 arrival burstiness 所需的 offered workload 摘要
- worker、pool、cluster pending queue/backpressure 时间序列
- 面向交互的 worker iteration index 和 iteration detail

在数据补齐前，真实 run 页面显示对应的 `not_generated`/`unavailable` 状态，不生成替代曲线。checked-in fixture 只裁剪真实 analyzer artifact 或覆盖 transport/status 合同；若协议测试必须使用 synthetic provenance，也必须显式标记，且不能成为生产组件的指标来源。

## 9. 演进规则

- Rust 端最终应使用 typed DTO，并生成或校验 JSON Schema；UI 端保留运行时校验。
- 添加可选字段属于向后兼容；删除、改名、改变单位或语义必须提升 subject schema version。
- 数值字段必须在 schema 或 definitions 中声明单位。
- analyzer 对大 run 仍须输出有界 payload；原始数据查询由后端执行。
- fixtures 必须来自真实 artifact 的最小裁剪或明确的 synthetic case，并覆盖 unavailable、failed、incompatible。
