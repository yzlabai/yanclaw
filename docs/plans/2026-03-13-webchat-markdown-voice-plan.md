# WebChat Markdown & Voice Input Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance webchat with rich markdown rendering (math, code highlighting, mermaid diagrams) and browser-based voice input with STT transcription.

**Architecture:** Two independent feature tracks. Track 1 enhances the existing `markdown.tsx` component with remark/rehype plugins and a new MermaidBlock component. Track 2 adds a server-side STT transcribe endpoint, extends system status with STT availability, and adds a `useVoiceInput` hook + mic button to the chat UI.

**Tech Stack:** remark-math, rehype-katex, rehype-highlight, mermaid, MediaRecorder API, existing SttService

---

## Chunk 1: Markdown Rendering Enhancement

### Task 1: Install markdown dependencies

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install remark-math, rehype-katex, katex, rehype-highlight, highlight.js**

```bash
cd packages/web && bun add remark-math rehype-katex katex rehype-highlight highlight.js
```

- [ ] **Step 2: Install mermaid**

```bash
cd packages/web && bun add mermaid
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json bun.lockb
git commit -m "chore: add markdown rendering dependencies (katex, highlight.js, mermaid)"
```

---

### Task 2: Add KaTeX and highlight.js CSS imports

**Files:**
- Modify: `packages/web/src/index.css:1-2`

- [ ] **Step 1: Add CSS imports at top of index.css**

Add these two imports at the very top of `packages/web/src/index.css`, before the `@import "tailwindcss"` line:

```css
@import "katex/dist/katex.min.css";
@import "highlight.js/styles/github-dark.min.css";
```

Note: `github-dark` theme works well with the dark-first UI. The light theme variant will still look acceptable.

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: Build succeeds, CSS includes katex and highlight.js styles

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/index.css
git commit -m "style: import KaTeX and highlight.js CSS"
```

---

### Task 3: Enhance markdown.tsx with math and syntax highlighting

**Files:**
- Modify: `packages/web/src/components/prompt-kit/markdown.tsx`

- [ ] **Step 1: Add plugin imports**

Add at the top of `markdown.tsx`:

```typescript
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
```

- [ ] **Step 2: Update MemoizedMarkdownBlock to use plugins**

Change the `ReactMarkdown` in `MemoizedMarkdownBlock` to:

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[rehypeKatex, rehypeHighlight]}
  components={components}
>
  {content}
</ReactMarkdown>
```

- [ ] **Step 3: Fix the block splitting to preserve math and code blocks**

