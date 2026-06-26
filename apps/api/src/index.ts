import {
  createExcerpt,
  docToMarkdown,
  docToText,
  emptyDoc,
  LoginSchema,
  markdownToDoc,
  MemoCreateSchema,
  MemoUpdateSchema,
  MergeMemosSchema,
  normalizeTags,
  NotebookCreateSchema,
  NotebookUpdateSchema,
  type MemoDetail,
  type MemoSummary,
  type Notebook,
  type TiptapDoc,
} from "@edgeever/shared";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";

type Bindings = {
  DB: D1Database;
  RESOURCES: R2Bucket;
  EDGE_EVER_AUTH_USERNAME?: string;
  EDGE_EVER_AUTH_PASSWORD_HASH?: string;
  EDGE_EVER_SESSION_TTL_DAYS?: string;
};

type AuthContext = {
  kind: "user" | "agent";
  actorType: "user" | "agent";
  actorId: string | null;
  username: string;
  displayName: string | null;
  sessionId?: string;
  tokenId?: string;
};

type NotebookRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type MemoSummaryRow = {
  id: string;
  notebook_id: string;
  title: string | null;
  excerpt: string;
  tags_json: string;
  is_pinned: number;
  is_archived: number;
  created_at: string;
  updated_at: string;
  revision: number;
};

type MemoDetailRow = MemoSummaryRow & {
  content_json: string;
  content_markdown: string;
  content_text: string;
  source_memo_ids: string;
  merge_source_count: number;
  merged_into_memo_id: string | null;
  content_hash: string;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string | null;
  is_disabled: number;
};

type SessionRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  expires_at: string;
};

type ApiTokenRow = {
  id: string;
  name: string;
  scopes_json: string;
  expires_at: string | null;
};

type AppContext = Context<{ Bindings: Bindings; Variables: { auth: AuthContext } }>;

const SESSION_COOKIE = "edgeever_session";
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";
const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const SESSION_TOKEN_BYTES = 32;
const DEFAULT_SESSION_TTL_DAYS = 30;

const app = new Hono<{ Bindings: Bindings; Variables: { auth: AuthContext } }>();

app.use(
  "/api/*",
  cors({
    origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    name: "edgeever",
    runtime: "cloudflare-workers",
  })
);

app.get("/api/v1/auth/session", async (c) => {
  const authRequired = await isAuthRequired(c.env);

  if (!authRequired) {
    return c.json({
      authRequired: false,
      authenticated: true,
      user: {
        id: "local",
        username: "owner",
        displayName: "Owner",
      },
    });
  }

  const auth = await authenticateRequest(c, false);

  return c.json({
    authRequired: true,
    authenticated: Boolean(auth && auth.kind === "user"),
    user:
      auth && auth.kind === "user"
        ? {
            id: auth.actorId,
            username: auth.username,
            displayName: auth.displayName,
          }
        : null,
  });
});

app.post("/api/v1/auth/login", zValidator("json", LoginSchema), async (c) => {
  const input = c.req.valid("json");
  const user = await verifyLogin(c.env, input.username, input.password);

  if (!user) {
    return unauthorized(c, "Username or password is incorrect.");
  }

  const session = await createSession(c, user);
  setSessionCookie(c, session.token, session.maxAge);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?`).bind(
      isoNow(),
      isoNow(),
      user.id
    ),
    auditStatement(c.env.DB, "user", user.id, "auth.login", "session", session.id, {
      username: user.username,
    }),
  ]);

  return c.json({
    authRequired: true,
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
  });
});

app.post("/api/v1/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);

  if (token) {
    await revokeSession(c.env.DB, token);
  }

  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.use("/api/v1/*", async (c, next) => {
  if (c.req.path.startsWith("/api/v1/auth/")) {
    await next();
    return;
  }

  const authRequired = await isAuthRequired(c.env);

  if (!authRequired) {
    c.set("auth", {
      kind: "user",
      actorType: "user",
      actorId: null,
      username: "owner",
      displayName: "Owner",
    });
    await next();
    return;
  }

  const auth = await authenticateRequest(c, true);

  if (!auth) {
    return unauthorized(c, "Authentication required.");
  }

  c.set("auth", auth);
  await next();
});

app.get("/api/v1/notebooks", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at
     FROM notebooks
     WHERE is_deleted = 0
     ORDER BY parent_id IS NOT NULL, sort_order ASC, name ASC`
  ).all<NotebookRow>();

  return c.json({ notebooks: rows.results.map(mapNotebook) });
});

