import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@yanclaw/web/components/ui/sheet";
import type { PermissionRequest } from "@yanclaw/web/hooks/useAgentHub";
import { cn } from "@yanclaw/web/lib/utils";
import { AlertTriangle, Check, X } from "lucide-react";

const riskColors = {
	low: "border-border",
	medium: "border-amber-500/30 bg-amber-500/5",
	high: "border-red-500/30 bg-red-500/5",
};

const riskLabels = {
	low: { text: "低", class: "text-green-400" },
	medium: { text: "中", class: "text-amber-400" },
	high: { text: "高", class: "text-red-400" },
};

function formatRemaining(request: PermissionRequest): string {
	const elapsed = Date.now() - request.createdAt;
	const remaining = Math.max(0, request.timeoutMs - elapsed);
	const minutes = Math.floor(remaining / 60000);
	const seconds = Math.floor((remaining % 60000) / 1000);
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

interface ApprovalQueueProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	approvals: PermissionRequest[];
	onApprove: (processId: string, requestId: string, allowed: boolean) => void;
}

export function ApprovalQueue({ open, onOpenChange, approvals, onApprove }: ApprovalQueueProps) {
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="w-full sm:max-w-md overflow-y-auto">
				<SheetHeader>
					<SheetTitle>待审批请求 ({approvals.length})</SheetTitle>
				</SheetHeader>

				{approvals.length > 1 && (
					<div className="flex gap-2 mt-4">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								for (const a of approvals) {
									onApprove(a.processId, a.requestId, true);
								}
							}}
						>
							<Check className="size-3" />
							全部批准
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								for (const a of approvals) {
									onApprove(a.processId, a.requestId, false);
								}
							}}
						>
							<X className="size-3" />
							全部拒绝
						</Button>
					</div>
				)}

				<div className="space-y-3 mt-4">
					{approvals.length === 0 && (
						<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
							<AlertTriangle className="size-10 mb-2 opacity-30" />
							<span className="text-sm">暂无待审批请求</span>
						</div>
					)}

					{approvals.map((req) => (
						<ApprovalCard key={req.requestId} request={req} onApprove={onApprove} />
					))}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function ApprovalCard({
	request,
	onApprove,
}: {
	request: PermissionRequest;
	onApprove: (processId: string, requestId: string, allowed: boolean) => void;
}) {
	const risk = riskLabels[request.risk];

	return (
		<div className={cn("rounded-lg border p-3 space-y-2", riskColors[request.risk])}>
			{/* Header: process + tool */}
			<div className="flex items-center gap-2 text-sm">
				<span className="font-medium">{request.processId.slice(0, 8)}</span>
				<span className="text-muted-foreground">·</span>
				<Badge variant="secondary" className="text-xs">
					{request.tool}
				</Badge>
			</div>

			{/* Args preview */}
			<div className="rounded-md bg-muted p-2 font-mono text-xs overflow-x-auto max-h-24 overflow-y-auto">
				{request.description}
			</div>

			{/* Footer: risk + timer + actions */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3 text-xs">
					<span>
						风险: <span className={risk.class}>{risk.text}</span>
					</span>
					<span className="text-muted-foreground tabular-nums">⏱ {formatRemaining(request)}</span>
				</div>
				<div className="flex gap-1">
					<Button
						variant="outline"
						size="sm"
						onClick={() => onApprove(request.processId, request.requestId, false)}
					>
						拒绝
					</Button>
					<Button size="sm" onClick={() => onApprove(request.processId, request.requestId, true)}>
						<Check className="size-3" />
						批准
					</Button>
				</div>
			</div>
		</div>
	);
}
