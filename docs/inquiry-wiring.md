# Inquiry 接入:待办清单

本文追踪把 agent 对话接入 viz-ui(即 `design/b-real.html` 所演示的形态)还缺什么。
它补充 `data-protocol.md`(Analyzer → UI 合同)和 `frontend-architecture.md`(合同进入
浏览器后归谁读取):本文只讲**目前不存在、必须新建**的部分,以及每一处的归属方。

状态约定沿用 `WORKPLAN.md`:`[x]` 已完成,`[ ]` 待完成,`[~]` 正在进行。

设计参考:`design/b-real.html`(聚合页 → 详情页,左侧对话面板);`design/index.html`
列出四个备选方向及取舍。

---

## 0. 结论先行

**run 详情页是 100% 复用,一行不用改。** `app/src/App.tsx` 的四个 section、
`VizState`、`AnalyzerRepository` 的 12 个方法、13 个 subject、9 个 feature stage
全部原样服务于新形态。

**缺的东西全在 run 之上。** 五块:聚合分析(产出)、聚合协议(传输)、聚合 UI、
agent 通道、以及**卡片与 run 之间的链接**。最后一块最不明显,单独用第 5 节展开。

### 0.1 2026-07-28 实现状态：统一为 Workspace

早期清单把 `conversation`、`inquiry` 和隔离目录近似看成同一个对象；当前实现明确拆开：

- `workspace` 是持久工作边界：一个 repo、一个 logs root、一个 SQLite、多个
  conversations、多个 experiments/jobs；
- `conversation` 是 workspace 内的一条叙事，不再自动复制 repo；
- `w_main` 是外部 development checkout，也是一等 workspace；
- `inquiry` 暂不另建持久实体；一次分析问题由 conversation turn +
  `conversation_experiments` 关系表达，只有未来出现跨 conversation 的研究对象时再提升。

共享 registry 位于 `agent-workspaces/registry.json`。每个
`agent-workspaces/<workspace-id>/workspace.json` 保存稳定 id、display name、状态、repo/logs
位置、base revision 与 last access；派生状态只进入该 workspace 的 `workspace.sqlite`。
Analyzer 只读 registry 中的 active logs roots，因此归档 workspace 会从 catalog 消失，
但删除 Docker container 不会删除 repo、对话或实验。

系统支持三种调用形态，但 Launcher/Analyzer 合同保持一致：

1. **直接开发**：开发 Agent 或人直接运行 Launcher；没有 managed context 时仍是普通 run。
2. **UI managed Agent**：conversation backend 为 turn 签发短期 capability，并通过隔离
   Codex home 注入 `managed-run.json`。Launcher 注册 experiment、上报 lifecycle，backend
   强制其 workspace/conversation/turn 身份及 logs-root 边界。
3. **只读已有结果**：用户从 Page 0 选择任何 active workspace 的 experiment；Agent
   只通过同一 Analyzer MCP 读取，不需要重跑。

Managed Launcher 在 experiment 根写 `experiment.meta.json`。其中稳定 `experiment_id`
同时进入 SQLite relationship 和 Analyzer catalog；因此 `experiment.ready` SSE 卡片中的
link 能精确打开 `(workspaceId, experimentId)`，不靠目录名或 catalog 顺序猜测。

UI 的两个入口现在复用同一个 workspace shell：

- 已有 experiment → 直接进入 aggregate Analyzer，可展开/拖拽/全屏 Agent；
- Agent-first → 先创建一个 workspace，再在其中创建 conversation；Agent 产出的 experiment
  通过 job card 回到同一个 aggregate Analyzer；
- 打开或刷新 Analyzer 只加载 history，不会创建 conversation；只有发送首问时才
  materialize conversation。

Evidence/citation 已提升为 v2。Aggregate 与 run target 都强制带 `workspaceId`，URL、
selection-change、conversation context、frozen citation 与 click navigation 使用同一身份。
Agent 仍只复制 turn dictionary 中的自然 symbolic token，不写 opaque id 或 URL。

