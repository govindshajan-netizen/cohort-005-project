import { and, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { bookmarks, courses, lessons, modules, notes } from "~/db/schema";
import { MAX_NOTE_LENGTH, MIN_NOTE_LENGTH } from "~/lib/notes";

// ─── Bookmarks and Notes ───
// Something a Student attaches to a Lesson for themselves and nobody else:
// a Bookmark flags a Lesson to find it again, and a Note holds the Student's
// private plain-text writing on that Lesson. See GLOSSARY.md for the language.
//
// Every function takes the database first, so tests can hand in an in-memory
// one. Uses positional parameters (project convention).

export type Db = BetterSQLite3Database<typeof schema>;

type Note = typeof notes.$inferSelect;

function lessonExists(db: Db, lessonId: number): boolean {
  return !!db
    .select({ id: lessons.id })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .get();
}

/** Whether the Student currently has a Bookmark on the Lesson. */
export function isBookmarked(
  db: Db,
  studentId: number,
  lessonId: number
): boolean {
  return !!db
    .select({ id: bookmarks.id })
    .from(bookmarks)
    .where(
      and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
    )
    .get();
}

export type ToggleBookmarkResult =
  | { ok: true; bookmarked: boolean }
  | { ok: false; error: string };

/**
 * Adds a Bookmark on the Lesson when the Student does not have one, or removes
 * it when they do. Returns whether the Lesson is now bookmarked.
 */
export function toggleBookmark(
  db: Db,
  studentId: number,
  lessonId: number,
  now: Date = new Date()
): ToggleBookmarkResult {
  if (!lessonExists(db, lessonId)) {
    return { ok: false, error: "Lesson not found" };
  }

  return db.transaction((tx): ToggleBookmarkResult => {
    const deleted = tx
      .delete(bookmarks)
      .where(
        and(eq(bookmarks.userId, studentId), eq(bookmarks.lessonId, lessonId))
      )
      .run();

    if (deleted.changes > 0) {
      return { ok: true, bookmarked: false };
    }

    tx.insert(bookmarks)
      .values({
        userId: studentId,
        lessonId,
        createdAt: now.toISOString(),
      })
      .run();

    return { ok: true, bookmarked: true };
  });
}

/** Reads the Student's own Note on the Lesson, or null when they have none. */
export function getNoteForLesson(
  db: Db,
  studentId: number,
  lessonId: number
): { body: string; createdAt: string; updatedAt: string } | null {
  const row = db
    .select({
      body: notes.body,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
    })
    .from(notes)
    .where(and(eq(notes.userId, studentId), eq(notes.lessonId, lessonId)))
    .get();

  return row ?? null;
}

export type SaveNoteResult =
  | { ok: true; note: Note }
  | { ok: false; error: string };

/**
 * Creates the Student's Note on the Lesson, or replaces its body and advances
 * `updatedAt` ("last edited") while keeping `createdAt` unchanged.
 */
export function saveNote(
  db: Db,
  studentId: number,
  lessonId: number,
  body: string,
  now: Date = new Date()
): SaveNoteResult {
  const trimmed = body.trim();
  if (trimmed.length < MIN_NOTE_LENGTH) {
    return { ok: false, error: "Note cannot be empty" };
  }
  if (trimmed.length > MAX_NOTE_LENGTH) {
    return {
      ok: false,
      error: `Note must be ${MAX_NOTE_LENGTH.toLocaleString("en-US")} characters or fewer`,
    };
  }

  if (!lessonExists(db, lessonId)) {
    return { ok: false, error: "Lesson not found" };
  }

  const nowIso = now.toISOString();
  const note = db
    .insert(notes)
    .values({
      userId: studentId,
      lessonId,
      body: trimmed,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .onConflictDoUpdate({
      target: [notes.userId, notes.lessonId],
      set: {
        body: trimmed,
        updatedAt: nowIso,
      },
    })
    .returning()
    .get();

  return { ok: true, note };
}

export type StudentBookmarkRow = {
  id: number;
  createdAt: string;
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
};

/**
 * Lists the Student's own Bookmarks joined to their Lesson and Course, ordered
 * by creation time, newest first.
 */
export function listBookmarksForStudent(
  db: Db,
  studentId: number
): StudentBookmarkRow[] {
  return db
    .select({
      id: bookmarks.id,
      createdAt: bookmarks.createdAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(bookmarks)
    .innerJoin(lessons, eq(bookmarks.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(bookmarks.userId, studentId))
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
    .all();
}

export type StudentNoteRow = {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  lessonId: number;
  lessonTitle: string;
  moduleTitle: string;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
};

/**
 * Lists the Student's own Notes joined to their Lesson and Course, ordered by
 * "last edited" (`updatedAt`) time, newest first.
 */
export function listNotesForStudent(
  db: Db,
  studentId: number
): StudentNoteRow[] {
  return db
    .select({
      id: notes.id,
      body: notes.body,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt,
      lessonId: lessons.id,
      lessonTitle: lessons.title,
      moduleTitle: modules.title,
      courseId: courses.id,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(notes)
    .innerJoin(lessons, eq(notes.lessonId, lessons.id))
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(notes.userId, studentId))
    .orderBy(desc(notes.updatedAt), desc(notes.id))
    .all();
}
