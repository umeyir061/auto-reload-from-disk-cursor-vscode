import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

const CONFIG_ROOT = "autoReloadFromDisk";
const DIRTY_NOTIFY_COOLDOWN_MS = 4000;

function cfg() {
  return vscode.workspace.getConfiguration();
}

function isEnabled(): boolean {
  return cfg().get<boolean>(`${CONFIG_ROOT}.enabled`, true);
}

function getGlob(): string {
  return cfg().get<string>(`${CONFIG_ROOT}.glob`, "**/*");
}

function notifyOnDirty(): boolean {
  return cfg().get<boolean>(`${CONFIG_ROOT}.notifyOnDirty`, true);
}

function stealFocusOnReload(): boolean {
  return cfg().get<boolean>(`${CONFIG_ROOT}.stealFocusOnReload`, false);
}

function getPollIntervalMs(): number {
  const value = cfg().get<number>(`${CONFIG_ROOT}.pollIntervalMs`, 1000);
  return Math.max(250, Math.min(60_000, value));
}

function getDebounceMs(): number {
  const value = cfg().get<number>(`${CONFIG_ROOT}.debounceMs`, 300);
  return Math.max(50, Math.min(5_000, value));
}

function isDebugEnabled(): boolean {
  return cfg().get<boolean>(`${CONFIG_ROOT}.debugLogs`, false);
}

