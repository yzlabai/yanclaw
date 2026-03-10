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
		if (isStreaming) return <Loader2 className="h-4 w-4 animate-spin text-blue-400" />;
		if (result) return <CheckCircle className="h-4 w-4 text-green-400" />;
		return <Loader2 className="h-4 w-4 animate-spin text-gray-400" />;
	};

	const getStateBadge = () => {
		if (isStreaming) {
			return (
				<span className="px-2 py-0.5 rounded-full text-xs bg-blue-900/30 text-blue-400">
					Running
				</span>
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
			<span className="px-2 py-0.5 rounded-full text-xs bg-gray-800 text-gray-400">Pending</span>
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
		<div className={cn("overflow-hidden rounded-lg border border-gray-700", className)}>
			<Collapsible open={isOpen} onOpenChange={setIsOpen}>
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center justify-between px-3 py-2 bg-gray-900 hover:bg-gray-800 transition-colors"
					>
						<div className="flex items-center gap-2">
							{getStateIcon()}
							<span className="font-mono text-sm">{name}</span>
							{getStateBadge()}
						</div>
						<ChevronDown
							className={cn("h-4 w-4 text-gray-400 transition-transform", isOpen && "rotate-180")}
						/>
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="border-t border-gray-700 bg-gray-900/50 p-3 space-y-3">
						{args && (
							<div>
								<h4 className="text-xs text-gray-500 mb-1">Input</h4>
								<pre className="text-xs text-gray-300 whitespace-pre-wrap break-all bg-gray-900 rounded p-2 max-h-40 overflow-y-auto">
									{formatValue(args)}
								</pre>
							</div>
						)}
						{result && (
							<div>
								<h4 className="text-xs text-gray-500 mb-1">Output</h4>
								<pre className="text-xs text-gray-300 whitespace-pre-wrap break-all bg-gray-900 rounded p-2 max-h-40 overflow-y-auto">
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