app.post("/api/v1/notebooks", zValidator("json", NotebookCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const id = createId("nb");
  const now = isoNow();

  await c.env.DB.prepare(
    `INSERT INTO notebooks (id, parent_id, name, slug, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, input.parentId ?? null, input.name, slugify(input.name), Date.now(), now, now)
    .run();

  const notebook = await getNotebook(c.env.DB, id);
  await audit(c.env.DB, actor.actorType, actor.actorId, "notebook.create", "notebook", id, { name: input.name });

  return c.json({ notebook }, 201);
});

app.patch("/api/v1/notebooks/:id", zValidator("json", NotebookUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const current = await getNotebook(c.env.DB, id);

  if (!current) {
    return notFound(c, "Notebook not found");
  }

  const nextName = input.name ?? current.name;
  const nextParentId = input.parentId === undefined ? current.parentId : input.parentId;
  const nextSortOrder = input.sortOrder ?? current.sortOrder;
  const now = isoNow();

  await c.env.DB.prepare(
    `UPDATE notebooks
     SET name = ?, slug = ?, parent_id = ?, sort_order = ?, updated_at = ?
     WHERE id = ? AND is_deleted = 0`
  )
    .bind(nextName, slugify(nextName), nextParentId ?? null, nextSortOrder, now, id)
    .run();

  await audit(c.env.DB, actor.actorType, actor.actorId, "notebook.update", "notebook", id, input);
  return c.json({ notebook: await getNotebook(c.env.DB, id) });
});

app.delete("/api/v1/notebooks/:id", async (c) => {
  const id = c.req.param("id");
  const actor = getAuditActor(c);
  const now = isoNow();

  await c.env.DB.prepare(
    `UPDATE notebooks
     SET is_deleted = 1, deleted_at = ?, updated_at = ?
     WHERE id = ? AND id <> 'nb_inbox'`
  )
    .bind(now, now, id)
    .run();

  await audit(c.env.DB, actor.actorType, actor.actorId, "notebook.delete", "notebook", id, {});
  return c.json({ ok: true });
});

app.get("/api/v1/memos", async (c) => {
  const notebookId = c.req.query("notebookId");
  const q = c.req.query("q")?.trim();
  const limit = clampNumber(Number(c.req.query("limit") ?? 80), 1, 100);

  if (q) {
    const ftsQuery = toFtsQuery(q);

    if (ftsQuery) {
      const rows = await c.env.DB.prepare(
        `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
                m.is_archived, m.created_at, m.updated_at, c.revision
         FROM memos_fts f
         INNER JOIN memos m ON m.id = f.memo_id
         INNER JOIN memo_contents c ON c.memo_id = m.id
         WHERE memos_fts MATCH ?
           AND m.is_deleted = 0
           AND (? IS NULL OR m.notebook_id = ?)
         ORDER BY m.is_pinned DESC, m.updated_at DESC
         LIMIT ?`
      )
        .bind(ftsQuery, notebookId ?? null, notebookId ?? null, limit)
        .all<MemoSummaryRow>();

      return c.json({ memos: rows.results.map(mapMemoSummary) });
    }
  }

  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.created_at, m.updated_at, c.revision
     FROM memos m
     INNER JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.is_deleted = 0
       AND (? IS NULL OR m.notebook_id = ?)
     ORDER BY m.is_pinned DESC, m.updated_at DESC
     LIMIT ?`
  )
    .bind(notebookId ?? null, notebookId ?? null, limit)
    .all<MemoSummaryRow>();

  return c.json({ memos: rows.results.map(mapMemoSummary) });
});

app.post("/api/v1/memos", zValidator("json", MemoCreateSchema), async (c) => {
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const tags = normalizeTags(input.tags);
  const contentMarkdown = input.contentMarkdown ?? "";
  const contentJson = markdownToDoc(contentMarkdown);
  const contentText = docToText(contentJson);
  const title = input.title || deriveTitle(contentText);
  const excerpt = createExcerpt(contentText || title || "");
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const id = createId("memo");
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memos (
        id, notebook_id, title, excerpt, tags_json, created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, input.notebookId, title, excerpt, JSON.stringify(tags), actorLabel, actorLabel, now, now),
    c.env.DB.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(id, JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, now, now),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.create", "memo", id, {
      notebookId: input.notebookId,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) }, 201);
});

