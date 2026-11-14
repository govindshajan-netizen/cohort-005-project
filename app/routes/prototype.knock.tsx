// THROWAWAY PROTOTYPE — Vendor spike for #35 ("Does Knock hold up against Cadence?").
// Question: Do signed RS256 user tokens (with DevUI user switching), Node SDK workflow
// triggering, the headless feed API, and category × channel opt-in preferences all hold
// up against Cadence on Knock's Free plan?

import { useEffect, useState } from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import {
  KnockFeedProvider,
  KnockProvider,
  useKnockFeed,
  usePreferences,
} from "@knocklabs/react-core";
import type {
  FeedEventCallback,
  FeedItem,
  WorkflowPreferences,
} from "@knocklabs/client";
import type { Route } from "./+types/prototype.knock";
import { db } from "~/db";
import { courses, lessons, modules, users } from "~/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUserId } from "~/lib/session";
import {
  getEnvironmentPreferenceDefaultsPrototype,
  getKnockPrototypeConfig,
  resetUserPreferencesToEnvironmentDefaults,
  signKnockPrototypeUserToken,
  triggerDiscussionReplyPrototype,
  triggerNewEnrollmentPrototype,
  upsertKnockPrototypeRecipient,
  verifyKnockEnhancedSecurityGate,
} from "~/lib/knock-prototype.server";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";
import {
  CheckCircle2,
  Eye,
  MailCheck,
  Radio,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
  const config = getKnockPrototypeConfig();
  const currentUserId = await getCurrentUserId(request);
  const allUsers = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .all();

  const currentUser = currentUserId
    ? (allUsers.find((u) => u.id === currentUserId) ?? null)
    : null;

  let knockToken: string | null = null;
  let decodedToken: {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
  } | null = null;

  if (config.configured && currentUser) {
    await upsertKnockPrototypeRecipient(currentUser);
    const signed = await signKnockPrototypeUserToken(currentUser.id);
    knockToken = signed.token;
    decodedToken = signed.decoded;
  }

  const environmentDefaults = config.configured
    ? await getEnvironmentPreferenceDefaultsPrototype()
    : null;

  const sampleCourse = db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(courses)
    .where(eq(courses.slug, "introduction-to-typescript"))
    .get();

  return {
    configured: config.configured,
    publicApiKey: config.publicApiKey,
    feedChannelId: config.feedChannelId,
    currentUser,
    allUsers: allUsers.slice(0, 12),
    knockToken,
    decodedToken,
    environmentDefaults,
    sampleCourse: sampleCourse ?? {
      id: 1,
      title: "Introduction to TypeScript",
      slug: "introduction-to-typescript",
      instructorId: 2,
    },
  };
}

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "verify-token-gate") {
    if (!currentUserId) {
      return {
        intent,
        ok: false,
        error: "Select a user in DevUI first.",
      };
    }
    const probe = await verifyKnockEnhancedSecurityGate(currentUserId);
    return { intent, ok: true, probe };
  }

  if (intent === "trigger-discussion-reply") {
    const recipientId = Number(formData.get("recipientId") || currentUserId);
    const actorId = Number(formData.get("actorId") || 2);
    const replyExcerpt =
      String(formData.get("replyExcerpt") || "").trim() ||
      "Try running `npx tsc --init` in the project root first!";

    const recipient = db
      .select()
      .from(users)
      .where(eq(users.id, recipientId))
      .get();
    const actor = db
      .select()
      .from(users)
      .where(eq(users.id, actorId))
      .get();

    if (!recipient || !actor) {
      return { intent, ok: false, error: "Actor or recipient not found." };
    }

    const lesson =
      db.select().from(lessons).where(eq(lessons.id, 3)).get() ??
      db.select().from(lessons).get();
    const mod = lesson
      ? db.select().from(modules).where(eq(modules.id, lesson.moduleId)).get()
      : null;
    const course = mod
      ? db.select().from(courses).where(eq(courses.id, mod.courseId)).get()
      : null;

    const res = await triggerDiscussionReplyPrototype({
      actor,
      recipient,
      courseTitle: course?.title ?? "Introduction to TypeScript",
      courseSlug: course?.slug ?? "introduction-to-typescript",
      lessonId: lesson?.id ?? 3,
      lessonTitle: lesson?.title ?? "Lesson 3",
      replyExcerpt,
    });

    return {
      intent,
      ok: true,
      workflowRunId: res?.workflowRunId ?? null,
      summary: `Triggered discussion-reply from ${actor.name} → ${recipient.name} (id=${recipient.id})`,
    };
  }

  if (intent === "trigger-new-enrollment") {
    const instructorId = Number(formData.get("instructorId") || currentUserId);
    const studentId = Number(formData.get("studentId") || 5);

    const instructor = db
      .select()
      .from(users)
      .where(eq(users.id, instructorId))
      .get();
    const student = db
      .select()
      .from(users)
      .where(eq(users.id, studentId))
      .get();

    if (!instructor || !student) {
      return { intent, ok: false, error: "Student or Instructor not found." };
    }

    const res = await triggerNewEnrollmentPrototype({
      student,
      instructor,
      courseId: 1,
      courseTitle: "Introduction to TypeScript",
    });

    return {
      intent,
      ok: true,
      workflowRunId: res.workflowRunId,
      summary: `Triggered new-enrollment (${student.name} enrolled) → ${instructor.name} (id=${instructor.id}). Delivery depends on ${instructor.name}'s new-enrollment × in_app_feed preference!`,
    };
  }

  if (intent === "reset-preferences") {
    if (!currentUserId) {
      return { intent, ok: false, error: "Select a user in DevUI first." };
    }
    const resetSet =
      await resetUserPreferencesToEnvironmentDefaults(currentUserId);
    return {
      intent,
      ok: true,
      resetUserId: currentUserId,
      resetSet,
      summary: `Cleared recipient overrides for user ${currentUserId}; environment defaults now apply again.`,
    };
  }

  return { intent, ok: false, error: "Unknown intent" };
}

