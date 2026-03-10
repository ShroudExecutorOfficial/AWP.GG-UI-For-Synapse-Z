/*
 * Copyright (c) 2025 April Fools (Discord: aprllfools | 267467561895985152). All Rights Reserved.
 * 
 * This software and its user interface (UI) are protected by copyright law.
 * 
 * PUBLIC USE:
 * Any public use, distribution, reproduction, or display of this UI, in whole or in part,
 * without the express written permission of the copyright holder is STRICTLY PROHIBITED.
 * Violators will be subject to legal action and punishment to the fullest extent of the law.
 * 
 * PRIVATE USE:
 * Private use of this UI is permitted ONLY under the condition that direct, visible,
 * and clear credit to the original author (April Fools) is maintained within the UI itself.
 * This credit must be clearly visible immediately upon opening the UI.
 * Failure to include such credit constitutes a violation of this license and will be subject to punishment.
 * 
 * SOURCE CODE:
 * The source code provided herein is for reference purposes only in the context of this specific application.
 * Extracting, reverse engineering, or repurposing the source code or UI assets for other projects
 * without permission is prohibited.
 */

const { exec } = require('child_process');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { spawn } = require('child_process');
const find = require('find-process');
const LuauLSPClient = require('./luau-lsp-client');
const SynzApi = require('./synz/SynzApi');

let mainWindow;
let mainRootPath;
let lspClient = null;
let lspEnabled = true;
let voltlspEnabled = false;
// PIDs with execution explicitly disabled (empty = all enabled)
const disabledPids = new Set();

const gotLock = app.requestSingleInstanceLock();
if (gotLock) {
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });
} else {
    app.quit();
    return;
}


// Helper function to build directory structure
const buildStructure = (dirPath) => {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    let structure = [];

    entries.forEach(dirent => {
        if (dirent.isDirectory()) {
            const nestedStructure = buildStructure(path.join(dirPath, dirent.name));
            if (nestedStructure.length > 0) {
                structure.push({
                    name: dirent.name,
                    type: 'folder',
                    files: nestedStructure
                });
            }
        } else if (['.lua', '.luau', '.txt'].some(ext => dirent.name.endsWith(ext))) {
            structure.push({
                name: dirent.name,
                type: 'file'
            });
        }
    });

    return structure;
};
const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 400,
    frame: false,
    //thickFrame: false,
    transparent: false,
    hasShadow: true,
    resizable: true,
    maximizable: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, // Required for contextBridge
        nodeIntegration: false, // Keeps security intact
        enableRemoteModule: false,
        backgroundThrottling: false,
        experimentalFeatures: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        v8CacheOptions: 'code',
        hardwareAcceleration: true,
        offscreen: false
    }
  })

    win.once('ready-to-show', () => {
        win.show(); // Will animate open
    });

  ipcMain.on('min-win', async (event) => {
    win.minimize();
  })

  // whoever formatted this shit before me was a RETARD
    ipcMain.on('max-win', async (event) => {
        if (win.isMaximized()) {
            win.unmaximize();
        } else {
            win.maximize();
        }
    })

    ipcMain.on('close-win', async (event) => {
        event.sender.send('prepare-close');
    })
    
    ipcMain.on('confirm-close', async (event) => {
        if (statusPollInterval) clearInterval(statusPollInterval);
        if (lspClient) { try { lspClient.stop(); } catch(e) {} lspClient = null; }
        win.destroy();
        app.exit(0);
    })
    
    ipcMain.on('set-always-on-top', async (event, enabled) => {
        win.setAlwaysOnTop(enabled, enabled ? "screen-saver" : "normal");
    })
    
    ipcMain.on('zoom-in', async (event) => {
        const currentZoom = win.webContents.getZoomFactor();
        win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0));
    })
    
    ipcMain.on('zoom-out', async (event) => {
        const currentZoom = win.webContents.getZoomFactor();
        win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.2));
    })
    
    ipcMain.on('zoom-reset', async (event) => {
        win.webContents.setZoomFactor(1.0);
    })
    
   ipcMain.on('set-reg-key', (event, key, name, value) => {
        const finalPath = `HKEY_CURRENT_USER\\${key}`;
        const dword = value ? 1 : 0;

        const command = `reg add "${finalPath}" /v "${name}" /t REG_DWORD /d ${dword} /f`;
        exec(command, (err) => {
            if (err) {
                console.error(`Failed to change reg key: ${command}`, err);
                event.reply('onLog', 'Failed to update registry.', 'error');
                return;
            }
        });
    });
    
    ipcMain.on('select-instance', async (event, pid) => {
        console.log(`Selected instance PID: ${pid}`);
        event.reply('onLog', `Switched to PID: ${pid}`, "info");
    })
    
    ipcMain.on('refresh-instances', async (event) => {
        try {
            const processes = SynzApi.GetRobloxProcesses();
            const instances = processes.map(p => ({
                pid: p.pid,
                name: p.name || 'Roblox',
                isSynz: SynzApi.IsSynz(Number(p.pid))
            }));
            mainWindow.webContents.send("instances-list", instances);
        } catch (err) {
            mainWindow.webContents.send("instances-list", []);
        }
    })
    ipcMain.on('toggle-volt-lsp', async (event, enabled) => {
        if (voltlspEnabled === !!enabled) return;
        voltlspEnabled = !!enabled;
        
        if (lspEnabled) {
            if (lspClient) {
                lspClient.stop();
                lspClient = null;
            }

            setTimeout(async () => { await initializeLSP(); }, 100);
        }
    })
    
    console.log(path.join(__dirname, 'preload.js'))
    win.loadFile('views/index.html')
    //devtools inspect element
    //win.webContents.openDevTools()
  win.setAlwaysOnTop(true, "screen-saver");  
  return win;
}

