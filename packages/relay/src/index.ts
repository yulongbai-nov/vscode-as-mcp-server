#!/usr/bin/env node

import { serve } from '@hono/node-server';
import * as fsExtra from 'fs-extra';
import { Hono } from 'hono';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { URL } from 'node:url';

// Constants
const MAX_RETRIES = 3;
const RETRY_INTERVAL = 1000; // 1 second
const HTTP_TIMEOUT = 10000; // 10 seconds
const PORT_SCAN_RANGE = 10; // Scan from specified port to port+10
const CACHE_DIR = path.join(os.homedir(), '.vscode-as-mcp-relay-cache');
const TOOLS_CACHE_FILE = path.join(CACHE_DIR, 'tools-list-cache.json');

// グローバル変数: アクティブサーバーのURL
let activeServerUrl = '';

// キャッシュ関連の型とグローバル変数
interface ToolsCache {
  timestamp: number;
  data: any;
  expiresAt: number;
}

let toolsListCache: ToolsCache | null = null;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24時間のキャッシュ有効期限（ミリ秒）

// キャッシュディレクトリの初期化
async function initCacheDir(): Promise<void> {
  try {
    await fsExtra.ensureDir(CACHE_DIR);
    console.error(`Cache directory initialized at: ${CACHE_DIR}`);

    // キャッシュファイルが存在する場合は読み込む
    if (await fsExtra.pathExists(TOOLS_CACHE_FILE)) {
      try {
        const cacheData = await fsExtra.readFile(TOOLS_CACHE_FILE, 'utf8');
        toolsListCache = JSON.parse(cacheData);
        console.error('Loaded existing tools list cache');
      } catch (err) {
        console.error(`Failed to load cache file: ${(err as Error).message}`);
        // 読み込みに失敗した場合はキャッシュをクリア
        toolsListCache = null;
      }
    }
  } catch (err) {
    console.error(`Failed to initialize cache directory: ${(err as Error).message}`);
  }
}

// キャッシュの保存
async function saveToolsCache(data: any): Promise<void> {
  try {
    const cacheData: ToolsCache = {
      timestamp: Date.now(),
      data,
      expiresAt: Date.now() + CACHE_TTL
    };

    await fsExtra.writeFile(TOOLS_CACHE_FILE, JSON.stringify(cacheData), 'utf8');
    toolsListCache = cacheData;
    console.error('Tools list cache saved');
  } catch (err) {
    console.error(`Failed to save cache: ${(err as Error).message}`);
  }
}

// キャッシュの取得
function getToolsCache(): any | null {
  if (!toolsListCache || Date.now() > toolsListCache.expiresAt) {
    return null;
  }
  return toolsListCache.data;
}

// Command line arguments interface
interface Args {
  serverUrl: string;
  listenPort: number;
}

// HTTP Response interface
interface HttpResponse {
  statusCode: number;
  headers: Headers;
  body: string;
}

// Parse command line arguments
function parseArgs(): Args {
  const args = process.argv.slice(2);
  let serverUrl = 'http://localhost:6010';
  let listenPort = 6011;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--server-url' && i + 1 < args.length) {
      serverUrl = args[i + 1];
      i++;
    } else if (args[i] === '--listen-port' && i + 1 < args.length) {
      listenPort = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { serverUrl, listenPort };
}

// Function to send HTTP request with retry logic
async function sendWithRetry(
  url: string,
  body: string,
  isRegister: boolean = false
): Promise<HttpResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.error(`Retry attempt ${attempt + 1}/${MAX_RETRIES}`);
      await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL));
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HTTP_TIMEOUT);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();

      // For registration, status codes >= 400 are errors
      // For relaying, status codes >= 500 are errors
      if ((isRegister && response.status >= 400) ||
        (!isRegister && response.status >= 500)) {
        lastError = new Error(`Request failed with status ${response.status}: ${responseText}`);
        continue;
      }

      if (isRegister) {
        console.error('Successfully registered with server');
      }

      return {
        statusCode: response.status,
        headers: response.headers,
        body: responseText
      };
    } catch (err) {
      lastError = err as Error;
    }
  }

  throw new Error(`All retry attempts failed: ${lastError?.message}`);
}

// Find an available port for the server
async function findAvailablePort(startPort: number): Promise<number> {
  const net = await import('node:net');

  for (let port = startPort; port < startPort + 100; port++) {
    try {
      const server = net.createServer();
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.once('listening', () => resolve());
        server.listen(port);
      });
      server.close();
      return port;
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        console.error(`Port ${port} is already in use, trying next port`);
        continue;
      }
      throw err;
    }
  }
  throw new Error('Failed to find available port after 100 attempts');
}

// Scan for MCP servers on nearby ports
async function scanForServers(basePort: number): Promise<string[]> {
  const servers: string[] = [];

  console.error(`Scanning for MCP servers from port ${basePort} to ${basePort + PORT_SCAN_RANGE}...`);

  for (let port = basePort; port <= basePort + PORT_SCAN_RANGE; port++) {
    const url = `http://localhost:${port}`;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // Short timeout for scanning

      const response = await fetch(`${url}/ping`, {
        method: 'GET',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.status === 200) {
        console.error(`Found MCP server at ${url}`);
        servers.push(url);
      }
    } catch (err) {
      // Ignore connection errors - this is expected for ports without an MCP server
    }
  }

  return servers;
}

