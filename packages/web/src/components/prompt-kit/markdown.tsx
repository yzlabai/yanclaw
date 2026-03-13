import { memo, useId, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "../../lib/utils";
import { MermaidBlock } from "./mermaid-block";

export type MarkdownProps = {
	children: string;
	id?: string;
	className?: string;
	components?: Partial<Components>;
};

const INITIAL_COMPONENTS: Partial<Components> = {
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
	pre: function PreComponent({ children }) {
		return <>{children}</>;
	},
};

const MemoizedMarkdownBlock = memo(
	function MarkdownBlock({
		content,
		components = INITIAL_COMPONENTS,
	}: {
		content: string;
		components?: Partial<Components>;
	}) {
		return (
			<ReactMarkdown
				remarkPlugins={[remarkGfm, remarkMath]}
				rehypePlugins={[rehypeKatex, rehypeHighlight]}
				components={components}
			>
				{content}
			</ReactMarkdown>
		);
	},
	function propsAreEqual(prevProps, nextProps) {
		return prevProps.content === nextProps.content;
	},
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

function MarkdownComponent({
	children,
	id,
	className,
	components = INITIAL_COMPONENTS,
}: MarkdownProps) {
	const generatedId = useId();
	const blockId = id ?? generatedId;
	const blocks = useMemo(() => {
		const result: string[] = [];
		let current = "";
		let inFence = false;
		let inMath = false;

		for (const line of children.split("\n")) {
			if (!inFence && !inMath && line.startsWith("```")) {
				if (current.trim()) result.push(current);
				current = `${line}\n`;
				inFence = true;
			} else if (inFence) {
				current += `${line}\n`;
				if (line.startsWith("```")) {
					result.push(current);
					current = "";
					inFence = false;
				}
			} else if (!inFence && !inMath && line.startsWith("$$")) {
				if (current.trim()) result.push(current);
				current = `${line}\n`;
				if (!line.endsWith("$$") || line === "$$") {
					inMath = true;
				} else {
					result.push(current);
					current = "";
				}
			} else if (inMath) {
				current += `${line}\n`;
				if (line.startsWith("$$")) {
					result.push(current);
					current = "";
					inMath = false;
				}
			} else if (line === "") {
				current += "\n";
			} else {
				current += `${line}\n`;
			}
		}
		if (current.trim()) result.push(current);
		return result;
	}, [children]);

	return (
		<div className={className}>
			{blocks.map((block, index) => (
				<MemoizedMarkdownBlock
					key={`${blockId}-block-${index}`}
					content={block}
					components={components}
				/>
			))}
		</div>
	);
}

const Markdown = memo(MarkdownComponent);
Markdown.displayName = "Markdown";

export { Markdown };
