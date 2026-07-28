# VibeSim Citation DSL v2

本文定义 Agent 如何在自然语言中引用 Analyzer evidence，以及用户点击引用后如何定位到
对应的 experiment coordinate、metric 或 run-level panel。

## 1. 核心形式

Agent 写一个简短的 symbolic evidence path，并用 Markdown inline code 标出：

```md
At `exp.tp2.rate20.throughput`, throughput reaches 8,420 tok/s.
```

Conversation UI 只检查完整的 `inlineCode` AST node。若 token 属于该 turn 公布的 citation
dictionary，就把它渲染为可点击 citation：

```text
At TP=2 · rate=20 · Throughput¹, throughput reaches 8,420 tok/s.
```

Agent 不写 URI、percent encoding、JSON、experiment ID、run ID 或 coordinates payload。

## 2. Ownership

| 阶段      | Owner             | 职责                                                                               |
| --------- | ----------------- | ---------------------------------------------------------------------------------- |
| 命名      | Analyzer UI       | 从 launcher axes、member coordinates 和 registered panels 生成 citation dictionary |
| turn 输入 | Conversation host | 把 bounded dictionary snapshot 随用户问题提供给 Agent                              |
| 选择      | Agent             | 选择支持当前 claim 的 symbolic token                                               |
| 冻结      | Conversation host | 将 token 解析为具体 `EvidenceRefV2`，与 message 一起持久化                         |
| 渲染      | Conversation UI   | 将已冻结 citation 渲染为可访问 control；不导航                                     |
| 激活      | 用户              | 点击 citation，明确请求查看 evidence                                               |
| 导航      | Analyzer bridge   | 发送 `AnalyzerNavigateCommandV2`，等待 acknowledgement                             |

“引用到哪里”由 Agent 选择哪个 token 决定。Runtime 不根据 prose、数值或当前 selection
替 Agent 猜 target。

v2 的身份边界是 `(workspaceId, experimentId | runId)`。`workspaceId` 来自当前
conversation/analyzer shell，而不是 Agent 文本；同一个 opaque experiment 或 run token
即使在另一个 workspace 中碰巧存在，也不得被当作同一 evidence。

## 3. Lexical grammar

```ebnf
citation-source = "`", citation-token, "`" ;
citation-token  = namespace, ".", path ;
namespace       = "exp" | "run" ;
path            = segment, { ".", segment } ;
segment         = letter, { letter | digit | "_" | "-" } ;
letter          = "a" … "z" ;
digit           = "0" … "9" ;
```

Token：

- 全部小写；
- 不允许 whitespace；
- 不允许 percent encoding；
- 最大 160 ASCII characters；
- 必须完整匹配 turn dictionary，grammar 合法但未公布的 token 仍然 invalid。

Inline code 是显式 delimiter。UI 禁止扫描普通 prose 并把形似 `exp.foo` 的文本自动建链；
也禁止对数字、title 或 run display name 做 fuzzy matching。

## 4. Experiment namespace

`exp` 在 turn 创建时绑定当前 active experiment。Source token 不包含 opaque
`experimentId`；host 在冻结 citation 时补入。

Aggregate token 结构：

```text
exp.<axis-value-segment>...<axis-value-segment>.<metric-path>
```

Axis segments 必须遵循 launcher DSL declaration order。没有 axis segment 表示引用整个
metric panel：

```text
exp.throughput
exp.tpot.mean
```

带 axis segments 表示引用具体 sweep member：

```text
exp.tp2.rate20.throughput
exp.tp4.rate44p6.tpot.mean
```

### 4.1 Axis aliases

Citation dictionary 为每个 launcher axis 公布一个短 alias，并为每个实际 value 公布完整
segment。Agent 只复制 segment，不负责把 value 编码成 segment。

示例：

| Launcher binding  | Alias  | Value | Segment    |
| ----------------- | ------ | ----: | ---------- |
| `tensor_parallel` | `tp`   |     2 | `tp2`      |
| `tensor_parallel` | `tp`   |     4 | `tp4`      |
| `request_rate`    | `rate` |    20 | `rate20`   |
| `request_rate`    | `rate` |  44.6 | `rate44p6` |

