import { useEffect, useId, useRef, useState } from "react";

let mermaidModule: typeof import("mermaid") | null = null;

async function getMermaid() {
	if (!mermaidModule) {
		mermaidModule = await import("mermaid");
		mermaidModule.default.initialize({
			startOnLoad: false,
			theme: document.documentElement.getAttribute("data-theme") === "light" ? "default" : "dark",
			securityLevel: "strict",
		});
	}
	return mermaidModule.default;
}

export function MermaidBlock({ source }: { source: string }) {
	const id = useId().replace(/:/g, "_");
	const containerRef = useRef<HTMLDivElement>(null);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showSource, setShowSource] = useState(false);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const mermaid = await getMermaid();
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
					// biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid.render() produces sanitized SVG with securityLevel: "strict"
					dangerouslySetInnerHTML={{ __html: svg }}
				/>
			)}
		</div>
	);
}
