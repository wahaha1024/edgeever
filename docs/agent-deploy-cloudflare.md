# AI Agent Cloudflare Deployment

This document is the deployment contract for AI agents. If a user asks an agent to deploy EdgeEver from a GitHub URL to Cloudflare, follow this runbook before asking the user for anything.

## Agent Rules

- Treat deployment as two required phases: use `bun run deploy:setup`, `bun run deploy:doctor`, and `bun run deploy` only for the initial installation; then run `bun run deploy:builds:setup` so all routine updates use Cloudflare Workers Builds.
- Do not hard-code a personal Worker name, D1 database ID, R2 bucket name, account ID, API token, or domain in source files.
- Use `.env.local` for local/private deployment values. It is git-ignored.
- If the Cloudflare MCP or Cloudflare plugin is available, it may be used to inspect or create resources. If not, use Wrangler through the scripts in this repo.
- Ask the user only for values that cannot be inferred or generated safely, such as Cloudflare authorization or custom domain ownership. The default first-login credentials are `admin` / `admin123`, so a custom password is optional.

## Standard Flow

1. Clone the repository and enter it.

   ```sh
   git clone <repo-url>
   cd edgeever
   ```

2. Install dependencies.

   ```sh
   bun install
   ```

3. Ensure Cloudflare authentication.

   ```sh
   bunx wrangler whoami
   ```

   If this fails, ask the user to finish Cloudflare login or provide a suitable API token. Do not continue deployment until this works.

4. Prepare deployment resources and `.env.local`.

   ```sh
   bun run deploy:setup
   ```

   This uses `admin` / `admin123`. If the user explicitly provided another plaintext password, use:

   ```sh
   EDGE_EVER_PASSWORD='<first-login-password>' bun run deploy:setup
   ```

5. Check the deployment inputs.

   ```sh
   bun run deploy:doctor
   ```

   Fix every `fail` result before deploying.

6. Deploy.

   ```sh
   bun run deploy
   ```

   This builds the web app, applies remote D1 migrations, deploys the Worker, and uploads `EDGE_EVER_AUTH_PASSWORD` as a Worker Secret. Existing `EDGE_EVER_AUTH_PASSWORD_HASH` configurations remain supported and take precedence when both exist.

7. Verify the result.

   Use the Worker URL from Wrangler output, then check:

   ```sh
   curl -I https://<worker-url>/
   curl https://<worker-url>/api/openapi.json
   ```

   Open the site and log in with the configured credentials (`admin` / `admin123` by default). Then create an MCP token from the in-app MCP settings.

8. Connect Cloudflare Workers Builds.

   ```sh
   bun run deploy:builds:setup
   ```

   Follow [Cloudflare Workers Builds](cloudflare-workers-builds.md) for any GitHub authorization, User API Token, or build-token prompt. Complete browser authorization when possible. Do not add a GitHub Actions Worker deployment.

## Blocking Conditions

Stop and ask the user only when:

- Cloudflare authentication is missing and the agent cannot open or complete login.
- The requested custom domain is not available in the Cloudflare account.
- Resource creation fails because of account limits, permissions, billing, or conflicting names that cannot be resolved by choosing a new name.

## Final User Response

After deployment, report:

- deployed URL
- login username
- whether the default password or a user-provided override was used
- where to create the EdgeEver MCP token in the app
- confirmation that Workers Builds is connected and that future `main` pushes automatically migrate and deploy
- any custom domain or Cloudflare DNS step that remains
