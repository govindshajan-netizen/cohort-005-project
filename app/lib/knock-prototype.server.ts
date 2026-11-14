// THROWAWAY PROTOTYPE — Vendor spike for #35 ("Does Knock hold up against Cadence?").
// Do not merge to main.

import { existsSync } from "node:fs";
import Knock, { signUserToken } from "@knocklabs/node";

let envLoaded = false;

export function ensureKnockEnvLoaded() {
  if (envLoaded || process.env.VITEST) return;
  envLoaded = true;
  if (!process.env.KNOCK_API_KEY && existsSync(".env")) {
    try {
      process.loadEnvFile(".env");
    } catch {
      // Ignore if .env cannot be parsed
    }
  }
}

export function getKnockPrototypeConfig() {
  ensureKnockEnvLoaded();
  const apiKey = process.env.KNOCK_API_KEY ?? "";
  const publicApiKey = process.env.KNOCK_PUBLIC_API_KEY ?? "";
  const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID ?? "";
  const signingKey = process.env.KNOCK_SIGNING_KEY ?? "";
  const serviceToken = process.env.KNOCK_SERVICE_TOKEN ?? "";

  return {
    configured: Boolean(apiKey && publicApiKey && feedChannelId && signingKey),
    apiKey,
    publicApiKey,
    feedChannelId,
    signingKey,
    serviceToken,
  };
}

let cachedKnockClient: Knock | null = null;

function getKnockServerClient(): Knock {
  const { apiKey } = getKnockPrototypeConfig();
  if (!apiKey) {
    throw new Error("Missing KNOCK_API_KEY in .env");
  }
  if (!cachedKnockClient) {
    cachedKnockClient = new Knock({ apiKey });
  }
  return cachedKnockClient;
}

export interface DecodedJwtPreview {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

function decodeJwtUnverified(token: string): DecodedJwtPreview | null {
  try {
    const [h, p] = token.split(".");
    if (!h || !p) return null;
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(p, "base64url").toString("utf8")),
    };
  } catch {
    return null;
  }
}

export async function signKnockPrototypeUserToken(userId: number) {
  const { signingKey } = getKnockPrototypeConfig();
  const token = await signUserToken(String(userId), {
    signingKey,
    expiresInSeconds: 3600,
  });
  return {
    token,
    decoded: decodeJwtUnverified(token),
  };
}

export async function upsertKnockPrototypeRecipient(user: {
  id: number;
  name: string;
  email: string;
}) {
  const knock = getKnockServerClient();
  await knock.users.update(String(user.id), {
    name: user.name,
    email: user.email,
  });
}

export async function verifyKnockEnhancedSecurityGate(userId: number) {
  const { publicApiKey, feedChannelId } = getKnockPrototypeConfig();
  const { token: validToken } = await signKnockPrototypeUserToken(userId);
  const otherUserId = userId === 1 ? 2 : 1;
  const { token: otherUserToken } =
    await signKnockPrototypeUserToken(otherUserId);

  const feedUrl = `https://api.knock.app/v1/users/${userId}/feeds/${feedChannelId}`;

  const [unsignedRes, mismatchedRes, validRes] = await Promise.all([
    fetch(feedUrl, {
      headers: { Authorization: `Bearer ${publicApiKey}` },
    }),
    fetch(feedUrl, {
      headers: {
        Authorization: `Bearer ${publicApiKey}`,
        "X-Knock-User-Token": otherUserToken,
      },
    }),
    fetch(feedUrl, {
      headers: {
        Authorization: `Bearer ${publicApiKey}`,
        "X-Knock-User-Token": validToken,
      },
    }),
  ]);

  const unsignedBody = await unsignedRes.json().catch(() => null);
  const mismatchedBody = await mismatchedRes.json().catch(() => null);

  return {
    checkedUserId: String(userId),
    unsigned: {
      status: unsignedRes.status,
      code: unsignedBody?.code ?? null,
    },
    mismatchedToken: {
      otherUserId: String(otherUserId),
      status: mismatchedRes.status,
      code: mismatchedBody?.code ?? null,
    },
    validSignedToken: {
      status: validRes.status,
    },
  };
}

export async function triggerDiscussionReplyPrototype(params: {
  actor: { id: number; name: string; email: string };
  recipient: { id: number; name: string; email: string };
  courseTitle: string;
  courseSlug: string;
  lessonId: number;
  lessonTitle: string;
  replyExcerpt: string;
}) {
  const { configured } = getKnockPrototypeConfig();
  if (!configured || process.env.VITEST) return null;

  const knock = getKnockServerClient();
  const result = await knock.workflows.trigger("discussion-reply", {
    actor: {
      id: String(params.actor.id),
      name: params.actor.name,
      email: params.actor.email,
    },
    recipients: [
      {
        id: String(params.recipient.id),
        name: params.recipient.name,
        email: params.recipient.email,
      },
    ],
    data: {
      courseTitle: params.courseTitle,
      courseSlug: params.courseSlug,
      lessonId: params.lessonId,
      lessonTitle: params.lessonTitle,
      replyExcerpt: params.replyExcerpt.slice(0, 140),
    },
  });

  return { workflowRunId: result.workflow_run_id };
}

export async function triggerNewEnrollmentPrototype(params: {
  student: { id: number; name: string; email: string };
  instructor: { id: number; name: string; email: string };
  courseId: number;
  courseTitle: string;
}) {
  const knock = getKnockServerClient();
  // Identify recipient without overwriting their preferences
  await knock.users.update(String(params.instructor.id), {
    name: params.instructor.name,
    email: params.instructor.email,
  });

  const result = await knock.workflows.trigger("new-enrollment", {
    actor: {
      id: String(params.student.id),
      name: params.student.name,
      email: params.student.email,
    },
    recipients: [String(params.instructor.id)],
    data: {
      courseId: params.courseId,
      courseTitle: params.courseTitle,
    },
  });

  return { workflowRunId: result.workflow_run_id };
}

export async function resetUserPreferencesToEnvironmentDefaults(userId: number) {
  const knock = getKnockServerClient();
  return knock.users.setPreferences(String(userId), "default", {});
}

export async function getEnvironmentPreferenceDefaultsPrototype() {
  const { serviceToken } = getKnockPrototypeConfig();
  if (!serviceToken) return null;
  try {
    const res = await fetch(
      "https://control.knock.app/v1/environments/development/defaults",
      {
        headers: { Authorization: `Bearer ${serviceToken}` },
      }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
