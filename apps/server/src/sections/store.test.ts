import { describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openDb } from "../db";
import { createSectionsStore } from "./store";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "syllabusops-sectionsdb-")
  );
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

describe("createSectionsStore", () => {
  test("upsert/list/delete section rows", async () => {
    await withTempDir(async (stateDir) => {
      const db = await openDb({ stateDir });
      const store = createSectionsStore(db);

      const first = store.upsert({
        courseSlug: "bio101",
        title: "Unit 2 Cells",
        startDate: "2026-02-10",
        endDate: "2026-02-20",
        description: "Cells and ATP",
      });
      expect(first.course_slug).toBe("bio101");
      expect(first.slug).toBe("unit-2-cells");

      const updated = store.upsert({
        courseSlug: "bio101",
        slug: "unit-2-cells",
        title: "Unit 2 Cells (Updated)",
        startDate: "2026-02-10",
        endDate: "2026-02-22",
      });
      expect(updated.id).toBe(first.id);
      expect(updated.title).toBe("Unit 2 Cells (Updated)");
      expect(updated.end_date).toBe("2026-02-22");

      const listed = store.list({ courseSlug: "bio101" });
      expect(listed).toHaveLength(1);
      expect(listed[0]?.slug).toBe("unit-2-cells");

      const removed = store.delete(first.id);
      expect(removed.changed).toBe(1);
      expect(store.list({ courseSlug: "bio101" })).toHaveLength(0);

      db.close();
    });
  });
});
