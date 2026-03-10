import { ChevronDown } from "lucide-react";
import { useStickToBottomContext } from "use-stick-to-bottom";
import { cn } from "../../lib/utils";

function ScrollButton({ className }: { className?: string }) {
	const { isAtBottom, scrollToBottom } = useStickToBottomContext();

	return (
		<button
			type="button"
			className={cn(
				"absolute bottom-24 left-1/2 -translate-x-1/2 h-8 w-8 rounded-full bg-gray-800 border border-gray-700 flex items-center justify-center shadow-lg transition-all duration-150",
				!isAtBottom
					? "translate-y-0 scale-100 opacity-100"
					: "pointer-events-none translate-y-4 scale-95 opacity-0",
				className,
			)}
			onClick={() => scrollToBottom()}
		>
			<ChevronDown className="h-4 w-4 text-gray-300" />
		</button>
	);
}

export { ScrollButton };
