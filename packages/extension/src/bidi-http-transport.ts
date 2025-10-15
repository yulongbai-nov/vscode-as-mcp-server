import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import * as http from 'node:http';
import * as vscode from 'vscode';

export class BidiHttpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  onServerStatusChanged?: (status: 'running' | 'stopped' | 'starting' | 'tool_list_updated') => void;
  #serverStatus: 'running' | 'stopped' | 'starting' | 'tool_list_updated' = 'stopped';
  private pendingResponses = new Map<string | number, (resp: JSONRPCMessage) => void>();
  private httpServer?: http.Server; // Express server instance
  private closingServerPromise: Promise<void> | null = null;
  private restartDelayMs = 1000;

  public get isServerRunning(): boolean {
    return this.serverStatus === 'running';
  }

  private set serverStatus(status: 'running' | 'stopped' | 'starting' | 'tool_list_updated') {
    this.#serverStatus = status;
    if (this.onServerStatusChanged) {
      this.onServerStatusChanged(status);
    }
  }

  public get serverStatus(): 'running' | 'stopped' | 'starting' | 'tool_list_updated' {
    return this.#serverStatus;
  }

  constructor(
    readonly listenPort: number,
    private readonly outputChannel: vscode.OutputChannel
  ) { }

  async requestHandover(): Promise<boolean> {
    this.outputChannel.appendLine('Requesting server handover');

    // Notify that we're requesting handover
    this.serverStatus = 'starting';

    try {
  // 現在のサーバーに対してハンドオーバーリクエストを送信
  // Send a handover request to the current server.
      const response = await fetch(`http://localhost:${this.listenPort}/request-handover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json() as { success: boolean };

      if (data.success) {
        this.outputChannel.appendLine('Handover request accepted');

        await this.waitForServerShutdown();

  // ハンドオーバーが成功したら、設定された時間待機してからサーバーを再起動する
  // After a successful handover, wait for the configured delay before restarting.
        this.outputChannel.appendLine(`Waiting ${this.restartDelayMs}ms before starting server...`);
        await this.delay(this.restartDelayMs);

        try {
          await this.start();
          this.outputChannel.appendLine('Server restarted after successful handover');
          return true;
        } catch (startErr) {
          const startErrorMessage = startErr instanceof Error ? startErr.message : String(startErr);
          this.outputChannel.appendLine(`Failed to restart server after handover: ${startErrorMessage}`);
          return false;
        }
      } else {
        this.outputChannel.appendLine('Handover request rejected');
        return false;
      }
    } catch (err) {
  // エラーが発生した場合（サーバーが起動していない場合など）
  // If an error occurs (for example, the server is not running).
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`Handover request failed: ${errorMessage}`);

      await this.waitForServerShutdown();

  // ハンドオーバーリクエストが失敗した場合も、設定された時間待機後にサーバー再起動を試みる
  // Even when the handover request fails, wait for the configured delay and attempt to start the server.
      this.outputChannel.appendLine(`Waiting ${this.restartDelayMs}ms before starting server...`);
      await this.delay(this.restartDelayMs);

      try {
        await this.start();
        this.outputChannel.appendLine('Server started after failed handover request');
        return true;
      } catch (startErr) {
        const startErrorMessage = startErr instanceof Error ? startErr.message : String(startErr);
        this.outputChannel.appendLine(`Failed to start server: ${startErrorMessage}`);
        return false;
      }
    }
  }

  async start(): Promise<void> {
    this.serverStatus = 'starting';

    const app = express();

    app.get('/ping', (_req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received ping request');
      const response = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        serverRunning: this.isServerRunning
      };

      res.send(response);
    });

    // Endpoint to handle handover requests
    app.post('/request-handover', express.json(), (_req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received handover request');

      // Accept the handover request
      res.send({ success: true });

      void this.closeServer('handover request');
    });

    app.post('/notify-tools-updated', express.json(), (_req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received tools updated notification');
      vscode.window.showWarningMessage('The Tool List has been updated. Please restart the MCP Client (e.g., Claude Desktop) to notify it of the new Tool List. (For Claude Desktop, click the top hamburger menu -> File -> Exit.)');
      this.serverStatus = 'tool_list_updated';

      res.send({ success: true });
    });

    app.post('/', express.json(), async (req: express.Request, res: express.Response) => {
      this.outputChannel.appendLine('Received message: ' + JSON.stringify(req.body));
      try {
        const message = req.body as JSONRPCMessage;

        if (this.serverStatus === 'tool_list_updated' && (message as { method: string }).method === 'tools/list') {
          this.serverStatus = 'running';
        }

        if (this.onmessage) {
          if ('id' in message) {
            // Create a new promise for the response
            const responsePromise = new Promise<JSONRPCMessage>((resolve) => {
              this.pendingResponses.set(message.id, resolve);
            });
            // Handle the request and wait for response
            this.onmessage(message);
            const resp = await responsePromise;
            res.send(resp);
          } else {
            // Handle the request without waiting for response
            this.onmessage(message);
            res.send('{ "success": true }');
          }
        } else {
          res.status(500).send('No message handler');
        }
      } catch (err) {
        this.outputChannel.appendLine('Error handling message: ' + err);
        res.status(500).send('Internal Server Error');
      }
    });

    // Only try to listen on the specified port
    const startServer = (port: number): Promise<number> => {
      console.trace('Starting server on port: ' + port);
      return new Promise((resolve, reject) => {
        const server = app.listen(port)
          .once('listening', () => {
            this.httpServer = server; // Store server instance
            this.outputChannel.appendLine(`MCP Server running at :${port}`);
            resolve(port);
          })
          .once('error', (err: NodeJS.ErrnoException) => {
            this.outputChannel.appendLine(`Failed to listen on port ${port}: ${err.message}`);
            reject(err);
          });
      });
    };

    try {
      await startServer(this.listenPort);

      // Server status is automatically set to running when httpServer is set
      this.serverStatus = 'running';
      this.outputChannel.appendLine('Server is now running');
    } catch (err) {
      this.serverStatus = 'stopped';
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.outputChannel.appendLine(`Failed to start server on port ${this.listenPort}: ${errorMessage}`);
      throw new Error(`Failed to bind to port ${this.listenPort}: ${errorMessage}`);
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    this.outputChannel.appendLine('Sending message: ' + JSON.stringify(message));

    if ('id' in message && 'result' in message) {
      // This is a response to a previous request
      const resolve = this.pendingResponses.get(message.id);
      if (resolve) {
        resolve(message);
        this.pendingResponses.delete(message.id);
      } else {
        this.outputChannel.appendLine(`No pending response for ID: ${message.id}`);
      }
    }
  }

  async close(): Promise<void> {
    if (this.httpServer) {
      await this.closeServer('manual close');
    } else {
      this.serverStatus = 'stopped';
    }
  }

  private async closeServer(reason: string): Promise<void> {
    if (!this.httpServer) {
      this.outputChannel.appendLine(`closeServer called (${reason}) but no active server instance.`);
      return;
    }

    if (this.closingServerPromise) {
      this.outputChannel.appendLine(`Server already closing due to ${reason}; awaiting existing shutdown.`);
      await this.closingServerPromise;
      return;
    }

    const serverToClose = this.httpServer;
    this.outputChannel.appendLine(`Stopping server (${reason})`);

    this.closingServerPromise = new Promise<void>((resolve) => {
      serverToClose.close((err) => {
        if (err) {
          this.outputChannel.appendLine(`Error while closing server (${reason}): ${err.message}`);
        } else {
          this.outputChannel.appendLine('Server close complete.');
        }
        resolve();
      });
    }).finally(() => {
      this.closingServerPromise = null;
    });

    this.httpServer = undefined;
    await this.closingServerPromise;
    this.serverStatus = 'stopped';
  }

  private async waitForServerShutdown(): Promise<void> {
    if (this.closingServerPromise) {
      await this.closingServerPromise;
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
