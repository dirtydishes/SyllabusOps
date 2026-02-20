import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import {
  BrowserWindow,
  type MessageBoxReturnValue,
  app,
  dialog,
  shell,
} from "electron";

const SERVER_PORT = 4959;
const SERVER_BASE_URL = `http://127.0.0.1:${SERVER_PORT}`;
const SERVER_HEALTH_URL = `${SERVER_BASE_URL}/api/status`;
const SERVER_START_TIMEOUT_MS = 45_000;
const SERVER_STOP_TIMEOUT_MS = 4_000;
const WINDOW_SHOW_FALLBACK_MS = 4_000;
const DEFAULT_WEB_DEV_URL = "http://localhost:5173";

function normalizeDevUrl(raw: string | undefined): string {
  const cleaned = raw?.trim().replaceAll('"', "").replaceAll("'", "");
  if (!cleaned) return DEFAULT_WEB_DEV_URL;
  const candidate = cleaned.includes("://") ? cleaned : `http://${cleaned}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return DEFAULT_WEB_DEV_URL;
    }
    // In desktop dev mode we require an explicit port for the Vite server URL.
    if (!parsed.port) return DEFAULT_WEB_DEV_URL;
    return parsed.toString();
  } catch {
    return DEFAULT_WEB_DEV_URL;
  }
}

const WEB_DEV_URL = normalizeDevUrl(process.env.SYLLABUSOPS_WEB_DEV_URL);
const DEV_LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;

function buildDevWebUrlCandidates(primaryUrl: string): string[] {
  try {
    const parsed = new URL(primaryUrl);
    if (!parsed.port) return [DEFAULT_WEB_DEV_URL];

    const urls = new Set<string>();
    urls.add(parsed.toString());
    for (const host of DEV_LOOPBACK_HOSTS) {
      const next = new URL(parsed.toString());
      next.hostname = host === "[::1]" ? "::1" : host;
      urls.add(next.toString());
    }
    return Array.from(urls);
  } catch {
    return [DEFAULT_WEB_DEV_URL];
  }
}

const isDev = process.env.SYLLABUSOPS_DESKTOP_DEV === "1";

let mainWindow: BrowserWindow | null = null;
let backendProc: ChildProcess | null = null;
let shuttingDown = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkPortAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const tester = net
      .createServer()
      .once("error", () => resolve(false))
      .once("listening", () => {
        tester.close(() => resolve(true));
      });
    tester.listen(port, "127.0.0.1");
  });
}

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Keep polling until the timeout expires. This avoids brittle startup races.
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // ignore until timeout
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForAnyHttpOk(
  urls: string[],
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) return url;
      } catch {
        // ignore until timeout
      }
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for any of: ${urls.join(", ")}`);
}

function resolveRepoRoot(): string {
  const fromEnv = process.env.SYLLABUSOPS_REPO_ROOT?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(process.cwd(), "..", "..");
}

async function resolveBunBinary(): Promise<string> {
  if (app.isPackaged) {
    const bundled = path.join(process.resourcesPath, "bin", "bun");
    await fs.access(bundled);
    return bundled;
  }
  return process.env.SYLLABUSOPS_BUN_BIN?.trim() || "bun";
}

function resolveServerEntry(): string {
  if (app.isPackaged)
    return path.join(process.resourcesPath, "server", "server.js");
  return path.join(resolveRepoRoot(), "apps", "server", "src", "index.ts");
}

function resolveWebDistDir(): string | null {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, "web");
}

function resolveStateDir(): string {
  return path.join(app.getPath("appData"), "SyllabusOps");
}

function resolvePreloadPath(): string {
  return path.join(__dirname, "preload.js");
}

