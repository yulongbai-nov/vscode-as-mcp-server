import { z } from 'zod';

// Define the schema for copilot_semanticSearch
export const semanticSearchSchema = z.object({
  query: z.string().describe(
    "The query to search the codebase for. Should contain all relevant context. Should ideally be text that might appear in the codebase, such as function names, variable names, or comments."
  ),
});

// Define the schema for copilot_searchWorkspaceSymbols
export const searchWorkspaceSymbolsSchema = z.object({
  symbolName: z.string().describe(
    "The symbol to search for, such as a function name, class name, or variable name."
  ),
});

// Define the schema for copilot_listCodeUsages
export const listCodeUsagesSchema = z.object({
  symbolName: z.string().describe(
    "The name of the symbol, such as a function name, class name, method name, variable name, etc."
  ),
  filePaths: z.array(z.string()).optional().describe(
    "One or more file paths which likely contain the definition of the symbol. For instance the file which declares a class or function. This is optional but will speed up the invocation of this tool and improve the quality of its output."
  ),
});

// Define the schema for copilot_vscodeAPI
export const vscodeAPISchema = z.object({
  query: z.string().describe(
    "The query to search vscode documentation for. Should contain all relevant context."
  ),
});

// Define the schema for copilot_findFiles
export const findFilesSchema = z.object({
  query: z.string().describe(
    "Search for files with names or paths matching this query. Can be a glob pattern."
  ),
});

// Define the schema for copilot_findTextInFiles
export const findTextInFilesSchema = z.object({
  query: z.string().describe(
    "The pattern to search for in files in the workspace. Can be a regex or plain text pattern"
  ),
  isRegexp: z.boolean().optional().describe(
    "Whether the pattern is a regex. False by default."
  ),
  includePattern: z.string().optional().describe(
    "Search files matching this glob pattern. Will be applied to the relative path of files within the workspace."
  ),
});

// Define the schema for copilot_readFile
export const readFileSchema = z.object({
  filePath: z.string().describe(
    "The absolute path of the file to read."
  ),
  startLineNumberBaseZero: z.number().describe(
    "The line number to start reading from, 0-based."
  ),
  endLineNumberBaseZero: z.number().describe(
    "The inclusive line number to end reading at, 0-based."
  ),
});

// Define the schema for copilot_listDirectory
export const copilotListDirectorySchema = z.object({
  path: z.string().describe(
    "The absolute path to the directory to list."
  ),
});

// Define the schema for copilot_getErrors
export const getErrorsSchema = z.object({
  filePaths: z.array(z.string()).describe(
    "Array of file paths to check for errors"
  ),
});

// Define the schema for copilot_getChangedFiles
export const getChangedFilesSchema = z.object({
  repositoryPath: z.string().describe(
    "The absolute path to the git repository to look for changes in."
  ),
  sourceControlState: z.array(
    z.enum(["staged", "unstaged", "merge-conflicts"])
  ).optional().describe(
    "The kinds of git state to filter by. Allowed values are: 'staged', 'unstaged', and 'merge-conflicts'. If not provided, all states will be included."
  ),
});

// Define the schema for copilot_runTests
export const runTestsSchema = z.object({
  filter: z.enum(["all", "failed", "last"]).describe(
    "Specifies which tests to run, either\n- `all` to run all tests\n- `failed` to run failed tests\n- `last` to re-run the last set of tests"
  ),
});

// Define the schema for copilot_runVsCodeTask
export const runVsCodeTaskSchema = z.object({
  workspaceFolder: z.string().describe(
    "The workspace folder path containing the task"
  ),
  id: z.string().describe(
    "The task ID to run."
  ),
});
