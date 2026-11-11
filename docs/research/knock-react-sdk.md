# Knock React SDK: feed hooks, prebuilt popover theming, client-only rendering under React Router SSR

Research for [#12](https://github.com/govindshajan-netizen/cohort-005-project/issues/12) (part of map #10). Researched 2026-11-11.

**Sources.** Knock docs ([docs.knock.app](https://docs.knock.app)), the published npm tarballs for `@knocklabs/react@0.15.1`, `@knocklabs/react-core@0.17.1` and `@knocklabs/client@0.23.1` (`react-core` and `client` ship their TypeScript `src/`, so I read that directly; for `@knocklabs/react` I read the compiled `dist/esm`). Those sources live in the [knocklabs/javascript monorepo](https://github.com/knocklabs/javascript). The React Router docs at [reactrouter.com](https://reactrouter.com), and the React docs at [react.dev](https://react.dev).

**Our stack** ([package.json](../../package.json)): `react`/`react-dom` `^19.2.7`, `react-router` / `@react-router/dev` `8.3.0` (framework mode, SSR via `react-router-serve`), Tailwind v4, and shadcn tokens in `app/app.css`, with dark mode set by a `.dark` class on `<html>` (`@custom-variant dark (&:is(.dark *))`). The bell would go in `app/components/sidebar.tsx`, rendered by `app/routes/layout.app.tsx`, whose loader already returns `currentUser`.

---

## TL;DR

| # | Answer |
| --- | --- |
| Packages | Install **`@knocklabs/react` 0.15.1**. It re-exports everything from `@knocklabs/react-core` 0.17.1 (providers + hooks, no UI) and pulls in `@knocklabs/client` 0.23.1. Peer deps are `react`/`react-dom` `^17 \|\| ^18 \|\| ^19`. `next` and `@tanstack/react-router` are **optional** peers, used only by the `/next` and `/tanstack` subpath exports. |
| 1 | `KnockProvider` → `KnockFeedProvider` → `useKnockFeed()` gives `{ feedClient, useFeedStore, colorMode }`. Read `items` and `metadata.{unread_count, unseen_count, total_count}` from the store. Call `feedClient.fetch()`, `markAsRead(item)`, `markAllAsRead()` and `markAllAsSeen()` (all optimistic). Real-time updates come from a websocket that `useNotifications` opens via `listenForUpdates()`, and the store updates on its own. A `FeedItem` has `actors[]`, `data`, `blocks[]` (`{type:"markdown"\|"text", content, rendered}`), `inserted_at`, `read_at`, `seen_at`, … |
| 2 | Pass `<KnockProvider apiKey user={{id}} userToken={jwt} onUserTokenExpiring={…}>`. The JWT is RS256-signed on our server with `sub = userId`. **When the DevUI switches user, just pass the new `user`/`userToken` props. No remount and no reload.** The SDK re-authenticates the same client, tears down and reopens the socket, and `KnockFeedProvider` re-keys itself on `userId`, so the feed subtree remounts and refetches. Use `enabled={Boolean(id && token)}` to hold it idle until both are present. |
| 3 | You can theme the prebuilt UI with about 80 `--rnf-*` CSS variables plus `rnf-*` BEM classes. Dark mode is an explicit `colorMode="light"\|"dark"` prop, not driven by `.dark` or `prefers-color-scheme`. There is no Tailwind integration. **Recommendation: use the headless hooks plus our own shadcn/Tailwind components** for a bell that matches the sidebar. Keep the prebuilt popover only as a quick prototype fallback. |
| 4 | **Importing the package does not break SSR.** I verified this: `import("@knocklabs/react")` and `renderToString(<KnockProvider><KnockFeedProvider><NotificationIconButton/><NotificationFeedPopover/>…)` both succeed in Node 24, where `window`, `document` and `self` are undefined. The client guards every browser API with `typeof window/document/self`. Still, render Knock **client-only behind a `useEffect` "hydrated" gate**, so the server never creates Knock clients or token-expiry timers per request and the badge never mismatches. No `.client.ts` file or `lazy()` is needed. |

---

## Packages, versions, peer deps

- `@knocklabs/react` **0.15.1** (npm `time.modified` 2026-11-06). Its peerDependencies are `react` and `react-dom` `^17.0.0 || ^18.0.0 || ^19.0.0`, plus `next` and `@tanstack/react-router`, which `peerDependenciesMeta` marks `optional: true`. Its dependencies include `@knocklabs/react-core ^0.17.1`, `@knocklabs/client ^0.23.1`, `@popperjs/core`, the `@telegraph/*` design-system packages, `@radix-ui/react-dialog`, `@radix-ui/react-hover-card` and `lucide-react`. Source: `npm view @knocklabs/react` / [npmjs.com/package/@knocklabs/react](https://www.npmjs.com/package/@knocklabs/react).
- `@knocklabs/react-core` **0.17.1**: peer is `react ^17 || ^18 || ^19`. Its dependencies are `@knocklabs/client`, `@tanstack/react-store`, `swr` and `date-fns`. It contains the providers and hooks and **no UI** ([npm](https://www.npmjs.com/package/@knocklabs/react-core)).
- `@knocklabs/client` **0.23.1**: the vanilla JS client, with the feed store (TanStack Store), the Phoenix websocket and the API client ([npm](https://www.npmjs.com/package/@knocklabs/client)).
- The Knock docs say the React library "is built on-top of the `@knocklabs/client` JS SDK and includes that library as an implicit dependency" ([React SDK overview](https://docs.knock.app/in-app-ui/react/sdk/overview)). `@knocklabs/react` re-exports the react-core hooks, which is why the README's headless example imports `useNotifications` and `useNotificationStore` from `@knocklabs/react` ([README](https://github.com/knocklabs/javascript/tree/main/packages/react#headless-usage)).
- The `@knocklabs/react` `package.json` `exports` has `"."`, `"./dist/index.css"`, `"./next"` and `"./tanstack"`. Only `next.mjs` and `tanstack.mjs` (plus the guide `KnockGuideLocationSensor`) import `next/*` or `@tanstack/react-router`. The main entry never does, so a React Router app does not need either peer (checked by grepping `dist/esm`).

**Decision:** we only need `npm i @knocklabs/react`. For a fully headless build, `@knocklabs/react-core` alone would also work and avoids the Telegraph/Popper/Radix weight. Both packages expose the same hooks.

---

## 1. Providers, hooks, feed item shape

### Providers

```tsx
<KnockProvider apiKey={PUBLIC_KEY} user={{ id: userId }} userToken={jwt}>
  <KnockFeedProvider feedId={FEED_CHANNEL_ID} colorMode="light">
    {/* bell */}
  </KnockFeedProvider>
</KnockProvider>
```

- `KnockProvider` props: `apiKey`, `user` (or the deprecated `userId`), `userToken`, `onUserTokenExpiring`, `timeBeforeExpirationInMs`, `host`, `logLevel`, `branch`, `i18n` and `enabled`. It puts a `Knock` instance in context, which you read with `useKnockClient()` ([KnockProvider.tsx](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/context/KnockProvider.tsx), [docs](https://docs.knock.app/in-app-ui/react/sdk/components/knock-provider)).
- `KnockFeedProvider` props: `feedId`, `colorMode` (default `"light"`) and `defaultFeedOptions` (`FeedClientOptions`: status/tenant/source/archived filters, etc.). It calls `useNotifications(knock, feedId, defaultFeedOptions)` and `useCreateNotificationStore(feedClient)`, and exposes `{ knock, feedClient, useFeedStore, colorMode }` through `useKnockFeed()` ([KnockFeedProvider.tsx](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/feed/context/KnockFeedProvider.tsx), [docs](https://docs.knock.app/in-app-ui/react/sdk/components/knock-feed-provider)).

### Hooks (all exported from `@knocklabs/react`)

| Need | API |
| --- | --- |
| Feed client | `const { feedClient, useFeedStore } = useKnockFeed()` inside `KnockFeedProvider`, **or** headless `const feedClient = useNotifications(useKnockClient(), feedId, options)` ([useNotifications.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/feed/hooks/useNotifications.ts), [headless feed docs](https://docs.knock.app/in-app-ui/react/headless/feed)) |
| Feed items | `const items = useFeedStore((s) => s.items)` or `useNotificationStore(feedClient, (s) => s.items)`. The selector form avoids re-rendering on unrelated changes ([useNotificationStore.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/feed/hooks/useNotificationStore.ts)) |
| Unread count / badge | `useFeedStore((s) => s.metadata.unread_count)`. `metadata` is `{ total_count, unread_count, unseen_count }` ([client feed interfaces](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/interfaces.ts)). The prebuilt badge uses `unseen_count` by default; `badgeCountType="unread"` switches it ([feed docs](https://docs.knock.app/in-app-ui/react/feed#notification-icon-button)) |
| Initial load | `feedClient.fetch()` in a `useEffect`. **The headless hooks do not fetch for you** ([headless docs](https://docs.knock.app/in-app-ui/react/headless/feed)). The prebuilt `NotificationFeed` calls `fetch({ status })` on mount (from `dist`). Pagination is `fetchNextPage()` |
| Mark one read | `feedClient.markAsRead(itemOrItems)` optimistically sets `read_at` and decrements `unread_count`, then calls the API ([feed.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)) |
| Mark all read | `feedClient.markAllAsRead()` optimistically sets `unread_count: 0` and `read_at` on loaded items, then calls the bulk API and emits `items.all_read` ([feed.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)) |
| Seen (badge clear) | `markAsSeen(item)` / `markAllAsSeen()`. "If you don't mark items as seen, `unseen_count` never decreases" when you build headless. The prebuilt popover calls `markAllAsSeen()` on open ([headless docs](https://docs.knock.app/in-app-ui/react/headless/feed#marking-items-as-seen)) |
| Others | `markAsUnread`, `markAsUnseen`, `markAsInteracted`, `markAsArchived`, `markAllAsArchived`, `markAllReadAsArchived`, `markAsUnarchived` ([feed.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)) |
| Real-time | Automatic. `useNotifications` calls `feedClient.listenForUpdates()`, which joins the feed's Phoenix channel on the shared socket. New items land in the store and the hooks re-render. To react to them (e.g. a sonner toast), use `feedClient.on("items.received.realtime", ({ items }) => …)`. Events include `items.received.page`, `items.received.realtime`, `items.read`, `items.all_read`, `items.*` and more ([types.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/types.ts), [toasts docs](https://docs.knock.app/in-app-ui/react/toasts)) |

Real-time extras that are on by default: cross-tab sync through `BroadcastChannel`, and the socket disconnects 30 s after the tab is hidden and reconnects when it is visible again ([pageVisibility.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/pageVisibility.ts), [socket behaviour docs](https://docs.knock.app/in-app-ui/react/feed#socket-behavior-options)).

### `FeedItem` shape (client 0.23.1)

From [`clients/feed/interfaces.ts`](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/interfaces.ts):

```ts
interface FeedItem<T = GenericData> {
  __cursor: string;
  id: string;
  activities?: Activity<T>[];   // "rich" mode only
  actors: Recipient[];          // who caused it, e.g. actors[0].name / .avatar
  blocks: ContentBlock[];       // rendered template content
  inserted_at: string;
  updated_at: string;
  read_at: string | null;
  seen_at: string | null;
  clicked_at: string | null;
  interacted_at: string | null;
  link_clicked_at: string | null;
  archived_at: string | null;
  total_activities?: number;
  total_actors: number;
  data: T | null;               // the workflow trigger payload
  source: NotificationSource;   // workflow key, etc.
  tenant: string | null;
}

type ContentBlock =
  | { name: string; type: "markdown"; content: string; rendered: string } // rendered = HTML
  | { name: string; type: "text";     content: string; rendered: string }
  | { name: string; type: "button_set"; buttons: { name; label; action }[] };
```

Knock's own headless example renders `item.blocks[0].rendered` with `dangerouslySetInnerHTML` ([headless feed docs](https://docs.knock.app/in-app-ui/react/headless/feed)). Because `rendered` is Knock-produced HTML, we can drop it into a `prose` container (we already use `@tailwindcss/typography`). Alternatively, ignore `blocks` and build the text from `data`.

---

## 2. Signed user token and switching user without a reload

**Token.** With *enhanced security mode* on, Knock rejects client requests that use the public key without a **signed user token**. The token is a JWT signed with our private signing key (`KNOCK_SIGNING_KEY`) using **RS256**. It must carry `sub` (the user id) and should carry `iat`/`exp`. `@knocklabs/node`'s `signUserToken(userId, { expiresInSeconds })` does the signing, with a default expiry of 3600 s. The client then passes `userToken` to `KnockProvider`. `grants`/`explicit_grants` can narrow what the token may do ([security & authentication](https://docs.knock.app/in-app-ui/security-and-authentication#authentication-with-enhanced-security)). With enhanced security off, which the docs recommend only for development, the public key plus a user id is enough. For us that means signing in `layout.app.tsx`'s loader (server-only) and returning `knockToken` beside `currentUser`. On the wire the token travels as the `X-Knock-User-Token` header and the socket `user_token` param ([api.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/api.ts)).

**Expiry.** `onUserTokenExpiring` (with `timeBeforeExpirationInMs`) is called before `exp`, so you can fetch a new token and pass it in ([KnockProvider.tsx](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/context/KnockProvider.tsx), [knock.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/knock.ts)).

**Switching user (DevUI).** Our DevUI switches user with a React Router `<Form action="/api/switch-user?redirectTo=…">` (`app/components/dev-ui.tsx`). That is a client-side navigation followed by loader revalidation, not a page reload, so `layout.app`'s `currentUser` (and a future `knockToken`) simply change as props. The SDK handles this itself:

- `useAuthenticatedKnockClient` memoizes on `[apiKey, enabled, user, userToken, options]`. If the client is already authenticated and only the user id or token changed, it **re-authenticates the same instance in place**. In all other cases (first mount, `enabled` toggles) it tears down the old client and makes a new one ([useAuthenticatedKnockClient.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/hooks/useAuthenticatedKnockClient.ts)).
- `Knock.authenticate()` notices that the credentials changed, calls `feeds.teardownInstances()` and `teardown()`, then reinitializes the API client and socket and rewires existing feeds ([knock.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/knock.ts)).
- `KnockFeedProvider` sets `key={feedProviderKey(knock.userId, feedId, options)}` on its context provider, so **a userId change remounts the feed subtree, and it refetches** ([KnockFeedProvider.tsx](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/feed/context/KnockFeedProvider.tsx), [core/utils.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/utils.ts)).
- For logged out (`currentUser === null`) or "token not loaded yet", Knock recommends `enabled={Boolean(userId && userToken)}` **instead of conditionally mounting** the provider. When `enabled` is false the client stays idle (no identify call, no requests, no socket), and flipping it behaves like login or logout and clears stores ([README](https://github.com/knocklabs/javascript/tree/main/packages/react#deferring-activity-with-enabled), [KnockProvider.tsx](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/context/KnockProvider.tsx)).

**Answer:** keep one long-lived `KnockProvider` and pass it `user={{ id: String(currentUser.id) }}`, `userToken={knockToken}` and `enabled={!!currentUser && !!knockToken}`. Do not add a manual `key` or reload. Adding `key={currentUser.id}` is a harmless belt-and-braces fallback, but the SDK already does the equivalent. Watch for one thing: pass a stable `user` object, or just an id. The SDK deep-compares through `useStableOptions`, so a fresh object literal each render is fine.

---

## 3. Theming the prebuilt `NotificationFeedPopover` / `NotificationIconButton`

What Knock provides ([feed docs › UI/UX overrides](https://docs.knock.app/in-app-ui/react/feed#uiux-overrides), [styling](https://docs.knock.app/in-app-ui/feeds/styling)):

1. **CSS variables**: about 80 `--rnf-*` variables (colors `--rnf-color-gray-*`/`brand-*`, `--rnf-font-family-sanserif`, font sizes, radii, `--rnf-notification-feed-popover-{bg-color,shadow,border-radius,min-w,max-w,height,z-index}`, `--rnf-notification-cell-*`, `--rnf-unseen-badge-*`, button colors, …), all defined on `:root` in `@knocklabs/react/dist/index.css`. The full list is in [theme.css](https://github.com/knocklabs/javascript/blob/main/packages/react/src/theme.css). The CSS import is required "unless you're overriding the styling".
2. **Custom CSS**: replace the stylesheet entirely. Every class is a unique `rnf-*` BEM name.
3. **Component props**: `NotificationFeed`/`NotificationFeedPopover` take `renderItem`, `onNotificationClick`, `onNotificationButtonClick`, `onOpen` (default `markAllAsSeen`; switch to `markAsRead`), `placement` and `closeOnClickOutside`. `NotificationCell` takes `avatar` and `children`. `NotificationIconButton` takes `badgeCountType`.
4. **Dark mode**: `KnockFeedProvider colorMode="dark"`. The styles are `.rnf-*--dark` modifier classes chosen by that prop, so they do **not** follow our `.dark` class or `prefers-color-scheme`.

What that means for us:

- There is **no Tailwind/shadcn integration**. To match the sidebar we would map `--rnf-*` onto our tokens (`--rnf-notification-feed-popover-bg-color: var(--popover)`, etc.) in `app.css`, for both light and `.dark`. Dark mode would still need `colorMode` passed in. Today `sidebar.tsx` keeps `isDark` in local state that it reads from `document.documentElement.classList`, so we would have to lift that state or observe the class.
- The popover is positioned with **Popper.js** (`createPopper`, default `placement: "bottom-end"`), not Radix. The sidebar is 56 units wide at the far left, so we would need `placement="right-start"` or similar. It also would not share our shadcn focus, animation or portal behaviour.
- The bundled stylesheet is about 67 KB. Besides `--rnf-*` it also adds `:root` tokens for Telegraph (`--tgph-*`), `--knock-*`, `--rsk-*` and `--rtk-*`, mostly for the guide, Slack and Teams components we would not use. Telegraph's component-scoped un-prefixed custom properties (`--color`, `--gap`, …) only apply on Telegraph elements, but they are more global CSS than we need.

**Recommendation:** use **hooks plus our own components.** The headless surface is small: `useKnockFeed`/`useFeedStore` for `items` and `metadata`, `fetch`, and the `markAs*` calls, all shown above. It lets us use lucide's `Bell`, a shadcn-style popover (we already depend on `radix-ui`), Tailwind `dark:` classes and `prose` for `blocks[].rendered`, with no extra stylesheet. The prebuilt popover is fine for a 10-minute "is the wiring right" spike. For the headless route we could even depend only on `@knocklabs/react-core`.

---

## 4. SSR in React Router framework mode

### Does importing the package break SSR at module load?

**No.** I verified this empirically (Node v24.11.1, `@knocklabs/react@0.15.1`, `react@19.2.7`) with a script that:

1. `await import("@knocklabs/react")`: succeeds, and all exports are present.
2. Calls `renderToString(<KnockProvider apiKey user={{id}}><KnockFeedProvider feedId><NotificationIconButton/><NotificationFeedPopover isVisible={false}/></KnockFeedProvider></KnockProvider>)`: succeeds and returns the bell `<button class="rnf-notification-icon-button rnf-notification-icon-button--light">…`. The process exits cleanly with no hung socket.

The source explains why:

- The client only builds the websocket `if (typeof window !== "undefined" && typeof WebSocket !== "undefined")`, and only adds the `online` listener and `PageVisibilityManager` inside that branch ([api.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/api.ts)). `PageVisibilityManager` checks `typeof document` itself ([pageVisibility.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/pageVisibility.ts)). `BroadcastChannel` is guarded by `typeof self !== "undefined"` ([feed.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/feed.ts)). With no socket there is no `FeedSocketManager`, so `listenForUpdates()` is a no-op on the server ([feeds/index.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/clients/feed/index.ts)).
- In `@knocklabs/react/dist/esm`, every `window`/`document` reference I found sits inside an event handler or effect, or behind a `typeof window` check.
- The entry starts with `"use client"`. That directive only means something to RSC bundlers. React Router framework mode without RSC ignores it.
- `import "@knocklabs/react/dist/index.css"` is a plain Vite side-effect CSS import, which framework mode supports ([RR styling](https://reactrouter.com/explanation/styling)). We would not need it if we go headless.

### So why gate it to client-only anyway?

- `KnockFeedProvider` → `useNotifications` creates the feed client **during render** (in a `useState` initializer), and `useAuthenticatedKnockClient` creates and authenticates a `Knock` instance in `useMemo`, also during render ([useNotifications.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/feed/hooks/useNotifications.ts), [useAuthenticatedKnockClient.ts](https://github.com/knocklabs/javascript/blob/main/packages/react-core/src/modules/core/hooks/useAuthenticatedKnockClient.ts)). Under SSR that means one throwaway Knock client per request on the server. If `onUserTokenExpiring` is set, `authenticate()` also schedules a `setTimeout` for token expiry on the server, and the unmount `teardown()` effect never runs there to clear it ([knock.ts](https://github.com/knocklabs/javascript/blob/main/packages/client/src/knock.ts)).
- Server HTML can only ever show an empty feed or a zero badge, because the store starts at `initialStoreState` and fetches happen in effects. A client-only render loses nothing.
- Hydration stays trivially consistent. Both server and first client render show a placeholder, and real data arrives after mount. React documents this two-pass pattern for content that has to differ between server and client: render the server-safe output first, then flip a flag in `useEffect` ([react.dev › hydrateRoot › different client and server content](https://react.dev/reference/react-dom/client/hydrateRoot#handling-different-client-and-server-content)).

### Pattern options

| Option | Verdict |
| --- | --- |
| **`useEffect` mount gate** (`const [hydrated, setHydrated] = useState(false); useEffect(() => setHydrated(true), [])`, then render a static bell placeholder until it is true) | **Recommended.** This is React's own documented pattern, needs no dependency, and works with the static import because the import is SSR-safe. Render the same lucide `Bell` icon, with no badge, as the placeholder so layout doesn't shift. |
| `.client.ts(x)` module | **Not needed and awkward.** React Router strips `.client` modules from the server bundle, and their exports are `undefined` on the server, "so the only places to use them are in `useEffect` and user events" ([RR .client modules](https://reactrouter.com/api/framework-conventions/client-modules)). Rendering a component from one still needs the mount gate. It only helps when a module has browser side effects at import time, which Knock doesn't. |
| `React.lazy(() => import(...))` + `<Suspense>` | Works when combined with the mount gate, and splits the Knock code out of the initial chunk. It is still not client-only on its own: `lazy` also resolves during SSR. Use it only if bundle size matters. |
| `clientLoader` / `HydrateFallback` | Wrong tool. Those are for route data, and the bell lives inside the always-rendered `layout.app` route. |

Sketch (headless, our own UI):

```tsx
// app/components/notification-bell.tsx
import { useEffect, useState } from "react";
import { KnockProvider, KnockFeedProvider, useKnockFeed } from "@knocklabs/react";

export function NotificationBell({ userId, token }: { userId: string | null; token: string | null }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return <BellPlaceholder />;           // identical on server + first client render
  return (
    <KnockProvider
      apiKey={import.meta.env.VITE_KNOCK_PUBLIC_API_KEY}
      user={{ id: userId ?? "" }}
      userToken={token ?? undefined}
      enabled={Boolean(userId && token)}
    >
      <KnockFeedProvider feedId={import.meta.env.VITE_KNOCK_FEED_CHANNEL_ID}>
        <Bell />
      </KnockFeedProvider>
    </KnockProvider>
  );
}

function Bell() {
  const { feedClient, useFeedStore } = useKnockFeed();
  const items = useFeedStore((s) => s.items);
  const unread = useFeedStore((s) => s.metadata.unread_count);
  useEffect(() => { feedClient.fetch(); }, [feedClient]);
  // render lucide <Bell/> + badge; feedClient.markAsRead(item) / markAllAsRead()
}
```

One more detail: put the gate **around** `KnockProvider`, not inside it. That way the provider, and its client, is only ever created in the browser. Mount it once in the sidebar, which stays mounted across navigations inside `layout.app`, so the socket survives route changes.

---

## Open questions surfaced

- **Where does the JWT get signed, and do we use enhanced security in dev?** We need `@knocklabs/node` (or any RS256 JWT lib) plus `KNOCK_SIGNING_KEY` on the server, and a decision on whether dev runs with enhanced security off. The DevUI makes impersonating any user trivial anyway.
- **Knock user ids**: our users have integer ids, and Knock wants string ids. Decide the mapping (`String(id)` vs a prefixed `user_<id>`) and make sure the server-side workflow triggers use the same id.
- **Badge semantics**: should the badge show `unseen_count` (Knock's default, cleared by opening the bell) or `unread_count` (cleared per item or by "mark all as read")? The issue asks for both "unread badge" and "mark as read", so pick one before building.
- **Public env vars**: the client needs the public API key and feed channel id in the browser. Expose them as `VITE_*`, or return them from the `layout.app` loader.
