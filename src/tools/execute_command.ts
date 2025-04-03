import * as vscode from "vscode"
import { z } from "zod"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
import { ConfirmationUI } from "../utils/confirmation_ui"
import { formatResponse, ToolResponse } from "../utils/response"
import { delay as setTimeoutPromise } from "../utils/time.js"

export const executeCommandSchema = z.object({
  command: z.string().describe("The command to execute"),
  customCwd: z.string().optional().describe("Optional custom working directory for command execution"),
})

export class ExecuteCommandTool {
  private cwd: string
  private terminalManager: TerminalManager

  constructor(cwd: string) {
    this.cwd = cwd
    this.terminalManager = new TerminalManager()
  }

  async execute(command: string, customCwd?: string): Promise<[boolean, ToolResponse]> {
    // Ask for permission before executing the command
    const userResponse = await this.ask(command);

    // If user denied execution
    if (userResponse !== "Approve") {
      return [
        false,
        formatResponse.toolResult(`Command execution was denied by the user. ${userResponse !== "Deny" ? `Feedback: ${userResponse}` : ""}`)
      ];
    }

    const terminalInfo = await this.terminalManager.getOrCreateTerminal(customCwd || this.cwd)
    terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
    const process = this.terminalManager.runCommand(terminalInfo, command)

    let result = ""
    process.on("line", (line) => {
      result += line + "\n"
    })

    let completed = false
    process.once("completed", () => {
      completed = true
    })

    process.once("no_shell_integration", async () => {
      await vscode.window.showWarningMessage("Shell integration is not available. Some features may be limited.")
    })

    await process

    // Wait for a short delay to ensure all messages are sent to the webview
    // This delay allows time for non-awaited promises to be created and
    // for their associated messages to be sent to the webview, maintaining
    // the correct order of messages (although the webview is smart about
    // grouping command_output messages despite any gaps anyways)
    await setTimeoutPromise(50)

    result = result.trim()

    if (completed) {
      return [false, formatResponse.toolResult(`Command executed.${result.length > 0 ? `\nOutput:\n${result}` : ""}`)]
    } else {
      return [
        false,
        formatResponse.toolResult(
          `Command is still running in the user's terminal.${result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
          }\n\nYou will be updated on the terminal status and new output in the future.`
        ),
      ]
    }
  }

  private async ask(command: string): Promise<string> {
    return await ConfirmationUI.confirm("Execute Command?", command, "Execute Command", "Deny");
  }
}

export async function executeCommandToolHandler(params: z.infer<typeof executeCommandSchema>) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    return {
      isError: true,
      content: [{ text: "No workspace folder is open" }],
    };
  }

  const tool = new ExecuteCommandTool(workspaceRoot);
  const [success, response] = await tool.execute(params.command, params.customCwd);

  return {
    isError: !success,
    content: [{ text: response.text }],
  };
}