app.get("/api/v1/memos/:id", async (c) => {
  const memo = await getMemoDetail(c.env.DB, c.req.param("id"));

  if (!memo) {
    return notFound(c, "Memo not found");
  }

  return c.json({ memo });
});

app.patch("/api/v1/memos/:id", zValidator("json", MemoUpdateSchema), async (c) => {
  const id = c.req.param("id");
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const current = await getMemoDetailRow(c.env.DB, id);

  if (!current) {
    return notFound(c, "Memo not found");
  }

  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return c.json(
      {
        error: {
          code: "revision_conflict",
          message: "Memo was updated elsewhere. Reload before saving.",
          details: {
            expectedRevision: input.expectedRevision,
            currentRevision: current.revision,
          },
        },
      },
      409
    );
  }

  const currentContentJson = JSON.parse(current.content_json) as TiptapDoc;
  const contentJson = input.contentJson
    ? (input.contentJson as TiptapDoc)
    : input.contentMarkdown !== undefined
      ? markdownToDoc(input.contentMarkdown)
      : currentContentJson;
  const contentMarkdown =
    input.contentMarkdown !== undefined ? input.contentMarkdown : docToMarkdown(contentJson);
  const contentText = docToText(contentJson);
  const title = input.title ?? current.title ?? deriveTitle(contentText);
  const tags = input.tags === undefined ? parseJsonArray(current.tags_json) : normalizeTags(input.tags);
  const excerpt = createExcerpt(contentText || title || "");
  const notebookId = input.notebookId ?? current.notebook_id;
  const nextRevision = current.revision + 1;
  const contentHash = await sha256(contentMarkdown + JSON.stringify(contentJson));
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memo_revisions (
        id, memo_id, revision, title, content_json, content_markdown, content_hash, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      createId("rev"),
      id,
      current.revision,
      current.title,
      current.content_json,
      current.content_markdown,
      current.content_hash,
      actorLabel,
      now
    ),
    c.env.DB.prepare(
      `UPDATE memos
       SET notebook_id = ?, title = ?, excerpt = ?, tags_json = ?, updated_by = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(notebookId, title, excerpt, JSON.stringify(tags), actorLabel, now, id),
    c.env.DB.prepare(
      `UPDATE memo_contents
       SET content_json = ?, content_markdown = ?, content_text = ?, content_hash = ?,
           revision = ?, updated_at = ?
       WHERE memo_id = ?`
    ).bind(JSON.stringify(contentJson), contentMarkdown, contentText, contentHash, nextRevision, now, id),
    c.env.DB.prepare(`DELETE FROM memos_fts WHERE memo_id = ?`).bind(id),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(id, title, contentText, tags.join(" ")),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.update", "memo", id, {
      revision: nextRevision,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, id) });
});

app.delete("/api/v1/memos/:id", async (c) => {
  const id = c.req.param("id");
  const actor = getAuditActor(c);
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, updated_at = ?
       WHERE id = ? AND is_deleted = 0`
    ).bind(now, now, id),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.delete", "memo", id, {}),
  ]);

  return c.json({ ok: true });
});

