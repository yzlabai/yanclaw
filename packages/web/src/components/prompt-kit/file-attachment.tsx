import { Download, File, FileText, Image, Music, Video } from "lucide-react";
import { cn } from "../../lib/utils";

export type FileAttachmentProps = {
	filename: string;
	size: number;
	mimeType: string;
	url: string;
	className?: string;
};

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
	if (mimeType.startsWith("image/")) return Image;
	if (mimeType.startsWith("video/")) return Video;
	if (mimeType.startsWith("audio/")) return Music;
	if (mimeType.includes("pdf") || mimeType.includes("text")) return FileText;
	return File;
}

function FileAttachment({ filename, size, mimeType, url, className }: FileAttachmentProps) {
	const isImage = mimeType.startsWith("image/");
	const Icon = getFileIcon(mimeType);

	if (isImage) {
		return (
			<a
				href={url}
				target="_blank"
				rel="noopener noreferrer"
				className={cn("block max-w-xs rounded-lg overflow-hidden border border-border", className)}
			>
				<img
					src={url}
					alt={filename}
					className="max-h-48 w-auto object-contain bg-muted"
					loading="lazy"
				/>
				<div className="flex items-center gap-2 px-2 py-1 bg-card text-xs text-muted-foreground">
					<span className="truncate flex-1">{filename}</span>
					<span>{formatSize(size)}</span>
				</div>
			</a>
		);
	}

	return (
		<a
			href={url}
			download={filename}
			className={cn(
				"flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 max-w-xs hover:bg-muted transition-colors",
				className,
			)}
		>
			<Icon className="size-5 text-muted-foreground shrink-0" />
			<div className="flex-1 min-w-0">
				<div className="text-sm text-foreground truncate">{filename}</div>
				<div className="text-xs text-muted-foreground">{formatSize(size)}</div>
			</div>
			<Download className="size-4 text-muted-foreground shrink-0" />
		</a>
	);
}

export { FileAttachment };