The current `children.split(/\n\n+/)` breaks multi-line math blocks (`$$...$$`) and fenced code blocks. Replace the `blocks` useMemo in `MarkdownComponent` with a smarter splitter that keeps fenced blocks (` ``` `) and display math (`$$`) intact:

```typescript
const blocks = useMemo(() => {
  const result: string[] = [];
  let current = "";
  let inFence = false;
  let inMath = false;

  for (const line of children.split("\n")) {
    if (!inFence && !inMath && line.startsWith("```")) {
      if (current.trim()) result.push(current);
      current = line + "\n";
      inFence = true;
    } else if (inFence) {
      current += line + "\n";
      if (line.startsWith("```")) {
        result.push(current);
        current = "";
        inFence = false;
      }
    } else if (!inFence && !inMath && line.startsWith("$$")) {
      if (current.trim()) result.push(current);
      current = line + "\n";
      if (!line.endsWith("$$") || line === "$$") {
        inMath = true;
      } else {
        result.push(current);
        current = "";
      }
    } else if (inMath) {
      current += line + "\n";
      if (line.startsWith("$$")) {
        result.push(current);
        current = "";
        inMath = false;
      }
    } else if (line === "") {
      current += "\n";
    } else {
      current += line + "\n";
    }
  }
  if (current.trim()) result.push(current);
  return result;
}, [children]);
```

- [ ] **Step 4: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/prompt-kit/markdown.tsx
git commit -m "feat: add math formula and code syntax highlighting to markdown"
```

---

### Task 4: Create MermaidBlock component

**Files:**
- Create: `packages/web/src/components/prompt-kit/mermaid-block.tsx`

- [ ] **Step 1: Create the MermaidBlock component**

```tsx
import { useEffect, useId, useRef, useState } from "react";
import mermaid from "mermaid";

let mermaidInitialized = false;

function ensureMermaidInit() {
	if (mermaidInitialized) return;
	mermaid.initialize({
		startOnLoad: false,
		theme: document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark",
		securityLevel: "strict",
	});
	mermaidInitialized = true;
}

export function MermaidBlock({ source }: { source: string }) {
	const id = useId().replace(/:/g, "_");
	const containerRef = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showSource, setShowSource] = useState(false);

	useEffect(() => {
		let cancelled = false;
		ensureMermaidInit();

		(async () => {
			try {
				const { svg: rendered } = await mermaid.render(`mermaid-${id}`, source.trim());
				if (!cancelled) setSvg(rendered);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to render diagram");
					setShowSource(true);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [source, id]);

	return (
		<div className="overflow-hidden rounded-lg border border-border my-2">
			<div className="flex items-center justify-between bg-muted/50 px-3 py-1.5 border-b border-border">
				<span className="text-xs text-muted-foreground font-medium">Mermaid</span>
				{svg && (
					<button
						type="button"
						onClick={() => setShowSource(!showSource)}
						className="text-xs text-muted-foreground hover:text-foreground transition-colors"
					>
						{showSource ? "Diagram" : "Source"}
					</button>
				)}
			</div>
			{error && !svg && (
				<div className="p-3">
					<p className="text-red-400 text-xs mb-2">{error}</p>
					<pre className="overflow-x-auto bg-muted/50 p-4">
						<code className="text-sm font-mono">{source}</code>
					</pre>
				</div>
			)}
			{!svg && !error && (
				<div className="p-4 text-center text-muted-foreground text-sm">Rendering...</div>
			)}
			{svg && showSource && (
				<pre className="overflow-x-auto bg-muted/50 p-4">
					<code className="text-sm font-mono">{source}</code>
				</pre>
			)}
			{svg && !showSource && (
				<div
					ref={containerRef}
					className="p-4 flex justify-center overflow-x-auto [&_svg]:max-w-full"
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			)}
		</div>
	);
}
```

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/prompt-kit/mermaid-block.tsx
git commit -m "feat: add MermaidBlock component with diagram/source toggle"
```

---

### Task 5: Integrate MermaidBlock into markdown code component

**Files:**
- Modify: `packages/web/src/components/prompt-kit/markdown.tsx`

- [ ] **Step 1: Import MermaidBlock**

Add at top of `markdown.tsx`:

```typescript
import { MermaidBlock } from "./mermaid-block";
```

- [ ] **Step 2: Update the code component to detect mermaid blocks**

Update `INITIAL_COMPONENTS.code` — after the inline check, before the regular code block return, add mermaid detection:

```tsx
code: function CodeComponent({ className, children, ...props }) {
    const isInline =
        !props.node?.position?.start.line ||
        props.node?.position?.start.line === props.node?.position?.end.line;

    if (isInline) {
        return (
            <code className={cn("bg-primary-foreground rounded-sm px-1 font-mono text-sm", className)}>
                {children}
            </code>
        );
    }

    // Detect mermaid code blocks
    if (className?.includes("language-mermaid")) {
        const source = String(children).replace(/\n$/, "");
        return <MermaidBlock source={source} />;
    }

    return (
        <div className="overflow-hidden rounded-lg border border-border my-2">
            <pre className="overflow-x-auto bg-muted/50 p-4">
                <code className={cn("text-sm font-mono", className)}>{children}</code>
            </pre>
        </div>
    );
},
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/prompt-kit/markdown.tsx
git commit -m "feat: integrate mermaid diagram rendering in markdown code blocks"
```

---

## Chunk 2: Voice Input

### Task 6: Add STT transcribe endpoint

**Files:**
- Create: `packages/server/src/routes/stt.ts`
- Modify: `packages/server/src/app.ts:6,44-63`

- [ ] **Step 1: Create the STT route**

Create `packages/server/src/routes/stt.ts`:

```typescript
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

export const sttRoute = new Hono().post(
	"/transcribe",
	zValidator("json", z.object({ mediaId: z.string() })),
	async (c) => {
		const gw = getGateway();
		const config = gw.config.get();

		if (!gw.sttService.isAvailable(config)) {
			return c.json({ error: "STT not configured. Set systemModels.stt in config." }, 400);
		}

		const { mediaId } = c.req.valid("json");
		const media = await gw.mediaStore.get(mediaId);
		if (!media) {
			return c.json({ error: "Media not found" }, 404);
		}

		// Build a local file URL for SttService to fetch
		const port = config.gateway.port;
		const audioUrl = `http://localhost:${port}/api/media/${mediaId}`;

		try {
			const text = await gw.sttService.transcribe(audioUrl, config);
			return c.json({ text });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Transcription failed";
			return c.json({ error: message }, 500);
		}
	},
);
```

- [ ] **Step 2: Register the route in app.ts**

Add import in `packages/server/src/app.ts`:

```typescript
import { sttRoute } from "./routes/stt";
```

Add to the route chain (after `.route("/skills", skillsRoute)`):

```typescript
.route("/stt", sttRoute)
```

- [ ] **Step 3: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/stt.ts packages/server/src/app.ts
git commit -m "feat: add POST /api/stt/transcribe endpoint"
```

---

### Task 7: Add STT availability to system status

**Files:**
- Modify: `packages/server/src/routes/system.ts:21-62`

- [ ] **Step 1: Add stt field to /api/system/status response**

In the `GET /status` handler in `system.ts`, add after the `cron` field in the response JSON:

```typescript
stt: { available: gw.sttService.isAvailable(config) },
```

The full return becomes:

```typescript
return c.json({
    // ...existing fields...
    cron: { tasks: config.cron.tasks.length },
    stt: { available: gw.sttService.isAvailable(config) },
});
```

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/routes/system.ts
git commit -m "feat: expose stt.available in system status endpoint"
```

---

### Task 8: Create useVoiceInput hook

**Files:**
- Create: `packages/web/src/hooks/use-voice-input.ts`

- [ ] **Step 1: Create the hook**

```typescript
import { useCallback, useRef, useState } from "react";
import { API_BASE, apiFetch, uploadMedia } from "../lib/api";

interface UseVoiceInputReturn {
	isRecording: boolean;
	isTranscribing: boolean;
	startRecording: () => Promise<void>;
	stopRecording: () => Promise<string>;
	cancelRecording: () => void;
}

export function useVoiceInput(): UseVoiceInputReturn {
	const [isRecording, setIsRecording] = useState(false);
	const [isTranscribing, setIsTranscribing] = useState(false);
	const recorderRef = useRef<MediaRecorder | null>(null);
	const chunksRef = useRef<Blob[]>([]);
	const resolveRef = useRef<((text: string) => void) | null>(null);
	const rejectRef = useRef<((err: Error) => void) | null>(null);

	const startRecording = useCallback(async () => {
		const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
		chunksRef.current = [];

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunksRef.current.push(e.data);
		};

		recorder.start();
		recorderRef.current = recorder;
		setIsRecording(true);
	}, []);

	const stopRecording = useCallback(async (): Promise<string> => {
		const recorder = recorderRef.current;
		if (!recorder || recorder.state === "inactive") {
			return "";
		}

		return new Promise<string>((resolve, reject) => {
			resolveRef.current = resolve;
			rejectRef.current = reject;

			recorder.onstop = async () => {
				// Stop all tracks to release the microphone
				for (const track of recorder.stream.getTracks()) {
					track.stop();
				}

				setIsRecording(false);
				setIsTranscribing(true);

				try {
					const blob = new Blob(chunksRef.current, { type: "audio/webm" });
					const file = new File([blob], "voice.webm", { type: "audio/webm" });
					const { id: mediaId } = await uploadMedia(file);

					const res = await apiFetch(`${API_BASE}/api/stt/transcribe`, {
						method: "POST",
						body: JSON.stringify({ mediaId }),
					});

					if (!res.ok) {
						const data = (await res.json()) as { error?: string };
						throw new Error(data.error ?? "Transcription failed");
					}

					const { text } = (await res.json()) as { text: string };
					resolveRef.current?.(text);
				} catch (err) {
					rejectRef.current?.(err instanceof Error ? err : new Error(String(err)));
				} finally {
					setIsTranscribing(false);
					recorderRef.current = null;
				}
			};

			recorder.stop();
		});
	}, []);

	const cancelRecording = useCallback(() => {
		const recorder = recorderRef.current;
		if (recorder && recorder.state !== "inactive") {
			recorder.onstop = () => {
				for (const track of recorder.stream.getTracks()) {
					track.stop();
				}
			};
			recorder.stop();
		}
		recorderRef.current = null;
		chunksRef.current = [];
		setIsRecording(false);
		setIsTranscribing(false);
	}, []);

	return { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording };
}
```

- [ ] **Step 2: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/hooks/use-voice-input.ts
git commit -m "feat: add useVoiceInput hook for browser audio recording + STT"
```

