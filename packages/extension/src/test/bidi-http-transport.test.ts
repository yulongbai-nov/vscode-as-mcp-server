import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import * as assert from 'assert';
import express from 'express';
import * as http from 'http';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { BidiHttpTransport } from '../bidi-http-transport';

// テスト用のモックとヘルパー関数
// Mock helpers used exclusively for test execution.
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
  // 10秒のタイムアウト
  // Apply a 10-second timeout for slower CI environments.
  this.timeout(10000);

  let transport: BidiHttpTransport;
  let outputChannel: MockOutputChannel;
  let server: http.Server;
  let mockOnMessage: sinon.SinonStub;
  let testPort: number;

  // テスト用のサーバーをセットアップ
  // Set up the HTTP server used for the tests.
  async function setupTestServer(port: number): Promise<http.Server> {
    const app = express();
    app.use(express.json());

    // /ping エンドポイント
    // /ping endpoint used to verify connectivity.
    app.get('/ping', (_req: express.Request, res: express.Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // /request-handover エンドポイント
    // /request-handover endpoint that simulates handover requests.
    app.post('/request-handover', (_req: express.Request, res: express.Response) => {
      res.json({ success: true });
    });

    // モックサーバーを起動
    // Start the mock server and resolve once listening.
    return new Promise((resolve) => {
      const server = app.listen(port, () => {
        resolve(server);
      });
    });
  }

  setup(async function () {
    // テスト用のポートを選択
    // Choose a dedicated port for the tests.
    testPort = 6020;

    // モックの設定
    // Configure mock objects used throughout the suite.
    outputChannel = new MockOutputChannel('Test Output');
    mockOnMessage = sinon.stub();

    // テスト対象のインスタンスを作成
    // Create the transport instance under test.
    transport = new BidiHttpTransport(testPort, outputChannel as unknown as vscode.OutputChannel);
    transport.onmessage = mockOnMessage;

    // テスト用のサーバーをセットアップ
    // Spin up the supporting server for test scenarios.
    server = await setupTestServer(testPort + 1);
  });

  teardown(async function () {
    // テストのクリーンアップ
    // Clean up resources created during each test.
    await transport.close();
    if (server) {
      server.close();
    }
  });

  test('should start the server on the specified port', async function () {
    await transport.start();

    assert.ok(outputChannel.logs.some(log => log.includes(`MCP Server running at :${testPort}`)));
  });

  test('should fail if the port is already in use', async function () {
    // 最初のポートで別のサーバーを起動
    // Launch a blocking server on the primary port first.
    const blockingServer = await setupTestServer(testPort);

    try {
      let errorThrown = false;
      try {
        await transport.start();
      } catch (err) {
        errorThrown = true;
        assert.ok((err as Error).message.includes(`Failed to bind to port ${testPort}`));
      }
      assert.ok(errorThrown, 'Expected an error to be thrown when port is in use');
    } finally {
      blockingServer.close();
    }
  });

  test('requestHandover should set isServerRunning to true upon successful response', async function () {
    await transport.start();

    // リクエスト前はtrue (start()で設定される)
    // `start()` sets `isServerRunning` to true before the request.
    assert.strictEqual(transport.isServerRunning, true);

    // テスト実行を高速化するため、ハンドオーバー遅延を短縮
    // Reduce restart delay to speed up the test run.
    (transport as unknown as { restartDelayMs: number }).restartDelayMs = 50;

    // リクエスト実行
    // Execute the handover request against the running server.
    const result = await transport.requestHandover();

    // 結果のチェック
    // Verify the handover result and internal state.
    assert.strictEqual(result, true);
    assert.strictEqual(transport.isServerRunning, true);
  });

  test('send should resolve pending responses for HTTP clients', async function () {
    await transport.start();

    const requestMessage: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      method: 'test.method'
    };

    const expectedResponse: JSONRPCMessage = {
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true }
    };

    const responsePromise = fetch(`http://localhost:${testPort}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestMessage)
    });

    transport.onmessage = async (message) => {
      assert.deepStrictEqual(message, requestMessage);
      await transport.send(expectedResponse);
    };

    const response = await responsePromise;
    assert.strictEqual(response.status, 200);

    const body = await response.json();
    assert.deepStrictEqual(body, expectedResponse);

    // 再起動遅延をリセット
    (transport as unknown as { restartDelayMs: number }).restartDelayMs = 1000;
  });

  test('send should log when no pending response is available', async function () {
    await transport.start();

    const message = {
      jsonrpc: '2.0',
      id: 1,
      result: { ok: false }
    } as JSONRPCMessage;

    await transport.send(message);
    assert.ok(outputChannel.logs.some(log => log.includes('No pending response for ID: 1')));
  });
});
