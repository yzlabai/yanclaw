# 消息路由

> 绑定匹配优先级、DM 会话隔离、跨平台身份关联。

---

## 1. 路由绑定

路由引擎根据消息来源（通道、账号、用户、群组、服务器、角色）匹配到目标 Agent 和会话。

### 优先级

从高到低，分值越高越精确：

| 分值 | 匹配类型 | 说明 | 示例 |
|------|----------|------|------|
| 8 | channel + account + peer | 精确用户 | 用户 Alice → code-agent |
| 7 | channel + account + guild + roles | Discord 服务器 + 角色 | admin 角色 → admin-agent |
| 6 | channel + account + guild | Discord 服务器 | 服务器 XYZ → game-agent |
| 5 | channel + account + group | 群组 | 群组 ABC → team-agent |
| 4 | channel + account | Bot 账号 | bot_prod → main |
| 3 | channel + peer | 通道用户 | telegram:alice → work-agent |
| 2 | channel | 通道类型 | telegram → main |
| 1 | default | 全局默认 | — → main |

### 配置示例

```json5
{
  "routing": {
    "default": "main",
    "bindings": [
      // 精确用户
      { "channel": "telegram", "peer": "user_123", "agent": "work-agent" },
      // Discord 服务器 + 角色
      { "guild": "guild_456", "roles": ["admin"], "agent": "admin-agent" },
      // Slack Workspace
      { "team": "T123ABC", "agent": "work-agent" },
      // 通道默认
      { "channel": "slack", "agent": "main" }
    ]
  }
}
```

### 路由调试

`GET /api/routing/debug` 返回每条绑定的匹配分值和最终结果，用于排查路由问题。

---

## 2. DM 会话隔离

`dmScope` 控制私聊消息的会话键生成方式：

| 模式 | 会话键格式 | 说明 |
|------|-----------|------|
| `main` | `agent:{agentId}:main` | 所有 DM 共享一个会话 |
| `per-peer` | `agent:{agentId}:{peerId}` | 每用户独立会话（默认） |
| `per-channel-peer` | `agent:{agentId}:{channel}:{peerId}` | 每通道 + 用户独立 |
| `per-account-peer` | `agent:{agentId}:{accountId}:{peerId}` | 每 Bot + 用户独立 |

**群组会话键**：`agent:{agentId}:{channel}:group:{groupId}`

**话题追加**：`{baseKey}:thread:{threadId}`（Discord 线程自动绑定）

---

## 3. 身份关联

将不同平台的账号映射为同一身份，共享会话历史：

```json5
{
  "routing": {
    "identityLinks": {
      "jane": ["telegram:user_111", "slack:U222", "discord:333"],
      "bob": ["telegram:user_444", "discord:555"]
    }
  }
}
```

Jane 在 Telegram、Slack、Discord 上与同一 Agent 对话时，共享同一会话。

---

## 4. 路由 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/routing` | 列出所有绑定 |
| POST | `/api/routing` | 创建绑定 |
| DELETE | `/api/routing/:id` | 删除绑定 |
| GET | `/api/routing/debug` | 路由调试（分值详情） |

---

## 5. 源码位置

| 文件 | 说明 |
|------|------|
| `server/src/routing/resolve.ts` | 路由解析 + 调试 |
| `server/src/routes/routing.ts` | 路由 API 端点 |
