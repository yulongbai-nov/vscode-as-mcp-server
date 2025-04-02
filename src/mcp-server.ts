import { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import dedent from 'dedent';
import * as vscode from 'vscode';
import { DiagnosticSeverity } from 'vscode';
import { z, ZodRawShape } from 'zod';
import packageJson from '../package.json';
import { codeCheckerTool } from './tools/code_checker';
import {
  listDebugSessions,
  listDebugSessionsSchema,
  startDebugSession,
  startDebugSessionSchema,
  stopDebugSession,
  stopDebugSessionSchema,
} from './tools/debug_tools';
import { executeCommandSchema, executeCommandToolHandler } from './tools/execute_command';
import { focusEditorTool } from './tools/focus_editor';
import { listDirectorySchema, listDirectoryTool } from './tools/list_directory';
import { textEditorSchema, textEditorTool } from './tools/text_editor';

export const extensionName = 'vscode-mcp-server';
export const extensionDisplayName = 'VSCode MCP Server';

export function createMcpServer(_outputChannel: vscode.OutputChannel): McpServer {
  const mcpServer = new McpServer({
    name: extensionName,
    version: packageJson.version,
  }, {
    capabilities: {
      resources: {},
      tools: {},
    },
  });

  // Register tools
  registerTools(mcpServer);
  // Register resource handlers
  registerResourceHandlers(mcpServer);

  return mcpServer;
}

function registerTools(mcpServer: McpServer) {
  // Register the "execute_command" tool
  mcpServer.tool(
    'execute_command',
    dedent`
      Execute a command in a VSCode integrated terminal with proper shell integration.
      This tool provides detailed output and exit status information, and supports:
      - Custom working directory
      - Shell integration for reliable output capture
      - Output compression for large outputs
      - Detailed exit status reporting
    `.trim(),
    executeCommandSchema.shape,
    async (params) => {
      const result = await executeCommandToolHandler(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register the "code_checker" tool
  mcpServer.tool(
    'code_checker',
    dedent`
      Retrieve diagnostics from VSCode's language services for the active workspace.
      Use this tool after making changes to any code in the filesystem to ensure no new
      errors were introduced, or when requested by the user.
    `.trim(),
    {
      severityLevel: z
        .enum(['Error', 'Warning', 'Information', 'Hint'])
        .default('Warning')
        .describe("Minimum severity level for checking issues: 'Error', 'Warning', 'Information', or 'Hint'."),
    },
    async (params: { severityLevel?: 'Error' | 'Warning' | 'Information' | 'Hint' }) => {
      const severityLevel = params.severityLevel
        ? DiagnosticSeverity[params.severityLevel]
        : DiagnosticSeverity.Warning;
      const result = codeCheckerTool(severityLevel);
      return {
        ...result,
        content: result.content.map((c) => ({
          ...c,
          text: typeof c.text === 'string' ? c.text : String(c.text),
          type: 'text',
        })),
      };
    },
  );

  // Register 'focus_editor' tool
  mcpServer.tool(
    'focus_editor',
    dedent`
      Open the specified file in the VSCode editor and navigate to a specific line and column.
      Use this tool to bring a file into focus and position the editor's cursor where desired.
      Note: This tool operates on the editor visual environment so that the user can see the file. It does not return the file contents in the tool call result.
    `.trim(),
    {
      filePath: z.string().describe('The absolute path to the file to focus in the editor.'),
      line: z.number().int().min(0).default(0).describe('The line number to navigate to (default: 0).'),
      column: z.number().int().min(0).default(0).describe('The column position to navigate to (default: 0).'),
      startLine: z.number().int().min(0).optional().describe('The starting line number for highlighting.'),
      startColumn: z.number().int().min(0).optional().describe('The starting column number for highlighting.'),
      endLine: z.number().int().min(0).optional().describe('The ending line number for highlighting.'),
      endColumn: z.number().int().min(0).optional().describe('The ending column number for highlighting.'),
    },
    async (params: { filePath: string; line?: number; column?: number }) => {
      const result = await focusEditorTool(params);
      return result;
    },
  );

  // Register debug tools
  mcpServer.tool(
    'list_debug_sessions',
    'List all active debug sessions in the workspace.',
    listDebugSessionsSchema.shape,
    async () => {
      const result = listDebugSessions();
      return {
        ...result,
        content: result.content.map((item) => ({ type: 'text', text: JSON.stringify(item.json) })),
      };
    },
  );

  mcpServer.tool(
    'start_debug_session',
    'Start a new debug session with the provided configuration.',
    startDebugSessionSchema.shape,
    async (params) => {
      const result = await startDebugSession(params);
      return {
        ...result,
        content: result.content.map((item) => ({
          ...item,
          type: 'text' as const,
        })),
      };
    },
  );

  mcpServer.tool(
    'restart_debug_session',
    'Restart a debug session by stopping it and then starting it with the provided configuration.',
    startDebugSessionSchema.shape,
    async (params) => {
      await stopDebugSession({ sessionName: params.configuration.name });
      const result = await startDebugSession(params);
      return {
        ...result,
        content: result.content.map((item) => ({
          ...item,
          type: 'text' as const,
        })),
      };
    },
  );

  mcpServer.tool(
    'stop_debug_session',
    'Stop all debug sessions that match the provided session name.',
    stopDebugSessionSchema.shape,
    async (params) => {
      const result = await stopDebugSession(params);
      return {
        ...result,
        content: result.content.map((item) => ({
          ...item,
          type: 'text' as const,
        })),
      };
    },
  );

  // Register text editor tool
  mcpServer.tool(
    'text_editor',
    dedent`
      A text editor tool that provides file manipulation capabilities using VSCode's native APIs:
      - view: Read file contents with optional line range
      - str_replace: Replace text in file
      - create: Create new file
      - insert: Insert text at specific line
      - undo_edit: Restore from backup

      Code Editing Tips:
      - VSCode may automatically prune unused imports when saving. To prevent this, make sure the imported type is
        actually used in your code before adding the import.
    `.trim(),
    textEditorSchema.shape,
    async (params) => {
      const result = await textEditorTool(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );

  // Register list directory tool
  mcpServer.tool(
    'list_directory',
    dedent`
      List directory contents in a tree format, respecting .gitignore patterns.
      Shows files and directories with proper indentation and icons.
      Useful for exploring workspace structure while excluding ignored files.
    `.trim(),
    listDirectorySchema.shape,
    async (params) => {
      const result = await listDirectoryTool(params);
      return {
        content: result.content.map(item => ({
          ...item,
          type: 'text' as const,
        })),
        isError: result.isError,
      };
    }
  );
}

function registerResourceHandlers(mcpServer: McpServer) {
  mcpServer.server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const documents = vscode.workspace.textDocuments;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return {
      resources: documents.map((doc) => ({
        uri: `vscode://${doc.uri.fsPath}`,
        mimeType: doc.languageId ? `text/${doc.languageId}` : "text/plain",
        name: `Currently Open in Editor: ${doc.fileName}`,
        description: dedent`
          This is one of the currently open files in the editor.
          Language: ${doc.languageId || 'plain text'}
          Line count: ${doc.lineCount}
          Note: This list only shows files that are currently open in the editor.
          There may be more files in the workspace at ${workspaceRoot || 'the current workspace'}.
        `.trim(),
      })),
    };
  });

  mcpServer.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resourceUrl = new URL(request.params.uri);
    const filePath = resourceUrl.pathname.replace(/^\//, '');

    const documents = vscode.workspace.textDocuments;
    const document = documents.find(doc => doc.uri.fsPath === filePath);

    if (!document) {
      throw new Error("File not found or not open in editor");
    }

    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: document.languageId ? `text/${document.languageId}` : "text/plain",
          text: document.getText(),
        },
      ],
    };
  });
}

interface Tool<Args extends ZodRawShape> {
  name: string;
  description: string;
  paramsSchema: Args;
  cb: ToolCallback<Args>;
}

export class McpServerHelper {
  tools: Tool<any>[] = [];
  tool<Args extends ZodRawShape>(name: string, description: string, paramsSchema: Args, cb: ToolCallback<Args>) {
    this.tools.push({ name, description, paramsSchema, cb });
  }
}
