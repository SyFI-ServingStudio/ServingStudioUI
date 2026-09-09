# 视觉检查记录

2026-09-08。主要桌面界面已改版并实际打开截图检查。截图位于工作树 `.artifacts/style-audit/`。

| 界面 | 截图 | 数据来源与范围 |
| --- | --- | --- |
| 目录与 Aggregate | final-entry.png、final-aggregate.png | Live 目录及 Llama sweep |
| Run/cluster/pool/worker | run-cluster.png、run-pool.png、run-worker.png | 仓库 fixture，系统图及指标 |
| Prediction/成本树/kernel 下钻 | prediction-refined.png、cost-tree-readable.png、kernel-detail.png | Live GLM prediction |
| Alignment | alignment-mapping.png、alignment-wallclock.png、alignment-whole-run.png | 仓库 fixture，映射、时间线与延迟图 |
| Kernel profile/measurement | kernel-profile-refined.png、kernel-measurement-refined.png | Live 数据；measurement 当前资源没有 plots |
| Agent 设置 | agent-setup.png、workspace-selection.png、agent-composer.png、model-picker.png | 设置与模型目录；未提交 |
| Agent 会话/历史 | agent-conversation.png、agent-history.png、conversation-catalog.png | 浏览器拦截样例，仅验证展示 |
| 文件预览 | file-preview.png | 浏览器拦截 Rust 样例，含停靠 Agent |
| 缺失数据状态 | run-iteration.png、optimality.png、alignment-split.png | Fixture 未生成对应数据，仅检查空状态 |

Agent 样例没有向后端发送消息或启动实验。Fixture 空状态不代表相应完整分析图已验证；真实成本树与下钻另用 live prediction 检查。

目视复查修复了 Agent 停靠区浅色、模型表头重叠、成本树缩放过小和 kernel 详情折行。最终生产构建与 TypeScript 检查通过，git diff --check 通过，浏览器未记录 pageerror。遵循用户速度优先要求，未运行单元测试、多屏宽或完整无障碍矩阵。

主预览 http://127.0.0.1:5188/；fixture 预览 http://127.0.0.1:5189/。服务仅监听本机。