Agent-first 的 dictionary 不要求在发送首问时已经存在。Agent 通过 managed Analyzer MCP
读取它刚生成的 workspace sweep payload 时，bridge 用当前 turn capability 将 payload 注册回
conversation backend；backend 以 capability 的 `workspaceId` 和已登记的 `experimentId`
重建 bounded dictionary，并把 citation document 随同本次 MCP 结果返回。最终答案冻结引用时
使用该 turn 最后注册的 dictionary，而不是只使用浏览器在 turn 开始时附带的 snapshot。
因此“先生成、后分析、再引用”与“从已打开的 Analyzer 开始解释”共享同一 Citation DSL。

下文保留早期 gap 推导作为设计背景；凡与本节冲突，以本节和当前代码为准。尚未完成的主要
工作是 inquiry-level constraints/verdict，而不是 workspace/Agent/Analyzer wiring。

---

## 1. 已有资产(用于界定"不用做"的边界)

以下均为已验证事实,不是推测:

| 资产                 | 位置                                          | 与新形态的关系                                                                                                                                 |
| -------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `VizState`           | `app/src/store.ts`                            | **它本身就是 context payload**。Run selection 字段全部可序列化,不必另造一份 selection state                                                    |
| `AnalyzerRepository` | `app/src/repositories/AnalyzerRepository.ts`  | 12 个方法全部以 `runId` 为键;agent 产出的 run 目录已是 `manifest.json` / `payloads/` / `reports/` 布局,`ArtifactAnalyzerRepository` 今天就能读 |
| 13 个 subject        | `app/src/contracts/analyzer/v1/subjectIds.ts` | 全部复用                                                                                                                                       |
| 9 个 feature stage   | `app/src/features/`                           | 全部复用(cost tree、timeline、Perfetto、optimality)                                                                                            |
| lifecycle 轮询策略   | `app/src/application/lifecyclePolling.ts`     | **直接复用于"phase 正在跑"**:`pending` 2 s、`not_started`/catalog 30 s、focus 时强制重取                                                       |
| agent 后端           | `user-facing-ui/backend/app.py`               | 已有多轮会话、SSE 流、按 `cid` 隔离的 workspace、artifact 列举与下载                                                                           |

### 1.1 一处必须修改的既有代码

- [x] **`store.ts::setRun` 支持显式保留选择。**

  ```ts
  setRun(runId, { keepSelection: true });
  ```

  普通 run 切换继续清空不适用的 drill state；citation 明确要求“另一个 run 的同一
  selection”时才走 `keepSelection`。目标 run 缺少对应 subject 时再回退到 `cluster`。

### 1.2 一处不要做的事

面板几何(`hidden | spine | docked | full` + 宽度)**不进 `VizState`**。`VizState` 是
发给 agent 的载荷,面板宽度不是 context。放在独立的 UI store 里。

---

## 2. 缺口 A · 聚合分析器(产出侧)

今天没有任何跨 run 的产物。代码库里所有 `Aggregate*` 类型(`domain/kernelTimeShare.ts`、
`domain/optimality.ts`)聚合的都是 **run 内部**跨 worker / 跨 iteration 的量,与本节无关。

- [ ] **决定归属:launcher 还是 analyzer。** 关键约束:**analyzer 不知道 sweep 轴,
      launcher 才知道**。被 sweep 的参数值虽然落在每个 run 的 `raw/params.json` 里,
      但"这一组 run 沿 `request_rate` 变化"这件事只有 launcher 的 sweep 定义知道。
      倾向:由 launcher 在启动一组 sweep 时写出 phase 清单,analyzer 只负责补齐每个
      run 的标量。
- [ ] **定义 inquiry / phase 产物。** 至少要有:inquiry id、问题文本、phase 列表,
      每个 phase 有目录名、sweep 轴名、成员 run 列表。
- [ ] **每个 run 的聚合标量。** 表格里除 `request_rate` 和 `verdict` 外的每一列
      (mean/p90/p99 TPOT、TTFT、decode batch、out tok/s、gpu busy、finished)
      **今天都已在 per-run 的 `summary` + `slo` subject 里**,聚合器只需按 run 收齐,
      不需要新算法。
- [ ] **暴露 `params`。** `contracts/analyzer/v1/params.ts` 已实现并被解码,但只被
      `topology.ts` 消费成 `Arch.params`,界面上从未露出。被 sweep 的值就在那儿。
