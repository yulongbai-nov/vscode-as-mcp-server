import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as vscode from 'vscode';
import { resolvePort } from './utils/port';

export interface ServerState {
    value: boolean;
}

export function registerVSCodeCommands(
    context: vscode.ExtensionContext,
    mcpServer: McpServer,
    outputChannel: vscode.OutputChannel,
    running: ServerState,
    startServer: (port: number) => Promise<void>
) {
    // COMMAND PALETTE COMMAND: Stop the MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.stopServer', () => {
            if (!running.value) {
                vscode.window.showWarningMessage('MCP Server is not running.');
                outputChannel.appendLine('Attempted to stop the MCP Server, but it is not running.');
                return;
            }
            mcpServer.close();
            running.value = false;
        }),
    );

    // COMMAND PALETTE COMMAND: Start the MCP Server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.startServer', async () => {
            if (running.value) {
                vscode.window.showWarningMessage('MCP Server is already running.');
                outputChannel.appendLine('Attempted to start the MCP Server, but it is already running.');
                return;
            }
            const newPort = await resolvePort(vscode.workspace.getConfiguration('mcpServer').get<number>('port', 6010));
            await startServer(newPort);
            outputChannel.appendLine(`MCP Server started on port ${newPort}.`);
            vscode.window.showInformationMessage(`MCP Server started on port ${newPort}.`);
        }),
    );

    // COMMAND PALETTE COMMAND: Set the MCP server port and restart the server
    context.subscriptions.push(
        vscode.commands.registerCommand('mcpServer.setPort', async () => {
            const currentPort = vscode.workspace.getConfiguration('mcpServer').get<number>('port', 6010);
            const newPortInput = await vscode.window.showInputBox({
                prompt: 'Enter new port number for the MCP Server:',
                value: String(currentPort),
                validateInput: (input) => {
                    const num = Number(input);
                    if (isNaN(num) || num < 1 || num > 65535) {
                        return 'Please enter a valid port number (1-65535).';
                    }
                    return null;
                },
            });

            if (newPortInput && newPortInput.trim().length > 0) {
                const newPort = Number(newPortInput);
                // Update the configuration so that subsequent startups use the new port
                await vscode.workspace
                    .getConfiguration('mcpServer')
                    .update('port', newPort, vscode.ConfigurationTarget.Global);

                // Restart the server
                mcpServer.close();
                await startServer(newPort);
                outputChannel.appendLine(`MCP Server restarted on port ${newPort}`);
                vscode.window.showInformationMessage(`MCP Server restarted on port ${newPort}`);
            }
        }),
    );
}
