import { cn } from "../../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Markdown } from "./markdown";

export type MessageProps = {
	children: React.ReactNode;
	className?: string;
} & React.HTMLProps<HTMLDivElement>;

const Message = ({ children, className, ...props }: MessageProps) => (
	<div className={cn("flex gap-3", className)} {...props}>
		{children}
	</div>
);

export type MessageAvatarProps = {
	src?: string;
	alt: string;
	fallback?: string;
	delayMs?: number;
	className?: string;
};

const MessageAvatar = ({ src, alt, fallback, delayMs, className }: MessageAvatarProps) => {
	return (
		<Avatar className={cn("h-8 w-8 shrink-0", className)}>
			{src && <AvatarImage src={src} alt={alt} />}
			{fallback && <AvatarFallback delayMs={delayMs}>{fallback}</AvatarFallback>}
		</Avatar>
	);
};

export type MessageContentProps = {
	children: React.ReactNode;
	markdown?: boolean;
	className?: string;
};

const MessageContent = ({ children, markdown = false, className }: MessageContentProps) => {
	const classNames = cn(
		"rounded-2xl px-4 py-2 text-foreground break-words whitespace-normal",
		className,
	);

	return markdown ? (
		<Markdown className={classNames}>{children as string}</Markdown>
	) : (
		<div className={classNames}>{children}</div>
	);
};

export { Message, MessageAvatar, MessageContent };