`p`、`m` 等字符没有全局数值语义；`rate44p6 → 44.6` 的映射来自 dictionary。Parser
不反向猜测 segment。

Compound sweep binding 仍是一个 axis。Dictionary 为每个实际 compound member 生成一个
segment，并把它映射到完整 binding object；不能把 compound members 拆成不存在的笛卡尔积。

### 4.2 Metric paths

Metric path 来自已注册 evidence panels，不从显示 title 推导。典型路径：

| Metric path   | Meaning                    | Unit    |
| ------------- | -------------------------- | ------- |
| `throughput`  | Total output throughput    | `tok/s` |
| `utilization` | GPU utilization            | `%`     |
| `ttft.mean`   | Mean time to first token   | `ms`    |
| `ttft.p99`    | P99 time to first token    | `ms`    |
| `tpot.mean`   | Mean time per output token | `ms`    |
| `tpot.p99`    | P99 time per output token  | `ms`    |

真正可用的 metric paths 由当前 dictionary 列出；本表不是硬编码 registry。

## 5. Run namespace

`run` 在 turn 创建时绑定当前 active run。常用形式：

```text
run.cluster.throughput
run.cluster.utilization
run.cluster.slo.ttft
run.pool.ffn.utilization
run.worker.ffn_0.batch.total_tokens
run.kernel.leaf52.performance
```

这些 token 同样必须由 dictionary 明确公布。`ffn_0`、`leaf52` 等 segment 是 dictionary
alias；Agent 不解析或构造 worker identity、CostTree identity。

Host 冻结 run token 时生成包含 `workspaceId`、`runId`、`panelId`、scope 和必要 drill
identity 的 run `EvidenceRefV2`。未在 token 中声明的 drill dimension 不从点击时的
Analyzer state 继承。

## 6. Agent-facing citation dictionary

Conversation host 为每个 turn 生成一段紧凑文档。推荐格式：

```md
## Analyzer citation references

Write an exact reference as Markdown inline code, for example
`exp.tp2.rate20.throughput`. Use only the forms and segments listed below.
Writing a reference does not navigate the Analyzer; navigation happens only
when the user clicks it.

Experiment `exp`

- axes, in order:
  - `tp<i>`: tensor parallel; valid segments: `tp2`, `tp4`
  - `rate<j>`: request rate; valid segments: `rate20`, `rate40`
- valid members:
  - `tp2.rate20`
  - `tp2.rate40`
  - `tp4.rate20`
  - `tp4.rate40`
- metrics:
  - `throughput`: total output throughput, tok/s
  - `utilization`: GPU utilization, %
  - `tpot.mean`: mean TPOT, ms
  - `tpot.p99`: p99 TPOT, ms
- form: `exp.<member>.<metric>`
- panel form: `exp.<metric>`

Current run `run`

- `run.cluster.throughput`: cluster throughput
- `run.cluster.utilization`: cluster GPU utilization
```

`valid members` 是 exact allowlist，不是 axis domains 的隐式笛卡尔积。这样 sparse、compound
或失败后缺 member 的 sweep 不会产生虚构 coordinate。

Dictionary 默认包含：

1. 当前 selection；
2. 当前 Analyzer view 中注册的 panels；
3. 当前 experiment 的 bounded member aliases；
4. 当前 inquiry 中最近由用户点击过的 evidence。

超过 context budget 时优先保留 current selection，再保留 viewport panels。Agent 没看到的
token 不可引用。

## 7. Resolution and freezing

Conversation host 收到完整 Agent message 后，通过 Markdown AST 查找 `inlineCode` nodes：

1. node content 是否符合 lexical grammar；
2. token 是否精确存在于该 turn 的 dictionary snapshot；
3. dictionary entry 是否能解析为 strict `EvidenceRefV2`；
4. aggregate member alias 是否只对应一个 run；
5. target 是否满足 metric/scope invariants。

通过后，host 生成 frozen citation：