ipcMain.on("save-file", async(event, msg) => {
    let dialogresult = await dialog.showSaveDialog({
        title: 'Save File',
        defaultPath: mainRootPath,
        filters: [
            { name: "Lua Scripts", extensions: ["lua", "luau"] },
            { name: 'Text Files', extensions: ['txt'] }
        ]
    })
    if(dialogresult.canceled == false)
    {
        fs.writeFile(dialogresult.filePath, msg, (err) => {
            if (err) {
              console.error('Error saving file:', err);
              event.reply('onLog', 'Error saving file', 'error');
            } else {
              console.log('File saved successfully!');
              const fileName = path.basename(dialogresult.filePath);
              const nameWithoutExt = getFileBasename(fileName);
              event.reply('file-saved-as', nameWithoutExt);
              event.reply('onLog', `Saved as ${fileName}`, 'success');
            }
          });
    }
})

ipcMain.on("save-to-script", async(event, fileName, content) => {
    try {
        const findFileRecursive = (dirPath, targetBaseName) => {
            const entries = fs.readdirSync(dirPath, {withFileTypes: true});
            
            for (const dirent of entries) {
                const fullPath = path.join(dirPath, dirent.name);
                
                if (dirent.isFile()) {
                    const nameWithoutExt = getFileBasename(dirent.name);
                    if (nameWithoutExt === targetBaseName) {
                        return fullPath;
                    }
                } else if (dirent.isDirectory()) {
                    const found = findFileRecursive(fullPath, targetBaseName);
                    if (found) return found;
                }
            }
            
            return null;
        };
        
        const foundFilePath = findFileRecursive(mainRootPath, fileName);
        
        if (foundFilePath) {
            fs.writeFileSync(foundFilePath, content, 'utf-8');
            event.reply('onLog', `Saved to ${path.relative(mainRootPath, foundFilePath)}`, "success");
            event.reply('save-success', fileName);
        } else {
            event.reply('file-not-found-save-as');
        }
    } catch (error) {
        event.reply('onLog', `Error saving file: ${error.message}`, "error");
    }
})

