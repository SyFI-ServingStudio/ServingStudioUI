# Claude preview — 2026-09-07

UI: http://10.158.48.50:60035/ （监听 0.0.0.0，本机 http://127.0.0.1:60035/ 已验证）

| 服务 | 工作树 | 监听地址 |
| --- | --- | --- |
| Vite live UI | wt-ui-claude/app | 0.0.0.0:60035 |
| Agent | wt-agent-claude | 172.17.0.1:8767 |
| Analyzer | main，#32 的 620e90e 已重新构建 | 172.17.0.1:8789 |

三项服务由独立 tmux server 保持运行，socket 为 `/tmp/vibesim-claude-1003.sock`，session 名称为 `ui`、`backend`、`analyzer`。

```bash
tmux -S /tmp/vibesim-claude-1003.sock list-sessions
```

启动脚本和日志在本工作树 `.artifacts/claude-preview/`：

- `ui.sh` / `ui.log`
- `backend.sh` / `backend.log`
- `analyzer.sh` / `analyzer.log`

运行状态独立存放于 `/raid/kanzhu/VibeSimWorkspace/agent-workspaces-claude/`；该目录已加入 workspace `.gitignore`。`w_main` 按原有设计指向 main 的项目与日志，新建工作区才会复制项目。原实例的状态目录和服务未修改。

runner 镜像为 `vibesim-ui-codex-runner:kanzhu-claude`，版本标签 `prebuilt-agent-runner-v11`，已通过仓库镜像 build 验收和 CUDA 可见性验证。新容器通过 host.docker.internal:8767/8789 访问对应服务，连通性已验证。

Claude 菜单已启用。backend.sh 使用 Agent 的 with_claude_env.py，优先采用认证环境变量，否则静态解析本机 claude alias/function 的配置。已成功使用本机 wrapper 配置完成容器真实 READY 请求。修改配置后重启 backend；详见 ../wt-agent-claude/README.md。

本机 HTTP、桌面/手机浏览器和 UI 测试通过；Claude 最小模型请求已验证，完整工具/恢复/混合角色端到端仍待验证。局域网直连检查被自动审批拒绝，本记录不宣称其已验证。包体积预算的既有超限见 notes.md。

启动脚本会读取 agent-workspaces-claude/claude.env。文件使用 chmod 600，内容为 export ANTHROPIC_API_KEY=... 或 export CLAUDE_CODE_OAUTH_TOKEN=...；凭据不写入工作树或镜像。更新后重启独立 tmux 的 backend pane。
