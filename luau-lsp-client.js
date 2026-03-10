const { spawn } = require('child_process');
const path = require('path');

class LuauLSPClient {
    constructor() {
        this.lspProcess = null;
        this.connection = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
        this.initialized = false;
        this.workspaceRoot = null;
        this.lspPath = null;
        this.intentionalStop = false;
        this.restartTimeout = null;
        this.config = {
            "diagnostics": { "enabled": true },
            "types": { "definitionFiles": ["roblox.d.luau"] },
            "completion": { "enabled": true, "suggestImports": true }
        };
    }

    async start(lspPath, workspaceRoot, config = null) {
        if (this.lspProcess) {
            return;
        }

        this.lspPath = lspPath;
        this.workspaceRoot = workspaceRoot;
        this.intentionalStop = false;
        if (config) {
            this.config = { ...this.config, ...config };
        }

        return new Promise((resolve, reject) => {
            try {
                const defFiles = this.config?.types?.definitionFiles || ['roblox.d.luau'];
                const defArgs = defFiles.map(f => `--definitions=${path.join(workspaceRoot, f)}`);
                
                this.lspProcess = spawn(lspPath, [
                    'lsp',
                    '--stdio',
                    ...defArgs
                ], {
                    cwd: workspaceRoot,
                    stdio: ['pipe', 'pipe', 'pipe']
                });

                this.lspProcess.on('error', (err) => {
                    if (!this.initialized) reject(err);
                });

                this.lspProcess.on('exit', (code, signal) => {
                    this.lspProcess = null;
                    this.initialized = false;
                    
                    if (!this.intentionalStop) {
                        if (this.restartTimeout) clearTimeout(this.restartTimeout);
                        this.restartTimeout = setTimeout(() => {
                            this.start(this.lspPath, this.workspaceRoot, this.config).catch(err => {
                                console.error('Failed to restart LSP:', err);
                            });
                        }, 2000);
                    }
                });
                
                this.setupMessageHandling();

                this.initialize().then(() => {
                    resolve();
                }).catch(reject);

            } catch (error) {
                reject(error);
            }
        });
    }

    setupMessageHandling() {
        let buffer = '';
        let contentLength = 0;

        this.lspProcess.stdout.on('data', (data) => {
            buffer += data.toString();

            while (true) {
                if (contentLength === 0) {
                    const headerMatch = buffer.match(/Content-Length: (\d+)\r\n\r\n/);
                    if (!headerMatch) break;

                    contentLength = parseInt(headerMatch[1]);
                    buffer = buffer.substring(headerMatch[0].length);
                }

                if (buffer.length >= contentLength) {
                    const message = buffer.substring(0, contentLength);
                    buffer = buffer.substring(contentLength);
                    contentLength = 0;

                    try {
                        this.handleMessage(JSON.parse(message));
                    } catch (error) {
                        console.error('Failed to parse lsp msg:', error);
                    }
                } else {
                    break;
                }
            }
        });
    }