app.post("/api/v1/memos/merge", zValidator("json", MergeMemosSchema), async (c) => {
  const input = c.req.valid("json");
  const actor = getAuditActor(c);
  const actorLabel = getActorLabel(c);
  const uniqueMemoIds = Array.from(new Set(input.memoIds));
  const placeholders = uniqueMemoIds.map(() => "?").join(", ");
  const rows = await c.env.DB.prepare(
    `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
            m.is_archived, m.created_at, m.updated_at, c.revision,
            c.content_json, c.content_markdown, c.content_text, c.content_hash,
            m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
     FROM memos m
     INNER JOIN memo_contents c ON c.memo_id = m.id
     WHERE m.is_deleted = 0 AND m.id IN (${placeholders})`
  )
    .bind(...uniqueMemoIds)
    .all<MemoDetailRow>();

  if (rows.results.length !== uniqueMemoIds.length) {
    return c.json(
      {
        error: {
          code: "missing_memos",
          message: "One or more memos cannot be merged.",
        },
      },
      400
    );
  }

  const ordered = uniqueMemoIds
    .map((memoId) => rows.results.find((row) => row.id === memoId))
    .filter((row): row is MemoDetailRow => Boolean(row));
  const notebookId = input.notebookId ?? ordered[0].notebook_id;
  const title = input.title || `合并笔记 ${new Date().toLocaleDateString("zh-CN")}`;
  const mergedMarkdown = ordered.map((memo) => memo.content_markdown).join("\n\n---\n\n");
  const contentJson = markdownToDoc(mergedMarkdown);
  const contentText = docToText(contentJson);
  const tags = Array.from(new Set(ordered.flatMap((memo) => parseJsonArray(memo.tags_json))));
  const excerpt = createExcerpt(contentText || title);
  const contentHash = await sha256(mergedMarkdown + JSON.stringify(contentJson));
  const newMemoId = createId("memo");
  const now = isoNow();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO memos (
        id, notebook_id, title, excerpt, tags_json, source_memo_ids, merge_source_count,
        created_by, updated_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      newMemoId,
      notebookId,
      title,
      excerpt,
      JSON.stringify(tags),
      JSON.stringify(uniqueMemoIds),
      uniqueMemoIds.length,
      actorLabel,
      actorLabel,
      now,
      now
    ),
    c.env.DB.prepare(
      `INSERT INTO memo_contents (
        memo_id, content_json, content_markdown, content_text, content_hash, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
    ).bind(newMemoId, JSON.stringify(contentJson), mergedMarkdown, contentText, contentHash, now, now),
    c.env.DB.prepare(
      `INSERT INTO memos_fts (memo_id, title, content_text, tags)
       VALUES (?, ?, ?, ?)`
    ).bind(newMemoId, title, contentText, tags.join(" ")),
    c.env.DB.prepare(
      `UPDATE memos
       SET is_deleted = 1, deleted_at = ?, merged_into_memo_id = ?, merged_at = ?, updated_at = ?
       WHERE id IN (${placeholders})`
    ).bind(now, newMemoId, now, now, ...uniqueMemoIds),
    c.env.DB.prepare(
      `UPDATE resources
       SET original_memo_id = COALESCE(original_memo_id, memo_id),
           memo_id = ?,
           updated_at = ?
       WHERE memo_id IN (${placeholders})`
    ).bind(newMemoId, now, ...uniqueMemoIds),
    auditStatement(c.env.DB, actor.actorType, actor.actorId, "memo.merge", "memo", newMemoId, {
      sourceMemoIds: uniqueMemoIds,
    }),
  ]);

  return c.json({ memo: await getMemoDetail(c.env.DB, newMemoId) }, 201);
});

app.all("/mcp", (c) =>
  c.json({
    name: "EdgeEver MCP endpoint",
    status: "planned",
    message: "Remote MCP will be wired to the same memo and notebook services as the REST API.",
    restBasePath: "/api/v1",
  })
);

app.notFound((c) =>
  c.json(
    {
      error: {
        code: "not_found",
        message: "Route not found",
      },
    },
    404
  )
);

export default app;

const isAuthRequired = async (env: Bindings) => {
  if (env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim()) {
    return true;
  }

  const user = await env.DB.prepare(`SELECT id FROM users WHERE is_disabled = 0 LIMIT 1`).first<{ id: string }>();
  return Boolean(user);
};

const verifyLogin = async (env: Bindings, username: string, password: string): Promise<UserRow | null> => {
  const normalizedUsername = username.trim();
  const existingUser = await getUserByUsername(env.DB, normalizedUsername);

  if (existingUser) {
    return (await verifyPassword(password, existingUser.password_hash)) ? existingUser : null;
  }

  const configuredHash = env.EDGE_EVER_AUTH_PASSWORD_HASH?.trim();

  if (!configuredHash) {
    return null;
  }

  const configuredUsername = env.EDGE_EVER_AUTH_USERNAME?.trim() || "admin";

  if (normalizedUsername !== configuredUsername || !(await verifyPassword(password, configuredHash))) {
    return null;
  }

  const now = isoNow();
  const userId = createId("usr");
  const passwordHash = await hashPassword(password);

  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, username, password_hash, display_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, normalizedUsername, passwordHash, normalizedUsername, now, now)
    .run();

  return getUserByUsername(env.DB, normalizedUsername);
};

const getUserByUsername = async (db: D1Database, username: string) =>
  db
    .prepare(
      `SELECT id, username, password_hash, display_name, is_disabled
       FROM users
       WHERE username = ? AND is_disabled = 0`
    )
    .bind(username)
    .first<UserRow>();

const createSession = async (c: AppContext, user: UserRow) => {
  const token = randomToken(SESSION_TOKEN_BYTES);
  const id = createId("sess");
  const now = isoNow();
  const maxAge = getSessionMaxAge(c.env);
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();
  const ip = c.req.header("CF-Connecting-IP");
  const ipHash = ip ? await sha256(ip) : null;

  await c.env.DB.prepare(
    `INSERT INTO sessions (
      id, user_id, token_hash, user_agent, ip_hash, expires_at, created_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      user.id,
      await sha256(token),
      c.req.header("User-Agent") ?? null,
      ipHash,
      expiresAt,
      now,
      now
    )
    .run();

  return { id, token, maxAge };
};

const setSessionCookie = (c: AppContext, token: string, maxAge: number) => {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge,
  });
};

