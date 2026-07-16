export const STANDALONE_MOBILE_EDITOR_PATH = "/mobile-edit.html";
export const MOBILE_EDITOR_RETURN_PARAM = "mobileEditorReturn";
const STANDALONE_MOBILE_EDITOR_MEMO_KEY = "edgeever-standalone-mobile-editor-memo-id";
const STANDALONE_MOBILE_EDITOR_RETURN_KEY = "edgeever-standalone-mobile-editor-return-memo-id";
const STANDALONE_MOBILE_EDITOR_RETURN_PREVIEW_KEY = "edgeever-standalone-mobile-editor-return-preview";

export type MobileEditorReturnPreview = {
  memoId: string;
  baseRevision: number;
  title: string | null;
  excerpt: string;
  tags: string[];
  updatedAt: string;
};

export const getStandaloneMobileEditorReturnPath = (memoId: string) => {
  const params = new URLSearchParams({
    [MOBILE_EDITOR_RETURN_PARAM]: memoId,
  });

  return `/?${params.toString()}`;
};

export const getStandaloneMobileEditorHref = (memoId: string, returnTo = getStandaloneMobileEditorReturnPath(memoId)) => {
  const params = new URLSearchParams({
    memoId,
    returnTo,
  });
  return `${STANDALONE_MOBILE_EDITOR_PATH}#${params.toString()}`;
};

export const openStandaloneMobileEditor = (memoId: string, returnTo = getStandaloneMobileEditorReturnPath(memoId)) => {
  markStandaloneMobileEditorOpened(memoId);
  window.location.href = getStandaloneMobileEditorHref(memoId, returnTo);
};

export const markStandaloneMobileEditorOpened = (memoId: string) => {
  sessionStorage.setItem(STANDALONE_MOBILE_EDITOR_MEMO_KEY, memoId);
  sessionStorage.removeItem(STANDALONE_MOBILE_EDITOR_RETURN_KEY);
  sessionStorage.removeItem(STANDALONE_MOBILE_EDITOR_RETURN_PREVIEW_KEY);
};

export const markStandaloneMobileEditorReturning = (memoId: string | null) => {
  if (!memoId) {
    return;
  }

  sessionStorage.setItem(STANDALONE_MOBILE_EDITOR_RETURN_KEY, memoId);
};

export const getStandaloneMobileEditorReturningMemoId = () =>
  sessionStorage.getItem(STANDALONE_MOBILE_EDITOR_RETURN_KEY);

export const writeMobileEditorReturnPreview = (preview: MobileEditorReturnPreview) => {
  sessionStorage.setItem(STANDALONE_MOBILE_EDITOR_RETURN_PREVIEW_KEY, JSON.stringify(preview));
};

export const readMobileEditorReturnPreview = (memoId: string | null): MobileEditorReturnPreview | null => {
  if (!memoId) {
    return null;
  }

  try {
    const raw = sessionStorage.getItem(STANDALONE_MOBILE_EDITOR_RETURN_PREVIEW_KEY);
    const preview = raw ? (JSON.parse(raw) as Partial<MobileEditorReturnPreview>) : null;

    if (
      preview?.memoId !== memoId ||
      typeof preview.baseRevision !== "number" ||
      typeof preview.excerpt !== "string" ||
      !Array.isArray(preview.tags) ||
      typeof preview.updatedAt !== "string"
    ) {
      return null;
    }

    return {
      memoId: preview.memoId,
      baseRevision: preview.baseRevision,
      title: typeof preview.title === "string" ? preview.title : null,
      excerpt: preview.excerpt,
      tags: preview.tags.filter((tag): tag is string => typeof tag === "string"),
      updatedAt: preview.updatedAt,
    };
  } catch {
    return null;
  }
};

export const clearMobileEditorReturnPreview = (memoId: string | null) => {
  const preview = readMobileEditorReturnPreview(memoId);
  if (preview) {
    sessionStorage.removeItem(STANDALONE_MOBILE_EDITOR_RETURN_PREVIEW_KEY);
  }
};

export const consumeStandaloneMobileEditorReturn = (memoId: string | null) => {
  if (!memoId) {
    return false;
  }

  const returningMemoId = sessionStorage.getItem(STANDALONE_MOBILE_EDITOR_RETURN_KEY);
  const matched = returningMemoId === memoId;

  if (matched) {
    sessionStorage.removeItem(STANDALONE_MOBILE_EDITOR_RETURN_KEY);
    sessionStorage.removeItem(STANDALONE_MOBILE_EDITOR_MEMO_KEY);
  }

  return matched;
};