---

### Task 9: Add mic button to Chat UI

**Files:**
- Modify: `packages/web/src/pages/Chat.tsx`

- [ ] **Step 1: Add imports**

Add to the lucide-react import in Chat.tsx:

```typescript
import { Mic, MicOff, Loader2 } from "lucide-react";
```

(Merge with existing lucide imports.)

Add the hook and API imports:

```typescript
import { useVoiceInput } from "../hooks/use-voice-input";
```

- [ ] **Step 2: Fetch STT availability on mount**

Inside the `Chat` component, add state and fetch:

```typescript
const [sttAvailable, setSttAvailable] = useState(false);

useEffect(() => {
    apiFetch(`${API_BASE}/api/system/status`)
        .then((r) => r.json())
        .then((data: { stt?: { available: boolean } }) => {
            setSttAvailable(data.stt?.available ?? false);
        })
        .catch(() => {});
}, []);
```

- [ ] **Step 3: Initialize the voice input hook**

```typescript
const { isRecording, isTranscribing, startRecording, stopRecording, cancelRecording } =
    useVoiceInput();
```

- [ ] **Step 4: Add mic button handler**

```typescript
const handleMicClick = useCallback(async () => {
    if (isRecording) {
        try {
            const text = await stopRecording();
            if (text) setInput((prev) => (prev ? `${prev} ${text}` : text));
        } catch {
            // STT failed silently — user already sees the button state reset
        }
    } else {
        try {
            await startRecording();
        } catch {
            // Microphone permission denied or not available
        }
    }
}, [isRecording, startRecording, stopRecording]);
```

