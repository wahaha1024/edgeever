# AI Agent Cloudflare Deployment

Use this contract when deploying EdgeEver from a GitHub repository to Cloudflare.

## Constraints

- Use local deployment only for the first installation or emergency recovery. Routine updates must use Cloudflare Workers Builds.
- Keep account IDs, resource names, API tokens, domains, and passwords in the git-ignored `.env.local`; never hard-code or commit them.
- Use the repository deployment scripts. Do not add a separate GitHub Actions deployment for the Worker.

## First Installation

Run in order:

```sh
bun run deploy:setup
bun run deploy:doctor
bun run deploy
```

If the user supplied a custom initial password, replace the first command with:

```sh
EDGE_EVER_PASSWORD='<first-login-password>' bun run deploy:setup
```

Do not deploy until `deploy:doctor` passes. After deployment, verify the Worker URL, `/api/openapi.json`, and login. The default initial login is `admin` / `admin123`.

## Automatic Updates

After the first deployment, run:

```sh
bun run deploy:builds:setup
```

Follow [Cloudflare Workers Builds](cloudflare-workers-builds.md) only when the command requests authorization or an API token. Deployment is complete when the verification build succeeds and future pushes to `main` automatically deploy the instance.