const revokeSession = async (db: D1Database, token: string) => {
  await db
    .prepare(`UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`)
    .bind(isoNow(), await sha256(token))
    .run();
};

const authenticateRequest = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const bearerAuth = await authenticateBearerToken(c, touch);

  if (bearerAuth) {
    return bearerAuth;
  }

  return authenticateSession(c, touch);
};

const authenticateBearerToken = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getBearerToken(c);

  if (!token) {
    return null;
  }

  const row = await c.env.DB.prepare(
    `SELECT id, name, scopes_json, expires_at
     FROM api_tokens
     WHERE token_hash = ?
       AND is_revoked = 0
       AND (expires_at IS NULL OR expires_at > ?)`
  )
    .bind(await sha256(token), isoNow())
    .first<ApiTokenRow>();

  if (!row) {
    return null;
  }

  if (touch) {
    await c.env.DB.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  return {
    kind: "agent",
    actorType: "agent",
    actorId: row.id,
    username: row.name,
    displayName: row.name,
    tokenId: row.id,
  };
};

const authenticateSession = async (c: AppContext, touch: boolean): Promise<AuthContext | null> => {
  const token = getCookie(c, SESSION_COOKIE);

  if (!token) {
    return null;
  }

  const row = await c.env.DB.prepare(
    `SELECT s.id, s.user_id, u.username, u.display_name, s.expires_at
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.revoked_at IS NULL
       AND s.expires_at > ?
       AND u.is_disabled = 0`
  )
    .bind(await sha256(token), isoNow())
    .first<SessionRow>();

  if (!row) {
    return null;
  }

  if (touch) {
    await c.env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).bind(isoNow(), row.id).run();
  }

  return {
    kind: "user",
    actorType: "user",
    actorId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    sessionId: row.id,
  };
};

const getBearerToken = (c: AppContext) => {
  const authorization = c.req.header("Authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);
  return scheme.toLowerCase() === "bearer" && token ? token : null;
};

const getAuditActor = (c: AppContext) => {
  const auth = c.get("auth");

  return {
    actorType: auth?.actorType ?? "user",
    actorId: auth?.actorId ?? null,
  };
};

const getActorLabel = (c: AppContext) => {
  const auth = c.get("auth");
  return auth?.actorId ? `${auth.actorType}:${auth.actorId}` : auth?.username ?? "user";
};

const getSessionMaxAge = (env: Bindings) => {
  const days = clampNumber(Number(env.EDGE_EVER_SESSION_TTL_DAYS ?? DEFAULT_SESSION_TTL_DAYS), 1, 90);
  return days * 24 * 60 * 60;
};

const hashPassword = async (password: string) => {
  const salt = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
  const hash = await derivePasswordHash(password, salt, PASSWORD_HASH_ITERATIONS);

  return [
    PASSWORD_HASH_ALGORITHM,
    PASSWORD_HASH_ITERATIONS,
    base64UrlEncode(salt),
    base64UrlEncode(hash),
  ].join("$");
};

const verifyPassword = async (password: string, passwordHash: string) => {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = passwordHash.split("$");
  const iterations = Number(iterationsRaw);

  if (
    algorithm !== PASSWORD_HASH_ALGORITHM ||
    !Number.isInteger(iterations) ||
    iterations < 100_000 ||
    !saltRaw ||
    !hashRaw
  ) {
    return false;
  }

  try {
    const expected = base64UrlDecode(hashRaw);
    const salt = base64UrlDecode(saltRaw);
    const actual = await derivePasswordHash(password, salt, iterations);

    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};

const derivePasswordHash = async (password: string, salt: Uint8Array, iterations: number) => {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const saltBuffer = salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer;
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: saltBuffer,
      iterations,
    },
    key,
    PASSWORD_HASH_BYTES * 8
  );

  return new Uint8Array(bits);
};