- [ ] **约束与 verdict 归属未定。** `TPOT ≤ 32 ms` 是 **inquiry 的**属性,不是 run 的;
      analyzer 的契约里没有任何地方能放"约束"或"判定"。三个候选:(a) 写进 inquiry 产物,
      (b) UI 侧配置,(c) agent 每次带上。倾向 (a) —— 它必须和产生它的那轮问答一起持久化,
      否则复盘时无法解释 pass/fail 从何而来。
- [ ] **run 身份与可寻址性。** `runCatalog.ts` 明确写着 `run_id` 是
      "an opaque server-issued token, not a path"。而 agent 是用目录名工作的
      (`workspaces/<cid>/main/logs/<experiment>/<phase>/<run>/`)。**这两者必须建立映射**,
      否则第 5 节的链接方案不成立。

---

## 3. 缺口 B · 聚合协议与端点

- [ ] **`run_catalog.json` 需要分组,但它是 `.strict()` 的。** 见
      `contracts/analyzer/v1/runCatalog.ts`:每一层对象都 `.strict()`,因此**任何新增
      字段都会直接变成解析错误**。要么走可选字段 + 版本协商,要么单开一个 inquiry 产物,
      让 catalog 保持不变。倾向后者:catalog 是"有哪些 run",inquiry 是"为什么有这些 run",
      本就是两件事。
- [ ] **新增端点。** 形如 `GET /api/v1/inquiries`、`/inquiries/{id}`、
      `/inquiries/{id}/phases/{phase}`。命名与既有 `/api/v1/` 保持一致
      (`HttpAnalyzerRepository` 默认 base 就是 `/api/v1/`)。
- [ ] **仓储边界:新开 `InquiryRepository`,不要往 `AnalyzerRepository` 里塞。**
      后者的注释写明它是 "the only analyzer-data boundary visible to application
      features",且全部方法以 `runId` 为键。inquiry 是另一个维度。
- [ ] **静态 artifact 实现也要跟上。** `configuredAnalyzerRepository.ts` 会在非 live
      模式下回退到 `bundledArtifactAnalyzerRepository`。若 inquiry 只在 HTTP 侧实现,
      fixture 环境会整块缺失 —— 需要一份 inquiry fixture,并遵守
      `docs/fixture-policy.md`(真实产出裁剪,不伪造)。
- [ ] **正在跑的 phase 要能刷新。** 复用 `lifecyclePolling.ts` 的策略常量;
      inquiry 层的轮询节奏应当由其成员 run 的 lifecycle 决定,不要另立一套。

---

## 4. 缺口 C · UI

- [ ] **新 feature:`features/inquiry/`。** sweep 条(每轮一条)、跨 run 图表、run 表格。
      遵守 `frontend-architecture.md` 的 feature 边界,只通过 `index.ts` 对外。
- [ ] **跨 run 图表是净新增。** 今天没有任何 N-run 图表,也没有共享坐标轴的组件。
      注意 y 轴不能锚定 0:0.1 网格的 phase 跨度只有 31–36 ms,锚 0 会把 crossing 压成
      一条直线(`b-real.html` 踩过这个坑)。
- [ ] **路由。** 今天 `App.tsx` 只渲染单个 run,**没有路由**。两个视图需要引入一层,
      并且 inquiry / phase / run / scope 应当可分享(URL 承载 `VizState` 的子集)。
- [ ] **对话卡片需要移植,不能引用。** `user-facing-ui/frontend` 是 React 19 + Tailwind 4,
      viz-ui 是 React 18 + MUI 5 + emotion。卡片清单:RoleCard(头像 / round / 状态 chip /
      `intermediate output · N` / 要点 / ToolCallLine / TokenFooter)、两种 HandoffCard、
      AnswerCard。角色配色按色相平移:orchestrator 琥珀→gold `#806600`,
      implementer 青→teal `#1f6f6b`,answer 玫→terra `#a84b2e`。