```ts
interface FrozenCitationV2 {
  protocol: "vibesim.citation/v2";
  token: string;
  sourceStart: number;
  sourceEnd: number;
  displayLabel: string;
  target: EvidenceRefV2;
}
```

Message 必须一起持久化：

- 原始 Markdown；
- turn dictionary identity/version；
- frozen citations；
- Citation DSL version。

历史 message 渲染和点击以 frozen `target` 为准，不用当前 experiment 重新解释 `exp`。因此
用户切换 experiment、run 或刷新页面后，citation destination 不会漂移。

Sidecar 在这里负责持久化 resolution，但 Agent 不读写它，也不靠 message-local `ev_1`
选择 target。

## 8. Invalid and stale references

以下情况都是 invalid：

- 普通 prose 中出现 `exp.tp2.rate20.throughput`，但没有 inline-code delimiter；
- token grammar 合法，但不在 turn dictionary；
- axis segments 顺序错误；
- member prefix 不在 exact valid-member allowlist；
- metric path 未注册；
- 同一个 member alias 解析到多个 run；
- Agent 手写 opaque ID、URI、JSON 或 percent-encoded payload。

Invalid token 保持普通 inline code，不可点击；不得尝试最接近匹配。

Frozen citation 在生成时有效，但用户点击时 target artifact 已不存在，则是 stale，而不是
invalid。Analyzer 返回 `not-found` 或 `unavailable`；Conversation UI 保留当前位置并显示
简短状态。

## 9. Rendering and click semantics

渲染、流式 token 到达、hover、focus 或恢复历史消息都不得改变 Analyzer。

Renderer：

- 用 `displayLabel` 替换 source token 的可见文本；
- 自动附加按首次出现排序的脚注序号；
- 相同 frozen target 在同一 message 中复用序号；
- teal underline 表示可点击，active 使用 ink/paper 反转；
- 使用原生 link/button 键盘语义和现有 warm-paper focus ring。

只有可信 user click / keyboard activation 才执行：

1. 创建唯一 `requestId`；
2. 把 frozen target 放入 `AnalyzerNavigateCommandV2`；
3. 发送给同源 Analyzer；
4. 等待相同 `requestId` 的 `AnalyzerNavigationResultV2`；
5. `ok` 后 citation 进入 active state，Analyzer 滚动并高亮；
6. `not-found` / `unavailable` 时不改变当前 Analyzer view。

Agent 生成 citation 不得触发 navigation。不存在 Agent-facing `focus_evidence` implicit
step。

## 10. Required implementation boundaries

- `domain/evidenceRef.ts`：`aggregate | run` `EvidenceRefV2` strict union；两种 target 都必须
  携带 `workspaceId`，不得跨 workspace 隐式解析。
- `domain/citationDsl.ts`：token grammar、dictionary schema、resolver、frozen citation。
- `components/evidenceRegistry.tsx`：React panel registration 和 dictionary snapshot。
- Conversation request contract：携带 Agent-facing dictionary document 和 machine snapshot。
- Conversation ingestion：Markdown AST resolution 和 frozen citation persistence。
- Conversation renderer：citation component。
- Citation click bridge：唯一允许从 citation 发送 `AnalyzerNavigateCommandV2` 的位置。

现有 `domain/analyzerNavigation.ts` 的 aggregate-only `EvidenceRefV2` 应迁移到共享
`domain/evidenceRef.ts`，并增加 run variant。

## 11. Acceptance

- Agent source 只需要写类似 `` `exp.tp2.rate20.throughput` `` 的短 token。
- Agent 不接触 URL encoding、coordinates JSON、opaque experiment/run ID。
- Parser 不扫描普通 prose，只解析完整 inline-code AST node。
- Token 只能引用 turn dictionary 的 exact member 和 metric。
- Historical citation 使用 frozen target，不随当前 context 漂移。
- 未点击 citation 时 Analyzer 的 URL、selection、scroll 和 render count 不变。
- 用户点击后 aggregate/run citation 经 acknowledgement 导航并高亮。
- Invalid、invented 和 stale citation 不产生错误导航。
