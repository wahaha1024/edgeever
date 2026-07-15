# Cloudflare Manual Deployment Guide

If you are comfortable with Cloudflare and the command line, or prefer customized control over first installation and resource setup, follow this guide for manual deployment. Cloudflare Workers Builds handles routine updates; local deployment is only for first installation and emergency recovery.

> 💡 **Tip**: If you are deploying using an AI assistant (such as Claude Code, Codex, Antigravity, Cursor, or Trae), the agent should follow the [AI Agent Cloudflare Deployment](https://github.com/tianma-if/edgeever/blob/main/docs/agent-deploy-cloudflare.md) runbook.

## Deployment Steps

1. **Fork the official repository**:
   Visit and fork the official repository: [https://github.com/tianma-if/edgeever](https://github.com/tianma-if/edgeever)

2. **Clone your fork**:
   ```sh
   git clone <your fork repository URL>
   cd edgeever
   ```

3. **Deploy with the automated helper commands**:
   ```sh
   # Copy the configuration template
   cp .env.local.example .env.local

   # Install dependencies
   bun install

   # Initialize deployment resources with the default admin / admin123 login
   bun run deploy:setup

   # Check the deployment environment and configurations
   bun run deploy:doctor

   # Deploy to Cloudflare
   bun run deploy
   ```

   To use a custom first-login password, run `EDGE_EVER_PASSWORD='<your password>' bun run deploy:setup` instead. You can also change the password later in Personal Settings.

### Creating Cloudflare Resources Manually

If you prefer not to use the automated `deploy:setup` helper, you can create the resources manually using Cloudflare CLI (Wrangler):

```sh
# Copy configuration template and install dependencies
cp .env.local.example .env.local
bun install

# Create the D1 database
bunx wrangler d1 create edgeever

# Create the R2 bucket
bunx wrangler r2 bucket create edgeever-resources

# Edit .env.local and fill in at least the generated resource values
# EDGE_EVER_D1_DATABASE_ID=<database_id returned by the D1 command>
# EDGE_EVER_R2_BUCKET_NAME=edgeever-resources
# EDGE_EVER_AUTH_PASSWORD=admin123
# EDGE_EVER_SESSION_TTL_DAYS=400

# Validate the completed configuration before deploying
bun run deploy:doctor
bun run deploy
```

Before running `bun run deploy`, copy the D1 `database_id` and R2 bucket name into your local `.env.local` file. The template uses `admin` / `admin123` for the initial login; edit `EDGE_EVER_AUTH_PASSWORD` if you prefer another initial password. Keep the session lifetime at the template default of `400` days; the server also caps larger values at 400 days.

`bun run deploy` builds the web app, applies remote D1 migrations, deploys the Worker, and uploads `EDGE_EVER_AUTH_PASSWORD` as a Worker Secret. After the first successful login, EdgeEver stores a salted PBKDF2-SHA256 hash in D1. Existing installations may continue to use `EDGE_EVER_AUTH_PASSWORD_HASH`; when both Secrets are set, the hash takes precedence. Verify the deployment by signing in with `EDGE_EVER_AUTH_USERNAME` and the configured password.

Existing installations do not need to migrate. If you intentionally switch from the hash setting to `EDGE_EVER_AUTH_PASSWORD`, remove the old `EDGE_EVER_AUTH_PASSWORD_HASH` from `.env.local`, Workers Builds, and the Worker's runtime Secrets; otherwise the legacy hash remains authoritative.

---

## Enable Automatic Updates

After the first deployment, connect the Worker to the fork's `main` branch. Cloudflare Workers Builds is the standard production deployment path for every EdgeEver instance. Follow [Cloudflare Workers Builds](cloudflare-workers-builds.md) to create the configuration-only **User API Token** (not an Account API Token), save it privately as `EDGE_EVER_BUILDS_API_TOKEN` in `.env.local`, then run:

```sh
bun run deploy:builds:setup
```

The command configures the Git repository connection, production trigger, build variables, and the deployment token needed for D1 migrations. Afterwards, use **Sync fork** or push to `main`; Cloudflare automatically builds the web app, applies new remote D1 migrations, and deploys the Worker. No GitHub Actions secrets or local redeployment are required.

Keep `bun run deploy` available for first installation and emergency recovery.
