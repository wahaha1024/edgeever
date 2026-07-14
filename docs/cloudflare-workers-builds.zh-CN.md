# Cloudflare Workers Builds 自动部署

EdgeEver 的日常发布统一使用 Cloudflare Workers Builds。每个 EdgeEver Worker 只需连接一次其仓库的 `main` 分支；之后任何推送（包括 GitHub 的 **Sync fork**）都会自动构建、迁移数据库并发布该实例。

官方实例和所有 Fork 使用完全相同的发布命令。本地 `bun run deploy` 仅用于首次安装和紧急修复。

## 为实例连接自动部署

先按[手动部署指南](manual-deploy.zh-CN.md)创建资源并完成首次部署，然后执行：

```sh
bun run deploy:builds:setup
```

该命令会读取 Fork 的 `origin` remote 与 `.env.local`，以幂等方式创建或更新仓库连接、生产触发器、构建命令、构建缓存、监听路径以及 Build Variables/Secrets。首次成功时还会自动构建一次 `main`，验证整条自动发布链路；后续重跑仅更新配置，不会再次触发构建。

### Cloudflare 的一次性授权

Cloudflare 有两项账号级授权，仓库脚本不能、也不应该绕过：

1. 为 Fork 安装并授权 **Cloudflare Workers & Pages** GitHub App。Agent 可以打开 Cloudflare 页面完成操作，用户只需确认 GitHub 授权。
2. 确保 Worker 已有可部署 Worker 且可执行 D1 migration 的 Workers Builds **build token**。若命令提示无法选择 token，请打开 **Worker** -> **Settings** -> **Builds** -> **API token**，创建/选择该 token，将其 UUID 填入 `.env.local` 的 `EDGE_EVER_BUILDS_BUILD_TOKEN_UUID`，然后重试命令。

配置 API 本身必须使用 **User API Token**，不能使用 **Account API Token**：Workers Builds Configuration API 仅接受 user-scoped token。请在 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 的 **My Profile** -> **API Tokens** 中创建，切勿进入 **Manage Account** -> **Account API Tokens**。它需要 **Workers Builds Configuration: Edit** 与 **Workers Scripts: Read** 权限。按以下步骤创建：

1. 打开 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)。
2. 点击 **Create Token** -> **Create Custom Token**。
3. 在 **Account** 权限中添加 `Workers Builds Configuration: Edit` 与 `Workers Scripts: Read`。
4. 将 token 限制为当前实例所属的 Cloudflare account，并设置合适的过期时间。
5. 创建后把值写入 `.env.local`：`EDGE_EVER_BUILDS_API_TOKEN=<token>`。

这个 token 仅供 `bun run deploy:builds:setup` 调用，不会上传到 Worker 或 Cloudflare Builds。只有在现有 `CLOUDFLARE_API_TOKEN` 同为 User API Token 且具备上述权限时，才可直接复用。

### 手动兜底

若不能运行命令，则在 Cloudflare Dashboard 中：

1. 打开 **Workers & Pages**，选择 EdgeEver Worker。
2. 打开 **Settings** -> **Builds** -> **Connect**。
3. 授权 GitHub，选择该实例对应的仓库，并选择 `main` 作为生产分支。
4. 设置以下命令：

   ```text
   Build command: bun install --frozen-lockfile && bun run build:cloudflare
   Deploy command: bun run deploy:cloudflare-builds
   ```

5. 在 **Settings** -> **Builds** -> **Build variables and secrets** 中，填入初次部署时 `.env.local` 的实例配置；`EDGE_EVER_AUTH_PASSWORD_HASH` 必须保存为 Secret。

Dashboard 中选中的 Worker 必须与 `EDGE_EVER_WORKER_NAME` 对应。部署命令会根据这些变量生成临时 Wrangler 配置，因此严禁把 D1 ID、R2 bucket、路由或密码 hash 提交进仓库。

## 必需的构建变量

从初次部署产生的 `.env.local` 复制适用的 `EDGE_EVER_*` 变量：

```text
EDGE_EVER_WORKER_NAME
EDGE_EVER_WORKERS_DEV
EDGE_EVER_D1_DATABASE_NAME
EDGE_EVER_D1_DATABASE_ID
EDGE_EVER_R2_BUCKET_NAME
EDGE_EVER_R2_PREVIEW_BUCKET_NAME
EDGE_EVER_AUTH_USERNAME
EDGE_EVER_AUTH_PASSWORD_HASH          # Build Secret
EDGE_EVER_SESSION_TTL_DAYS
EDGE_EVER_DEMO_MODE                   # 可选
EDGE_EVER_DEMO_RESET_CRON             # 可选
EDGE_EVER_CUSTOM_DOMAIN               # 可选
EDGE_EVER_ROUTE_PATTERN               # 可选
```

多实例场景则设置 `EDGE_EVER_INSTANCE`，并使用 `EDGE_EVER_PROD_D1_DATABASE_ID` 之类的带实例前缀变量。本地部署和 Workers Builds 使用相同的变量解析规则。

Workers Builds 使用的 API Token 必须拥有 Worker 发布、R2 binding 更新和 D1 migration 所需权限。如果 Cloudflare 自动创建的 Builds token 没有 D1 编辑权限，请选择或新建一个具备该权限的 token。

## 每次推送的执行顺序

```text
bun install --frozen-lockfile
-> bun run typecheck
-> bun run build
-> bun run db:migrate:remote
-> wrangler deploy
```

`wrangler d1 migrations apply` 会在 D1 中记录已完成的 SQL migration。因此每个实例只会在发布对应 Worker 版本之前执行新增加的 migration。

## 更新 Fork

1. 在 GitHub 的 Fork 页面点击 **Sync fork**，将上游更新合入 fork 的 `main`。
2. Cloudflare Workers Builds 检测到 push 后自动执行上述流程。
3. 若失败，可在 Worker 的 **Deployments** 页面查看 build log。

首次连接完成后，不再需要 GitHub Actions Secrets，也不需要本地重新部署。

## 额度

Workers Free 目前每月包含 3,000 分钟 Workers Builds，并且每个账号同时执行一个构建。最新限制请参考 [Cloudflare Workers Builds 限额与价格](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)。