function getFileBasename(fileName) {
    if (!fileName) return fileName;
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
}


ipcMain.on('load-file-dialog', async (event) => {
    let path = await dialog.showOpenDialog({
        title: 'Load File',
        filters: [
          { name: "Lua Scripts", extensions: ["lua", "luau"] },
          { name: 'Text Files', extensions: ['txt'] }
        ]
    })

    if(path.canceled == false)
    {
        let _path = path.filePaths[0]
        const contents = await fs.promises.readFile(_path, 'utf8');
        event.reply('on-load-file', contents)
    }
})

ipcMain.on('load-file', async (event, fileName) => {    
    const entries = fs.readdirSync(mainRootPath, { withFileTypes: true });

    entries.forEach(dirent => {
        if(dirent.name == fileName)
        {
            const filePath = path.join(mainRootPath, fileName);
            const fileContents = fs.readFileSync(filePath, 'utf-8');
            event.reply('file', { content: fileContents, fileName: fileName });
        }
    });
})
// IPC COMMUNICATIONS
ipcMain.on('load-files', async (event, folderPath) => {
  const rootPath = path.join(path.dirname(app.getPath('exe')), folderPath);
  if (!fs.existsSync(rootPath)) {
    fs.mkdirSync(rootPath, { recursive: true });
  }
  mainRootPath = rootPath;

  try {
      const filesAndFolders = buildStructure(rootPath);
      event.reply("files", filesAndFolders)
  } catch (error) {
      console.error('Failed to read directory:', error);
      return [];
  }
});

ipcMain.handle('get-file', async (event, fileName) => {
  if (typeof fileName !== 'string') {
      console.error('[ERROR] Invalid file name:', fileName);
      return { success: false, error: 'Invalid file name' };
  }

  try {
      const filePath = await recursiveSearch(path.join(__dirname, "workspace"), fileName);
      
      if (!filePath) {
          throw new Error('[ERROR] File not found');
      }

      const contents = await fs.promises.readFile(filePath, 'utf8');
      return { success: true, contents };
  } catch (error) {
      console.error('[ERROR] Failed to read file:', error);
      return { success: false, error: error.message };
  }
});

const wsClients = [];
let websocketServer;

let logBuffer = [];
const flushThreshold = 100;
let flushTimer = null;

function flushLogBuffer() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }

    if (logBuffer.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
        try {
            mainWindow.webContents.send("onLogBatch", logBuffer);
            logBuffer = [];
        } catch (e) {
            console.error("Failed log batch:", e);
        }
    }
}

function scheduleFlush() {
    if (!flushTimer) {
        flushTimer = setTimeout(flushLogBuffer, 33);
    }
}

function startWS() {
    if (websocketServer) {
        const isAttached = wsClients.length > 0;
        mainWindow.webContents.send("attached", isAttached);
        
        if (logBuffer.length > 0) {
            mainWindow.webContents.send("onLogBatch", logBuffer);
            logBuffer = [];
        }
        return;
    }

    websocketServer = new WebSocketServer({
        port: 6969
    });

    websocketServer.on("connection", (ws) => {
        wsClients.push(ws);
        mainWindow.webContents.send("attached", true);
        
        ws.on("close", () => {
            flushLogBuffer();
            const index = wsClients.indexOf(ws);
            if (index !== -1) {
                wsClients.splice(index, 1);
                mainWindow.webContents.send("attached", wsClients.length > 0);
            }
        });

        ws.on("message", (message) => {
            const moneyMessage = Buffer.from(message.toString(), 'base64').toString('utf-8');
            const firstPipe = moneyMessage.indexOf("|");
            if (firstPipe === -1) {
                logBuffer.push({ message: moneyMessage, type: "info" });
            } else {
                const type = moneyMessage.substring(0, firstPipe);
                const msg = moneyMessage.substring(firstPipe + 1);
                logBuffer.push({ message: msg, type: type });
            }

            if (logBuffer.length >= flushThreshold) {
                flushLogBuffer();
            } else {
                scheduleFlush();
            }
        })
    })

    mainWindow.webContents.send("onLog", "Websocket server started at localhost:6969", "info");
}