- [x] **面板状态机。** `hidden | spine | docked | full` + 拖拽改宽 + 键盘。几何状态与
      宽度由 `features/workspace/workspaceUiStore.ts` 独立持有；docked 分隔线支持 pointer
      drag、方向键、Home / End，Agent header 支持折叠为零宽 spine 与 full-page 往返；
      spine 只在 Analyzer 左侧中点保留一个小型梯形展开 tab，不占用内容宽度。
      docked 与 spine 之间切换时 Agent pane 保持 mounted，以宽度、透明度和轻微位移共同
      过渡；边界 tab 随 grid boundary 连续移动，不能因条件卸载导致内容或 Analyzer
      panels 在动画终点跳变。
      `b-real.html` 里有三个已修 bug 值得带过去: 1. 指针捕获结束时仍派发 `click`,会把刚折叠的面板立刻弹回; 2. 头部按钮的 click 冒泡到"点书脊展开"处理器,同上; 3. grid 用隐式 `auto` 行 + `height:100vh` 会把 composer 顶出视口,必须
      `grid-template-rows: minmax(0,1fr)`;两列都要显式 `grid-column`,
      否则某一列 `display:none` 时另一列会被自动放置到坍缩的那一列。
- [x] **context chip 与 payload。** payload 可展开为字面 `VizState`，发送 turn 时同一
      selection 与 bounded citation dictionary 作为 `analyzerContext` 进入 conversation
      backend；面板几何不进入 payload。
      这是 Chrome DevTools AI assistance 的信任机制,不要藏。
- [ ] **降级路径。** 选中一个尚未分析完的 run 必须显式降级(显示 lifecycle 两段状态),
      不能白屏。这与 `WORKPLAN.md` P1 里"对 unavailable / not generated / failed 提供
      明确 UI 状态"是同一条要求。

---

## 5. 缺口 D · Citation DSL

卡片 ↔ Agent 文本不再使用 run-id token matching，也不从数字或散文推断链接。完整合同见
[`citation-dsl.md`](citation-dsl.md)。

v1 的核心形式是由 turn citation dictionary 定义的 symbolic evidence path：

```md
At `exp.tp2.rate20.throughput`, throughput reaches 8,420 tok/s.
```

职责边界：

- Analyzer 从 launcher axes、members 和已注册 evidence panels 生成 citation dictionary；
- Conversation host 在创建 turn 时把 bounded registry snapshot 作为输入 context 提供给
  Agent；
- Agent 决定哪个 symbolic token 支持当前 claim；
- Conversation host 把 token 冻结为具体 `EvidenceRefV1`；renderer 只渲染，不导航；
- 只有用户点击 citation 才发送 `AnalyzerNavigateCommandV1` 并触发滚动、高亮。

现有 commentary collector 的纯文本可以直接承载 inline-code token。Agent 不写 URI、
percent encoding、JSON 或 opaque IDs；sidecar 只持久化已解析的 frozen target。

- [x] 把 aggregate-only `EvidenceRefV1` 提升为 `aggregate | run` union
- [x] 建立 React evidence registry 和 symbolic dictionary；aggregate 从 launcher axis
      order、真实 member allowlist 与 metric panel registry 生成，run target 冻结完整 drill state
- [x] Conversation request 保存并发送 bounded dictionary snapshot
- [x] Agent instruction 只允许使用 dictionary 中的 symbolic token
- [x] 单 backtick inline-code resolver + frozen citation persistence；禁止扫描普通 prose
- [x] Citation click bridge；未点击不得改变 Analyzer，点击后等待 `navigation-result`
- [x] 持久化每个 turn 的 Markdown、dictionary identity、frozen targets 与 DSL version
- [x] Agent-first 动态 dictionary：workspace sweep MCP read 注册 turn-scoped snapshot，
      finalization 使用最新 snapshot 冻结引用

---

## 6. 缺口 E · agent 通道

viz-ui 今天**完全没有**写入侧:`AnalyzerRepository` 是严格只读的 artifact 接口,
没有"发问题"的方法,也没有接收 turn 的流。

- [x] **`ConversationRepository`**,与 `AnalyzerRepository` 平级、方向相反:
      一个读 artifact,一个收发 turn。
- [x] **复用既有后端。** `user-facing-ui/backend/app.py` 已提供
      `POST /api/conversations/{cid}/messages`、`GET /api/conversations/{cid}/stream`(SSE)、
      `POST /api/conversations/{cid}/cancel`,以及 token 门控的 agent 侧
      `/api/agent/conversations*`。不要重写。
