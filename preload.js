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

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
    minimize: () => ipcRenderer.send('min-win'),
    maximize: () => ipcRenderer.send('max-win'),
    close: () => ipcRenderer.send('close-win'),
    confirmClose: () => ipcRenderer.send('confirm-close'),
    onPrepareClose: (callback) => ipcRenderer.on('prepare-close', () => callback()),
    sendMessage: (msg) => ipcRenderer.send('message-from-renderer', msg),
    getFiles: (msg) => ipcRenderer.send('load-files', msg),
    getFile: (msg) => ipcRenderer.send('load-file', msg),
    saveFile: (msg) => ipcRenderer.send('save-file', msg),
    saveToScript: (fileName, content) => ipcRenderer.send('save-to-script', fileName, content),
    loadDialog: () => ipcRenderer.send('load-file-dialog'),
    onFiles: (callback) => ipcRenderer.on('files', (_, data) => callback(data)),
    onFile: (callback) => ipcRenderer.on('file', (_, data) => callback(data)),
    onLoadFile: (callback) => ipcRenderer.on('on-load-file', (_, data) => callback(data)),
    onFileNotFoundSaveAs: (callback) => ipcRenderer.on('file-not-found-save-as', () => callback()),
    onLog: (callback) => {
        ipcRenderer.on("onLog", (event, msg, type) => {
          callback(msg, type);
        });
      },
    onLogBatch: (callback) => {
        ipcRenderer.on("onLogBatch", (event, batch) => {
            callback(batch);
        });
    },
      onSaveSuccess: (callback) => {
        ipcRenderer.on("save-success", (event, fileName) => {
          callback(fileName);
        });
      },
      onFileSavedAs: (callback) => {
        ipcRenderer.on("file-saved-as", (event, fileName) => {
          callback(fileName);
        });
      },
      attached: (callback) => {
        ipcRenderer.on("attached", (event, isAttached) => {
          callback(isAttached);
        });
      },
    execute: (content) => {
        ipcRenderer.send("execute", content);
    },
    executeFile: (fileName) => {
        ipcRenderer.send("execute-file", fileName);
    },
    renameFile: (oldName, newName) => {
        ipcRenderer.send("rename-file", oldName, newName);
    },
    duplicateFile: (fileName, newName) => {
        ipcRenderer.send("duplicate-file", fileName, newName);
    },
    deleteFile: (fileName) => {
        ipcRenderer.send("delete-file", fileName);
    },
    createFile: (fileName) => {
        ipcRenderer.send("create-file", fileName);
    },
    attach: () => {
        ipcRenderer.send("attach");
    },
    openRoblox: () => {
        ipcRenderer.send("open-roblox");
    },
    refreshInstances: () => {
        ipcRenderer.send("refresh-instances");
    },
    onInstancesList: (callback) => {
        ipcRenderer.on("instances-list", (event, instances) => callback(instances));
    },
    killInstance: (pid) => {
        ipcRenderer.send("kill-instance", pid);
    },
    toggleInstanceExecution: (pid, enabled) => {
        ipcRenderer.send("toggle-instance-execution", pid, enabled);
    },
    sendLog: (msg, type) => {
        ipcRenderer.send('onLog', msg, type);
    },
    setAlwaysOnTop: (enabled) => {
        ipcRenderer.send('set-always-on-top', enabled);
    },
    zoomIn: () => {
        ipcRenderer.send('zoom-in');
    },
    zoomOut: () => {
        ipcRenderer.send('zoom-out');
    },
    zoomReset: () => {
        ipcRenderer.send('zoom-reset');
    },
    uiReady: () => {
        ipcRenderer.send('ui-ready');
    },
    setRegistryValue: (key, name, value) => {
        ipcRenderer.send('set-reg-key', key, name, value);
    },

    lspDidOpen: (uri, languageId, version, text) => {
        ipcRenderer.send('lsp-did-open', uri, languageId, version, text);
    },
    lspDidChange: (uri, version, text) => {
        ipcRenderer.send('lsp-did-change', uri, version, text);
    },
    lspDidClose: (uri) => {
        ipcRenderer.send('lsp-did-close', uri);
    },
    lspCompletion: (uri, line, character) => {
        return ipcRenderer.invoke('lsp-completion', uri, line, character);
    },
    lspHover: (uri, line, character) => {
        return ipcRenderer.invoke('lsp-hover', uri, line, character);
    },
    onLspReady: (callback) => {
        ipcRenderer.on('lsp-ready', (_, data) => callback(data));
    },
    lspSignatureHelp: (uri, line, character) => {
        return ipcRenderer.invoke('lsp-signature-help', uri, line, character);
    },
    lspDefinition: (uri, line, character) => {
        return ipcRenderer.invoke('lsp-definition', uri, line, character);
    },
    onDiagnostics: (callback) => {
        ipcRenderer.on('lsp-diagnostics', (_, diagnostics) => callback(diagnostics));
    },
    getWorkspaceRoot: () => {
        return ipcRenderer.invoke('get-workspace-root');
    },
    enableLSP: (enabled) => {
        return ipcRenderer.invoke('enable-lsp', !!enabled);
    },
    toggleVoltLSP: (enabled) => {
        ipcRenderer.send('toggle-volt-lsp', enabled);
    }
});