# 微信小程序接入 YanClaw 需求分析

## 背景

通过微信小程序与本地电脑上运行的 YanClaw 对话。微信小程序无法直连局域网，需要公网 Relay 中继。

**前提条件：** 已有云服务器 + ICP 备案域名。

## 架构分层

小程序接入本质上是一个 **Channel**，但和 Telegram/Discord 等不同：那些平台自己提供公网入口（Bot API / Gateway），YanClaw 直连即可；而小程序无法直连 localhost，需要一层通用 Relay 解决网络可达性。

因此拆为两层：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Channel 层（消息语义）                                              │
│  WeChatMiniAdapter implements ChannelAdapter                        │
│  · 将 openId 映射为 Peer                                            │
│  · 适配小程序特有的消息格式（图片/语音/小程序卡片）                      │
│  · 遵循 DM Policy / ownerOnly / routing 等现有机制                   │
├─────────────────────────────────────────────────────────────────────┤
│  Relay 层（传输通道）                                                │
│  RelayClient ←wss→ Relay Server ←wss→ 小程序                        │
│  · 纯管道，透传 JSON-RPC 消息                                        │
│  · 设备注册、配对、心跳、重连                                         │
│  · 未来其他不能直连的客户端也可复用（如自建 App、Web 外网访问）          │
└─────────────────────────────────────────────────────────────────────┘
```

数据流：

```
微信小程序 →wss→ Relay Server ←wss← RelayClient → WeChatMiniAdapter → ChannelManager → Agent Runtime
                                                                                          ↓
微信小程序 ←wss← Relay Server →wss→ RelayClient ← WeChatMiniAdapter ← ChannelManager ← 流式响应
```

### 与现有 Channel 的对齐

| 维度 | Telegram | WebChat | 微信小程序 |
|------|----------|---------|-----------|
| 传输 | grammY polling → Telegram API | 直连 WebSocket | Relay 透传 WebSocket |
| Adapter | TelegramAdapter | 内嵌在 ws.ts | WeChatMiniAdapter（新增） |
| Peer 映射 | chatId | 匿名/ticket | openId |
| DM Policy | ✅ | 跳过（本地信任） | ✅ |
| ownerOnly | ✅ | 全部放行 | ✅（配对用户 = owner） |
| 流式 | 分块编辑消息 | 直推 delta | Relay 透传 delta |
| 注册方式 | `channelRegistry.register()` | 无（内置路由） | `channelRegistry.register()` |

---

## Relay Server（云服务器部署）

极简 WebSocket 路由器，**不存储任何对话内容**：

**职责：**
- 接受 YanClaw 实例注册（设备 ID + 密钥）
- 接受小程序用户连接（设备 ID + 配对码/token）
- 双向透传 JSON-RPC 消息
- 心跳保活 + 断线检测
- 限流 + 并发控制

**不做：** 不存储消息、不解析内容、不运行推理

**技术选型：** Bun + Hono（与 YanClaw 技术栈一致，共享类型定义）

### 数据模型

```typescript
// 设备注册表（内存/Redis）
interface Device {
  deviceId: string;        // 随机生成，持久化在 YanClaw 本地
  deviceSecret: string;    // 注册时协商
  pairingCode?: string;    // 6 位配对码，5 分钟有效
  pairingExpiry?: number;
  boundUsers: string[];    // 已绑定的小程序 openId 列表
  ws?: WebSocket;          // 当前 YanClaw 连接
}

// 小程序用户连接
interface MiniClient {
  openId: string;
  deviceId: string;        // 绑定的设备
  token: string;           // 配对成功后颁发
  ws?: WebSocket;          // 当前小程序连接
}
```

### 核心路由

```typescript
// YanClaw 实例连接
wss://relay.example.com/device
  → 认证: { deviceId, deviceSecret }
  → 上行: 接收小程序消息转发
  → 下行: AI 响应转发给小程序

// 小程序连接
wss://relay.example.com/client
  → 认证: { deviceId, token } 或首次 { deviceId, pairingCode }
  → 上行: 用户消息 → 转发给对应 YanClaw
  → 下行: AI 响应流式推送