let statusPollInterval = null;

ipcMain.on('ui-ready', () => {
    startWS();

    // Poll injection status and instance list every 2.5 seconds
    if (statusPollInterval) clearInterval(statusPollInterval);
    statusPollInterval = setInterval(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        try {
            const allProcesses = SynzApi.GetRobloxProcesses();
            const activePids = new Set(allProcesses.map(p => Number(p.pid)));

            // Clean up stale pids from disabledPids
            for (const pid of disabledPids) {
                if (!activePids.has(pid)) disabledPids.delete(pid);
            }

            const isAttached = allProcesses.length > 0;
            mainWindow.webContents.send("attached", isAttached);

            const instanceData = allProcesses.map(p => ({
                pid: p.pid,
                name: p.name || 'Roblox',
                isSynz: SynzApi.IsSynz(Number(p.pid)),
                memoryMB: p.memoryMB || '0',
                executionEnabled: !disabledPids.has(Number(p.pid))
            }));
            mainWindow.webContents.send("instances-list", instanceData);
        } catch (e) {}
    }, 2500);
});

ipcMain.on("attach", async (event) => {
    try {
        const synzInstances = SynzApi.GetSynzRobloxInstances();
        if (synzInstances.length > 0) {
            mainWindow.webContents.send("onLog", `Synapse Z injected on ${synzInstances.length} instance(s).`, "success");
            mainWindow.webContents.send("attached", true);
        } else {
            const robloxProcesses = SynzApi.GetRobloxProcesses();
            if (robloxProcesses.length === 0) {
                mainWindow.webContents.send("onLog", "Roblox isn't open.", "error");
            } else {
                mainWindow.webContents.send("onLog", "Roblox is open but Synapse Z is not injected.", "error");
            }
            mainWindow.webContents.send("attached", false);
        }
    } catch (err) {
        mainWindow.webContents.send("onLog", "Error checking Synapse Z: " + err.message, "error");
        mainWindow.webContents.send("attached", false);
    }
})

ipcMain.on("execute", (event, scriptContent) => {
    try {
        if (disabledPids.size === 0) {
            // No exclusions — broadcast to all with PID 0
            const result = SynzApi.Execute(scriptContent, 0);
            if (result !== 0) {
                mainWindow.webContents.send("onLog", `Execute failed: ${SynzApi.GetLatestErrorMessage()}`, "error");
            }
        } else {
            // Execute only on instances NOT in disabledPids
            const allProcesses = SynzApi.GetRobloxProcesses();
            const targets = allProcesses.filter(p => !disabledPids.has(Number(p.pid)));
            if (targets.length === 0) {
                mainWindow.webContents.send("onLog", "All instances have execution disabled.", "error");
                return;
            }
            let anyFailed = false;
            for (const p of targets) {
                const result = SynzApi.Execute(scriptContent, p.pid);
                if (result !== 0) anyFailed = true;
            }
            if (anyFailed) {
                mainWindow.webContents.send("onLog", `Execute failed on one or more instances: ${SynzApi.GetLatestErrorMessage()}`, "error");
            }
        }
    } catch (err) {
        mainWindow.webContents.send("onLog", "Execute error: " + err.message, "error");
    }
})

ipcMain.on("execute-file", async (event, fileName) => {
    try {
        const filePath = path.join(mainRootPath, fileName);
        if (fs.existsSync(filePath)) {
            const contents = fs.readFileSync(filePath, 'utf-8');
            const result = SynzApi.Execute(contents, 0);
            if (result !== 0) {
                const errMsg = SynzApi.GetLatestErrorMessage();
                event.reply('onLog', `Execute failed: ${errMsg}`, "error");
            } else {
                event.reply('onLog', `Executed ${fileName}`, "success");
            }
        } else {
            event.reply('onLog', `File ${fileName} not found`, "error");
        }
    } catch (error) {
        event.reply('onLog', `Error executing ${fileName}: ${error.message}`, "error");
    }
})

