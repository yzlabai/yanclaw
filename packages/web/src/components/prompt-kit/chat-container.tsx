import { StickToBottom } from "use-stick-to-bottom";
import { cn } from "../../lib/utils";

export type ChatContainerRootProps = {
	children: React.ReactNode;
	className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

export type ChatContainerContentProps = {
	children: React.ReactNode;
	className?: string;
} & React.HTMLAttributes<HTMLDivElement>;

function ChatContainerRoot({ children, className, ...props }: ChatContainerRootProps) {
	return (
		<StickToBottom
			className={cn("flex overflow-y-auto", className)}
			resize="smooth"
			initial="instant"
			role="log"
			{...props}
		>
			{children}
		</StickToBottom>
	);
}

function ChatContainerContent({ children, className, ...props }: ChatContainerContentProps) {
	return (
		<StickToBottom.Content className={cn("flex w-full flex-col", className)} {...props}>
			{children}
		</StickToBottom.Content>
	);
}

export { ChatContainerRoot, ChatContainerContent };
