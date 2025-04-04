import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import * as assert from 'assert';
import express from 'express';
import * as http from 'http';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BidiHttpTransport } from '../bidi-http-transport';

// テスト用のモックとヘルパー関数
class MockOutputChannel implements vscode.OutputChannel {
  name: string;
  logs: string[] = [];

  constructor(name: string) {
    this.name = name;
  }

  append(value: string): void {
    this.logs.push(value);
  }

  appendLine(value: string): void {
    this.logs.push(value + '\n');
  }

  clear(): void {
    this.logs = [];
  }

  show(preserveFocus?: boolean): void;
  show(column?: vscode.ViewColumn, preserveFocus?: boolean): void;
  show(_columnOrPreserveFocus?: vscode.ViewColumn | boolean, _preserveFocus?: boolean): void { }

  hide(): void { }

  replace(_value: string): void { }

  dispose(): void { }
}

suite('BidiHttpTransport Test Suite', function () {
  this.timeout(10000); // 10秒のタイムアウト

  let transport: BidiHttpTransport;
  let outputChannel: MockOutputChannel;
  let server: http.Server;
  let mockOnMessage: sinon.SinonStub;
  let testPort: number;

  // テスト用のサーバーをセットアップ
  async function setupTestServer(port: number): Promise<http.Server> {
    const app = express();
    app.use(express.json());

    // /ping エンドポイント
    app.get('/ping', (_req: express.Request, res: express.Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // /request-active エンドポイント
    app.post('/request-active', (_req: express.Request, res: express.Response) => {
      res.json({ success: true });
    });

    // モックサーバーを起動
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        resolve(server);
      });
    });
  }

  setup(async function () {
    // テスト用のポートを選択
    testPort = 6020;

    // モックの設定
    outputChannel = new MockOutputChannel('Test Output');
    mockOnMessage = sinon.stub();

    // テスト対象のインスタンスを作成
    transport = new BidiHttpTransport(testPort, outputChannel as unknown as vscode.OutputChannel);
    transport.onmessage = mockOnMessage;

    // テスト用のサーバーをセットアップ
    server = await setupTestServer(testPort + 1);
  });

  teardown(async function () {
    // テストのクリーンアップ
    await transport.close();
    if (server) {
      server.close();
    }
  });

  test('should start the server on the specified port', async function () {
    await transport.start();

    assert.strictEqual(transport.actualPort, testPort);
    assert.ok(outputChannel.logs.some(log => log.includes(`MCP Server running at :${testPort}`)));
  });

  test('should try next port if the initial port is in use', async function () {
    // 最初のポートで別のサーバーを起動
    const blockingServer = await setupTestServer(testPort);

    try {
      await transport.start();

      // 次のポートを試みるはず
      assert.strictEqual(transport.actualPort, testPort + 1);
      assert.ok(outputChannel.logs.some(log => log.includes(`Port ${testPort} is in use, trying ${testPort + 1}`)));
    } finally {
      blockingServer.close();
    }
  });

  test('requestActive should set isActiveServer to true upon successful response', async function () {
    await transport.start();

    // リクエスト前はfalse
    assert.strictEqual(transport.isActiveServer, false);

    // requestActiveメソッドのfetchをモック化
    const originalFetch = global.fetch;

    // @ts-ignore
    global.fetch = async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true })
      } as Response;
    };

    try {
      // リクエスト実行
      const result = await transport.requestActive();

      // 結果のチェック
      assert.strictEqual(result, true);
      assert.strictEqual(transport.isActiveServer, true);
      assert.ok(outputChannel.logs.some(log => log.includes('Server is now active')));
    } finally {
      // fetchを元に戻す
      global.fetch = originalFetch;
    }
  });

  test('send should throw an error if no clients are connected', async function () {
    await transport.start();

    // クライアントなしでsendを呼び出す
    const message: JSONRPCMessage = {
      jsonrpc: '2.0',
      method: 'test',
      id: 1
    };

    let threwError = false;
    try {
      await transport.send(message);
    } catch (err) {
      threwError = true;
      assert.ok((err as Error).message.includes('No clients connected'));
    }

    assert.ok(threwError, 'Expected an error to be thrown');
  });
});
