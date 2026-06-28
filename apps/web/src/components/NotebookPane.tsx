import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Plus,
  LayoutList,
  BookPlus,
  ArrowDownWideNarrow,
  Notebook as NotebookIcon,
  Tags,
  Archive,
  Trash2,
  KeyRound,
  LogOut,
  CloudOff,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  CircleUserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { NotebookTreeItem } from "./NotebookTreeItem";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { Notebook, AuthUser } from "@edgeever/shared";
import type { NotebookNode, NotebookDropPosition, NotebookSortMode } from "@/lib/app-helpers";
import type { SyncQueueSummary } from "@/lib/sync-queue";
import {
  NOTEBOOK_SORT_OPTIONS,
  buildNotebookTree,
  getNotebookSortComparator,
  hasEdgeEverDragData,
  readNotebookSortPreference,
  writeNotebookSortPreference,
} from "@/lib/app-helpers";

const NOTEBOOK_DRAG_SCROLL_EDGE_PX = 56;
const NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX = 18;

const SidebarNavButton = ({
  active = false,
  icon,
  label,
  onClick,
}: {
  active?: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) => (
  <button
    className={cn(
      "flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none transition-all duration-200",
      active ? "bg-slate-100 text-slate-950" : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
    )}
    type="button"
    aria-current={active ? "page" : undefined}
    onClick={onClick}
  >
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </button>
);

const SidebarSectionLabel = ({ icon, label }: { icon: ReactNode; label: string }) => (
  <div className="flex h-9 items-center gap-3 px-3 text-sm font-medium leading-none text-slate-600">
    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
    <span className="min-w-0 flex-1 truncate">{label}</span>
  </div>
);

const getSyncStatusLabel = (summary: SyncQueueSummary, isOnline: boolean, isSyncing: boolean) => {
  if (!isOnline) {
    return summary.total > 0 ? `离线，${summary.total} 项待同步` : "离线";
  }

  if (isSyncing || summary.syncing > 0) {
    return "同步中";
  }

  if (summary.conflict > 0) {
    return `${summary.conflict} 项同步冲突`;
  }

  if (summary.error > 0) {
    return `${summary.error} 项等待重试`;
  }

  if (summary.pending > 0) {
    return `${summary.pending} 项待同步`;
  }

  return "已同步";
};

const SyncStatusBar = ({
  summary,
  isOnline,
  isSyncing,
  onSyncNow,
}: {
  summary: SyncQueueSummary;
  isOnline: boolean;
  isSyncing: boolean;
  onSyncNow: () => void;
}) => {
  const hasQueuedWork = summary.total > 0;
  const label = getSyncStatusLabel(summary, isOnline, isSyncing);
  const statusClassName = !isOnline
    ? "border-slate-200 bg-slate-50 text-slate-600"
    : summary.conflict > 0
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : hasQueuedWork
        ? "border-slate-200 bg-slate-50 text-slate-700"
        : "border-slate-200 bg-white text-slate-500";

  return (
    <div className={cn("mb-3 flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 transition-all duration-200", statusClassName)}>
      {!isOnline ? (
        <CloudOff className="h-4 w-4 shrink-0" />
      ) : summary.conflict > 0 ? (
        <AlertTriangle className="h-4 w-4 shrink-0" />
      ) : hasQueuedWork || isSyncing ? (
        <RefreshCw className={cn("h-4 w-4 shrink-0", isSyncing && "animate-spin")} />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
      {hasQueuedWork && (
        <button
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/70 disabled:opacity-50 transition-colors"
          type="button"
          title="立即同步"
          aria-label="立即同步"
          disabled={!isOnline || isSyncing}
          onClick={onSyncNow}
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export const NotebookPane = ({
  user,
  view,
  selectedNotebookId,
  onSelect,
  onCreateNotebook,
  onRenameNotebook,
  onDeleteNotebook,
  onMoveNotebook,
  onMoveMemos,
  onBackToList,
  onOpenTags,
  onOpenAssets,
  onOpenTrash,
  onOpenSettings,
  onCreateMemo,
  canCreateMemo,
  isCreatingMemo,
  syncSummary,
  isOnline,
  isSyncingQueuedChanges,
  onSyncQueuedChanges,
  imageCompressionEnabled,
  onImageCompressionChange,
  authRequired,
  onLogout,
  isLoggingOut,
}: {
  user: AuthUser | null;
  view: string;
  selectedNotebookId: string | null;
  onSelect: (notebookId: string) => void;
  onCreateNotebook: (parentId?: string | null) => void;
  onRenameNotebook: (notebook: Notebook) => void;
  onDeleteNotebook: (notebook: Notebook) => void;
  onMoveNotebook: (notebookId: string, targetNotebookId: string, position: NotebookDropPosition) => void;
  onMoveMemos: (memoIds: string[], targetNotebookId: string) => void;
  onBackToList: () => void;
  onOpenTags: () => void;
  onOpenAssets: () => void;
  onOpenTrash: () => void;
  onOpenSettings: () => void;
  onCreateMemo: () => void;
  canCreateMemo: boolean;
  isCreatingMemo: boolean;
  syncSummary: SyncQueueSummary;
  isOnline: boolean;
  isSyncingQueuedChanges: boolean;
  onSyncQueuedChanges: () => void;
  imageCompressionEnabled: boolean;
  onImageCompressionChange: (enabled: boolean) => void;
  authRequired: boolean;
  onLogout: () => void;
  isLoggingOut: boolean;
}) => {
  const notebookScrollRef = useRef<HTMLDivElement | null>(null);
  const notebookDragScrollFrameRef = useRef<number | null>(null);
  const [expandSiblingsRequest, setExpandSiblingsRequest] = useState<{ parentId: string | null; token: number } | null>(null);
  const [notebookSortMode, setNotebookSortMode] = useState<NotebookSortMode>(readNotebookSortPreference);

  const stopNotebookDragAutoScroll = useCallback(() => {
    if (notebookDragScrollFrameRef.current === null) {
      return;
    }

    window.cancelAnimationFrame(notebookDragScrollFrameRef.current);
    notebookDragScrollFrameRef.current = null;
  }, []);

  useEffect(() => () => stopNotebookDragAutoScroll(), [stopNotebookDragAutoScroll]);

  const handleExpandNotebookSiblings = useCallback((parentId: string | null) => {
    setExpandSiblingsRequest((current: { parentId: string | null; token: number } | null) => ({ parentId, token: (current?.token ?? 0) + 1 }));
  }, []);

  const handleNotebookScrollDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasEdgeEverDragData(event.dataTransfer)) {
      stopNotebookDragAutoScroll();
      return;
    }

    const scrollContainer = notebookScrollRef.current;

    if (!scrollContainer) {
      return;
    }

    const rect = scrollContainer.getBoundingClientRect();
    const distanceToTop = event.clientY - rect.top;
    const distanceToBottom = rect.bottom - event.clientY;
    const topPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToTop);
    const bottomPressure = Math.max(0, NOTEBOOK_DRAG_SCROLL_EDGE_PX - distanceToBottom);
    const direction = bottomPressure > 0 ? 1 : topPressure > 0 ? -1 : 0;

    if (direction === 0) {
      stopNotebookDragAutoScroll();
      return;
    }

    event.preventDefault();

    const pressure = Math.max(topPressure, bottomPressure) / NOTEBOOK_DRAG_SCROLL_EDGE_PX;
    const scrollStep = Math.max(4, Math.ceil(pressure * NOTEBOOK_DRAG_SCROLL_MAX_STEP_PX)) * direction;
    const tick = () => {
      scrollContainer.scrollTop += scrollStep;
      notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
    };

    if (notebookDragScrollFrameRef.current !== null) {
      return;
    }

    notebookDragScrollFrameRef.current = window.requestAnimationFrame(tick);
  };

  const notebooksQuery = useQuery({
    queryKey: ["notebooks"],
    queryFn: () => api.listNotebooks(),
  });

  const notebooks = notebooksQuery.data?.notebooks ?? [];
  const tree = useMemo(() => buildNotebookTree(notebooks, getNotebookSortComparator(notebookSortMode)), [notebooks, notebookSortMode]);
  const isLoading = notebooksQuery.isLoading;
  const activeNotebookSortLabel = NOTEBOOK_SORT_OPTIONS.find((option) => option.value === notebookSortMode)?.label ?? "名称";

  useEffect(() => {
    writeNotebookSortPreference(notebookSortMode);
  }, [notebookSortMode]);

  useEffect(() => {
    if (!selectedNotebookId) {
      return;
    }

    window.setTimeout(() => {
      const selectedNode = notebookScrollRef.current?.querySelector<HTMLElement>(
        `[data-notebook-id="${CSS.escape(selectedNotebookId)}"]`
      );

      selectedNode?.scrollIntoView({ block: "nearest" });
    }, 0);
  }, [selectedNotebookId, tree]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-end justify-between border-b border-slate-200 px-4 pb-3 pt-[env(safe-area-inset-top)] lg:h-16 lg:items-center lg:pb-0 lg:pt-0">
        <div>
          <div className="text-base font-semibold tracking-normal lg:hidden">笔记本</div>
          <div className="hidden text-base font-semibold tracking-normal lg:block">EdgeEver</div>
          <div className="text-xs text-slate-500">{user?.username ?? "边缘笔记工作区"}</div>
        </div>
        <div className="flex items-center gap-1">
          <Button className="lg:hidden" size="icon" variant="ghost" title="返回笔记列表" aria-label="返回笔记列表" onClick={onBackToList}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button className="lg:hidden" size="icon" variant="ghost" title="新建笔记本" aria-label="新建笔记本" onClick={() => onCreateNotebook(null)}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div
        ref={notebookScrollRef}
        className="flex-1 overflow-y-auto px-3 py-4"
        onDragEnd={stopNotebookDragAutoScroll}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            stopNotebookDragAutoScroll();
          }
        }}
        onDragOver={handleNotebookScrollDragOver}
        onDrop={stopNotebookDragAutoScroll}
      >
        <div className="mb-4 hidden overflow-hidden rounded-full border border-slate-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.06)] lg:flex">
          <button
            className="flex h-14 min-w-0 flex-1 items-center gap-3 px-3 text-left transition-all duration-200 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            title="新建笔记"
            onClick={onCreateMemo}
            disabled={!canCreateMemo || isCreatingMemo}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-[0_8px_18px_rgb(var(--brand-green-rgb)/0.28)] transition-transform duration-200 group-hover:scale-105">
              <Plus className="h-6 w-6" />
            </span>
            <span className="min-w-0 truncate text-sm font-semibold text-slate-950">新建笔记</span>
          </button>
        </div>

        <nav className="mb-3 space-y-1" aria-label="笔记入口">
          <SidebarNavButton
            active={view === "notebook" && selectedNotebookId === null}
            icon={<LayoutList className="h-4 w-4" />}
            label="全部笔记"
            onClick={onBackToList}
          />
        </nav>

        <div className="group mb-2 flex items-center justify-between gap-2">
          <SidebarSectionLabel icon={<NotebookIcon className="h-4 w-4" />} label="笔记本" />
          <div className="flex items-center gap-1 opacity-100 transition-opacity duration-200 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
            <button
              className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
              type="button"
              title="新建笔记本"
              aria-label="新建笔记本"
              onClick={() => onCreateNotebook(null)}
            >
              <BookPlus className="h-3.5 w-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition-colors duration-200 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
                  type="button"
                  title={`笔记本排序：${activeNotebookSortLabel}`}
                  aria-label={`笔记本排序：${activeNotebookSortLabel}`}
                >
                  <ArrowDownWideNarrow className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                {NOTEBOOK_SORT_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={notebookSortMode === option.value}
                    onSelect={() => setNotebookSortMode(option.value)}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {isLoading ? (
          <div className="mb-4 px-2 py-3 text-sm text-slate-500">加载中</div>
        ) : (
          <div className="mb-4 space-y-1" data-notebook-tree>
            {tree.map((node) => (
              <NotebookTreeItem
                key={node.id}
                node={node}
                depth={0}
                selectedNotebookId={selectedNotebookId}
                onSelect={onSelect}
                onCreateNotebook={onCreateNotebook}
                onRenameNotebook={onRenameNotebook}
                onDeleteNotebook={onDeleteNotebook}
                onMoveNotebook={onMoveNotebook}
                onMoveMemos={onMoveMemos}
                onDragScroll={handleNotebookScrollDragOver}
                expandSiblingsRequest={expandSiblingsRequest}
                onExpandSiblings={handleExpandNotebookSiblings}
              />
            ))}
          </div>
        )}

        <nav className="space-y-1 border-t border-slate-100 pt-3" aria-label="辅助入口">
          <SidebarNavButton icon={<Tags className="h-4 w-4" />} label="标签" onClick={onOpenTags} />
          <SidebarNavButton icon={<Archive className="h-4 w-4" />} label="附件" onClick={onOpenAssets} />
          <SidebarNavButton
            active={view === "trash"}
            icon={<Trash2 className="h-4 w-4" />}
            label="回收站"
            onClick={onOpenTrash}
          />
        </nav>
      </div>

      <footer className="border-t border-slate-200 bg-white/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-sm">
        <div>
          <button
            onClick={onOpenSettings}
            className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium leading-none text-slate-700 transition-colors duration-200 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/70"
            type="button"
            title="个人中心"
            aria-label="个人中心"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              <CircleUserRound className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1 truncate">个人中心</span>
          </button>
        </div>
      </footer>
    </div>
  );
};