// 配对码管理（YanClaw 调用）
POST /api/pairing/create  → { deviceId, deviceSecret } → { code: "482910" }
POST /api/pairing/verify  → { code, openId } → { token }
```

### 消息转发逻辑

```
小程序发消息 → Relay 查 deviceId → 找到 YanClaw 的 ws → 原样转发
YanClaw 响应 → Relay 查 openId → 找到小程序的 ws → 原样转发
```

Relay 只看消息头的路由字段（deviceId / openId），消息体（对话内容）透传不解析。

---

## YanClaw 端改动

### 1. Relay Client（传输层）

新增 `packages/server/src/relay/client.ts`：

```typescript
class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private deviceId: string;       // 持久化到 dataDir/relay.json
  private deviceSecret: string;

  constructor(private config: RelayConfig, private ctx: GatewayContext) {}

  async connect(): Promise<void> {
    // 1. 连接 Relay Server
    // 2. 发送设备认证
    // 3. 监听消息 → emit('message', { openId, data })
    // 4. 心跳保活（30s interval）
    // 5. 断线自动重连（指数退避，复用 HealthMonitor 逻辑）
  }

  // 发送消息给指定小程序用户
  async send(openId: string, data: unknown): Promise<void> {
    // 通过 Relay 转发
  }

  async requestPairingCode(): Promise<string> { ... }
  disconnect(): void { ... }
}
```

### 2. WeChatMiniAdapter（Channel 层）

新增 `packages/server/src/channels/wechat-mini.ts`：

```typescript
class WeChatMiniAdapter implements ChannelAdapter {
  readonly id: string;
  readonly type = "wechat_mini";
  readonly capabilities: ChannelCapabilities = {
    chatTypes: ["direct"],
    supportsMedia: true,
    supportsThread: false,
    supportsMarkdown: true,
    supportsEdit: false,
    supportsReaction: false,
    blockStreaming: false,
    maxTextLength: 4096,
  };

  constructor(
    private accountConfig: ChannelAccountConfig,
    private relayClient: RelayClient,   // 注入 Relay 连接
  ) {}

  async connect(): Promise<void> {
    // 监听 relayClient 的 'message' 事件
    // 将 openId 映射为 Peer { kind: "direct", id: openId }
    // 转换为 InboundMessage → 触发 onMessage handler
  }

  async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
    // 将 OutboundMessage 序列化为 JSON-RPC event
    // 通过 relayClient.send(peer.id, event) 发出
  }

  onMessage(handler: InboundHandler): Unsubscribe { ... }
  async disconnect(): Promise<void> { ... }
}

// 自注册
channelRegistry.register({
  type: "wechat_mini",
  capabilities: CHANNEL_DOCK.wechat_mini,
  requiredFields: [],  // 无需 token，靠 Relay 配对
  create: (account, ctx) => {
    const relayClient = ctx.relayClient;  // 从 GatewayContext 获取
    if (!relayClient) return null;
    return new WeChatMiniAdapter(account, relayClient);
  },
});
```

### 3. 现有文件改动

| 文件 | 改动 |
|------|------|
| `channels/dock.ts` | 新增 `wechat_mini` capabilities 条目 |
| `config/schema.ts` | 新增 `relay` 配置段（url, enabled, autoConnect） |
| `gateway.ts` | 启动时初始化 RelayClient，注入 GatewayContext；`import "./channels/wechat-mini"` |
| `routes/relay.ts`（新增） | 暴露配对码生成 / 状态查询 API 给前端 |
| `web/src/pages/Settings.tsx` | Relay 开关 + 配对码展示 + 二维码 |

---

## 配对流程

```
1. 用户在 YanClaw 设置页点"启用小程序访问"
2. YanClaw 连接 Relay，请求 6 位配对码（有效期 5 分钟）
3. YanClaw 前端显示配对码 + 二维码
4. 用户在小程序输入配对码（或扫码）
5. Relay 验证 → 绑定 openId 与 deviceId → 返回 token
6. 后续小程序用 token 自动连接，无需重复配对
7. 配对用户自动成为 ownerIds（拥有全部工具权限）
```

---

## 微信小程序端

**技术栈：** Taro（React 语法，与 YanClaw 前端一致）

### 页面结构

| 页面 | 功能 |
|------|------|
| 配对页 | 输入配对码绑定 YanClaw 实例 |
| 对话页 | 流式对话、Markdown 渲染、工具调用展示 |
| 会话列表 | 历史会话 |
| 设置页 | 连接状态、解绑 |

### WebSocket 通信

复用 YanClaw 现有 JSON-RPC 协议：

```javascript
const ws = wx.connectSocket({ url: 'wss://relay.example.com/client' });

