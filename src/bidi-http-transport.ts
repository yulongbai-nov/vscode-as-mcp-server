import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as vscode from 'vscode';

export class BidiHttpTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    private clientUrls: Set<string> = new Set();

    constructor(
        readonly listenPort: number,
        private readonly outputChannel: vscode.OutputChannel
    ) { }

    async start() {
        const app = express();

        app.post('/register', express.json(), async (req: express.Request, res: express.Response) => {
            this.outputChannel.appendLine('Received registration request: ' + JSON.stringify(req.body));
            try {
                const { clientUrl } = req.body;
                if (!clientUrl) {
                    res.status(400).send('clientUrl is required');
                    return;
                }
                this.clientUrls.add(clientUrl);
                this.outputChannel.appendLine('New client URL added: ' + clientUrl);
                this.outputChannel.appendLine(`Total connected clients: ${this.clientUrls.size}`);
                res.send({ status: 'registered', clientCount: this.clientUrls.size });
            } catch (err) {
                this.outputChannel.appendLine('Error handling registration request: ' + err);
                res.status(500).send('Internal Server Error');
            }
        });

        app.post('/', express.json(), async (req: express.Request, res: express.Response) => {
            this.outputChannel.appendLine('Received message: ' + JSON.stringify(req.body));
            try {
                this.onmessage!(req.body);
                res.send('OK');
            } catch (err) {
                this.outputChannel.appendLine('Error handling message: ' + err);
                res.status(500).send('Internal Server Error');
            }
        });

        app.listen(this.listenPort, () => {
            this.outputChannel.appendLine(`MCP Server running at :${this.listenPort}`);
        });
    }

    private async sendToClient(clientUrl: string, message: JSONRPCMessage): Promise<void> {
        let retries = 3;
        while (retries > 0) {
            try {
                const resp = await fetch(clientUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(message),
                });
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
                }
                return;
            } catch (err) {
                retries--;
                if (retries === 0) {
                    throw err;
                }
                this.outputChannel.appendLine(`Error sending message to ${clientUrl}: ${err}. Retries left: ${retries}`);
                await new Promise<void>((resolve) => setTimeout(resolve, 1000));
            }
        }
    }

    async send(message: JSONRPCMessage) {
        this.outputChannel.appendLine('Sending message: ' + JSON.stringify(message));
        if (this.clientUrls.size === 0) {
            throw new Error('No clients connected. Waiting for clients to connect with clientUrl parameter.');
        }

        const sendPromises = Array.from(this.clientUrls).map(clientUrl =>
            this.sendToClient(clientUrl, message)
                .catch(err => {
                    this.outputChannel.appendLine(`Failed to send message to ${clientUrl}: ${err}`);
                    return err;
                })
        );

        const results = await Promise.allSettled(sendPromises);
        const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

        if (failures.length > 0) {
            this.outputChannel.appendLine(`Failed to send message to ${failures.length} client(s):`);
            failures.forEach(f => this.outputChannel.appendLine(f.reason.message));
        }
    }

    close(): Promise<void> {
        return Promise.resolve();
    }
}