    handleMessage(message) {
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                reject(message.error);
            } else {
                resolve(message.result);
            }
        } else if (message.method) {
            this.handleNotification(message);
        }
    }

    handleNotification(message) {
        switch (message.method) {
            case 'textDocument/publishDiagnostics':
                if (this.onDiagnostics) {
                    this.onDiagnostics(message.params);
                }
                break;
            case 'workspace/configuration':
                try {

                    if (message.id !== undefined) {
                        const result = message.params.items.map(item => {
                            if (item.section === "types") return this.config.types;
                            if (item.section === "completion") return this.config.completion;
                            if (item.section === "diagnostics") return this.config.diagnostics;
                            return this.config;
                        });

                        this.sendResponse(message.id, result);
                    }
                } catch (error) {
                    console.error('Error handling cfg:', error);
                }
                break;
        }
    }

    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        if (this.initialized) {
            this.sendNotification('workspace/didChangeConfiguration', {
                settings: this.config
            });
        }
    }

    sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = ++this.messageId;
            const message = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            const timeout = setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request timeout: ${method}`));
                }
            }, 30000);

            this.pendingRequests.set(id, {
                resolve: (result) => {
                    clearTimeout(timeout);
                    resolve(result);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });

            const content = JSON.stringify(message);
            const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

            this.lspProcess.stdin.write(header + content);
        });
    }

    sendNotification(method, params) {
        const message = {
            jsonrpc: '2.0',
            method,
            params
        };

        const content = JSON.stringify(message);
        const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

        this.lspProcess.stdin.write(header + content);
    }

    sendResponse(id, result) {
        const message = {
            jsonrpc: '2.0',
            id,
            result
        };

        const content = JSON.stringify(message);
        const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;

        this.lspProcess.stdin.write(header + content);
    }

    async initialize() {
        const workspaceUri = `file:///${this.workspaceRoot.replace(/\\/g, '/')}`;

        const result = await this.sendRequest('initialize', {
            processId: process.pid,
            rootUri: workspaceUri,
            initializationOptions: {
                fflags: {},
                types: {
                    definitionFiles: this.config.types.definitionFiles
                }
            },
            capabilities: {
                textDocument: {
                    completion: {
                        completionItem: {
                            snippetSupport: true,
                            commitCharactersSupport: true,
                            documentationFormat: ['markdown', 'plaintext']
                        }
                    },
                    hover: {
                        contentFormat: ['markdown', 'plaintext']
                    },
                    signatureHelp: {
                        signatureInformation: {
                            documentationFormat: ['markdown', 'plaintext']
                        }
                    },
                    definition: { linkSupport: true },
                    references: {},
                    documentSymbol: {},
                    rename: {},
                    publishDiagnostics: {}
                },
                workspace: {
                    workspaceFolders: true,
                    configuration: true
                }
            },
            workspaceFolders: [{
                uri: `file:///${this.workspaceRoot.replace(/\\/g, '/')}`,
                name: path.basename(this.workspaceRoot)
            }]
        });

        this.sendNotification('initialized', {});
        this.initialized = true;

        return result;
    }

    async didOpen(uri, languageId, version, text) {
        this.sendNotification('textDocument/didOpen', {
            textDocument: {
                uri,
                languageId,
                version,
                text
            }
        });
    }

    async didChange(uri, version, text) {
        this.sendNotification('textDocument/didChange', {
            textDocument: {
                uri,
                version
            },
            contentChanges: [{
                text
            }]
        });
    }

    async didClose(uri) {
        this.sendNotification('textDocument/didClose', {
            textDocument: { uri }
        });
    }

    async completion(uri, line, character) {
        const result = await this.sendRequest('textDocument/completion', {
            textDocument: { uri },
            position: { line, character }
        });
        return result;
    }

    async hover(uri, line, character) {
        return this.sendRequest('textDocument/hover', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    async signatureHelp(uri, line, character) {
        return this.sendRequest('textDocument/signatureHelp', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    async definition(uri, line, character) {
        return this.sendRequest('textDocument/definition', {
            textDocument: { uri },
            position: { line, character }
        });
    }

    async references(uri, line, character) {
        return this.sendRequest('textDocument/references', {
            textDocument: { uri },
            position: { line, character },
            context: { includeDeclaration: true }
        });
    }

    async rename(uri, line, character, newName) {
        return this.sendRequest('textDocument/rename', {
            textDocument: { uri },
            position: { line, character },
            newName
        });
    }

    stop() {
        this.intentionalStop = true;
        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }
        if (this.lspProcess) {
            this.sendRequest('shutdown', {}).then(() => {
                this.sendNotification('exit', {});
                if (this.lspProcess) this.lspProcess.kill();
                this.lspProcess = null;
                this.initialized = false;
            }).catch(() => {
                if (this.lspProcess) this.lspProcess.kill();
                this.lspProcess = null;
                this.initialized = false;
            });
        }
    }
}

module.exports = LuauLSPClient;