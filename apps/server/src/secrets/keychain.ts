import fs from "node:fs/promises";
import path from "node:path";
import type { Logger } from "../logger";

export type SecretStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  del: (key: string) => Promise<void>;
};

function isDarwin(): boolean {
  return process.platform === "darwin";
}

function isSafeKey(key: string): boolean {
  return /^[a-zA-Z0-9_.-]+$/.test(key);
}

async function execSecurity(args: string[]) {
  const proc = Bun.spawn(["security", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = proc.stdout ? await new Response(proc.stdout).text() : "";
  const stderr = proc.stderr ? await new Response(proc.stderr).text() : "";
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

export function keychainStore(opts: {
  serviceName: string;
  fallbackDir: string;
  logger: Logger;
}): SecretStore {
  async function fallbackPath(key: string) {
    await fs.mkdir(opts.fallbackDir, { recursive: true });
    return path.join(opts.fallbackDir, `${key}.secret`);
  }

  return {
    get: async (key) => {
      if (!isSafeKey(key)) throw new Error("Invalid secret key.");
      if (isDarwin()) {
        const res = await execSecurity([
          "find-generic-password",
          "-a",
          key,
          "-s",
          opts.serviceName,
          "-w",
        ]);
        if (res.exitCode !== 0) return null;
        return res.stdout.trim() || null;
      }
      try {
        const p = await fallbackPath(key);
        return (await fs.readFile(p, "utf8")).trim() || null;
      } catch {
        return null;
      }
    },
    set: async (key, value) => {
      if (!isSafeKey(key)) throw new Error("Invalid secret key.");
      if (isDarwin()) {
        const res = await execSecurity([
          "add-generic-password",
          "-U",
          "-a",
          key,
          "-s",
          opts.serviceName,
          "-w",
          value,
        ]);
        if (res.exitCode !== 0) {
          opts.logger.error("secrets.keychain_set_failed", {
            key,
            service: opts.serviceName,
            stderr: res.stderr.trim(),
          });
          throw new Error("Failed to store secret in Keychain.");
        }
        return;
      }
      const p = await fallbackPath(key);
      await fs.writeFile(p, value, "utf8");
    },
    del: async (key) => {
      if (!isSafeKey(key)) throw new Error("Invalid secret key.");
      if (isDarwin()) {
        const res = await execSecurity([
          "delete-generic-password",
          "-a",
          key,
          "-s",
          opts.serviceName,
        ]);
        if (res.exitCode !== 0) return;
        return;
      }
      try {
        const p = await fallbackPath(key);
        await fs.unlink(p);
      } catch {
        // ignore
      }
    },
  };
}