- [x] **恢复与失败语义。** 空闲 conversation 的 `GET .../stream` 返回 `204`，不是
      conflict；turn failure 以 `{code,message}` 持久化并随 `done` 发送。完整 subprocess /
      Docker 诊断只进 backend log，不能伪装成 Answer 或泄漏到对话正文。
- [x] **首问启动可重入。** Page 0 创建 conversation 后进入 `#/agent` 时，初始化必须在
      React StrictMode 的 effect setup/cleanup replay 下保持幂等：只创建一个 conversation，
      完成一次 idle resume，并且首条 prompt 只发送一次。
- [x] **决定部署形态。** 开发环境保持浏览器同源：Vite 将 `/api/conversations` 转发到
      `user-facing-ui`（默认 8765），其余 `/api` 仍转发到只读 Analyzer（默认 8787）。
      Codex container 的 Analyzer MCP 明确区分 `source="host"`（UI 已选实验）与
      `source="workspace"`（Agent 在隔离 workspace 内新产出的 simulation）。
- [x] **提问时携带 `VizState`。** 载荷即字面 run selection 字段 +
      `inquiryId` / `phaseId`，并附带 Citation DSL 所需的 bounded evidence registry。
- [ ] **注意笔记会被去重。** `(role, text)` 精确去重意味着 UI 拿到的笔记序列
      **不保证完整**;不要基于"笔记条数"做任何推断。

---

## 7. 跨切面未决问题

- [ ] **一个 inquiry 对应一个 workspace 吗?** 后端按 `cid` 隔离 workspace;
      inquiry 是否就等于 conversation?若是,`inquiryId` 应直接用 `cid`。
- [ ] **多 workspace / 多用户的可见性与鉴权。**
- [ ] **agent 正在跑时的 UI 语义。** 聚合页需要区分 `simulating` / `analysing` / `queued`
      三态(`b-real.html` 已演示),这要求 lifecycle 两段状态一直传到 inquiry 层。
- [ ] **inquiry 产物写在哪里。** 与 run 同级?还是 workspace 根?影响 fixture 裁剪方式。
- [ ] **Perfetto 的教训要守住:**布局不得随选择变化而出现/消失。唯一允许的例外是
      用户主动请求看证据(全屏时点脚注 → 退回分栏),`b-real.html` 里已如此实现。

---

## 8. 建议顺序

每一步结束时系统都应可用,且不依赖后一步。

1. **共享 EvidenceRef contract。** 先完成 `aggregate | run` union 与 navigation
   round-trip tests。
2. **React evidence registry。** Aggregate 与 run-level panel 注册 descriptor，并可生成
   bounded snapshot；这一阶段仍不接 Agent。
3. **协议与端点 + fixture**(第 3 节)。让 inquiry 与 conversation transport 都能持久化
   turn-time registry allowlist。
4. **对话面板移植**(第 4 节后半)，先用 fixture message 验证 Citation Markdown renderer。
5. **Citation click bridge。** 只有真实用户 activation 才导航；覆盖 aggregate、run、
   stale 和 invalid targets。
6. **Agent 通道**(第 6 节)。最后接写入侧，并在 prompt 中只公布 symbolic citation
   dictionary。

---

## 9. 验收

- 聚合页能按 inquiry / phase 浏览,pass/fail 相对**声明的**约束(不是硬编码)判定
- 未分析完的 run 显式降级,并按 lifecycle 自动刷新
- 点表格行 / 带子格 / 图上的点,都进入同一个 run 详情页,且**保留选择**
- 详情页与今天 `App.tsx` 的行为逐项一致(00/01/02/03 四段、Run ▸ Pool ▸ Worker ▸ Kernel)
- Agent 只能引用 turn dictionary 中的 symbolic token；invented citation 不可点击
- 未点击 citation 时 Analyzer 的 URL、selection、scroll 和 render count 不变
- 用户点击后 aggregate/run citation 都经 acknowledgement 导航并高亮；stale target
  保留当前位置并显示 `not-found` / `unavailable`
- context chip 展开显示字面 `VizState`,与实际发送的载荷逐字段一致
