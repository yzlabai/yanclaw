# 定时任务与心跳

> Cron 表达式调度、间隔/单次定时、Agent 心跳。

---

## 1. 定时任务

### 任务定义

```json5
{
  "cron": {
    "tasks": [
      {
        "id": "daily-summary",
        "agent": "main",
        "schedule": "0 9 * * *",
        "prompt": "总结昨天的工作进展",
        "deliveryTargets": [
          { "channel": "telegram", "peer": "user_123" },
          { "channel": "webchat" }
        ],
        "enabled": true
      }
    ]
  }
}
```

### 调度模式

| 模式 | 格式 | 示例 |
|------|------|------|
| Cron 表达式 | `"0 9 * * *"` | 每天 9:00 |
| 间隔 | `{ "every": { "value": 30, "unit": "minutes" } }` | 每 30 分钟 |
| 单次定时 | `{ "at": "2025-03-15T09:00:00Z" }` | 一次性 |

### 执行流程

```
到达触发时间
  → CronService 调用 AgentRuntime.run()
  → 收集 Agent 回复
  → 发送到 deliveryTargets（通道 + 前端）
  → 记录执行日志（last_run_at, last_result）
  → 计算下次执行时间
```

### 管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/cron` | 列出所有任务 |
| POST | `/api/cron` | 创建任务 |
| PATCH | `/api/cron/:id` | 更新任务 |
| DELETE | `/api/cron/:id` | 删除任务 |
| POST | `/api/cron/:id/run` | 立即执行一次 |

配置热重载时自动刷新任务调度。

---

## 2. Agent 心跳

心跳定时器定期触发 Agent 执行，适用于巡检、状态汇报等场景。

### 配置

```json5
{
  "agents": [{
    "id": "monitor",
    "heartbeat": {
      "interval": "5m",
      "prompt": "检查系统状态，如有异常请报告",
      "activeHours": { "start": 9, "end": 22 },
      "suppressIfNoOp": true,
      "target": "last"
    }
  }]
}
```

| 字段 | 说明 |
|------|------|
| `interval` | 心跳间隔（如 `"5m"`、`"1h"`） |
| `prompt` | 心跳触发时发送的提示词 |
| `activeHours` | 仅在指定时段内触发 |
| `suppressIfNoOp` | Agent 无输出时不发送 |
| `target` | `none`（不发送）/ `last`（最近活跃通道）/ 指定通道 |

### 活动追踪

`HeartbeatRunner` 记录每个 Agent 的最近活动通道，心跳回复自动发送到该通道。

---

## 3. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/cron/service.ts` | CronService 调度器 |
| `server/src/cron/heartbeat.ts` | HeartbeatRunner |
| `server/src/routes/cron.ts` | Cron API |