ipcMain.on("open-roblox", () => {
    shell.openExternal("roblox://");
});

ipcMain.on("kill-instance", (event, pid) => {
    try {
        exec(`taskkill /F /PID ${parseInt(pid)}`, { windowsHide: true }, (err) => {
            if (err) {
                mainWindow.webContents.send("onLog", `Failed to kill PID ${pid}: ${err.message}`, "error");
            } else {
                mainWindow.webContents.send("onLog", `Killed Roblox instance (PID: ${pid})`, "success");
                disabledPids.delete(Number(pid));
            }
        });
    } catch (err) {
        mainWindow.webContents.send("onLog", "Kill error: " + err.message, "error");
    }
})

ipcMain.on("toggle-instance-execution", (event, pid, enabled) => {
    const numPid = Number(pid);
    if (enabled) {
        disabledPids.delete(numPid);  // remove from blacklist → execution re-enabled
    } else {
        disabledPids.add(numPid);     // add to blacklist → execution disabled until toggled back
    }
    mainWindow.webContents.send("onLog", `Execution ${enabled ? 'enabled' : 'disabled'} for PID ${pid}`, "info");
})

ipcMain.on("rename-file", async (event, oldName, newName) => {
    try {
        const oldPath = path.join(mainRootPath, oldName);
        const newPath = path.join(mainRootPath, newName);
        
        if (!fs.existsSync(oldPath)) {
            event.reply('onLog', `File ${oldName} not found`, "error");
            return;
        }
        
        if (fs.existsSync(newPath)) {
            event.reply('onLog', `File ${newName} already exists`, "error");
            return;
        }
        
        fs.renameSync(oldPath, newPath);
        event.reply('onLog', `Renamed ${oldName} to ${newName}`, "success");
        
        const filesAndFolders = buildStructure(mainRootPath);
        event.reply("files", filesAndFolders);
    } catch (error) {
        event.reply('onLog', `Error renaming file: ${error.message}`, "error");
    }
})

ipcMain.on("duplicate-file", async (event, fileName, newName) => {
    try {
        const sourcePath = path.join(mainRootPath, fileName);
        const destPath = path.join(mainRootPath, newName);
        
        if (!fs.existsSync(sourcePath)) {
            event.reply('onLog', `File ${fileName} not found`, "error");
            return;
        }
        
        if (fs.existsSync(destPath)) {
            event.reply('onLog', `File ${newName} already exists`, "error");
            return;
        }
        
        fs.copyFileSync(sourcePath, destPath);
        event.reply('onLog', `Duplicated ${fileName} as ${newName}`, "success");
        
        const filesAndFolders = buildStructure(mainRootPath);
        event.reply("files", filesAndFolders);
    } catch (error) {
        event.reply('onLog', `Error duplicating file: ${error.message}`, "error");
    }
})

ipcMain.on("delete-file", async (event, fileName) => {
    try {
        const filePath = path.join(mainRootPath, fileName);
        
        if (!fs.existsSync(filePath)) {
            event.reply('onLog', `File ${fileName} not found`, "error");
            return;
        }
        
        fs.unlinkSync(filePath);
        event.reply('onLog', `Deleted ${fileName}`, "success");
        
        const filesAndFolders = buildStructure(mainRootPath);
        event.reply("files", filesAndFolders);
    } catch (error) {
        event.reply('onLog', `Error deleting file: ${error.message}`, "error");
    }
})

ipcMain.on("create-file", async (event, fileName) => {
    try {
        const filePath = path.join(mainRootPath, fileName);
        
        if (fs.existsSync(filePath)) {
            event.reply('onLog', `File ${fileName} already exists`, "error");
            return;
        }
        
        const defaultContent = `-- ${fileName}\n-- Created on ${new Date().toLocaleDateString()}\n\n`;
        fs.writeFileSync(filePath, defaultContent, 'utf-8');
        event.reply('onLog', `Created ${fileName}`, "success");
        
        const filesAndFolders = buildStructure(mainRootPath);
        event.reply("files", filesAndFolders);
    } catch (error) {
        event.reply('onLog', `Error creating file: ${error.message}`, "error");
    }
})

