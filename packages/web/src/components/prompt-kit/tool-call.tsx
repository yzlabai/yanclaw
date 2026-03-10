import { CheckCircle, ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";

export type ToolCallProps = {
	name: string;
	args?: unknown;
	result?: unknown;
	isStreaming?: boolean;
	className?: string;
};

function ToolCall({ name, args, result, isStreaming, className }: ToolCallProps) {
	const [isOpen, setIsOpen] = useState(false);

	const getStateIcon = () => {
		if (isStreaming) return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
		if (result) return <CheckCircle className="h-4 w-4 text-green-400" />;
		return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
	};

	const getStateBadge = () => {
		if (isStreaming) {
			return (
				<span className="px-2 py-0.5 rounded-full text-xs bg-primary/20 text-primary">Running</span>
			);
		}
		if (result) {
			return (
				<span className="px-2 py-0.5 rounded-full text-xs bg-green-900/30 text-green-400">
					Done
				</span>
			);
		}
		return (
			<span className="px-2 py-0.5 rounded-full text-xs bg-muted text-muted-foreground">
				Pending
			</span>
		);
	};

	const formatValue = (value: unknown): string => {
		if (value === null) return "null";
		if (value === undefined) return "undefined";
		if (typeof value === "string") return value;
		if (typeof value === "object") return JSON.stringify(value, null, 2);
		return String(value);
	};

	return (
		<div className={cn("overflow-hidden rounded-lg border border-border", className)}>
			<Collapsible open={isOpen} onOpenChange={setIsOpen}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center justify-between px-3 py-2 bg-card hover:bg-muted transition-colors"
					>
						<div className="flex items-center gap-2">
							{getStateIcon()}
							<span className="font-mono text-sm">{name}</span>
							{getStateBadge()}
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
					<div className="border-t border-border bg-card/50 p-3 space-y-3">
						{args && (
							<div>
								<h4 className="text-xs text-muted-foreground mb-1">Input</h4>
								<pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all bg-card rounded p-2 max-h-40 overflow-y-auto">
									{formatValue(args)}
								</pre>
							</div>
						)}
						{result && (
							<div>
								<h4 className="text-xs text-muted-foreground mb-1">Output</h4>
								<pre className="text-xs text-foreground/80 whitespace-pre-wrap break-all bg-card rounded p-2 max-h-40 overflow-y-auto">
									{formatValue(result)}
								</pre>
							</div>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</div>
	);
}

export { ToolCall };