const randomToken = (bytes: number) => {
  const token = crypto.getRandomValues(new Uint8Array(bytes));
  return base64UrlEncode(token);
};

const base64UrlEncode = (bytes: Uint8Array) => {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (left[index % left.length] ?? 0) ^ (right[index % right.length] ?? 0);
  }

  return diff === 0;
};

const mapNotebook = (row: NotebookRow): Notebook => ({
  id: row.id,
  parentId: row.parent_id,
  name: row.name,
  slug: row.slug,
  icon: row.icon,
  color: row.color,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemoSummary = (row: MemoSummaryRow): MemoSummary => ({
  id: row.id,
  notebookId: row.notebook_id,
  title: row.title,
  excerpt: row.excerpt,
  tags: parseJsonArray(row.tags_json),
  isPinned: Boolean(row.is_pinned),
  isArchived: Boolean(row.is_archived),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapMemoDetail = (row: MemoDetailRow): MemoDetail => ({
  ...mapMemoSummary(row),
  contentJson: parseDoc(row.content_json),
  contentMarkdown: row.content_markdown,
  contentText: row.content_text,
  sourceMemoIds: parseJsonArray(row.source_memo_ids),
  mergeSourceCount: row.merge_source_count,
  mergedIntoMemoId: row.merged_into_memo_id,
});

const getNotebook = async (db: D1Database, id: string): Promise<Notebook | null> => {
  const row = await db
    .prepare(
      `SELECT id, parent_id, name, slug, icon, color, sort_order, created_at, updated_at
       FROM notebooks
       WHERE id = ? AND is_deleted = 0`
    )
    .bind(id)
    .first<NotebookRow>();

  return row ? mapNotebook(row) : null;
};

const getMemoDetailRow = async (db: D1Database, id: string): Promise<MemoDetailRow | null> =>
  db
    .prepare(
      `SELECT m.id, m.notebook_id, m.title, m.excerpt, m.tags_json, m.is_pinned,
              m.is_archived, m.created_at, m.updated_at, c.revision,
              c.content_json, c.content_markdown, c.content_text, c.content_hash,
              m.source_memo_ids, m.merge_source_count, m.merged_into_memo_id
       FROM memos m
       INNER JOIN memo_contents c ON c.memo_id = m.id
       WHERE m.id = ? AND m.is_deleted = 0`
    )
    .bind(id)
    .first<MemoDetailRow>();

const getMemoDetail = async (db: D1Database, id: string): Promise<MemoDetail | null> => {
  const row = await getMemoDetailRow(db, id);
  return row ? mapMemoDetail(row) : null;
};

const parseJsonArray = (json: string): string[] => {
  try {
    const value = JSON.parse(json);
    return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const parseDoc = (json: string): TiptapDoc => {
  try {
    const value = JSON.parse(json);
    return value && typeof value === "object" ? (value as TiptapDoc) : emptyDoc();
  } catch {
    return emptyDoc();
  }
};

const audit = async (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) => auditStatement(db, actorType, actorId, action, entityType, entityId, metadata).run();

const auditStatement = (
  db: D1Database,
  actorType: "user" | "agent" | "system",
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: unknown
) =>
  db
    .prepare(
      `INSERT INTO audit_events (
        id, actor_type, actor_id, action, entity_type, entity_id, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(createId("audit"), actorType, actorId, action, entityType, entityId, JSON.stringify(metadata ?? {}), isoNow());

const createId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;

const isoNow = () => new Date().toISOString();

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const deriveTitle = (text: string) => {
  const title = text.trim().split(/\s+/).slice(0, 10).join(" ");
  return title || "Untitled memo";
};

const clampNumber = (value: number, min: number, max: number) => {
  if (Number.isNaN(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
};

const toFtsQuery = (value: string) => {
  const tokens = value.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return tokens.slice(0, 8).join(" ");
};

const sha256 = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

const notFound = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "not_found",
        message,
      },
    },
    404
  );

const unauthorized = (c: Context, message: string) =>
  c.json(
    {
      error: {
        code: "unauthorized",
        message,
      },
    },
    401
  );