export default function KnockPrototypeRoute({
  loaderData,
}: Route.ComponentProps) {
  const {
    configured,
    publicApiKey,
    feedChannelId,
    currentUser,
    allUsers,
    knockToken,
    decodedToken,
    environmentDefaults,
  } = loaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);

  if (!configured) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle>Knock credentials missing</CardTitle>
            <CardDescription>
              Ensure <code>.env</code> contains <code>KNOCK_API_KEY</code>,{" "}
              <code>KNOCK_PUBLIC_API_KEY</code>,{" "}
              <code>KNOCK_FEED_CHANNEL_ID</code>, and{" "}
              <code>KNOCK_SIGNING_KEY</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 pb-28">
      {/* Prototype framing banner */}
      <div className="rounded-xl border-2 border-dashed border-amber-500/60 bg-amber-500/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            <Sparkles className="size-3.5" />
            Throwaway Prototype — Issue #35
          </span>
          <span className="text-xs text-muted-foreground">
            Vendor fit spike (not Notification Feed UI design)
          </span>
        </div>
        <h1 className="mt-2 text-xl font-bold">
          Does Knock hold up against Cadence?
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Spikes Knock&apos;s Free plan against the live Cadence app and DevUI
          switcher across all four confirmation gates: (1) RS256 signed user
          tokens + DevUI user switching, (2) Node SDK workflow triggering, (3)
          headless Notification Feed API, and (4) category × channel preferences
          with an off-by-default opt-in entry (new Enrollment → Instructor).
        </p>
      </div>

      {/* Action result toast/banner */}
      {actionData && (
        <div
          className={cn(
            "rounded-lg border px-4 py-3 text-sm",
            actionData.ok
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200"
              : "border-destructive/50 bg-destructive/10 text-destructive"
          )}
        >
          {"error" in actionData && actionData.error && (
            <p className="font-medium">{actionData.error}</p>
          )}
          {"summary" in actionData && actionData.summary && (
            <p className="font-medium">
              {actionData.summary}
              {"workflowRunId" in actionData && actionData.workflowRunId ? (
                <span className="ml-2 font-mono text-xs opacity-80">
                  (run: {actionData.workflowRunId})
                </span>
              ) : null}
            </p>
          )}
          {"probe" in actionData && actionData.probe && (
            <div className="mt-1 space-y-1 font-mono text-xs">
              <div>
                Enhanced security probe for user{" "}
                <strong>{actionData.probe.checkedUserId}</strong>:
              </div>
              <div>
                • Unsigned public-key request → HTTP{" "}
                <strong>{actionData.probe.unsigned.status}</strong> (
                {actionData.probe.unsigned.code ?? "rejected"})
              </div>
              <div>
                • Mismatched user token (sub=
                {actionData.probe.mismatchedToken.otherUserId}) → HTTP{" "}
                <strong>{actionData.probe.mismatchedToken.status}</strong>
              </div>
              <div>
                • Matching RS256 user token (sub=
                {actionData.probe.checkedUserId}) → HTTP{" "}
                <strong>{actionData.probe.validSignedToken.status} OK</strong>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* CHECK 1: Signed user tokens + DevUI */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="size-4 text-primary" />
                1. Signed User Tokens &amp; DevUI Switcher
              </CardTitle>
              <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs">
                RS256
              </span>
            </div>
            <CardDescription>
              Loader signs a short-lived RS256 JWT for whichever person the
              floating DevUI panel (bottom-right) selects. Switching users
              revalidates the loader and switches the Notification Feed live.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Selected DevUI person
                </span>
                {currentUser ? (
                  <span className="font-medium">
                    {currentUser.name}{" "}
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
                      id={currentUser.id} · {currentUser.role}
                    </span>
                  </span>
                ) : (
                  <span className="italic text-amber-600">
                    None — pick a user in DevUI (bottom-right)
                  </span>
                )}
              </div>
              {decodedToken && (
                <>
                  <div className="border-t pt-2 font-mono text-xs">
                    <div className="text-muted-foreground">JWT Header:</div>
                    <div>{JSON.stringify(decodedToken.header)}</div>
                  </div>
                  <div className="font-mono text-xs">
                    <div className="text-muted-foreground">JWT Claims:</div>
                    <div>{JSON.stringify(decodedToken.payload)}</div>
                  </div>
                </>
              )}
            </div>

            <Form method="post">
              <input type="hidden" name="intent" value="verify-token-gate" />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={!currentUser || isSubmitting}
              >
                Verify Enhanced Security Gate (400 / 403 / 200)
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* CHECK 2: Triggering via Node SDK */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4 text-primary" />
              2. Node SDK Triggering (Discussion Reply)
            </CardTitle>
            <CardDescription>
              Fires Knock workflow <code>discussion-reply</code> via{" "}
              <code>@knocklabs/node</code>. Also wired into real{" "}
              <Link
                to="/courses/introduction-to-typescript/lessons/3"
                className="underline font-medium text-foreground"
              >
                Lesson 3 Discussion Replies
              </Link>{" "}
              (e.g. switch to Sarah Chen, reply to Emma Wilson&apos;s Discussion
              Question, then switch to Emma Wilson).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-3 text-sm">
              <input
                type="hidden"
                name="intent"
                value="trigger-discussion-reply"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Replier (actor)
                  </span>
                  <select
                    name="actorId"
                    defaultValue={currentUser?.id === 2 ? 5 : 2}
                    className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                  >
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role}, #{u.id})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-xs text-muted-foreground">
                    Question author (recipient)
                  </span>
                  <select
                    name="recipientId"
                    key={currentUser?.id ?? "none"}
                    defaultValue={currentUser?.id ?? 5}
                    className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                  >
                    {allUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role}, #{u.id})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs text-muted-foreground">
                  Discussion Reply excerpt
                </span>
                <input
                  type="text"
                  name="replyExcerpt"
                  defaultValue="Try running `npx tsc --init` in the project root first!"
                  className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                />
              </label>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                Trigger Discussion Reply Notification
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* Client-only KnockProvider + KnockFeedProvider mount gate (SSR safe) */}
      {!hydrated ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Connecting headless Knock client…
          </CardContent>
        </Card>
      ) : !currentUser || !knockToken ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Select any Student, Instructor, or Platform Admin in the{" "}
            <strong>DevUI</strong> panel (bottom-right) to authenticate the
            headless Notification Feed and Preferences panels.
          </CardContent>
        </Card>
      ) : (
        <KnockProvider
          apiKey={publicApiKey}
          user={{
            id: String(currentUser.id),
            name: currentUser.name,
            email: currentUser.email,
          }}
          userToken={knockToken}
          enabled={Boolean(currentUser && knockToken)}
        >
          <KnockFeedProvider feedId={feedChannelId}>
            <div className="grid gap-6 lg:grid-cols-2">
              <HeadlessFeedInspector currentUser={currentUser} />
              <PreferencesInspector
                currentUser={currentUser}
                allUsers={allUsers}
                environmentDefaults={environmentDefaults}
                resetNonce={
                  actionData &&
                  "resetSet" in actionData &&
                  actionData.ok
                    ? JSON.stringify(actionData.resetSet)
                    : null
                }
              />
            </div>
          </KnockFeedProvider>
        </KnockProvider>
      )}
    </div>
  );
}