app.whenReady().then(() => {
   mainWindow = createWindow()
    if (lspEnabled) {
        initializeLSP();
    }
})

app.on('before-quit', () => {
    if (lspClient) {
        lspClient.stop();
    }
});

async function initializeLSP() {
    try {
        if (!lspEnabled) {
            return;
        }

        if (lspClient && lspClient.initialized) {
            return;
        }

        const lspPath = path.join(__dirname, '..', 'luau-lsp.exe');

        if (!fs.existsSync(lspPath)) {
            mainWindow.webContents.send("onLog", "Luau LSP not installed. Autocomplete will not work for you.", "info");
            return;
        }

        lspClient = new LuauLSPClient();

        lspClient.onDiagnostics = (diagnostics) => {
            mainWindow.webContents.send('lsp-diagnostics', diagnostics.diagnostics);
        };

        const definitions = ["roblox.d.luau"];
        if (voltlspEnabled) definitions.push("volt.d.luau");

        await lspClient.start(
            lspPath,
            path.join(__dirname, '..', 'lsp-workspace'),
            { types: { definitionFiles: definitions } }
        );
        mainWindow.webContents.send('lsp-ready');
    } catch (error) {
        mainWindow.webContents.send("onLog", "Failed to start Luau LSP: " + error.message, "error");
    }
}

function stopLSP() {
    if (lspClient) {
        try {
            lspClient.stop();
        } catch (e) {}
        lspClient = null;
    }
}

ipcMain.handle('enable-lsp', async (event, enabled) => {
    lspEnabled = !!enabled;
    if (lspEnabled) {
        await initializeLSP();
    } else {
        stopLSP();
    }
    return { enabled: lspEnabled };
});

ipcMain.handle('get-workspace-root', async () => {
    const workspacePath = path.join(__dirname, '..', 'lsp-workspace');
    if (!fs.existsSync(workspacePath)) {
        fs.mkdirSync(workspacePath, { recursive: true });
    }
    return workspacePath;
});

ipcMain.on('lsp-did-open', (event, uri, languageId, version, text) => {
    if (lspClient && lspClient.initialized) {
        lspClient.didOpen(uri, languageId, version, text);
    }
});

ipcMain.on('lsp-did-change', (event, uri, version, text) => {
    if (lspClient && lspClient.initialized) {
        lspClient.didChange(uri, version, text);
    }
});

ipcMain.on('lsp-did-close', (event, uri) => {
    if (lspClient && lspClient.initialized) {
        lspClient.didClose(uri);
    }
});

ipcMain.handle('lsp-completion', async (event, uri, line, character) => {
    if (lspClient && lspClient.initialized) {
        try {
            return await lspClient.completion(uri, line, character);
        } catch (error) {
            return null;
        }
    }
    return null;
});

ipcMain.handle('lsp-hover', async (event, uri, line, character) => {
    if (lspClient && lspClient.initialized) {
        try {
            return await lspClient.hover(uri, line, character);
        } catch (error) {
            console.error('LSP hover:', error);
            return null;
        }
    }
    return null;
});

ipcMain.handle('lsp-signature-help', async (event, uri, line, character) => {
    if (lspClient && lspClient.initialized) {
        try {
            return await lspClient.signatureHelp(uri, line, character);
        } catch (error) {
            console.error('LSP signature help:', error);
            return null;
        }
    }
    return null;
});

ipcMain.handle('lsp-definition', async (event, uri, line, character) => {
    if (lspClient && lspClient.initialized) {
        try {
            return await lspClient.definition(uri, line, character);
        } catch (error) {
            console.error('LSP definition:', error);
            return null;
        }
    }
    return null;
});