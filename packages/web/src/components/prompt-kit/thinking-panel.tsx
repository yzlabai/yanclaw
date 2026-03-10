import { Brain, ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

export type ThinkingPanelProps = {
	content: string;
	isStreaming?: boolean;
	durationMs?: number;
	className?: string;
};

function ThinkingPanel({ content, isStreaming, durationMs, className }: ThinkingPanelProps) {
	const [isOpen, setIsOpen] = useState(false);

	const label = isStreaming
		? "Thinking..."
		: durationMs
			? `Thought for ${(durationMs / 1000).toFixed(1)}s`
			: "Thought";

	return (
		<div className={cn("overflow-hidden rounded-lg border border-border", className)}>
			<Collapsible open={isOpen} onOpenChange={setIsOpen}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center justify-between px-3 py-2 bg-card hover:bg-muted transition-colors"
					>
						<div className="flex items-center gap-2">
							<Brain
								className={cn("h-4 w-4 text-muted-foreground", isStreaming && "animate-pulse")}
							/>
							<span className="text-sm text-muted-foreground italic">{label}</span>
						</div>
						<ChevronDown
							className={cn(
								"h-4 w-4 text-muted-foreground transition-transform",
								isOpen && "rotate-180",
							)}
						/>
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="border-t border-border bg-card/50 px-3 py-2">
						<p className="text-sm text-muted-foreground italic whitespace-pre-wrap">{content}</p>
					</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

export { ThinkingPanel };
