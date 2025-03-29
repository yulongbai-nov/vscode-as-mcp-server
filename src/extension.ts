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

  // テキストエディタのコマンドを登録
  context.subscriptions.push(
    vscode.commands.registerCommand('textEditor.applyChanges', () => {
      vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return true;
    }),
    vscode.commands.registerCommand('textEditor.cancelChanges', () => {
      vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
      return false;
    })
  );

  // CodeLensプロバイダーを登録
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { pattern: '**/*' },
      new (class implements vscode.CodeLensProvider {
        private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
        readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

        async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
          const codeLenses: vscode.CodeLens[] = [];
          const editor = vscode.window.activeTextEditor;

          if (editor && editor.document === document) {
            const range = new vscode.Range(
              new vscode.Position(0, 0),
              new vscode.Position(0, 0)
            );

            codeLenses.push(
              new vscode.CodeLens(range, {
                title: "✓ Apply Changes",
                command: 'textEditor.applyChanges'
              }),
              new vscode.CodeLens(range, {
                title: "✗ Cancel",
                command: 'textEditor.cancelChanges'
              })
            );
          }

          return codeLenses;
        }
      })()
    )
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
