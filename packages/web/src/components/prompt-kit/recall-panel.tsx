import { BookOpen, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RecallInfo } from "../../lib/api";

interface RecallPanelProps {
	memories: RecallInfo[];
}

export function RecallPanel({ memories }: RecallPanelProps) {
	const [open, setOpen] = useState(false);
	const navigate = useNavigate();

	if (memories.length === 0) return null;

	return (
		<div className="mt-1">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<BookOpen className="h-3 w-3" />
				<span>
					{memories.length} {memories.length === 1 ? "memory" : "memories"} referenced
				</span>
				<ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
			</button>

			{open && (
				<div className="mt-1.5 space-y-1.5 pl-1 border-l-2 border-border">
					{memories.map((m) => (
						<button
							type="button"
							key={m.memoryId}
							onClick={() => navigate(`/knowledge?id=${m.memoryId}`)}
							className="block w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
						>
							<div className="flex items-center gap-2 text-xs">
								<span className="text-muted-foreground truncate flex-1">{m.snippet}</span>
								<span className="shrink-0 text-muted-foreground/60 tabular-nums">
									{Math.round(m.score * 100)}%
								</span>
							</div>
							{m.source && (
								<span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground/70">
									{m.source}
								</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
