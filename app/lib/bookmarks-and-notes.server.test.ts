import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { CourseStatus, UserRole } from "~/db/schema";
import {
  getNoteForLesson,
  isBookmarked,
  listBookmarksForStudent,
  listNotesForStudent,
  saveNote,
  toggleBookmark,
} from "./bookmarks-and-notes.server";
import {
  approveRefundRequest,
  raiseRefundRequest,
} from "./refunds.server";
import { isEnrolled } from "./enrollments.server";
import { fakeNotifications } from "./notifications.fake.server";

type TestDb = ReturnType<typeof createTestDb>;

const T0 = new Date(2026, 9, 6, 12, 0, 0);
const T1 = new Date(2026, 9, 6, 12, 5, 0);
const T2 = new Date(2026, 9, 6, 12, 10, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let moduleId: number;
let lesson1Id: number;
let lesson2Id: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  moduleId = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Module 1", position: 1 })
    .returning()
    .get().id;

  lesson1Id = db
    .insert(schema.lessons)
    .values({ moduleId, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  lesson2Id = db
    .insert(schema.lessons)
    .values({ moduleId, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

function addStudent(name: string) {
  return db
    .insert(schema.users)
    .values({
      name,
      email: `${name.toLowerCase()}@example.com`,
      role: UserRole.Student,
    })
    .returning()
    .get();
}

describe("toggling a Bookmark", () => {
  it("creates a Bookmark when the Lesson has none, and removes it on a second toggle", () => {
    expect(isBookmarked(db, base.user.id, lesson1Id)).toBe(false);

    expect(toggleBookmark(db, base.user.id, lesson1Id, T0)).toEqual({
      ok: true,
      bookmarked: true,
    });
    expect(isBookmarked(db, base.user.id, lesson1Id)).toBe(true);

    expect(toggleBookmark(db, base.user.id, lesson1Id, T1)).toEqual({
      ok: true,
      bookmarked: false,
    });
    expect(isBookmarked(db, base.user.id, lesson1Id)).toBe(false);
  });

  it("refuses to bookmark a Lesson that does not exist", () => {
    expect(toggleBookmark(db, base.user.id, 9999, T0)).toEqual({
      ok: false,
      error: "Lesson not found",
    });
  });

  it("enforces at most one Bookmark per Student per Lesson at the database level", () => {
    toggleBookmark(db, base.user.id, lesson1Id, T0);

    expect(() =>
      db
        .insert(schema.bookmarks)
        .values({
          userId: base.user.id,
          lessonId: lesson1Id,
          createdAt: T1.toISOString(),
        })
        .run()
    ).toThrow();

    expect(listBookmarksForStudent(db, base.user.id)).toHaveLength(1);
  });
});

describe("saving a Note", () => {
  it("creates a Note with the body trimmed, then replaces the body and advances updatedAt on re-save", () => {
    expect(getNoteForLesson(db, base.user.id, lesson1Id)).toBeNull();

    const first = saveNote(
      db,
      base.user.id,
      lesson1Id,
      "  Remember #1 and *important* plain text  ",
      T0
    );
    expect(first).toMatchObject({
      ok: true,
      note: {
        body: "Remember #1 and *important* plain text",
        createdAt: T0.toISOString(),
        updatedAt: T0.toISOString(),
      },
    });

    const second = saveNote(
      db,
      base.user.id,
      lesson1Id,
      "Updated thought\nsecond line",
      T1
    );
    expect(second).toMatchObject({
      ok: true,
      note: {
        body: "Updated thought\nsecond line",
        createdAt: T0.toISOString(),
        updatedAt: T1.toISOString(),
      },
    });

    expect(getNoteForLesson(db, base.user.id, lesson1Id)).toEqual({
      body: "Updated thought\nsecond line",
      createdAt: T0.toISOString(),
      updatedAt: T1.toISOString(),
    });
    expect(listNotesForStudent(db, base.user.id)).toHaveLength(1);
  });

  it("enforces at most one Note per Student per Lesson at the database level", () => {
    saveNote(db, base.user.id, lesson1Id, "First note", T0);

    expect(() =>
      db
        .insert(schema.notes)
        .values({
          userId: base.user.id,
          lessonId: lesson1Id,
          body: "Duplicate",
          createdAt: T1.toISOString(),
          updatedAt: T1.toISOString(),
        })
        .run()
    ).toThrow();
  });

  it("accepts a Note of 2,000 characters and refuses one over 2,000 characters", () => {
    const exact = "a".repeat(2000);
    expect(saveNote(db, base.user.id, lesson1Id, exact, T0)).toMatchObject({
      ok: true,
      note: { body: exact },
    });

    const tooLong = "b".repeat(2001);
    expect(saveNote(db, base.user.id, lesson1Id, tooLong, T1)).toEqual({
      ok: false,
      error: "Note must be 2,000 characters or fewer",
    });

    // Previous valid Note remains intact when an over-long edit is refused.
    expect(getNoteForLesson(db, base.user.id, lesson1Id)?.body).toBe(exact);
  });

  it("refuses a whitespace-only Note and a nonexistent Lesson", () => {
    expect(saveNote(db, base.user.id, lesson1Id, "   ", T0)).toEqual({
      ok: false,
      error: "Note cannot be empty",
    });

    expect(saveNote(db, base.user.id, 9999, "Valid note", T0)).toEqual({
      ok: false,
      error: "Lesson not found",
    });
  });
});

describe("the Saved lists for a Student", () => {
  it("lists only that Student's Bookmarks and Notes, newest first, with Lesson and Course details", () => {
    const otherCourse = db
      .insert(schema.courses)
      .values({
        title: "Second Course",
        slug: "second-course",
        description: "Another course",
        salesCopy: "Sales copy",
        instructorId: base.instructor.id,
        categoryId: base.category.id,
        status: CourseStatus.Published,
      })
      .returning()
      .get();
    const otherModule = db
      .insert(schema.modules)
      .values({ courseId: otherCourse.id, title: "Deep Dive", position: 1 })
      .returning()
      .get();
    const otherLesson = db
      .insert(schema.lessons)
      .values({
        moduleId: otherModule.id,
        title: "Other Course Lesson",
        position: 1,
      })
      .returning()
      .get();

    const ben = addStudent("Ben");

    // Current Student bookmarks two Lessons at T0 then T1
    toggleBookmark(db, base.user.id, lesson1Id, T0);
    toggleBookmark(db, base.user.id, otherLesson.id, T1);
    // Another Student bookmarks Lesson 2
    toggleBookmark(db, ben.id, lesson2Id, T2);

    // Current Student writes a Note on Lesson 1 at T0, Lesson 2 at T1, then edits Lesson 1 at T2
    saveNote(db, base.user.id, lesson1Id, "Initial note", T0);
    saveNote(db, base.user.id, otherLesson.id, "Second course note", T1);
    saveNote(db, base.user.id, lesson1Id, "Edited most recently", T2);
    // Another Student writes a Note on Lesson 2
    saveNote(db, ben.id, lesson2Id, "Ben's private note", T2);

    expect(listBookmarksForStudent(db, base.user.id)).toMatchObject([
      {
        lessonId: otherLesson.id,
        lessonTitle: "Other Course Lesson",
        courseTitle: "Second Course",
        courseSlug: "second-course",
      },
      {
        lessonId: lesson1Id,
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
      },
    ]);

    expect(listNotesForStudent(db, base.user.id)).toMatchObject([
      {
        lessonId: lesson1Id,
        lessonTitle: "Lesson 1",
        courseTitle: "Test Course",
        courseSlug: "test-course",
        body: "Edited most recently",
        updatedAt: T2.toISOString(),
      },
      {
        lessonId: otherLesson.id,
        lessonTitle: "Other Course Lesson",
        courseTitle: "Second Course",
        courseSlug: "second-course",
        body: "Second course note",
        updatedAt: T1.toISOString(),
      },
    ]);
  });
});

describe("approving a Refund", () => {
  it("leaves the Student's Bookmarks and Notes in place when their Enrollment ends", async () => {
    const notifications = fakeNotifications();
    const platformAdmin = db
      .insert(schema.users)
      .values({
        name: "Pat Admin",
        email: "pat@example.com",
        role: UserRole.Admin,
      })
      .returning()
      .get();

    const purchase = db
      .insert(schema.purchases)
      .values({
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 7900,
        createdAt: T0.toISOString(),
      })
      .returning()
      .get();
    db.insert(schema.enrollments)
      .values({ userId: base.user.id, courseId: base.course.id })
      .run();

    toggleBookmark(db, base.user.id, lesson1Id, T0);
    saveNote(db, base.user.id, lesson1Id, "Keep this if I come back", T0);

    const raised = await raiseRefundRequest(
      db,
      purchase.id,
      base.user.id,
      "Need to pause for now",
      T1,
      notifications
    );
    if (!raised.ok) throw new Error("Expected Refund Request to succeed");

    const approved = await approveRefundRequest(
      db,
      raised.refundRequestId,
      platformAdmin.id,
      null,
      T2,
      notifications
    );
    expect(approved.ok).toBe(true);
    expect(isEnrolled(db, base.user.id, base.course.id)).toBe(false);

    expect(isBookmarked(db, base.user.id, lesson1Id)).toBe(true);
    expect(getNoteForLesson(db, base.user.id, lesson1Id)).toMatchObject({
      body: "Keep this if I come back",
    });
    expect(listBookmarksForStudent(db, base.user.id)).toHaveLength(1);
    expect(listNotesForStudent(db, base.user.id)).toHaveLength(1);
  });
});