// JSON-RPC リクエストの処理と必要に応じてキャッシュ
async function processJsonRpc(line: string, activeServerUrl: string): Promise<string> {
  try {
    // 文字列を直接パースせず、必要な部分だけを抽出
    // メソッド名のみを確認するための簡易パース
    const methodMatch = line.match(/"method"\s*:\s*"([^"]+)"/);
    const idMatch = line.match(/"id"\s*:\s*([0-9]+)/);

    if (methodMatch && methodMatch[1] === 'list/tools' && idMatch) {
      const requestId = idMatch[1];

      // キャッシュからデータを取得
      const cachedData = getToolsCache();
      if (cachedData) {
        console.error('Returning tools list from cache');
        // キャッシュにあるデータをそのまま送信（idのみ置き換え）
        let cachedResponse = JSON.stringify(cachedData);
        // idを置き換え（正規表現で慎重に処理）
        cachedResponse = cachedResponse.replace(/"id"\s*:\s*([0-9]+)/, `"id": ${requestId}`);
        return cachedResponse;
      }

      // キャッシュにない場合は取得してキャッシュ
      const response = await sendWithRetry(activeServerUrl, line);

      try {
        // キャッシュに保存（大きなレスポンスでも対応）
        await saveToolsCache(JSON.parse(response.body));
      } catch (cacheErr) {
        console.error(`Failed to cache tools response: ${(cacheErr as Error).message}`);
      }

      return response.body;
    } else {
      // list/tools以外は通常通り処理
      const response = await sendWithRetry(activeServerUrl, line);
      return response.body;
    }
  } catch (err) {
    throw err;
  }
}

