import * as vscode from 'vscode';
import { BidiHttpTransport } from './bidi-http-transport';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { DIFF_VIEW_URI_SCHEME } from './utils/DiffViewProvider';

// MCP Server のステータスを表示するステータスバーアイテム
// Status bar item that displays the MCP Server status.
let serverStatusBarItem: vscode.StatusBarItem;
let transport: BidiHttpTransport | undefined;

// Active MCP server instance. Undefined when the server lifecycle is disabled (e.g., under tests).
let mcpServerInstance: ReturnType<typeof createMcpServer> | undefined;

// ステータスバーを更新する関数
// Function to update the status bar.
function updateServerStatusBar(status: 'running' | 'stopped' | 'starting' | 'tool_list_updated') {
  if (!serverStatusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      serverStatusBarItem.text = '$(server) MCP Server';
      serverStatusBarItem.tooltip = 'MCP Server is running';
      serverStatusBarItem.command = 'mcpServer.stopServer';
      break;
    case 'starting':
      serverStatusBarItem.text = '$(sync~spin) MCP Server';
      serverStatusBarItem.tooltip = 'Starting...';
      serverStatusBarItem.command = undefined;
      break;
    case 'tool_list_updated':
      serverStatusBarItem.text = '$(warning) MCP Server';
      serverStatusBarItem.tooltip = 'Tool list updated - Restart MCP Client';
      serverStatusBarItem.command = 'mcpServer.stopServer';
      break;
    case 'stopped':
    default:
      serverStatusBarItem.text = '$(circle-slash) MCP Server';
      serverStatusBarItem.tooltip = 'MCP Server is not running';
      serverStatusBarItem.command = 'mcpServer.toggleActiveStatus';
      break;
  }
  serverStatusBarItem.show();
}

export const activate = async (context: vscode.ExtensionContext) => {
  console.log('LMLMLM', vscode.lm.tools);
  console.log(`[mcp] extension mode: ${context.extensionMode}`);

  // Create the output channel for logging
  const outputChannel = vscode.window.createOutputChannel(extensionDisplayName);
  outputChannel.appendLine(`Activating ${extensionDisplayName}...`);

  const isTestMode = context.extensionMode === vscode.ExtensionMode.Test;

  if (isTestMode) {
    outputChannel.appendLine('Test mode detected; MCP Server will not be initialized.');
    updateServerStatusBar('stopped');
  } else {
    // Initialize the MCP server instance
    mcpServerInstance = createMcpServer(outputChannel);
  }

  // Create status bar item
  serverStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(serverStatusBarItem);

  // Server start function
  async function startServer(port: number) {
    if (!mcpServerInstance) {
      outputChannel.appendLine('DEBUG: startServer called but MCP Server is disabled (likely under tests).');
      updateServerStatusBar('stopped');
      return;
    }

    if (transport) {
      outputChannel.appendLine('DEBUG: Existing MCP Server instance detected. Stopping before restart.');
      try {
        await stopServer();
      } catch (err) {
        outputChannel.appendLine(`DEBUG: Ignoring stop error during restart: ${err}`);
      }
    }

    outputChannel.appendLine(`DEBUG: Starting MCP Server on port ${port}...`);
    transport = new BidiHttpTransport(port, outputChannel);
    // サーバー状態変更のイベントハンドラを設定
    // Register the event handler for server status changes.
    transport.onServerStatusChanged = (status) => {
      updateServerStatusBar(status);
    };

  await mcpServerInstance.connect(transport); // connect calls transport.start().
    updateServerStatusBar(transport.serverStatus);
  }

  async function stopServer() {
    if (!mcpServerInstance) {
      outputChannel.appendLine('DEBUG: stopServer called but MCP Server is disabled. Nothing to stop.');
      updateServerStatusBar('stopped');
      transport = undefined;
      return;
    }

    if (!transport) {
      outputChannel.appendLine('DEBUG: stopServer called without an active transport; closing MCP Server instance.');
      try {
        mcpServerInstance.close();
      } catch (err) {
        outputChannel.appendLine(`Failed to close MCP Server connection: ${err}`);
      }
      updateServerStatusBar('stopped');
      return;
    }

    outputChannel.appendLine('DEBUG: Stopping MCP Server...');
    try {
      await transport.close();
    } catch (err) {
      outputChannel.appendLine(`Failed to close transport cleanly: ${err}`);
    }

    transport = undefined;

    try {
      mcpServerInstance.close();
    } catch (err) {
      outputChannel.appendLine(`Failed to close MCP Server connection: ${err}`);
    }

    updateServerStatusBar('stopped');
    outputChannel.appendLine('MCP Server stopped.');
  }

  // Register Diff View Provider for file comparison functionality
  const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return Buffer.from(uri.query, "base64").toString("utf-8");
    }
  })();

  // DiffViewProvider の URI スキームを mcp-diff に変更
  // Change the DiffViewProvider URI scheme to mcp-diff.
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
  );

  // Start server if configured to do so
  const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
  const port = mcpConfig.get<number>('port', 60100);
  let startOnActivate = mcpConfig.get<boolean>('startOnActivate', true);

  if (isTestMode) {
    startOnActivate = false;
    outputChannel.appendLine('Extension running in test mode; skipping MCP Server auto-start.');
  }

  if (startOnActivate && mcpServerInstance) {
    try {
      await startServer(port);
      outputChannel.appendLine(`MCP Server started on port ${port}.`);
    } catch (err) {
      outputChannel.appendLine(`Failed to start MCP Server: ${err}`);
    }
  } else {
    updateServerStatusBar('stopped');
    outputChannel.appendLine('Auto-start disabled via mcpServer.startOnActivate configuration.');
  }

  // Register VSCode commands
  registerVSCodeCommands(context, outputChannel, startServer, stopServer, () => transport);

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
