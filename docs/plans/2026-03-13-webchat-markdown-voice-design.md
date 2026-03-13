# WebChat 增强：Markdown 渲染 + 语音输入

## 概述

增强 WebChat 的消息渲染能力（数学公式、代码高亮、Mermaid 图表）和输入方式（语音转文字）。

## 1. Markdown 渲染增强

### 新增依赖

| 包 | 用途 |
|---|---|
| `remark-math` | 解析 `$...$` 和 `$$...$$` 数学语法 |
| `rehype-katex` | 将数学 AST 渲染为 KaTeX HTML |
| `katex` | KaTeX CSS 样式 |
| `rehype-highlight` | 代码块语法高亮 (highlight.js) |
| `highlight.js` | highlight.js 主题 CSS |
| `mermaid` | Mermaid 图表渲染 |

### 改动文件

**`packages/web/src/components/prompt-kit/markdown.tsx`**

- 添加 `remarkMath` + `rehypeKatex` + `rehypeHighlight` 插件到 `ReactMarkdown`
- 自定义 `code` 组件：检测 `language-mermaid` → 渲染 `<MermaidBlock>`，其余走 `rehype-highlight` 默认高亮

**新建 `packages/web/src/components/prompt-kit/mermaid-block.tsx`**

- 接收原始 mermaid 源码
- `useEffect` 内调用 `mermaid.render()` 生成 SVG
- 提供 toggle 按钮切换「图表 ↔ 源码」视图
- `mermaid.initialize()` 单例初始化，跟随当前主题（dark/light）
- 渲染中显示 loading 占位

**`packages/web/src/index.css`（或组件级导入）**

- 导入 KaTeX CSS：`katex/dist/katex.min.css`
- 导入 highlight.js 主题：选一个适配 dark/light 的主题

### 渲染流程

```
用户消息 (markdown string)
  → react-markdown
    → remark-gfm (表格、删除线等)
    → remark-math (解析 $...$ / $$...$$)
    → rehype-katex (数学→HTML)
    → rehype-highlight (代码高亮)
    → 自定义 code 组件
      → language-mermaid? → <MermaidBlock>
      → 其他 → 默认高亮代码块
```

## 2. 语音输入

### 前提

服务端已有 `SttService`（`packages/server/src/media/stt.ts`），支持 OpenAI 兼容的 STT API。当前仅在 channel adapter（Telegram 等）中使用，需要暴露给 webchat。

### 新增 API

**`POST /api/stt/transcribe`**（新路由文件 `packages/server/src/routes/stt.ts`）

- 请求：`{ mediaId: string }`
- 逻辑：从 MediaStore 获取文件 URL → 调用 `SttService.transcribe()` → 返回 `{ text: string }`
- 错误：STT 未配置返回 400

**扩展 `GET /api/system/status`**

- 响应中增加 `stt: { available: boolean }`，前端据此决定是否显示麦克风按钮

### 前端改动

**新建 `packages/web/src/hooks/use-voice-input.ts`**

- 管理 `MediaRecorder` 生命周期
- 暴露：`{ isRecording, isTranscribing, startRecording, stopRecording, cancelRecording }`
- 流程：开始录音 → 停止 → upload blob via `uploadMedia()` → 调用 `/api/stt/transcribe` → 返回文字

**`packages/web/src/pages/Chat.tsx`**

- 启动时请求 `/api/system/status` 获取 `stt.available`
- `sttAvailable` 为 true 时，在 `PromptInputActions` 中显示麦克风按钮（send 按钮左侧）
- 录音中：按钮变为红色脉冲动画 + 停止图标
- 转写中：按钮显示 loading 状态
- 转写完成：文字插入输入框

### 录音流程

```
用户点击麦克风 → MediaRecorder.start()
  → 用户点击停止 → MediaRecorder.stop()
    → 获得 audio Blob
    → uploadMedia(blob) → mediaId
    → POST /api/stt/transcribe { mediaId }
    → 返回 { text }
    → 插入到 PromptInput 输入框
```

## 不做的事

- 不做实时语音流式转写（过于复杂，当前场景不需要）
- 不做 TTS（文字转语音播放），后续独立需求
- 不改动现有 channel adapter 的 STT 逻辑
