import * as vscode from 'vscode';
import { BidiHttpTransport } from './bidi-http-transport';
import { registerVSCodeCommands, ServerState } from './commands';
import { createMcpServer, extensionDisplayName } from './mcp-server';
import { DIFF_VIEW_URI_SCHEME } from './utils/DiffViewProvider';
import { resolvePort } from './utils/port';

export const activate = async (context: vscode.ExtensionContext) => {
  console.log('LMLMLM', vscode.lm.tools);

  // Create the output channel for logging
  const outputChannel = vscode.window.createOutputChannel(extensionDisplayName);
  outputChannel.appendLine(`Activating ${extensionDisplayName}...`);

  // Initialize the MCP server instance
  const mcpServer = createMcpServer(outputChannel);

  // Server state
  const running: ServerState = { value: false };

  // Server start function
  async function startServer(port: number) {
    const bidiHttpTransport = new BidiHttpTransport(port, outputChannel);
    await bidiHttpTransport.start();
    await mcpServer.connect(bidiHttpTransport);
    running.value = true;
  }

  // Register VSCode commands
  registerVSCodeCommands(context, mcpServer, outputChannel, running, startServer);

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
      running.value = false;
    }
  } else {
    outputChannel.appendLine('MCP Server startup disabled by configuration.');
  }

  outputChannel.appendLine(`${extensionDisplayName} activated.`);
};

export function deactivate() {
  // Clean-up is managed by the disposables added in the activate method.
}