function normalizeFsPath(uri: vscode.Uri): string {
  const normalized = path.normalize(uri.fsPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function shouldWatchDocument(doc: vscode.TextDocument): boolean {
  return doc.uri.scheme === "file" && !doc.isUntitled;
}

async function statMtimeMs(fsPath: string): Promise<number | undefined> {
  try {
    const stat = await fs.promises.stat(fsPath);
    return stat.mtimeMs;
  } catch {
    return undefined;
  }
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Auto Reload From Disk");
  context.subscriptions.push(output);

  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 10_000);
  statusItem.command = "autoReloadFromDisk.toggleEnabled";
  context.subscriptions.push(statusItem);

  const log = (message: string) => {
    if (!isDebugEnabled()) return;
    output.appendLine(`[${new Date().toISOString()}] ${message}`);
  };

  const externalWatchers = new Map<string, fs.FSWatcher>();
  const knownMtimes = new Map<string, number>();
  const inFlight = new Set<string>();
  const lastEventAt = new Map<string, number>();
  const lastDirtyNotifyAt = new Map<string, number>();

  let workspaceWatcher: vscode.Disposable | undefined;
  let pollHandle: NodeJS.Timeout | undefined;
  let pollInProgress = false;
  let isRuntimeEnabled = false;
  let syncWatchersQueue: Promise<void> = Promise.resolve();

  const findOpenDocByPath = (normalizedPath: string): vscode.TextDocument | undefined =>
    vscode.workspace.textDocuments.find(
      (d) => d.uri.scheme === "file" && normalizeFsPath(d.uri) === normalizedPath
    );

  const refreshKnownMtime = async (doc: vscode.TextDocument) => {
    const pathKey = normalizeFsPath(doc.uri);
    const mtime = await statMtimeMs(doc.uri.fsPath);
    if (mtime !== undefined) knownMtimes.set(pathKey, mtime);
  };

  const revertDocument = async (doc: vscode.TextDocument): Promise<boolean> => {
    if (doc.isDirty) return false;

    try {
      await vscode.commands.executeCommand("workbench.action.files.revertResource", doc.uri);
      await refreshKnownMtime(doc);
      log(`Reverted from disk (resource): ${doc.fileName}`);
      return true;
    } catch {
      // Fallback for hosts that don't expose revertResource.
    }

    const isActive = vscode.window.activeTextEditor?.document.uri.toString() === doc.uri.toString();
    if (!isActive && !stealFocusOnReload()) {
      log(`Skipped reload to avoid focus steal: ${doc.fileName}`);
      return false;
    }

    if (!isActive) {
      await vscode.window.showTextDocument(doc, { preserveFocus: false, preview: false });
    }

    if (doc.isDirty) return false;
    await vscode.commands.executeCommand("workbench.action.files.revert");
    await refreshKnownMtime(doc);
    log(`Reverted from disk (fallback): ${doc.fileName}`);
    return true;
  };

  const maybeReloadForUri = async (changedUri: vscode.Uri, source: string) => {
    if (!isRuntimeEnabled) return;
    if (changedUri.scheme !== "file") return;

    const changedPath = normalizeFsPath(changedUri);
    const now = Date.now();
    const last = lastEventAt.get(changedPath) ?? 0;
    if (now - last < getDebounceMs()) return;
    lastEventAt.set(changedPath, now);

    if (inFlight.has(changedPath)) return;
    inFlight.add(changedPath);

    try {
      const doc = findOpenDocByPath(changedPath);
      if (!doc) return;

      if (doc.isDirty) {
        if (!notifyOnDirty()) return;

        const lastNotify = lastDirtyNotifyAt.get(changedPath) ?? 0;
        if (now - lastNotify < DIRTY_NOTIFY_COOLDOWN_MS) return;
        lastDirtyNotifyAt.set(changedPath, now);

        log(`Dirty conflict (${source}): ${doc.fileName}`);
        const choice = await vscode.window.showWarningMessage(
          `File changed on disk but has unsaved changes in editor: ${doc.fileName}`,
          "Reload from disk (discard local changes)",
          "Ignore"
        );
        if (choice === "Reload from disk (discard local changes)") {
          await revertDocument(doc);
        }
        return;
      }

      log(`Change detected (${source}): ${doc.fileName}`);
      await revertDocument(doc);
    } finally {
      inFlight.delete(changedPath);
    }
  };

  const syncExternalWatchers = async () => {
    const openDocs = vscode.workspace.textDocuments.filter(shouldWatchDocument);
    const openPaths = new Set(openDocs.map((doc) => normalizeFsPath(doc.uri)));

    for (const watchedPath of externalWatchers.keys()) {
      if (!openPaths.has(watchedPath)) {
        externalWatchers.get(watchedPath)?.close();
        externalWatchers.delete(watchedPath);
        knownMtimes.delete(watchedPath);
        lastEventAt.delete(watchedPath);
        lastDirtyNotifyAt.delete(watchedPath);
      }
    }

    for (const doc of openDocs) {
      const filePath = normalizeFsPath(doc.uri);

      if (!knownMtimes.has(filePath)) {
        const mtime = await statMtimeMs(doc.uri.fsPath);
        if (mtime !== undefined) knownMtimes.set(filePath, mtime);
      }

      if (externalWatchers.has(filePath)) continue;
      try {
        const watcher = fs.watch(doc.uri.fsPath, () => {
          void maybeReloadForUri(doc.uri, "fs.watch");
        });
        watcher.on("error", (err) => log(`fs.watch error for ${doc.fileName}: ${String(err)}`));
        externalWatchers.set(filePath, watcher);
      } catch {
        log(`fs.watch attach failed: ${doc.fileName}`);
      }
    }
  };

  const queueSyncExternalWatchers = () => {
    syncWatchersQueue = syncWatchersQueue
      .then(() => syncExternalWatchers())
      .catch((err) => {
        log(`syncExternalWatchers failed: ${String(err)}`);
      });
  };

  const stopExternalWatchers = () => {
    for (const watcher of externalWatchers.values()) watcher.close();
    externalWatchers.clear();
    knownMtimes.clear();
    inFlight.clear();
    lastEventAt.clear();
    lastDirtyNotifyAt.clear();
  };

  const pollForExternalChanges = async () => {
    for (const doc of vscode.workspace.textDocuments) {
      if (!shouldWatchDocument(doc)) continue;

      const filePath = normalizeFsPath(doc.uri);
      const mtime = await statMtimeMs(doc.uri.fsPath);
      if (mtime === undefined) continue;

      const previous = knownMtimes.get(filePath);
      if (previous === undefined) {
        knownMtimes.set(filePath, mtime);
        continue;
      }

      if (mtime !== previous) {
        knownMtimes.set(filePath, mtime);
        void maybeReloadForUri(doc.uri, "poll");
      }
    }
  };

  const restartWorkspaceWatcher = () => {
    workspaceWatcher?.dispose();
    const watcher = vscode.workspace.createFileSystemWatcher(getGlob());
    const onChange = (uri: vscode.Uri) => void maybeReloadForUri(uri, "workspace");

    const d1 = watcher.onDidChange(onChange);
    const d2 = watcher.onDidCreate(onChange);
    const d3 = watcher.onDidDelete(onChange);
    workspaceWatcher = vscode.Disposable.from(watcher, d1, d2, d3);
    log(`Workspace watcher started with glob: ${getGlob()}`);
  };

  const restartPolling = () => {
    if (pollHandle) clearInterval(pollHandle);

    const interval = getPollIntervalMs();
    pollHandle = setInterval(() => {
      if (pollInProgress) return;
      pollInProgress = true;

      void (async () => {
        try {
          await pollForExternalChanges();
        } finally {
          pollInProgress = false;
        }
      })();
    }, interval);

    log(`Polling started with interval: ${interval}ms`);
  };

  const stopRuntime = () => {
    workspaceWatcher?.dispose();
    workspaceWatcher = undefined;

    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = undefined;
    }

    pollInProgress = false;
    stopExternalWatchers();
  };

  const startRuntime = () => {
    restartWorkspaceWatcher();
    restartPolling();
    queueSyncExternalWatchers();
  };

  const applyEnabledState = () => {
    const enabled = isEnabled();
    if (enabled === isRuntimeEnabled) return;
    isRuntimeEnabled = enabled;

    if (enabled) {
      startRuntime();
      log("Auto reload enabled");
    } else {
      stopRuntime();
      log("Auto reload disabled");
    }
  };

  const updateStatusBar = () => {
    const enabled = isEnabled();
    statusItem.text = enabled ? "$(sync) Auto Refresh: ON" : "$(circle-slash) Auto Refresh: OFF";
    statusItem.tooltip = "Toggle Auto Reload From Disk";
    statusItem.show();
  };

  const setEnabled = async (nextValue: boolean) => {
    const allCfg = cfg();
    const inspect = allCfg.inspect<boolean>(`${CONFIG_ROOT}.enabled`);

    if (inspect?.workspaceValue !== undefined) {
      await allCfg.update(`${CONFIG_ROOT}.enabled`, nextValue, vscode.ConfigurationTarget.Workspace);
      return;
    }

    if (inspect?.globalValue !== undefined) {
      await allCfg.update(`${CONFIG_ROOT}.enabled`, nextValue, vscode.ConfigurationTarget.Global);
      return;
    }

    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      await allCfg.update(`${CONFIG_ROOT}.enabled`, nextValue, vscode.ConfigurationTarget.Workspace);
      return;
    }

    await allCfg.update(`${CONFIG_ROOT}.enabled`, nextValue, vscode.ConfigurationTarget.Global);
  };

  const manual = vscode.commands.registerCommand("autoReloadFromDisk.reloadActive", async () => {
    await vscode.commands.executeCommand("workbench.action.files.revert");
  });

  const toggle = vscode.commands.registerCommand("autoReloadFromDisk.toggleEnabled", async () => {
    const enabled = isEnabled();
    await setEnabled(!enabled);
    updateStatusBar();
  });
  context.subscriptions.push(manual, toggle);

  const onOpen = vscode.workspace.onDidOpenTextDocument(() => queueSyncExternalWatchers());
  const onClose = vscode.workspace.onDidCloseTextDocument(() => queueSyncExternalWatchers());
  const onSave = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (!shouldWatchDocument(doc)) return;
    void refreshKnownMtime(doc);
  });

  const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(CONFIG_ROOT)) return;

    const wasEnabled = isRuntimeEnabled;
    applyEnabledState();

    if (!isRuntimeEnabled) {
      updateStatusBar();
      log("Configuration changed while extension disabled");
      return;
    }

    if (!wasEnabled && isRuntimeEnabled) {
      updateStatusBar();
      log("Configuration changed and extension started");
      return;
    }

    if (event.affectsConfiguration(`${CONFIG_ROOT}.glob`)) {
      restartWorkspaceWatcher();
    }
    if (event.affectsConfiguration(`${CONFIG_ROOT}.pollIntervalMs`)) {
      restartPolling();
    }

    queueSyncExternalWatchers();
    updateStatusBar();
    log("Configuration changed and watchers restarted");
  });

  context.subscriptions.push(onOpen, onClose, onSave, onConfig);
  context.subscriptions.push({
    dispose: () => {
      stopRuntime();
    },
  });

  applyEnabledState();
  updateStatusBar();
}

export function deactivate() {}