async function startBackend(): Promise<void> {
  const portFree = await checkPortAvailable(SERVER_PORT);
  if (!portFree) {
    throw new Error(
      `Port ${SERVER_PORT} is already in use. Close the conflicting process and relaunch SyllabusOps.`
    );
  }

  const bunBinary = await resolveBunBinary();
  const serverEntry = resolveServerEntry();
  const stateDir = resolveStateDir();
  const webDistDir = resolveWebDistDir();

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(SERVER_PORT),
    SYLLABUSOPS_STATE_DIR: stateDir,
  };
  if (process.env.SYLLABUSOPS_UNIFIED_DIR) {
    env.SYLLABUSOPS_UNIFIED_DIR = process.env.SYLLABUSOPS_UNIFIED_DIR;
  }
  if (process.env.SYLLABUSOPS_CODEX_BIN) {
    env.SYLLABUSOPS_CODEX_BIN = process.env.SYLLABUSOPS_CODEX_BIN;
  }
  if (webDistDir) env.SYLLABUSOPS_WEB_DIST_DIR = webDistDir;

  const proc = spawn(bunBinary, [serverEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProc = proc;

  proc.stdout?.on("data", (chunk) => {
    process.stdout.write(`[backend] ${String(chunk)}`);
  });
  proc.stderr?.on("data", (chunk) => {
    process.stderr.write(`[backend:err] ${String(chunk)}`);
  });
  proc.on("error", (err) => {
    process.stderr.write(`[backend:spawn_error] ${String(err.message)}\n`);
  });
  proc.on("exit", (code, signal) => {
    const expected = shuttingDown;
    backendProc = null;
    const msg = `Backend exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`;
    process.stderr.write(`[backend:exit] ${msg}\n`);
    if (!expected) {
      dialog.showErrorBox(
        "SyllabusOps backend stopped",
        `${msg}\n\nThe desktop app will now close.`
      );
      void app.quit();
    }
  });

  await waitForHttpOk(SERVER_HEALTH_URL, SERVER_START_TIMEOUT_MS);
}

async function stopBackend(): Promise<void> {
  const proc = backendProc;
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null) {
    backendProc = null;
    return;
  }

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      proc.removeAllListeners("exit");
      resolve();
    };

    proc.once("exit", finish);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill("SIGKILL");
      }
      finish();
    }, SERVER_STOP_TIMEOUT_MS);
  });

  backendProc = null;
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    show: isDev,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on(
    "did-fail-load",
    (_event, code, description, validatedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      const msg = `Failed to load ${validatedUrl} (${code}): ${description}`;
      process.stderr.write(`[desktop:web] ${msg}\n`);
      dialog.showErrorBox(
        "SyllabusOps window failed to load",
        `${msg}\n\nIn dev mode, ensure Vite is running and reachable.`
      );
    }
  );

  let targetUrl = isDev ? WEB_DEV_URL : SERVER_BASE_URL;
  if (isDev) {
    const candidates = buildDevWebUrlCandidates(WEB_DEV_URL);
    try {
      targetUrl = await waitForAnyHttpOk(candidates, SERVER_START_TIMEOUT_MS);
    } catch (e: unknown) {
      throw new Error(
        `Dev web server not reachable (${String((e as Error)?.message ?? e)}). Run \`bun run dev:desktop\` from repo root or unset SYLLABUSOPS_WEB_DEV_URL.`
      );
    }
  }
  const showFallbackTimer = setTimeout(() => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
      process.stdout.write("[desktop] forcing window show fallback\n");
      mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  }, WINDOW_SHOW_FALLBACK_MS);
  await mainWindow.loadURL(targetUrl);
  mainWindow.webContents.once("did-finish-load", () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  mainWindow.once("ready-to-show", () => {
    clearTimeout(showFallbackTimer);
    mainWindow?.show();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function startup(): Promise<void> {
  await startBackend();
  await createWindow();
}

app.on("before-quit", (event) => {
  if (shuttingDown) return;
  shuttingDown = true;
  event.preventDefault();
  void stopBackend().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  void app.quit();
});

app.on("activate", () => {
  if (mainWindow) {
    if (!mainWindow.isVisible()) mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  if (BrowserWindow.getAllWindows().length > 0) return;
  void createWindow();
});

void app.whenReady().then(async () => {
  try {
    await startup();
  } catch (e: unknown) {
    const message = String((e as Error)?.message ?? e);
    const details: MessageBoxReturnValue = await dialog.showMessageBox({
      type: "error",
      title: "SyllabusOps failed to start",
      message,
      detail:
        "Startup failed. Verify Bun is available, port 4959 is free, and in desktop dev mode that Vite is running on 5173.",
      buttons: ["Quit"],
      defaultId: 0,
      cancelId: 0,
    });
    if (details.response === 0) app.quit();
  }
});
