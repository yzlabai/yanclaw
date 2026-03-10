import { cn } from "../../lib/utils";

export function TypingLoader({
	className,
	size = "md",
}: {
	className?: string;
	size?: "sm" | "md" | "lg";
}) {
	const dotSizes = { sm: "h-1 w-1", md: "h-1.5 w-1.5", lg: "h-2 w-2" };
	const containerSizes = { sm: "h-4", md: "h-5", lg: "h-6" };

	return (
		<div className={cn("flex items-center space-x-1", containerSizes[size], className)}>
			{[0, 1, 2].map((i) => (
				<div
					key={i}
					className={cn("bg-gray-400 rounded-full animate-bounce", dotSizes[size])}
					style={{ animationDelay: `${i * 200}ms`, animationDuration: "0.8s" }}
				/>
			))}
		</div>
	);
}

export function CircularLoader({
	className,
	size = "md",
}: {
	className?: string;
	size?: "sm" | "md" | "lg";
}) {
	const sizeClasses = { sm: "size-4", md: "size-5", lg: "size-6" };

	return (
		<div
			className={cn(
				"border-blue-500 animate-spin rounded-full border-2 border-t-transparent",
				sizeClasses[size],
				className,
			)}
		/>
	);
}
