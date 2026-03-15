# 通道系统

> 消息通道适配器、能力声明、健康监控与 DM 策略。

---

## 1. 架构

```
ChannelManager（管理器）
  │
  ├─→ ChannelRegistry（注册表）
  │     ├─→ TelegramAdapter  (grammY)
  │     ├─→ DiscordAdapter   (discord.js v14)
  │     ├─→ SlackAdapter     (@slack/bolt Socket Mode)
  │     ├─→ FeishuAdapter    (飞书开放平台)
  │     └─→ Plugin Channels  (插件注册)
  │
  ├─→ HealthMonitor（健康监控）
  │     └─→ 指数退避自动重连
  │
  └─→ DM Policy（私聊策略）
        └─→ open / allowlist / pairing
```

### 消息流

```
通道收到消息
  → DM 策略检查
  → 媒体附件提取
  → 路由解析 (resolveRoute)
  → ownerOnly 检查
  → AgentRuntime.run()
  → 响应发回通道（block streaming 可选）
```

---

## 2. 通道能力

每个适配器声明自身支持的能力：

```typescript
interface ChannelCapabilities {
  chatTypes: ("direct" | "group" | "channel" | "thread")[];
  supportsPoll: boolean;
  supportsReaction: boolean;
  supportsMedia: boolean;
  supportsThread: boolean;
  supportsNativeCommands: boolean;
  supportsMarkdown: boolean;
  supportsEdit: boolean;
  blockStreaming: boolean;
  maxTextLength: number;
}
```

| 能力 | Telegram | Discord | Slack | 飞书 | WebChat |
|------|----------|---------|-------|------|---------|
| 聊天类型 | direct, group, channel | direct, group, thread | direct, group, thread | direct, group | direct |
| 媒体 | 是 | 是 | 是 | 是 | 是 |
| 话题/线程 | 是 | 是 | 是 | 否 | 否 |
| 编辑消息 | 是 | 是 | 是 | 否 | 否 |
| Markdown | 是 | 是 | Block Kit | 否 | 是 |
| 单条上限 | 4000 | 2000 | 4000 | 4000 | 无限制 |

---

## 3. 适配器配置

### Telegram

```json5
{
  "type": "telegram",
  "enabled": true,
  "accounts": [{
    "id": "bot_prod",
    "token": "${TELEGRAM_BOT_TOKEN}",
    "dmPolicy": "allowlist",
    "ownerIds": ["user_123"]
  }]
}
```

- SDK: grammY
- 支持私聊、群组、超级群组、频道
- @提及触发（群组中需 @bot）
- 话题/Topics 支持
- 多 Bot 账号

### Discord

```json5
{
  "type": "discord",
  "enabled": true,
  "accounts": [{
    "id": "bot_main",
    "token": "${DISCORD_BOT_TOKEN}",
    "ownerIds": ["discord_user_id"]
  }]
}
```

- SDK: discord.js v14
- DM、服务器频道、线程
- 消息 > 2000 字符自动分片
- 服务器 + 角色绑定路由

### Slack

```json5
{
  "type": "slack",
  "enabled": true,
  "accounts": [{
    "id": "workspace_main",
    "botToken": "${SLACK_BOT_TOKEN}",
    "appToken": "${SLACK_APP_TOKEN}"
  }]
}
```

- SDK: @slack/bolt
- **Socket Mode**（无需公网 URL）
- DM、频道、线程

### 飞书

```json5
{
  "type": "feishu",
  "enabled": true,
  "accounts": [{
    "id": "feishu_main",
    "appId": "${FEISHU_APP_ID}",
    "appSecret": "${FEISHU_APP_SECRET}"
  }]
}
```

---

## 4. Block Streaming

通道可配置 `blockStreaming` 模式：

- **关闭**（默认）：Agent 生成完毕后一次性发送
- **开启**：Agent 流式输出时分块发送，然后编辑合并最终消息

Telegram 和 Discord 支持 `editMessage()` 实现编辑模式。

---

## 5. 健康监控

- 每 30 秒探测连接状态
- 状态：`connected` | `disconnected` | `error` | `connecting`
- 断线自动重连：指数退避（5s → 10s → 30s → 60s → 最大 5min）
- 连续失败 5 次 → 停止重连，标记 error
- WebSocket 推送状态变更到前端

---

## 6. DM 策略

| 策略 | 说明 |
|------|------|
| `open` | 允许任何人私聊 |
| `allowlist` | 仅允许 `ownerIds` 中的用户 |
| `pairing` | 新用户需发送配对码 |

### ownerOnly 工具

- WebChat 前端视为 owner
- 外部通道默认非 owner
- 通过 `ownerIds` 配置覆盖

---

## 7. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/channels/manager.ts` | ChannelManager 主逻辑 |
| `server/src/channels/registry.ts` | 适配器注册表 |
| `server/src/channels/types.ts` | 类型定义 |
| `server/src/channels/dm-policy.ts` | DM 策略实现 |
| `server/src/channels/telegram.ts` | Telegram 适配器 |
| `server/src/channels/discord.ts` | Discord 适配器 |
| `server/src/channels/slack.ts` | Slack 适配器 |
| `server/src/channels/feishu.ts` | 飞书适配器 |