// Process stdin and relay all messages
function processStdin(serverUrls: string[]): void {
  // アクティブサーバーが設定されていない場合は最初のサーバーをアクティブとして使用
  if (!activeServerUrl) {
    activeServerUrl = serverUrls[0];
    console.error(`Setting initial active server to: ${activeServerUrl}`);

    // 初期アクティブサーバーが決定したときも全サーバーに通知
    notifyAllServersOfActiveChange(activeServerUrl, serverUrls).catch(err => {
      console.error(`Failed to notify servers about initial active server: ${(err as Error).message}`);
    });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false
  });

  rl.on('line', async (line: string) => {
    try {
      // Skip empty lines
      if (!line.trim()) {
        return;
      }

      // JSON-RPC処理（キャッシュを含む）
      const responseBody = await processJsonRpc(line, activeServerUrl);

      // Output the response to stdout
      process.stdout.write(responseBody + '\n');
    } catch (err) {
      console.error(`Failed to relay message: ${(err as Error).message}`);
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}

// Main function
async function main(): Promise<void> {
  try {
    // Redirect log output to stderr
    console.log = console.error;

    // キャッシュシステムの初期化
    await initCacheDir();

    const { serverUrl, listenPort } = parseArgs();

    // Parse base port from server URL
    const serverUrlObj = new URL(serverUrl);
    const basePort = parseInt(serverUrlObj.port, 10);

    // MCPサーバーを見つけるための変数
    let serverUrls: string[] = [];
    let scanInterval: NodeJS.Timeout | null = null;
    let isFirstScan = true;

    // MCPサーバーをスキャンする関数
    const scanForMCPServers = async () => {
      const foundServers = await scanForServers(basePort);

      if (foundServers.length > 0) {
        // 新しいサーバーが見つかった場合
        if (serverUrls.length === 0) {
          console.error(`Found ${foundServers.length} MCP servers. Using ${foundServers[0]} as active.`);
          serverUrls = foundServers;

          // 最初のスキャンでサーバーが見つかった場合は残りの設定を実行
          if (isFirstScan) {
            isFirstScan = false;
            await setupServer(listenPort, serverUrls);
          } else {
            // 後続のスキャンでサーバーが見つかった場合、それらに登録
            await registerWithServers(serverUrls);
          }

          // スキャン間隔を増やす（サーバーが見つかったので）
          if (scanInterval) {
            clearInterval(scanInterval);
            scanInterval = setInterval(scanForMCPServers, 60000); // 1分ごとにスキャン
          }
        } else {
          // すでにサーバーリストがある場合は、新しいサーバーがあれば追加
          const newServers = foundServers.filter(url => !serverUrls.includes(url));
          if (newServers.length > 0) {
            console.error(`Found ${newServers.length} new MCP servers.`);
            serverUrls = [...serverUrls, ...newServers];
            // 新しいサーバーに登録
            await registerWithServers(newServers);
          }
        }
      } else if (serverUrls.length === 0) {
        // サーバーがまだ見つからない場合
        console.error(`No MCP servers found on ports ${basePort} through ${basePort + PORT_SCAN_RANGE}, will retry...`);

        // 最初のスキャンの場合はサーバーのセットアップを行わずに継続
        if (isFirstScan) {
          isFirstScan = false;
          // 頻繁にスキャン（10秒ごと）
          scanInterval = setInterval(scanForMCPServers, 10000);
        }
      }
    };

    // 最初のスキャンを実行
    await scanForMCPServers();

    // サーバーが見つからない場合は待機
    if (serverUrls.length === 0) {
      console.error('Waiting for MCP servers to become available...');
      // この時点では、スキャン間隔はすでに設定されているので、
      // メインスレッドを維持するためにダミーのリスナーを設定
      process.on('SIGINT', () => {
        if (scanInterval) {
          clearInterval(scanInterval);
        }
        process.exit(0);
      });

      // stdinの処理はサーバーが見つかるまで延期される
    }
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

// 全サーバーにアクティブサーバーの変更を通知する関数
async function notifyAllServersOfActiveChange(activeServerUrl: string, servers: string[]): Promise<void> {
  console.error(`Notifying all servers about active server change to: ${activeServerUrl}`);

  for (const serverUrl of servers) {
    try {
      const notifyUrl = `${serverUrl}/active-server-changed`;
      const payload = JSON.stringify({
        activeServerUrl: activeServerUrl,
        timestamp: Date.now()
      });

      await sendWithRetry(notifyUrl, payload);
      console.error(`Successfully notified server ${serverUrl} about active server change`);
    } catch (err) {
      console.error(`Failed to notify server ${serverUrl} about active server change: ${(err as Error).message}`);
    }
  }
}

// MCPサーバーに登録する関数
async function registerWithServers(serverUrls: string[]): Promise<void> {
  // このコンテキストでポート番号を取得する
  const port = parseInt(process.env.CURRENT_PORT || '6011', 10);

  for (const serverUrl of serverUrls) {
    const registerUrl = `${serverUrl}/register`;
    const registerPayload = JSON.stringify({
      clientUrl: `http://localhost:${port}`,
      features: ['relay_protocol_v1']  // Indicate support for our relay protocol
    });

    try {
      await sendWithRetry(registerUrl, registerPayload, true);
    } catch (err) {
      console.error(`Failed to register with server ${serverUrl}: ${(err as Error).message}`);
    }
  }
}

// Honoサーバーなどのセットアップを行う関数
async function setupServer(listenPort: number, serverUrls: string[]): Promise<void> {
  // Find an available port for our HTTP server
  const port = await findAvailablePort(listenPort);
  console.error(`Using port ${port} for relay server`);

  // 現在のポートを環境変数に保存（他の関数で使用するため）
  process.env.CURRENT_PORT = port.toString();

  // アクティブサーバーを変更する関数
  async function setActiveServer(newActiveServerUrl: string): Promise<void> {
    try {
      // アクティブサーバーURLを更新
      activeServerUrl = newActiveServerUrl;
      console.error(`Active server changed to: ${activeServerUrl}`);

      // 全サーバーに通知
      await notifyAllServersOfActiveChange(newActiveServerUrl, serverUrls);
    } catch (err) {
      console.error(`Failed to set active server: ${(err as Error).message}`);
    }
  }

  // Honoアプリケーションの作成
  const app = new Hono();

  // アクティブサーバーになりたいリクエストを処理するエンドポイント
  app.post('/request-active', async (c) => {
    try {
      const body = await c.req.json();
      const requestingServerUrl = body.serverUrl;

      if (!requestingServerUrl) {
        return c.json({ success: false, error: 'Missing serverUrl in request' }, 400);
      }

      await setActiveServer(requestingServerUrl);
      return c.json({ success: true, message: 'Server set as active' });
    } catch (err) {
      console.error('Error processing set-as-active request:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  // アクティブサーバー変更通知を受け取るエンドポイント
  app.post('/active-server-changed', async (c) => {
    try {
      const body = await c.req.json();
      const newActiveServerUrl = body.activeServerUrl;

      if (!newActiveServerUrl) {
        return c.json({ success: false, error: 'Missing activeServerUrl in request' }, 400);
      }

      console.error(`Received notification: Active server changed to ${newActiveServerUrl}`);

      // ローカルの状態を更新
      // これにより、次のリクエスト時に新しいアクティブサーバーが使用される
      if (activeServerUrl === '') {
        activeServerUrl = newActiveServerUrl;
      }

      return c.json({ success: true });
    } catch (err) {
      console.error('Error processing active-server-changed notification:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  });

  // 通常のメッセージ受信処理
  app.post('/', async (c) => {
    try {
      const body = await c.req.text();
      // Output received JSON to stdout
      process.stdout.write(body + '\n');
      return c.text('OK');
    } catch (err) {
      console.error('Error processing request:', err);
      return c.text('Failed to process request body', 500);
    }
  });

  // 404エラーハンドラー
  app.notFound((c) => {
    return c.text('Not Found', 404);
  });

  // エラーハンドラー
  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.text('Internal Server Error', 500);
  });

  // サーバー起動
  serve({
    fetch: app.fetch,
    port: port
  }, (info) => {
    console.error(`Hono server listening on port ${info.port}`);
  });

  // Register with all found servers
  await registerWithServers(serverUrls);

  // Process stdin
  processStdin(serverUrls);
}

// Run the program
main();
