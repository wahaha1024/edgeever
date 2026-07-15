import type { MemoDetail, TiptapDoc } from "@edgeever/shared";
import { liveQuery } from "dexie";
import { ApiRequestError, api } from "@/lib/api";
import { localDb, type MemoUpdateSyncPayload, type SyncQueueItem } from "@/lib/local-db";

export type SyncQueueSummary = {
  total: number;
  pending: number;
  syncing: number;
  conflict: number;
  error: number;
};

export type SyncRunResult = {
  attempted: number;
  synced: number;
  failed: number;
  conflicted: number;
};

export const emptySyncQueueSummary = (): SyncQueueSummary => ({
  total: 0,
  pending: 0,
  syncing: 0,
  conflict: 0,
  error: 0,
});

export const getMemoUpdateQueueId = (memoId: string) => `memo.update:${memoId}`;

export const queueMemoUpdate = async (payload: MemoUpdateSyncPayload) => {
  const id = getMemoUpdateQueueId(payload.memoId);
  const now = new Date().toISOString();
  await localDb.transaction("rw", localDb.syncQueue, async () => {
    const existing = await localDb.syncQueue.get(id);

    await localDb.syncQueue.put({
      id,
      kind: "memo.update",
      memoId: payload.memoId,
      status: "pending",
      payload,
      attemptCount: existing?.attemptCount ?? 0,
      lastError: null,
      nextAttemptAt: null,
      claimId: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  });
};

export const observeSyncQueue = (onChange: (summary: SyncQueueSummary) => void) => {
  const subscription = liveQuery(async () => summarizeSyncQueue(await localDb.syncQueue.toArray())).subscribe({
    next: onChange,
    error: () => onChange(emptySyncQueueSummary()),
  });

  return () => subscription.unsubscribe();
};

export const isMemoUpdateAlreadyApplied = (memo: MemoDetail, item: SyncQueueItem) => {
  if (memo.id !== item.memoId || memo.title !== item.payload.title) {
    return false;
  }

  const remoteTags = [...memo.tags].sort((left, right) => left.localeCompare(right));
  const queuedTags = [...item.payload.tags].sort((left, right) => left.localeCompare(right));
  return JSON.stringify(remoteTags) === JSON.stringify(queuedTags) &&
    JSON.stringify(memo.contentJson) === JSON.stringify(item.payload.contentJson);
};

let activeSyncPromise: Promise<SyncRunResult> | null = null;

export const syncQueuedChanges = (options: {
  onSynced?: (memo: MemoDetail) => void | Promise<void>;
} = {}): Promise<SyncRunResult> => {
  if (activeSyncPromise) {
    return activeSyncPromise;
  }

  activeSyncPromise = runQueuedChanges(options).finally(() => {
    activeSyncPromise = null;
  });

  return activeSyncPromise;
};

const runQueuedChanges = async (options: {
  onSynced?: (memo: MemoDetail) => void | Promise<void>;
}): Promise<SyncRunResult> => {
  const result: SyncRunResult = {
    attempted: 0,
    synced: 0,
    failed: 0,
    conflicted: 0,
  };

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return result;
  }

  const now = new Date();
  const items = (await localDb.syncQueue.where("status").anyOf("pending", "error").toArray())
    .filter((item) => !item.nextAttemptAt || new Date(item.nextAttemptAt) <= now)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

  for (const candidate of items) {
    const item = await claimQueueItem(candidate.id);
    if (!item) {
      continue;
    }

    result.attempted += 1;

    try {
      const memo = await syncQueueItem(item);
      const removed = await removeClaimedQueueItem(item);
      if (removed) {
        await localDb.drafts.delete(item.memoId);
        await options.onSynced?.(memo);
        result.synced += 1;
      }
    } catch (error) {
      const status = isRevisionConflict(error) ? "conflict" : "error";
      const attemptCount = item.attemptCount + 1;

      const updated = await updateClaimedQueueItem(item, {
        status,
        attemptCount,
        lastError: getErrorMessage(error),
        nextAttemptAt: status === "error" ? nextRetryAt(attemptCount) : null,
        claimId: null,
        updatedAt: new Date().toISOString(),
      });

      if (!updated) {
        continue;
      } else if (status === "conflict") {
        result.conflicted += 1;
      } else {
        result.failed += 1;
      }
    }
  }

  return result;
};

const claimQueueItem = (id: string) =>
  localDb.transaction("rw", localDb.syncQueue, async () => {
    const item = await localDb.syncQueue.get(id);
    if (!item || (item.status !== "pending" && item.status !== "error")) {
      return null;
    }

    const claimId = crypto.randomUUID();
    const claimedItem: SyncQueueItem = {
      ...item,
      status: "syncing",
      claimId,
      updatedAt: new Date().toISOString(),
    };
    await localDb.syncQueue.put(claimedItem);
    return claimedItem;
  });

const removeClaimedQueueItem = (item: SyncQueueItem) =>
  localDb.transaction("rw", localDb.syncQueue, async () => {
    const current = await localDb.syncQueue.get(item.id);
    if (!current || current.claimId !== item.claimId || current.status !== "syncing") {
      return false;
    }

    await localDb.syncQueue.delete(item.id);
    return true;
  });

const updateClaimedQueueItem = (item: SyncQueueItem, patch: Partial<SyncQueueItem>) =>
  localDb.transaction("rw", localDb.syncQueue, async () => {
    const current = await localDb.syncQueue.get(item.id);
    if (!current || current.claimId !== item.claimId || current.status !== "syncing") {
      return false;
    }

    await localDb.syncQueue.update(item.id, patch);
    return true;
  });

export const shouldQueueMemoSaveError = (error: unknown) => {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return true;
  }

  if (error instanceof ApiRequestError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }

  return error instanceof TypeError;
};

const syncQueueItem = async (item: SyncQueueItem): Promise<MemoDetail> => {
  if (item.kind !== "memo.update") {
    throw new Error(`Unsupported sync item kind: ${item.kind}`);
  }

  const { editSession } = await api.createMemoEditSession(item.memoId);
  if (
    editSession.baseRevision !== item.payload.expectedRevision ||
    editSession.baseContentHash !== item.payload.expectedContentHash
  ) {
    throw new ApiRequestError("Note changed before the offline draft could sync.", 409, "revision_conflict");
  }

  const data = await api.updateMemo(item.memoId, {
    expectedRevision: item.payload.expectedRevision,
    expectedContentHash: item.payload.expectedContentHash,
    editSessionId: editSession.id,
    title: item.payload.title,
    contentJson: item.payload.contentJson as TiptapDoc,
    contentMarkdown: item.payload.contentMarkdown,
    tags: item.payload.tags,
  });

  return data.memo;
};

const summarizeSyncQueue = (items: SyncQueueItem[]): SyncQueueSummary =>
  items.reduce(
    (summary, item) => {
      summary.total += 1;
      summary[item.status] += 1;
      return summary;
    },
    emptySyncQueueSummary()
  );

const isRevisionConflict = (error: unknown) =>
  error instanceof ApiRequestError && error.code === "revision_conflict";

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return "Sync failed";
};

const nextRetryAt = (attemptCount: number) => {
  const delayMs = Math.min(5 * 60_000, 2 ** Math.min(attemptCount, 6) * 1000);
  return new Date(Date.now() + delayMs).toISOString();
};
