# Knock CLI, environments, click-through URLs and free-tier limits

Research for [#13](https://github.com/govindshajan-netizen/cohort-005-project/issues/13) (part of map #10). Researched 2026-11-11. Primary sources only: docs.knock.app, knock.app/pricing, the `knocklabs/knock-cli` source, and the `knocklabs/javascript` SDK source. Every claim links to the page or file it comes from.

## TL;DR

- **CLI**: `npm install -g @knocklabs/cli`. Log in with `knock login` (opens a browser) or a `knock_st_` **service token**. The token can come from `--service-token`, the `KNOCK_SERVICE_TOKEN` env var, or a user `config.json`, so the CLI runs non-interactively in CI. Resources live under `knockDir` from `knock.json` (usually `.knock/`). Workflows go in `.knock/workflows/<key>/workflow.json`, with in-app templates in `in_app_feed_1/markdown_body.md`. The flow is `pull` → edit → `push [--commit]`, plus `commit promote --to=<env>` once environments are enabled.
- **Environments**: accounts created after October 2026 start with **one environment (production)**. "Enable environments" adds development and can't be undone. Each environment has its **own public key, secret key and signing key**. The in-app channel is account-level, with settings per environment.
- **`.env` for Cadence**: `KNOCK_API_KEY`, `KNOCK_PUBLIC_API_KEY`, `KNOCK_FEED_CHANNEL_ID`, `KNOCK_SIGNING_KEY`, plus `KNOCK_SERVICE_TOKEN` for the CLI.
- **Click-through**: use the in-app template's **`action_url`**. The pre-built feed reads it and redirects automatically. Build it with Liquid from trigger `data` and `vars`. Keep `data` for extra fields only.
- **Free plan**: 10,000 messages/month with no hard cap, unlimited environments, feeds, workflows and team members, and the CLI and API are included. Nothing here blocks a dev project. The one visible limit is that the pre-built feed shows Knock branding.

## 1. Knock CLI

### Install

- Homebrew (`brew install knocklabs/tap/knock`) or npm (`npm install -g @knocklabs/cli`). [docs: Install the Knock CLI](https://docs.knock.app/cli/overview/installation)
- **Node version conflict.** The docs page says Node ≥ 16.14.0 ([installation](https://docs.knock.app/cli/overview/installation)). The CI tutorial says ≥ 20.19.0 ([CI/CD tutorial](https://docs.knock.app/tutorials/integrating-into-cicd)). The current package (v1.6.1) declares `"node": ">=24"`, and its README says "Requires Node.js >= 24" ([package.json](https://github.com/knocklabs/knock-cli/blob/main/package.json), [README](https://github.com/knocklabs/knock-cli/blob/main/README.md)). Trust the source: plan for **Node 24+**. This machine has Node v24.11.1, which is fine.
- You can also install it as a project devDependency and run it with `npx knock`. That's standard npm behaviour; Knock's docs only show the global install.

### Authentication

- `knock login` opens a browser so you can authorize the CLI. `knock whoami` checks that it worked. [docs: Authentication](https://docs.knock.app/cli/overview/authentication)
- **Service tokens** are made for "remote environments". Create one under Settings → Service tokens. Only owners and admins can create them, and a token has the full rights of the person who created it. Tokens start with `knock_st_`, work **only** with the Management API, CLI and MCP server (not the regular Knock API), and are shown only once. [docs: Service tokens](https://docs.knock.app/developer-tools/service-tokens)
- Where the token can come from:
  - the `--service-token` flag on any command ([global flags](https://docs.knock.app/cli/overview/global-flags))
  - a user config file `config.json` with `{"serviceToken": "..."}` in `~/.config/knock` or `%LOCALAPPDATA%\knock` ([authentication](https://docs.knock.app/cli/overview/authentication))
  - the env var **`KNOCK_SERVICE_TOKEN`**: the flag is declared with `env: "KNOCK_SERVICE_TOKEN"` ([src/lib/base-command.ts](https://github.com/knocklabs/knock-cli/blob/main/src/lib/base-command.ts)), and the CI tutorial passes it this way ([CI/CD tutorial](https://docs.knock.app/tutorials/integrating-into-cicd))

### Project config and on-disk layout

- `knock init` creates `knock.json`, for example `{ "knockDir": ".knock" }`. After that, `pull`/`push` use that directory by default. Run the CLI from the folder that holds `knock.json`, because a relative `knockDir` is resolved against the current working directory. [docs: Configuring your project](https://docs.knock.app/cli/overview/configuring-your-project)
- `knock pull` groups resources into folders by type: `.knock/{audiences,goals,guides,layouts,message-types,partials,reusable-requests,schemas,translations,workflows}/`. [docs: Directory structure](https://docs.knock.app/cli/overview/directory-structure)
- Workflow layout ([docs: Workflow file structure](https://docs.knock.app/cli/workflow/file-structure)):

  ```text
  .knock/workflows/
  └── my-workflow/
      ├── workflow.json            # all steps
      ├── email_1/ ...
      └── in_app_feed_1/
          └── markdown_body.md     # extracted in-app template body
  ```

- Inside `workflow.json`, a template field that was moved out to a file gets an `@` suffix whose value is the file path, e.g. `"markdown_body@": "in_app_feed_1/markdown_body.md"` (`FILEPATH_MARKER = "@"` in [const.isomorphic.ts](https://github.com/knocklabs/knock-cli/blob/main/src/lib/marshal/shared/const.isomorphic.ts)). The CLI's own in-app scaffold writes `channel_key`, `action_url: "{{ vars.app_url }}"` and `markdown_body@` ([generator.ts](https://github.com/knocklabs/knock-cli/blob/main/src/lib/marshal/workflow/generator.ts)). The in-app template schema is `markdown_body` (required), `action_url`, and `action_buttons` ([InAppFeedTemplate](https://docs.knock.app/mapi-reference/templates/schemas/in_app_feed_template)).

### pull / push / commit / promote

| Command | What it does | Source |
| --- | --- | --- |
| `knock pull [--environment] [--branch] [--force]` | Downloads all resources to `knockDir`. Without `--environment` it uses the account's **default** environment. `--force` skips the confirmation prompt. | [pull](https://docs.knock.app/cli/resources/pull) |
| `knock push [--commit -m "..."] [--force]` | Upserts all local resources. `--commit` pushes and commits in one step. | [push](https://docs.knock.app/cli/resources/push) |
| `knock workflow push <key> [--all] [--commit]` | Pushes one workflow (or all of them), creating any that don't exist yet. | [workflow push](https://docs.knock.app/cli/workflow/push) |
| `knock commit -m "..." [--force]` | Commits all uncommitted changes in an environment. | [commit](https://docs.knock.app/cli/commit/all) |
| `knock commit promote --to=production [--force]` / `--only=<id>` | Promotes commits from the environment just below. **Only works once environments are enabled.** | [promote](https://docs.knock.app/cli/commit/promote) |

- Content changes start as drafts and only go live when committed. In production the dashboard calls committing "Publish". [docs: Version control overview](https://docs.knock.app/version-control/overview)
- **Non-interactive CI: yes.** Use the `KNOCK_SERVICE_TOKEN` secret plus `--force` to skip prompts. Knock's own GitHub Actions examples run `knock push --branch=… --commit`, `knock branch merge … --force`, and `knock commit promote --to=staging`. [docs: CI/CD tutorial](https://docs.knock.app/tutorials/integrating-into-cicd)
- Knock positions the CLI as the main tool for coding agents, and publishes a `knock-cli` agent skill (`npx skills add knocklabs/skills --skill knock-cli`). [docs: AI → Knock CLI](https://docs.knock.app/ai/cli)

## 2. Environments and keys

- **New accounts start with only production.** "New Knock accounts start with a single environment." Accounts created **before October 2026** were set up with development and production. [docs: Version control overview](https://docs.knock.app/version-control/overview)
- **Enabling environments** (Settings → Environments, owner/admin only) adds development below production and turns on promotion, extra environments and branches. **It can't be turned off.** Development starts empty: only the `default` email layout is copied over. Development also becomes the **default environment** for the CLI and Management API, so scripts that should hit production must pass `--environment=production`. [docs: Environments](https://docs.knock.app/version-control/environments)
- Content can only be edited in the environment where it was created, and can be promoted upwards. Data (users, messages, logs and so on) belongs to one environment and is never copied. [docs: Environments](https://docs.knock.app/version-control/environments)
- **API keys belong to an environment.** Each environment has its own set under Platform → API keys. Keys are either public (`pk_`, safe in client code) or secret (`sk_`, server only), and you can create as many as you like. [docs: API keys](https://docs.knock.app/developer-tools/api-keys)
- **Signing key** (for enhanced security mode): create it under Platform → API keys (an environment-specific page). It's shown once and comes either as single-line base-64 PEM or as multi-line PEM. "By convention… `KNOCK_SIGNING_KEY`. This is where the Knock SDK will look for the key by default." Tokens are RS256 JWTs with `sub` = user id. [docs: Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Enhanced security mode** is off by default and set per environment. Knock suggests keeping it off in development and turning it on before going live, because without it "a request with your public key can act as any user". [docs: Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)
- **Feed channel id**: find it under account settings → Channels and sources → your in-app channel. [docs: React feed](https://docs.knock.app/in-app-ui/react/feed). Channels are account-level, with settings for each environment ([docs: In-app feeds](https://docs.knock.app/integrations/in-app/feeds), "for each environment, expand its settings"). *Inference:* the channel id is the same in every environment, but check this in the dashboard.
- **Template `vars`** are "account and environment-specific variables" ([docs: Variables](https://docs.knock.app/template-editor/variables)). That makes `{{ vars.app_url }}` a natural per-environment base URL for `action_url`.

### `.env` variables Cadence needs

| Variable | Value | Scope | Used by | Source for the name |
| --- | --- | --- | --- | --- |
| `KNOCK_API_KEY` | `sk_…` secret key | per environment, server only | `@knocklabs/node` (default env var) to trigger workflows and identify users | [Node 1.0 migration guide](https://docs.knock.app/developer-tools/migration-guides/node) (`process.env["KNOCK_API_KEY"] // This is the default`) |
| `KNOCK_PUBLIC_API_KEY` | `pk_…` public key | per environment | `KnockProvider apiKey` in the browser | [React feed](https://docs.knock.app/in-app-ui/react/feed) |
| `KNOCK_FEED_CHANNEL_ID` | in-app channel UUID | account-level channel | `KnockFeedProvider feedId` | [React feed](https://docs.knock.app/in-app-ui/react/feed) |
| `KNOCK_SIGNING_KEY` | base-64 PEM private key | per environment, server only | `signUserToken` in loaders, **only needed once enhanced security is on** | [Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication) |
| `KNOCK_SERVICE_TOKEN` | `knock_st_…` | account-level, not per environment | Knock CLI (`push`/`pull`/`commit`), CI secret | [base-command.ts](https://github.com/knocklabs/knock-cli/blob/main/src/lib/base-command.ts), [CI/CD tutorial](https://docs.knock.app/tutorials/integrating-into-cicd) |

Notes:

- Every environment uses the same variable names with different values. A dev `.env` points at whichever environment local development uses. With a new single-environment account, that is **production**.
- Cadence is a React Router app, so `process.env` isn't available in the browser. The public key and channel id need to reach the client through a loader (or a `VITE_`-prefixed var). That's general React Router/Vite behaviour, not something Knock documents. Knock's examples just write `process.env.KNOCK_PUBLIC_API_KEY`.
- The CLI's `--environment` flag takes an environment **slug** (e.g. `development`, `production`), not a key. No env var is needed for that.
- README.md L84 only says Knock keys "go in `.env`, which is gitignored". It doesn't name any of them.

## 3. Click-through URLs: `action_url` vs `data`

- The in-app template has an **Action URL** field. Turn on "include click action", then use a static URL or Liquid. "By default, the in-app feed will redirect to the action URL when the notification cell is clicked." The Single-action and Multi-action variants add labelled buttons, each with its own URL. [docs: In-app feeds](https://docs.knock.app/integrations/in-app/feeds)
- How it reaches the client: the rendered message comes back as `blocks` (`{name, type, content, rendered}`) on each feed item, and trigger `data` comes back as `item.data` ([List feed items](https://docs.knock.app/api-reference/users/feeds/list_items), [MessageInAppFeedContentBlock](https://docs.knock.app/api-reference/messages/schemas/message_in_app_feed_content_block)). The React `NotificationCell` reads `blocksByName.action_url.rendered` and calls `maybeNavigateToUrlWithDelay(actionUrl)` ([NotificationCell.tsx L66–84](https://github.com/knocklabs/javascript/blob/main/packages/react/src/modules/feed/components/NotificationCell/NotificationCell.tsx)). "The `KnockFeedProvider` will attach a redirect handler if `action_url` is not empty." [docs: React feed](https://docs.knock.app/in-app-ui/react/feed)
- To customise the behaviour (e.g. client-side routing instead of a full page load), use `onNotificationClick(item)` / `onNotificationButtonClick(item, button)`. [docs: Handling interactivity](https://docs.knock.app/in-app-ui/feeds/handling-interactivity)
- Clicking an action URL records an `interacted` event. It isn't wrapped for link tracking, so it doesn't send `link_clicked`. [docs: In-app feeds](https://docs.knock.app/integrations/in-app/feeds)
- **The idiomatic choice is `action_url`.** It's the first-class template field, the pre-built feed uses it with no extra code, and it versions with the workflow. Build it in the template from trigger data, e.g. `{{ vars.app_url }}/courses/{{ data.course_slug }}`, and pass ids/slugs in the trigger `data`. Reading a URL out of `item.data` would mean writing your own click handler. Also, `data` is the whole trigger payload, returned to the browser by default (you can narrow it with the channel's API response filter). [docs: In-app feeds → Customizing API response content](https://docs.knock.app/integrations/in-app/feeds)
- Once Knock generates a feed message, its content (including the URL) can't change. If it goes stale, archive it and trigger again. [docs: In-app feeds FAQ](https://docs.knock.app/integrations/in-app/feeds)

## 4. Free tier

From [knock.app/pricing](https://knock.app/pricing) unless noted:

- **Free plan** (formerly "Developer"): $0/month, no credit card. [Knock plans](https://docs.knock.app/manage-your-account/knock-plans)
- **10,000 messages sent/month.** A message is one successful delivery to one user on one channel. Bounces and failures don't count. Guides are capped separately at 500 recipients/month, and agent credits at 500.
- **No hard cap.** "We don't hard cap your messages… If you go over your limit, we'll get in touch." (pricing FAQ)
- **All environments count toward usage.** The in-app channel **has no sandbox mode**, so every in-app message from testing counts. Use channel conditions to limit test sends. [Knock plans](https://docs.knock.app/manage-your-account/knock-plans)
- **Environments: unlimited** on every plan. Version control and history: yes.
- **In-app feeds: unlimited** feeds per recipient. Pre-built components and the feed API are included, and feed retention is unlimited. **"Remove Knock branding": No** on Free, so the pre-built feed shows Knock branding.
- **"Manage via API & CLI": Yes** on all plans. Log retention is 30 days.
- **Enhanced security mode** isn't on the pricing table, and the docs don't gate it to any plan ([Security and authentication](https://docs.knock.app/in-app-ui/security-and-authentication)). The [Enterprise-only list](https://docs.knock.app/manage-your-account/knock-plans) is: per-tenant preferences, branding and guides; translations; batch render beyond 10; custom roles; SAML SSO; directory sync; warehouse export; and the Datadog, New Relic, Segment and Heap extensions. None of these matter for Cadence.
- **Verdict:** nothing on the Free plan blocks a dev project.

## Open questions surfaced

1. **Enable environments or stay single-environment?** A new account (after October 2026) has only production. Enabling environments is free and permanent, and makes development the CLI default. Is promote-to-production worth it for a course project, or should we push straight to production?
2. **Enhanced security mode in dev?** Turning it on means building `signUserToken` and passing it into `KnockProvider` from loaders. Leaving it off is simpler, but any client can read any user's feed.
3. **How to install the CLI:** a global `npm i -g` or a pinned devDependency (`npx knock`)? It needs Node ≥ 24.
4. **Channel id across environments**: I believe it's shared, but this is inference. Check in the dashboard if we enable environments.