- [ ] **Step 5: Add mic button to PromptInputActions**

In the left-side `<div className="flex items-center gap-1">` inside `PromptInputActions`, after the Paperclip (file attach) button and before the streaming cancel button, add:

```tsx
{sttAvailable && (
    <Button
        variant="ghost"
        size="icon"
        className={`h-8 w-8 rounded-full ${
            isRecording
                ? "text-red-400 animate-pulse"
                : isTranscribing
                    ? "text-muted-foreground"
                    : "text-muted-foreground hover:text-foreground"
        }`}
        onClick={handleMicClick}
        disabled={isTranscribing || isStreaming}
        title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Voice input"}
    >
        {isTranscribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
        ) : isRecording ? (
            <MicOff className="h-4 w-4" />
        ) : (
            <Mic className="h-4 w-4" />
        )}
    </Button>
)}
```

- [ ] **Step 6: Verify build passes**

Run: `bun run build`
Expected: Build succeeds

- [ ] **Step 7: Run lint**

Run: `bun run check`
Expected: No new errors

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/pages/Chat.tsx
git commit -m "feat: add voice input mic button to chat UI"
```

---

### Task 10: Add i18n strings for voice input

**Files:**
- Modify: `packages/web/src/i18n/locales/en.json`
- Modify: `packages/web/src/i18n/locales/zh.json`

- [ ] **Step 1: Check if voice-related i18n keys are needed**

The mic button currently uses `title` attributes with hardcoded English strings. If the project uses i18n for tooltips, update the title strings to use `t()` keys. Add the following keys:

In `en.json`:
```json
"chat.voice.start": "Voice input",
"chat.voice.stop": "Stop recording",
"chat.voice.transcribing": "Transcribing..."
```

In `zh.json`:
```json
"chat.voice.start": "语音输入",
"chat.voice.stop": "停止录音",
"chat.voice.transcribing": "转写中..."
```

- [ ] **Step 2: Update mic button to use i18n**

Replace the hardcoded `title` strings in the mic button with `t("chat.voice.start")`, `t("chat.voice.stop")`, `t("chat.voice.transcribing")` respectively.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/i18n/locales/en.json packages/web/src/i18n/locales/zh.json packages/web/src/pages/Chat.tsx
git commit -m "feat: add i18n strings for voice input"
```
