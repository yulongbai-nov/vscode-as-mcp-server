import * as vscode from "vscode"
import { z } from "zod"
import { TerminalManager } from "../integrations/terminal/TerminalManager"
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
    const terminalInfo = await this.terminalManager.getOrCreateTerminal(customCwd || this.cwd)
    terminalInfo.terminal.show() // weird visual bug when creating new terminals (even manually) where there's an empty space at the top.
    const process = this.terminalManager.runCommand(terminalInfo, command)

    let userFeedback: { text?: string; images?: string[] } | undefined
    let didContinue = false
    const sendCommandOutput = async (line: string): Promise<void> => {
      try {
        const response = await this.ask("command_output", line)
        if (response === "Continue") {
          // proceed while running
        } else {
          userFeedback = { text: response }
        }
        didContinue = true
        process.continue() // continue past the await
      } catch {
        // This can only happen if this ask promise was ignored, so ignore this error
      }
    }

    let result = ""
    process.on("line", (line) => {
      result += line + "\n"
      if (!didContinue) {
        sendCommandOutput(line)
      }
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

    if (userFeedback) {
      return [
        true,
        formatResponse.toolResult(
          `Command is still running in the user's terminal.${result.length > 0 ? `\nHere's the output so far:\n${result}` : ""
          }\n\nThe user provided the following feedback:\n<feedback>\n${userFeedback.text}\n</feedback>`,
        ),
      ]
    }

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

  private async ask(type: string, line: string): Promise<string> {
    if (type === "command_output") {
      const response = await vscode.window.showInformationMessage(
        line,
        { modal: false },
        { title: "Continue", isCloseAffordance: false },
        { title: "Stop", isCloseAffordance: true }
      )
      return response?.title || "Continue"
    }
    throw new Error(`Unknown ask type: ${type}`)
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