// 认证
ws.send(JSON.stringify({
  jsonrpc: '2.0', method: 'auth',
  params: { deviceId: 'xxx', token: 'yyy' }, id: 0
}));

// 发送消息
ws.send(JSON.stringify({
  jsonrpc: '2.0', method: 'chat.send',
  params: { text: '你好', sessionId: 'sess_1' }, id: 1
}));

// 接收流式响应
ws.onMessage(msg => {
  const data = JSON.parse(msg.data);
  switch (data.method) {
    case 'chat.delta':     // 流式文本片段
    case 'chat.thinking':  // 思考过程
    case 'chat.tool_call': // 工具调用
    case 'chat.done':      // 完成
  }
});
```

### 小程序特有适配

| 问题 | 方案 |
|------|------|
| Markdown 渲染 | towxml 或 mp-html 组件 |
| 代码高亮 | prism.js 轻量版（小程序包大小限制 2MB） |
| 长文本 | 分段渲染 + 虚拟滚动 |
| 离线/断线 | 本地缓存最近对话，重连后同步 |
| 图片发送 | `wx.chooseMedia()` → 上传到 Relay 临时存储 → 转发 YanClaw |
| 语音输入 | `wx.getRecorderManager()` → Whisper 转文字 → 发送 |

---

## 安全设计

| 层面 | 措施 |
|------|------|
| 传输 | 全链路 TLS（wss://） |
| 认证 | 配对码（一次性）+ 设备密钥 + openId + token 四要素 |
| 隐私 | Relay 透传不存储，消息体可选 AES-256-GCM 端到端加密 |
| 防滥用 | 每设备 60 msg/min、单设备最多绑定 5 个小程序用户 |
| 令牌管理 | token 30 天有效，支持 YanClaw 端主动吊销 |

---

## 配置示例

```json5
// config.json5
{
  relay: {
    enabled: true,
    url: "wss://relay.example.com",
    autoConnect: true,
  },
  channels: [
    {
      type: "wechat_mini",
      enabled: true,
      accounts: [
        {
          id: "mini_default",
          dmPolicy: "open",       // 配对即信任
          ownerIds: [],            // 配对时自动填充
        }
      ]
    }
  ]
}
```

---

## 分阶段实施

### Phase 1：最小可用

- [ ] Relay Server：WebSocket 路由 + 设备注册 + 配对验证
- [ ] RelayClient：自动外连 + 心跳重连 + 消息收发
- [ ] WeChatMiniAdapter：实现 ChannelAdapter，注册到 channelRegistry
- [ ] dock.ts 新增 wechat_mini capabilities
- [ ] YanClaw 设置页：Relay 开关 + 配对码显示
- [ ] 小程序：配对页 + 单会话纯文本对话

**交付物：** 手机上能和本地 YanClaw 文字对话

### Phase 2：体验完善

- [ ] 小程序：Markdown 渲染（代码块、列表、表格）
- [ ] 小程序：多会话管理 + 会话列表
- [ ] 小程序：工具调用展示 + 审批
- [ ] 连接状态指示 + 断线重连
- [ ] Relay 监控 + 告警

### Phase 3：多媒体与增强

- [ ] 图片/文件收发
- [ ] 语音消息（录音 → 转文字）
- [ ] 端到端加密
- [ ] 多设备绑定管理
- [ ] Relay 复用：支持其他自建客户端通过同一 Relay 接入
