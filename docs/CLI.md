# YanClaw 命令行工具

> `yanclaw` CLI — 终端对话、Gateway 管理、资源操作。

---

## 1. 安装与运行

```bash
# 开发环境
bun run yanclaw <command>

# 或直接执行
bun run packages/server/src/cli.ts <command>
```

---

## 2. 命令总览

```
Usage: yanclaw <command> [subcommand] [options]

Gateway:
  serve              Start Gateway in foreground
  start              Start Gateway in background
  stop               Gracefully stop Gateway
  restart            Restart Gateway
  status             Show running status

Chat:
  chat [message]     Send a message (or -i for interactive)

Management:
  agents             list|show|create|delete
  channels           list|connect|disconnect
  sessions           list|show|export|delete
  config             show|get|set|edit
  cron               list|run
  memory             search|add|delete|stats
  plugins            list

Global options:
  --json             Output as JSON
  --api <url>        Override API base URL
  -h, --help         Show help
```

---

## 3. Gateway 管理

```bash
yanclaw serve           # 前台启动（开发调试用）
yanclaw start           # 后台启动（daemon 模式）
yanclaw stop            # 优雅关闭
yanclaw restart         # 重启
yanclaw status          # 查看运行状态
yanclaw status --json   # JSON 格式输出
```

---

## 4. 终端对话

### 单次对话

```bash
yanclaw chat "帮我总结项目进展"
yanclaw chat --agent code "重构这个函数"
yanclaw chat -a code -p fast "快速回答"
```

### 交互式 REPL

```bash
yanclaw chat -i
yanclaw chat -i --agent code --session my-project
```

REPL 中可用命令：

| 命令 | 说明 |
|------|------|
| `/exit`, `/quit` | 退出 |
| `/clear` | 清除会话，重新开始 |
| `/agent [id]` | 查看或切换 Agent |
| `/session [key]` | 查看或切换会话 |
| `/cancel` | 取消当前 Agent 运行 |
| `/help` | 帮助 |

### 管道模式

```bash
# 将 stdin 作为上下文
cat error.log | yanclaw chat "分析这个错误"
echo "hello" | yanclaw chat --agent translator
git diff | yanclaw chat "review 这段变更"
```

### 选项

| 选项 | 缩写 | 说明 | 默认值 |
|------|------|------|--------|
| `--interactive` | `-i` | 交互式 REPL | false |
| `--agent` | `-a` | 目标 Agent | `main` |
| `--session` | `-s` | 会话 Key | `agent:{agentId}:cli` |
| `--preference` | `-p` | 模型偏好 (fast/quality/cheap) | `default` |
| `--no-tools` | | 隐藏工具调用详情 | false |

### 输出格式

- **文本**：逐 token 流式输出
- **工具调用**：`⚙ tool_name(args)`（青色）
- **工具结果**：`→ result`（灰色，截断 200 字符）
- **Token 用量**：`[tokens: 1234→567]`（灰色）
- **错误**：红色显示

---

## 5. Agent 管理

```bash
yanclaw agents list                                    # 列出所有 Agent
yanclaw agents show main                               # 查看详情
yanclaw agents create --id coder --name "编程助手"      # 创建
yanclaw agents create --id coder --name "编程助手" --model claude-sonnet-4-20250514
yanclaw agents delete coder                            # 删除
```

---

## 6. 通道管理

```bash
yanclaw channels list                                  # 列出通道 + 状态
yanclaw channels connect telegram bot_prod             # 连接
yanclaw channels disconnect telegram bot_prod          # 断开
```

---

## 7. 会话管理

```bash
yanclaw sessions list                                  # 列出会话
yanclaw sessions list --agent main --limit 10          # 按 Agent 筛选
yanclaw sessions show <key>                            # 查看消息历史
yanclaw sessions export <key>                          # 导出 JSON
yanclaw sessions export <key> --format md              # 导出 Markdown
yanclaw sessions delete <key>                          # 删除
```

---

## 8. 配置管理

```bash
yanclaw config show                                    # 显示完整配置
yanclaw config get gateway.port                        # 读取字段
yanclaw config set gateway.port 8080                   # 修改字段
yanclaw config edit                                    # 用 $EDITOR 编辑
```

---

## 9. 定时任务

```bash
yanclaw cron list                                      # 列出任务
yanclaw cron run daily-summary                         # 立即执行
```

---

## 10. 记忆

```bash
yanclaw memory search "API 配置"                       # 搜索
yanclaw memory search "部署流程" --agent code           # 指定 Agent
yanclaw memory add "项目使用 Bun 运行时" --tags bun,runtime  # 添加
yanclaw memory delete <id>                             # 删除
yanclaw memory stats                                   # 统计
```

---

## 11. 插件

```bash
yanclaw plugins list                                   # 列出已加载插件
```

---

## 12. 全局选项

### `--json`

所有列表/详情命令支持 `--json` 输出，便于脚本处理：

```bash
yanclaw agents list --json | jq '.[].id'
yanclaw status --json | jq '.uptime'
```

### `--api`

覆盖 API 地址（也可用环境变量 `YANCLAW_API`）：

```bash
yanclaw status --api http://192.168.1.100:18789
YANCLAW_API=http://remote:18789 yanclaw agents list
```

---

## 13. 源码

CLI 实现为单文件，零外部依赖：[packages/server/src/cli.ts](../packages/server/src/cli.ts)
