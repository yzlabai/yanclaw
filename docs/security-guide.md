# YanClaw 安全配置指南

本文档介绍 YanClaw 安全模块的配置和使用方法。

---

## 目录

1. [认证与令牌](#1-认证与令牌)
2. [凭证加密存储（Vault）](#2-凭证加密存储vault)
3. [速率限制](#3-速率限制)
4. [能力模型（Capabilities）](#4-能力模型capabilities)
5. [网络白名单（SSRF 防护）](#5-网络白名单ssrf-防护)
6. [提示注入防御](#6-提示注入防御)
7. [数据流启发式检测](#7-数据流启发式检测)
8. [审计日志](#8-审计日志)
9. [异常频率检测](#9-异常频率检测)
10. [Token 自动轮转](#10-token-自动轮转)
11. [凭证泄漏检测](#11-凭证泄漏检测)
12. [文件安全（Symlink 防护）](#12-文件安全symlink-防护)
13. [WebSocket 票据认证](#13-websocket-票据认证)
14. [配置示例](#14-完整配置示例)

---

## 1. 认证与令牌

Gateway 启动时自动生成 Bearer Token（32 字节随机 hex），保存在 `~/.yanclaw/auth.token`。

### 使用方式

所有 API 请求需携带：

```
Authorization: Bearer <token>
```

### 免认证端点

- `GET /api/system/health` — 健康检查

### Tauri 桌面端

前端通过 IPC 自动获取 token，无需手动配置：

```typescript
const token = await invoke("get_auth_token");
```

---

## 2. 凭证加密存储（Vault）

使用 AES-256-GCM 加密 API Key，密钥从本机 machine-id 派生。

### 配置

```json5
{
  security: {
    vault: { enabled: true }  // 默认开启
  }
}
```

### 使用 Vault 引用

在配置文件中使用 `$vault:` 前缀引用加密凭证：

```json5
{
  models: {
    anthropic: {
      profiles: [
        { id: "main", apiKey: "$vault:anthropic_key" }
      ]
    }
  }
}
```

### 迁移现有明文密钥

运行迁移脚本，自动将配置中的明文 API Key 加密存入 Vault：

```bash
bun run packages/server/src/security/vault-migrate.ts
```

迁移后配置文件中的 `apiKey` 字段自动替换为 `$vault:provider_id` 格式。

### 密钥来源

| 平台 | 来源 |
|------|------|
| Windows | 注册表 `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid` |
| macOS | `IOPlatformUUID` |
| Linux | `/var/lib/dbus/machine-id` 或 `/etc/machine-id` |
| 回退 | `~/.yanclaw/.machine-id`（首次生成随机值并持久化） |

---

## 3. 速率限制

滑动窗口算法，分三个级别独立限流。

### 配置

```json5
{
  security: {
    rateLimit: {
      api: { windowMs: 60000, max: 60 },        // 全局 API：60 次/分
      chat: { windowMs: 60000, max: 10 },        // Chat 消息：10 次/分
      approval: { windowMs: 60000, max: 30 },    // 审批操作：30 次/分
    }
  }
}
```

### 行为

- 超限返回 HTTP 429 + `Retry-After` header
- 优先使用 auth token 后缀做限流 key（比 IP 更可靠）
- 后台每 60 秒自动清理过期条目

---

## 4. 能力模型（Capabilities）

控制每个 Agent 可使用的工具类别。与工具策略（allow/deny）和 ownerOnly 三层叠加过滤。

### 预设

| 预设名 | 能力 | 适用场景 |
|--------|------|----------|
| `safe-reader` | `fs:read`, `memory:read` | 只读助手，不能执行命令或写文件 |
| `researcher` | `fs:read`, `net:http`, `memory:read/write` | 信息检索，可上网但不能改文件 |
| `developer` | `fs:read/write`, `exec:shell`, `net:http`, `memory:read/write` | 开发辅助，有完整读写和执行权限 |
| `full-access` | `*` | 所有工具（等同不配置） |

### 使用预设

```json5
{
  agents: [
    {
      id: "reader",
      name: "只读助手",
      model: "claude-sonnet-4-20250514",
      capabilities: "safe-reader"  // 字符串 = 预设名
    }
  ]
}
```

### 自定义能力

```json5
{
  agents: [
    {
      id: "custom",
      name: "自定义助手",
      capabilities: ["fs:read", "net:http"]  // 数组 = 自定义能力
    }
  ]
}
```

### 能力列表

| 能力 | 对应工具 |
|------|----------|
| `exec:shell` | shell |
| `fs:read` | file_read |
| `fs:write` | file_write, file_edit |
| `net:http` | web_fetch, web_search |
| `browser:control` | browser_navigate, browser_screenshot, browser_action |
| `memory:read` | memory_search |
| `memory:write` | memory_store, memory_delete |

不配置 `capabilities` 则不限制（等同 `full-access`）。

---

## 5. 网络白名单（SSRF 防护）

控制 `web_fetch` 工具的出站网络访问。

### 配置

```json5
{
  security: {
    network: {
      blockPrivate: true,          // 阻断私有地址（默认 true）
      exemptPorts: [11434, 18789], // 豁免端口（如 Ollama、Gateway 自身）
      allowedHosts: [              // Host 白名单（空 = 不限制）
        "*.openai.com",
        "*.anthropic.com",
        "api.github.com"
      ]
    }
  }
}
```

### 阻断规则

- 默认阻断：`127.x`、`10.x`、`172.16-31.x`、`192.168.x`、`localhost`、`::1`
- 豁免端口内的私有地址可以通过
- `allowedHosts` 非空时仅允许白名单中的域名
- 支持通配符：`*.example.com` 匹配 `api.example.com`

---

## 6. 提示注入防御

防止 LLM 被工具返回内容中的恶意指令劫持。

### 配置

```json5
{
  security: {
    promptInjection: {
      wrapToolResults: true,      // 用 <tool_result> 包裹工具输出（默认 true）
      detectPatterns: true,       // 检测注入模式（默认 true）
      blockOnDetection: false,    // 检测到时是否阻断（默认仅告警）
    }
  }
}
```

### 工作原理

1. **边界标记**：所有工具返回内容用 `<tool_result source="tool_name">...</tool_result>` 包裹
2. **模式检测**：扫描 8 种常见注入模式（如 "ignore previous instructions"、"you are now a..."）
3. **安全后缀**：系统提示末尾自动追加安全警告，提醒 LLM 不要执行工具结果中的指令

---

## 7. 数据流启发式检测

在工具执行前检查参数，识别潜在危险操作。

### 配置

```json5
{
  security: {
    dataFlow: {
      enabled: true,    // 启用检测（默认 true）
      block: false,     // 检测到时是否阻断（默认仅告警）
    }
  }
}
```

### 检测规则

| 规则 | 工具 | 检测内容 | 严重级别 |
|------|------|----------|----------|
| shell-contains-url | shell | 命令中包含 URL | warning |
| shell-exfiltration | shell | curl/wget POST、nc/scp/ssh 等外泄命令 | critical |
| file-write-suspicious-path | file_write | 写入 .bashrc/.ssh/crontab 等 | critical |
| file-read-sensitive-path | file_read | 读取 .ssh/.env/passwd/.aws/.kube 等 | warning |

---

## 8. 审计日志

记录所有安全相关事件到 SQLite。

### 配置

```json5
{
  security: {
    audit: {
      enabled: true,          // 启用审计（默认 true）
      retentionDays: 90,      // 保留天数（默认 90）
    }
  }
}
```

### 查询 API

```
GET /api/audit?action=tool_call&actor=agent:main&after=2026-03-01&limit=50&offset=0
```

参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `action` | 按动作类型筛选 | 全部 |
| `actor` | 按执行者筛选 | 全部 |
| `after` | 起始时间（ISO 8601） | 无 |
| `before` | 结束时间（ISO 8601） | 无 |
| `limit` | 每页条数（1-1000） | 50 |
| `offset` | 偏移量 | 0 |

返回：

```json
{
  "logs": [
    {
      "id": 1,
      "timestamp": "2026-03-10T12:00:00.000Z",
      "actor": "agent:main",
      "action": "tool_call",
      "resource": "shell",
      "detail": "{\"command\":\"ls\"}",
      "sessionKey": "webchat:main",
      "result": "success"
    }
  ],
  "total": 42
}
```

---

## 9. 异常频率检测

监控工具调用频率，发现异常行为自动响应。

### 配置

```json5
{
  security: {
    anomaly: {
      enabled: true,
      thresholds: {
        "shell": { warn: 10, critical: 20 },       // shell 每分钟 >10 告警，>20 严重
        "file_write": { warn: 30, critical: 50 },   // file_write 每分钟 >30 告警
        "*": { warn: 80, critical: 100 },            // 其他工具默认阈值
      },
      action: "pause",  // "log" | "pause" | "abort"
    }
  }
}
```

### 动作说明

| 动作 | 行为 |
|------|------|
| `log` | 仅记录日志 |
| `pause` | 暂停执行并通知用户审批 |
| `abort` | 直接中断当前 Agent 循环 |

---

## 10. Token 自动轮转

定期更换 auth token，降低令牌泄漏风险。

### 配置

```json5
{
  security: {
    tokenRotation: {
      intervalHours: 24,          // 轮转间隔（小时），0 = 不轮转（默认）
      gracePeriodMinutes: 5,      // 过渡期（分钟），新旧 token 同时有效
    }
  }
}
```

### 工作流程

1. 到达轮转时间 → 生成新 token
2. 写入 `~/.yanclaw/auth.token`（写入失败则不轮转）
3. Grace period 内旧 token 继续有效
4. Grace period 结束后旧 token 失效
5. Tauri 桌面端通过 IPC 自动获取最新 token，无感切换

---

## 11. 凭证泄漏检测

扫描 LLM 输出，防止 API Key 意外泄漏。

### 工作原理

- Gateway 启动时自动从配置注册所有已知 API Key 的前缀（前 16 字符）
- 短于 8 字符的凭证不注册（避免误报）
- 每次 LLM 输出流式片段时实时扫描
- 命中则阻断该条响应并记录日志

无需额外配置，与 Vault 配合自动工作。

---

## 12. 文件安全（Symlink 防护）

file_read / file_write / file_edit 工具内置路径安全检查。

### 防护机制

1. **路径解析**：`resolve()` 确保路径不越界 workspace
2. **Symlink 检查**：`realpath()` 跟随符号链接后再次验证真实路径仍在 workspace 内
3. **新文件处理**：目标文件不存在时（write 场景），回退到预解析检查

### 示例

```
workspace: /home/user/project
请求路径: ../../../etc/passwd       → 拒绝（路径解析越界）
请求路径: data/link → /etc/passwd   → 拒绝（symlink 逃逸）
请求路径: src/main.ts               → 允许
```

无需额外配置，始终生效。

---

## 13. WebSocket 票据认证

解决浏览器 WebSocket API 无法携带 HTTP header 的问题。

### 流程

1. 客户端先用 Bearer Token 调用 `POST /api/ws/ticket`
2. 获取一次性票据（30 秒有效）
3. 用票据连接 WebSocket：`ws://host:port/api/ws?ticket=<ticket>`
4. 票据使用后立即销毁，不可重用

### 前端示例

```typescript
// 1. 获取票据
const res = await fetch("/api/ws/ticket", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}` },
});
const { ticket } = await res.json();

// 2. 连接 WebSocket
const ws = new WebSocket(`ws://localhost:18789/api/ws?ticket=${ticket}`);
```

---

## 14. 完整配置示例

以下是一个启用所有安全功能的配置片段：

```json5
{
  security: {
    // 凭证加密
    vault: { enabled: true },

    // 速率限制
    rateLimit: {
      api: { windowMs: 60000, max: 60 },
      chat: { windowMs: 60000, max: 10 },
      approval: { windowMs: 60000, max: 30 },
    },

    // Token 轮转（每 24 小时）
    tokenRotation: {
      intervalHours: 24,
      gracePeriodMinutes: 5,
    },

    // 审计日志
    audit: {
      enabled: true,
      retentionDays: 90,
    },

    // 异常检测
    anomaly: {
      enabled: true,
      thresholds: {
        "shell": { warn: 10, critical: 20 },
        "file_write": { warn: 30, critical: 50 },
        "*": { warn: 80, critical: 100 },
      },
      action: "pause",
    },

    // 提示注入防御
    promptInjection: {
      wrapToolResults: true,
      detectPatterns: true,
      blockOnDetection: false,
    },

    // 网络白名单
    network: {
      blockPrivate: true,
      exemptPorts: [11434],
      allowedHosts: [],  // 空 = 不限制外部域名
    },

    // 数据流检测
    dataFlow: {
      enabled: true,
      block: false,  // 生产环境建议设为 true
    },
  },

  agents: [
    {
      id: "reader",
      name: "只读助手",
      model: "claude-sonnet-4-20250514",
      capabilities: "safe-reader",  // 仅允许读文件和查记忆
    },
    {
      id: "dev",
      name: "开发助手",
      model: "claude-sonnet-4-20250514",
      capabilities: "developer",    // 读写文件 + shell + 网络 + 记忆
    },
  ],
}
```

### 安全最佳实践

1. **启用 Vault**：运行 `vault-migrate.ts` 加密现有 API Key
2. **按需分配能力**：给每个 Agent 最小必要权限（`safe-reader` > `researcher` > `developer`）
3. **启用审计**：保留日志用于问题追溯
4. **生产环境**：`dataFlow.block: true` + `promptInjection.blockOnDetection: true`
5. **Token 轮转**：`intervalHours: 24`，定期更换令牌
6. **网络限制**：配置 `allowedHosts` 白名单，仅允许必要的外部服务
7. **异常检测**：`action: "pause"`，异常时暂停等待人工确认
