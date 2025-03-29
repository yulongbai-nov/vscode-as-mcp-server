import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';

const execAsync = promisify(exec);

// Schema for the bash tool parameters
export const bashToolSchema = z.object({
  command: z.string().describe('The command to execute'),
  timeout: z.number().int().positive().max(600000).optional().describe('Optional timeout in milliseconds (max 600000)')
});

// Type for the bash tool parameters
export type BashToolParams = z.infer<typeof bashToolSchema>;

/**
 * Executes a bash command and returns the result
 * @param params Parameters for the bash command execution
 * @returns Result of the bash command
 */
export async function bashTool(params: BashToolParams): Promise<{ content: { text: string; type: string }[]; isError: boolean }> {
  const { command, timeout } = params;

  try {
    // Execute the command with the specified timeout
    const execOptions = {
      timeout: timeout || 30000, // Default timeout: 30 seconds
    };

    const { stdout, stderr } = await execAsync(command, execOptions);

    // Build the result
    const content: { text: string; type: string }[] = [];

    if (stdout) {
      content.push({
        text: stdout,
        type: 'text'
      });
    }

    if (stderr) {
      content.push({
        text: `Error: ${stderr}`,
        type: 'text'
      });
    }

    return {
      content,
      isError: !!stderr
    };
  } catch (error) {
    let errorMessage = 'Unknown error';

    if (error instanceof Error) {
      errorMessage = error.message;
    }

    return {
      content: [{
        text: `Error executing command: ${errorMessage}`,
        type: 'text'
      }],
      isError: true
    };
  }
}
