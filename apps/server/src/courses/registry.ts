import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger";

const RegistrySchema = z.object({
  version: z.literal(1),
  aliases: z.record(z.string().min(1)).default({}), // sourceSlug -> canonicalSlug
  names: z.record(z.string().min(1)).default({}), // canonicalSlug -> display name
});
export type CourseRegistryData = z.infer<typeof RegistrySchema>;

export type CourseRegistry = {
  load: () => Promise<CourseRegistryData>;
  resolveCanonical: (slug: string) => Promise<string>;
  nameFor: (canonicalSlug: string) => Promise<string | null>;
  setName: (canonicalSlug: string, name: string) => Promise<void>;
  mergeInto: (opts: {
    destinationSlug: string;
    sourceSlugs: string[];
    name?: string;
  }) => Promise<void>;
};

async function readJsonFile(p: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function writeJsonFile(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function createCourseRegistry(opts: {
  stateDir: string;
  logger: Logger;
}): CourseRegistry {
  const filePath = path.join(opts.stateDir, "courses.json");
  let cache: CourseRegistryData | null = null;

  async function load(): Promise<CourseRegistryData> {
    if (cache) return cache;
    const raw = await readJsonFile(filePath);
    const parsed = RegistrySchema.safeParse(raw);
    if (parsed.success) {
      cache = parsed.data;
      return parsed.data;
    }
    cache = { version: 1, aliases: {}, names: {} };
    return cache;
  }

  async function persist(next: CourseRegistryData): Promise<void> {
    cache = next;
    await writeJsonFile(filePath, next);
  }

  async function resolveCanonical(slug: string): Promise<string> {
    const reg = await load();
    return reg.aliases[slug] ?? slug;
  }

  async function nameFor(canonicalSlug: string): Promise<string | null> {
    const reg = await load();
    return reg.names[canonicalSlug] ?? null;
  }

  async function setName(canonicalSlug: string, name: string): Promise<void> {
    const reg = await load();
    const next: CourseRegistryData = {
      ...reg,
      names: { ...reg.names, [canonicalSlug]: name },
    };
    await persist(next);
    opts.logger.info("courses.registry.rename", { canonicalSlug, name });
  }

  async function mergeInto(input: {
    destinationSlug: string;
    sourceSlugs: string[];
    name?: string;
  }): Promise<void> {
    const reg = await load();
    const nextAliases = { ...reg.aliases };
    for (const src of input.sourceSlugs) {
      if (src === input.destinationSlug) continue;
      nextAliases[src] = input.destinationSlug;
    }
    const nextNames = { ...reg.names };
    const trimmedName = input.name?.trim();
    if (trimmedName) nextNames[input.destinationSlug] = trimmedName;
    await persist({ version: 1, aliases: nextAliases, names: nextNames });
    opts.logger.info("courses.registry.merge", {
      destinationSlug: input.destinationSlug,
      sourceSlugs: input.sourceSlugs,
      name: input.name ?? null,
    });
  }

  return { load, resolveCanonical, nameFor, setName, mergeInto };
}
