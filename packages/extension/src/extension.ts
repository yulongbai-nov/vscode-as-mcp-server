import * as vscode from 'vscode';
import { BidiHttpTransport } from './bidi-http-transport';
import { registerVSCodeCommands } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { DIFF_VIEW_URI_SCHEME } from './utils/DiffViewProvider';
import { resolvePort } from './utils/port';

// MCP Server のステータスを表示するステータスバーアイテム
let serverStatusBarItem: vscode.StatusBarItem;
let transport: BidiHttpTransport;
let running = false;  // サーバーが起動しているかどうかのフラグ

// ステータスバーを更新する関数
function updateServerStatusBar(isRunning: boolean, isActive: boolean) {
  if (!serverStatusBarItem) {
    return;
  }

  if (isRunning) {
    serverStatusBarItem.text = isActive
      ? '$(star-full) MCP Active'
      : '$(server) MCP Server';
    serverStatusBarItem.tooltip = isActive
      ? 'Running as Active MCP Server'
      : 'Running as MCP Server (non-active)';
    serverStatusBarItem.command = 'mcpServer.toggleActiveStatus';
    serverStatusBarItem.show();
  } else {
    serverStatusBarItem.text = '$(circle-slash) MCP Server';
    serverStatusBarItem.tooltip = 'MCP Server is not running';
    serverStatusBarItem.command = 'mcpServer.startServer';
    serverStatusBarItem.show();
  }
}

export const activate = async (context: vscode.ExtensionContext) => {
  console.log('LMLMLM', vscode.lm.tools);

  // Create the output channel for logging
  const outputChannel = vscode.window.createOutputChannel(extensionDisplayName);
  outputChannel.appendLine(`Activating ${extensionDisplayName}...`);

  // Initialize the MCP server instance
  const mcpServer = createMcpServer(outputChannel);

  // Server state
  running = false;

  // Create status bar item
  serverStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(serverStatusBarItem);
  updateServerStatusBar(false, false);

  // Register command to toggle active status
  context.subscriptions.push(
    vscode.commands.registerCommand('mcpServer.toggleActiveStatus', async () => {
      if (!transport) {
        vscode.window.showWarningMessage('MCP Server is not running.');
        return;
      }

      // アクティブが有効な場合は無効に
      if (transport.isActiveServer) {
        transport.isActiveServer = false;
        updateServerStatusBar(running, false);
        outputChannel.appendLine('Server is now non-Active');
        vscode.window.showInformationMessage('MCP Server is now a non-Active server.');
        return;
      }

      // 現在非アクティブの場合はリクエストを送信
      try {
        const success = await transport.requestActive();
        if (success) {
          updateServerStatusBar(running, true);
          outputChannel.appendLine('Server is now Active');
          vscode.window.showInformationMessage('MCP Server is now an Active server.');
        } else {
          vscode.window.showErrorMessage('Failed to set MCP Server as Active.');
        }
      } catch (err) {
        outputChannel.appendLine(`Error toggling active status: ${err}`);
        vscode.window.showErrorMessage(`Failed to set MCP Server as Active: ${err}`);
      }
    })
  );

  // Server start function
  async function startServer(port: number) {
    transport = new BidiHttpTransport(port, outputChannel);
    await transport.start();
    await mcpServer.connect(transport);
    running = true;

    // デフォルトでは非アクティブサーバーとして起動
    transport.isActiveServer = false;
    updateServerStatusBar(running, false);
  }

  // Register VSCode commands
  registerVSCodeCommands(context, mcpServer, outputChannel, startServer, updateServerStatusBar, running);

  // Register Diff View Provider for file comparison functionality
  const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return Buffer.from(uri.query, "base64").toString("utf-8");
    }
  })();

  // DiffViewProvider の URI スキームを mcp-diff に変更
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_VIEW_URI_SCHEME, diffContentProvider),
  );

  // ステータスバーのコマンドを登録
  context.subscriptions.push(
    vscode.commands.registerCommand('mcp.textEditor.applyChanges', () => {
      vscode.commands.executeCommand('statusBar.applyChanges');
      return true;
    }),
    vscode.commands.registerCommand('mcp.textEditor.cancelChanges', () => {
      vscode.commands.executeCommand('statusBar.cancelChanges');
      return false;
    })
  );

  // Start server if configured to do so
  const mcpConfig = vscode.workspace.getConfiguration('mcpServer');
  const port = await resolvePort(mcpConfig.get<number>('port', 6010));
  const startOnActivate = mcpConfig.get<boolean>('startOnActivate', true);

  if (startOnActivate) {
    try {
      await startServer(port);
      outputChannel.appendLine(`MCP Server started on port ${port}.`);
    } catch (err) {
      outputChannel.appendLine(`Failed to start MCP Server: ${err}`);
      running = false;
    }
  } else {
    outputChannel.appendLine('MCP Server startup disabled by configuration.');
  }

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
