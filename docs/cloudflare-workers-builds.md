# Cloudflare Workers Builds

Cloudflare Workers Builds deploys EdgeEver whenever `main` changes, including after GitHub **Sync fork**. Use local `bun run deploy` only for the first installation or emergency recovery.

## Setup

Complete the [first deployment](manual-deploy.md), then run:

```sh
bun run deploy:builds:setup
```

The command reads the repository remote and `.env.local`, configures the build, and starts one verification build on first setup. It is safe to rerun after instance settings change.

Only complete the following steps when the command asks for them.

### GitHub authorization

Approve installation of the **Cloudflare Workers & Pages** GitHub App for the fork. This is the app's name; an EdgeEver instance does not require a Pages project. The command handles the repository connection after authorization.

### Configuration API token

If `EDGE_EVER_BUILDS_API_TOKEN` is missing, create a custom **User API Token** at [My Profile -> API Tokens](https://dash.cloudflare.com/profile/api-tokens) with:

- **Account** -> **Workers Builds Configuration** -> **Edit**
- **Account** -> **Workers Scripts** -> **Read**

Do not use an Account API Token or a prebuilt template. Limit the token to the relevant account, then save the value shown by Cloudflare once in `.env.local`:

```text
EDGE_EVER_BUILDS_API_TOKEN=<token>
```

Never commit or share this token.

![Redacted Cloudflare User API Token permissions](assets/cloudflare-workers-builds-user-token.svg)

### Deployment API token

If the command reports that no deployment API token is available, open **Worker** -> **Settings** -> **Builds** -> **API token** and create or select one that can deploy the Worker and update D1 and R2, then rerun the command. When several are available, select one by name in the terminal.

## Updates and Troubleshooting

After setup, push to `main` or use GitHub **Sync fork**. Cloudflare installs dependencies, checks and builds the app, applies new D1 migrations, and deploys the Worker. No GitHub Actions secrets or local redeployment are required.

If a build fails, inspect its log in the Worker **Deployments** tab. Rerun `bun run deploy:builds:setup` when instance settings change.