function HeadlessFeedInspector({
  currentUser,
}: {
  currentUser: { id: number; name: string; role: string };
}) {
  const { feedClient, useFeedStore } = useKnockFeed();
  const items = useFeedStore((s) => s.items);
  const metadata = useFeedStore((s) => s.metadata);
  const loading = useFeedStore((s) => s.loading);
  const [realtimeEvents, setRealtimeEvents] = useState<string[]>([]);

  useEffect(() => {
    feedClient.fetch();
    const handler: FeedEventCallback = ({ items: incoming }) => {
      setRealtimeEvents((prev) => [
        `${new Date().toLocaleTimeString()} — ${incoming.length} realtime item(s) via WebSocket`,
        ...prev.slice(0, 4),
      ]);
    };
    feedClient.on("items.received.realtime", handler);
    return () => {
      feedClient.off("items.received.realtime", handler);
    };
  }, [feedClient]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="size-4 text-emerald-600" />
            3. Headless Notification Feed API
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            @knocklabs/react-core
          </span>
        </div>
        <CardDescription>
          Live store state for <strong>{currentUser.name}</strong> (id=
          {currentUser.id}). Switching users in DevUI re-authenticates and
          swaps this feed without reloading.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Live counters */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border bg-muted/40 p-2.5">
            <div className="text-xs text-muted-foreground">total_count</div>
            <div className="mt-0.5 font-mono text-xl font-bold">
              {metadata.total_count}
            </div>
          </div>
          <div className="rounded-lg border bg-primary/5 p-2.5">
            <div className="text-xs text-muted-foreground">unread_count</div>
            <div className="mt-0.5 font-mono text-xl font-bold text-primary">
              {metadata.unread_count}
            </div>
          </div>
          <div className="rounded-lg border bg-amber-500/5 p-2.5">
            <div className="text-xs text-muted-foreground">unseen_count</div>
            <div className="mt-0.5 font-mono text-xl font-bold text-amber-600 dark:text-amber-400">
              {metadata.unseen_count}
            </div>
          </div>
        </div>

        {/* Bulk controls */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => feedClient.markAllAsSeen()}
          >
            <Eye className="mr-1.5 size-3.5" />
            markAllAsSeen()
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => feedClient.markAllAsRead()}
          >
            <MailCheck className="mr-1.5 size-3.5" />
            markAllAsRead()
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => feedClient.fetch()}
          >
            <RefreshCw
              className={cn("mr-1.5 size-3.5", loading && "animate-spin")}
            />
            fetch()
          </Button>
        </div>

        {realtimeEvents.length > 0 && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 font-mono text-xs text-emerald-800 dark:text-emerald-300">
            {realtimeEvents.map((ev, i) => (
              <div key={i}>⚡ {ev}</div>
            ))}
          </div>
        )}

        {/* Feed items */}
        <div className="max-h-96 space-y-2.5 overflow-y-auto pr-1">
          {items.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {loading
                ? "Loading feed items…"
                : `No Notifications in ${currentUser.name}'s feed yet. Trigger one in Panel 2 or Panel 4!`}
            </div>
          ) : (
            items.map((item: FeedItem) => {
              const bodyBlock = item.blocks.find((b) => b.name === "body");
              const actionBlock = item.blocks.find(
                (b) => b.name === "action_url"
              );
              const renderedHtml =
                bodyBlock && "rendered" in bodyBlock ? bodyBlock.rendered : "";
              const actionUrl =
                actionBlock && "rendered" in actionBlock
                  ? actionBlock.rendered
                  : null;
              const isUnread = !item.read_at;
              const isUnseen = !item.seen_at;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border p-3 text-sm transition-colors",
                    isUnread ? "border-primary/40 bg-primary/5" : "bg-card"
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-muted-foreground">
                    <span className="font-mono font-medium text-foreground">
                      {item.source.key}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-[11px]",
                          isUnseen
                            ? "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                            : "bg-muted"
                        )}
                      >
                        {isUnseen ? "unseen" : "seen"}
                      </span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-[11px]",
                          isUnread
                            ? "bg-primary/20 text-primary"
                            : "bg-muted"
                        )}
                      >
                        {isUnread ? "unread" : "read"}
                      </span>
                    </div>
                  </div>

                  {renderedHtml && (
                    <div
                      className="prose prose-sm dark:prose-invert mt-1.5 max-w-none"
                      dangerouslySetInnerHTML={{ __html: renderedHtml }}
                    />
                  )}

                  {actionUrl && (
                    <div className="mt-1 text-xs">
                      <Link
                        to={actionUrl}
                        className="font-mono text-primary underline"
                      >
                        action_url → {actionUrl}
                      </Link>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      onClick={() => feedClient.markAsSeen(item)}
                      disabled={!isUnseen}
                    >
                      markAsSeen
                    </Button>
                    {isUnread ? (
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        onClick={() => feedClient.markAsRead(item)}
                      >
                        markAsRead
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => feedClient.markAsUnread(item)}
                      >
                        markAsUnread
                      </Button>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {new Date(item.inserted_at).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function readCategoryChannelBool(
  categories: WorkflowPreferences | null | undefined,
  category: string,
  channelType: "in_app_feed" | "email",
  fallback: boolean
): boolean {
  const entry = categories?.[category];
  if (typeof entry === "boolean") return entry;
  if (entry && "channel_types" in entry) {
    const val = entry.channel_types[channelType];
    if (typeof val === "boolean") return val;
  }
  return fallback;
}

function PreferencesInspector({
  currentUser,
  allUsers,
  environmentDefaults,
  resetNonce,
}: {
  currentUser: { id: number; name: string; role: string };
  allUsers: Array<{ id: number; name: string; role: string }>;
  environmentDefaults: unknown;
  resetNonce: string | null;
}) {
  const { preferences, setPreferences, getAllPreferences, isLoading } =
    usePreferences();

  useEffect(() => {
    if (resetNonce) {
      getAllPreferences();
    }
  }, [resetNonce, getAllPreferences]);

  const categories = preferences?.categories;
  const rows: Array<{
    key: "discussions" | "new-enrollment";
    label: string;
    note: string;
    defaultVal: boolean;
  }> = [
    {
      key: "discussions",
      label: "discussions (Discussion Reply / Question)",
      note: "On by default in environment defaults",
      defaultVal: true,
    },
    {
      key: "new-enrollment",
      label: "new-enrollment (new Enrollment → Instructor)",
      note: "OFF by default in environment defaults (opt-in)",
      defaultVal: false,
    },
  ];

  function togglePreference(
    category: "discussions" | "new-enrollment",
    channelType: "in_app_feed" | "email",
    currentValue: boolean
  ) {
    const nextDiscussionsInApp = readCategoryChannelBool(
      categories,
      "discussions",
      "in_app_feed",
      true
    );
    const nextDiscussionsEmail = readCategoryChannelBool(
      categories,
      "discussions",
      "email",
      true
    );
    const nextEnrollmentInApp = readCategoryChannelBool(
      categories,
      "new-enrollment",
      "in_app_feed",
      false
    );
    const nextEnrollmentEmail = readCategoryChannelBool(
      categories,
      "new-enrollment",
      "email",
      false
    );

    const nextCategories: WorkflowPreferences = {
      ...categories,
      discussions: {
        channel_types: {
          in_app_feed:
            category === "discussions" && channelType === "in_app_feed"
              ? !currentValue
              : nextDiscussionsInApp,
          email:
            category === "discussions" && channelType === "email"
              ? !currentValue
              : nextDiscussionsEmail,
        },
      },
      "new-enrollment": {
        channel_types: {
          in_app_feed:
            category === "new-enrollment" && channelType === "in_app_feed"
              ? !currentValue
              : nextEnrollmentInApp,
          email:
            category === "new-enrollment" && channelType === "email"
              ? !currentValue
              : nextEnrollmentEmail,
        },
      },
    };

    setPreferences({ categories: nextCategories });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="size-4 text-primary" />
            4. Category × Channel Preferences (Opt-In)
          </CardTitle>
          <span className="font-mono text-xs text-muted-foreground">
            usePreferences()
          </span>
        </div>
        <CardDescription>
          Environment-level default <code>PreferenceSet</code> sets{" "}
          <code>new-enrollment</code> to <code>false</code> across channels.{" "}
          <strong>{currentUser.name}</strong> inherits <code>false</code> until
          explicitly opting in per channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Matrix */}
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-center font-medium">
                  in_app_feed
                </th>
                <th className="px-3 py-2 text-center font-medium">email</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => {
                const inApp = readCategoryChannelBool(
                  categories,
                  row.key,
                  "in_app_feed",
                  row.defaultVal
                );
                const email = readCategoryChannelBool(
                  categories,
                  row.key,
                  "email",
                  row.defaultVal
                );
                return (
                  <tr key={row.key}>
                    <td className="px-3 py-2.5">
                      <div className="font-medium text-foreground">
                        {row.label}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {row.note}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Button
                        type="button"
                        size="xs"
                        variant={inApp ? "default" : "outline"}
                        disabled={isLoading}
                        onClick={() =>
                          togglePreference(row.key, "in_app_feed", inApp)
                        }
                      >
                        {inApp ? "ON (true)" : "OFF (false)"}
                      </Button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <Button
                        type="button"
                        size="xs"
                        variant={email ? "default" : "outline"}
                        disabled={isLoading}
                        onClick={() =>
                          togglePreference(row.key, "email", email)
                        }
                      >
                        {email ? "ON (true)" : "OFF (false)"}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Trigger new-enrollment test + reset */}
        <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
          <div className="text-xs font-medium">
            Test opt-in suppression vs delivery on{" "}
            <strong>{currentUser.name}</strong>:
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Form method="post">
              <input
                type="hidden"
                name="intent"
                value="trigger-new-enrollment"
              />
              <input
                type="hidden"
                name="instructorId"
                value={currentUser.id}
              />
              <input
                type="hidden"
                name="studentId"
                value={
                  allUsers.find((u) => u.id !== currentUser.id)?.id ?? 5
                }
              />
              <Button type="submit" size="sm">
                <CheckCircle2 className="mr-1.5 size-3.5" />
                Trigger new-enrollment → {currentUser.name}
              </Button>
            </Form>

            <Form method="post" reloadDocument>
              <input type="hidden" name="intent" value="reset-preferences" />
              <Button type="submit" size="sm" variant="outline">
                Reset {currentUser.name} to Environment Defaults
              </Button>
            </Form>
          </div>
          <p className="text-[11px] text-muted-foreground">
            1. With <code>new-enrollment × in_app_feed = OFF (false)</code>,
            click Trigger — Knock suppresses delivery and{" "}
            <code>total_count</code> stays unchanged. 2. Toggle{" "}
            <code>in_app_feed</code> to <code>ON (true)</code> (leaving{" "}
            <code>email</code> OFF) and click Trigger again — the Notification
            arrives in Panel 3 immediately.
          </p>
        </div>

        {/* Raw surfaced state */}
        <details className="rounded-lg border bg-muted/20 p-2.5 text-xs">
          <summary className="cursor-pointer font-mono font-medium">
            Raw PreferenceSet state (merged user vs environment default)
          </summary>
          <div className="mt-2 space-y-2 font-mono text-[11px]">
            <div>
              <div className="text-muted-foreground">
                Current user merged PreferenceSet (usePreferences):
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-background p-2">
                {JSON.stringify(preferences ?? null, null, 2)}
              </pre>
            </div>
            <div>
              <div className="text-muted-foreground">
                Environment default (GET /v1/environments/development/defaults):
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-background p-2">
                {JSON.stringify(environmentDefaults, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
