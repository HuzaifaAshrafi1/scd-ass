const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const APP_NAME = "WeChat Cloned";
const START_PORT = 53127;
const MAX_RESTARTS = 3;

let mainWindow = null;
let backendProcess = null;
let backendPort = null;
let isQuitting = false;
let restartAttempts = 0;

app.setName(APP_NAME);
if (process.env.WECHAT_CLONED_USER_DATA_DIR) {
  app.setPath("userData", ensureDir(process.env.WECHAT_CLONED_USER_DATA_DIR));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logPath(name) {
  return path.join(ensureDir(path.join(app.getPath("userData"), "logs")), name);
}

function appendSupervisorLog(message) {
  try {
    fs.appendFileSync(
      logPath("desktop.log"),
      `${new Date().toISOString()} ${message}\n`,
      "utf8"
    );
  } catch {
    // Logging must never prevent the desktop shell from starting.
  }
}

function windowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(windowStatePath(), "utf8"));
    return {
      width: Math.max(980, Number(state.width) || 1200),
      height: Math.max(640, Number(state.height) || 780),
      x: Number.isFinite(state.x) ? state.x : undefined,
      y: Number.isFinite(state.y) ? state.y : undefined,
      isMaximized: Boolean(state.isMaximized)
    };
  } catch {
    return { width: 1200, height: 780, isMaximized: false };
  }
}

function saveWindowState() {
  if (!mainWindow) return;
  try {
    const bounds = mainWindow.getBounds();
    fs.writeFileSync(
      windowStatePath(),
      JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() }, null, 2),
      "utf8"
    );
  } catch (error) {
    appendSupervisorLog(`Could not save window state: ${error.message}`);
  }
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const server = net.createServer();
      server.once("error", () => tryPort(port + 1));
      server.once("listening", () => {
        server.close(() => resolve(port));
      });
      server.listen(port, "127.0.0.1");
    };
    try {
      tryPort(startPort);
    } catch (error) {
      reject(error);
    }
  });
}

function backendExecutable() {
  const packagedPath = path.join(process.resourcesPath, "backend", "WeChatClonedBackend.exe");
  if (app.isPackaged && fs.existsSync(packagedPath)) {
    return { command: packagedPath, args: [] };
  }

  const root = path.resolve(__dirname, "..");
  const builtBackend = path.join(root, "project_support", "build_output", "dist", "WeChatClonedBackend", "WeChatClonedBackend.exe");
  if (fs.existsSync(builtBackend)) {
    return { command: builtBackend, args: [] };
  }

  const venvPython = path.join(root, "backend", ".venv", "Scripts", "python.exe");
  const python = fs.existsSync(venvPython) ? venvPython : "python";
  return { command: python, args: [path.join(root, "backend", "app.py")] };
}

function waitForHealth(port, timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          res.resume();
          resolve();
          return;
        }
        res.resume();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1200, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Backend did not become healthy in time."));
        return;
      }
      setTimeout(tick, 350);
    };

    tick();
  });
}

async function startBackend() {
  backendPort = await findFreePort(START_PORT);
  const backend = backendExecutable();
  if (backend.command !== "python" && !fs.existsSync(backend.command)) {
    throw new Error(`Backend executable was not found: ${backend.command}`);
  }
  const stdout = fs.openSync(logPath("backend.stdout.log"), "a");
  const stderr = fs.openSync(logPath("backend.stderr.log"), "a");
  const env = {
    ...process.env,
    WECHAT_CLONED_DESKTOP: "1",
    WECHAT_CLONED_PORT: String(backendPort),
    WECHAT_CLONED_DATA_DIR: app.getPath("userData"),
    WECHAT_CLONED_VERSION: app.getVersion(),
    FLASK_DEBUG: "0"
  };

  appendSupervisorLog(`Starting backend on port ${backendPort}: ${backend.command}`);
  backendProcess = spawn(backend.command, backend.args, {
    cwd: app.isPackaged ? process.resourcesPath : path.resolve(__dirname, ".."),
    env,
    windowsHide: true,
    stdio: ["ignore", stdout, stderr]
  });
  fs.closeSync(stdout);
  fs.closeSync(stderr);

  backendProcess.on("error", (error) => {
    appendSupervisorLog(`Backend process error: ${error.stack || error.message}`);
  });

  backendProcess.on("exit", (code, signal) => {
    appendSupervisorLog(`Backend exited code=${code} signal=${signal}`);
    backendProcess = null;
    if (isQuitting) return;
    if (restartAttempts >= MAX_RESTARTS) {
      dialog.showErrorBox(APP_NAME, "The local service stopped and could not be restarted. Please relaunch the application.");
      app.quit();
      return;
    }
    restartAttempts += 1;
    setTimeout(() => {
      startBackend()
        .then(() => mainWindow?.loadURL(`http://127.0.0.1:${backendPort}`))
        .catch((error) => {
          appendSupervisorLog(`Backend restart failed: ${error.message}`);
        });
    }, 900);
  });

  await waitForHealth(backendPort);
  restartAttempts = 0;
}

function createWindow() {
  const savedWindow = loadWindowState();
  mainWindow = new BrowserWindow({
    width: savedWindow.width,
    height: savedWindow.height,
    x: savedWindow.x,
    y: savedWindow.y,
    minWidth: 980,
    minHeight: 640,
    title: APP_NAME,
    show: false,
    backgroundColor: "#e9e9e9",
    icon: path.join(__dirname, "..", "project_support", "resources", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });

  mainWindow.removeMenu();
  if (savedWindow.isMaximized) {
    mainWindow.maximize();
  }
  mainWindow.on("close", saveWindowState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);
}

async function boot() {
  try {
    await startBackend();
    createWindow();
  } catch (error) {
    appendSupervisorLog(`Startup failed: ${error.stack || error.message}`);
    dialog.showErrorBox(APP_NAME, `The application could not start.\n\n${error.message}`);
    app.quit();
  }
}

process.on("uncaughtException", (error) => {
  appendSupervisorLog(`Uncaught exception: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  appendSupervisorLog(`Unhandled rejection: ${reason?.stack || reason}`);
});

app.whenReady().then(boot);

app.on("before-quit", () => {
  isQuitting = true;
  if (backendProcess) {
    backendProcess.kill();
  }
});

app.on("window-all-closed", () => {
  app.quit();
});
