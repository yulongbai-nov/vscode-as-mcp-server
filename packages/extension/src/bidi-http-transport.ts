import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as vscode from 'vscode';

export class BidiHttpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private clientUrls: Set<string> = new Set();
  public actualPort: number = 0;
  public isActiveServer: boolean = false;

  // requestActive メソッドを追加
  async requestActive(): Promise<boolean> {
    this.outputChannel.appendLine('Requesting active server status');
    try {
      // HTTP POSTリクエストを送信して、アクティブステータスをリクエスト
      const results = await Promise.all([...this.clientUrls].map(async clientUrl => {
        const response = await fetch(`${clientUrl}/request-active`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ serverUrl: `http://localhost:${this.actualPort}` }),
        });

        if (!response.ok) {
          console.error(`HTTP ${response.status}: ${await response.text()}`);
          return false;
        }

        // success: true が返ってきた場合にアクティブとする
        const resp = await response.json() as { success?: boolean };
        return resp.success;
      }));

      const ok = results.some(r => r);

      if (ok) {
        this.isActiveServer = true;
        this.outputChannel.appendLine('Server is now active');
        return true;
      } else {
        this.outputChannel.appendLine('Server could not become active');
        return false;
      }
    } catch (err) {
      this.outputChannel.appendLine(`Error requesting active status: ${err}`);
      return false;
    }
  }

  constructor(
    readonly listenPort: number,
    private readonly outputChannel: vscode.OutputChannel
  ) { }

  async start(): Promise<void> {
    const app = express();

    app.get('/ping', (_req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received ping request');
      res.send({ status: 'ok', timestamp: new Date().toISOString() });
    });

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

    // アクティブサーバー変更通知を処理するエンドポイント
    app.post('/active-server-changed', express.json(), async (req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received active server changed notification: ' + JSON.stringify(req.body));
      try {
        const { activeServerUrl } = req.body;
        if (!activeServerUrl) {
          res.status(400).send('activeServerUrl is required');
          return;
        }

        // 自分のURLと比較して、自分がアクティブかどうかを判断
        const myUrl = `http://localhost:${this.actualPort}`;
        const isThisServerActive = activeServerUrl === myUrl;

        // アクティブ状態を更新
        this.isActiveServer = isThisServerActive;
        this.outputChannel.appendLine(`Server active status updated: ${this.isActiveServer ? 'active' : 'inactive'}`);

        res.send({ success: true });
      } catch (err) {
        this.outputChannel.appendLine('Error handling active server changed notification: ' + err);
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

    // Try to listen on ports starting from listenPort up to listenPort+10
    let currentPort = this.listenPort;
    const maxPort = this.listenPort + 10;

    const startServer = (port: number): Promise<number> => {
      return new Promise((resolve, reject) => {
        const server = app.listen(port)
          .on('listening', () => {
            this.outputChannel.appendLine(`MCP Server running at :${port}`);
            resolve(port);
          })
          .on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE' && port < maxPort) {
              this.outputChannel.appendLine(`Port ${port} is in use, trying ${port + 1}`);
              server.close();
              resolve(0); // Signal to try next port
            } else {
              reject(err);
            }
          });
      });
    };

    while (currentPort <= maxPort) {
      try {
        const boundPort = await startServer(currentPort);
        if (boundPort > 0) {
          // Successfully bound to a port
          this.actualPort = boundPort;
          return;
        }
        // Try next port
        currentPort++;
      } catch (err) {
        this.outputChannel.appendLine(`Failed to start server: ${err}`);
        throw err;
      }
    }

    throw new Error(`Failed to bind to any port in range ${this.listenPort}-${maxPort}`);
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
