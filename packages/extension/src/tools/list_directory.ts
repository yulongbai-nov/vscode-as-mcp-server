import * as ignore from 'ignore';
import * as path from 'path';
import * as vscode from 'vscode';
import { z } from 'zod';

// Zodスキーマ定義
// Define the Zod schema.
export const listDirectorySchema = z.object({
  path: z.string().describe('Directory path to list'),
  depth: z.number().int().min(1).optional().describe('Maximum depth for traversal (default: unlimited)'),
  include_hidden: z.boolean().optional().describe('Include hidden files/directories (default: false)'),
});

type ListDirectoryParams = z.infer<typeof listDirectorySchema>;

interface ListDirectoryResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  // 追加: MCP Serverが期待するインデックスシグネチャ
  // Added: index signature expected by the MCP Server.
  [key: string]: unknown;
}

interface TreeNode {
  name: string;
  isDirectory: boolean;
  children: TreeNode[];
}

/**
 * ディレクトリツリーを表示するツール
 * Tool for displaying the directory tree.
 * .gitignore パターンを考慮して、指定されたディレクトリの構造を表示します
 * Displays the directory structure while honoring .gitignore patterns.
 */
export async function listDirectoryTool(params: ListDirectoryParams): Promise<ListDirectoryResult> {
  try {
    const resolvedPath = resolvePath(params.path);
    const uri = vscode.Uri.file(resolvedPath);

    try {
      const stats = await vscode.workspace.fs.stat(uri);
      if (!(stats.type & vscode.FileType.Directory)) {
        return {
          content: [{ type: 'text', text: `${resolvedPath} is not a directory` }],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: 'Directory is empty or does not exist' }],
        isError: true,
      };
    }

    // .gitignore を読み込む
    // Load .gitignore patterns.
    const ignorePatterns = await loadGitignorePatterns(resolvedPath);
    const ig = ignore.default().add(ignorePatterns);

    // ディレクトリツリーを構築
    // Build the directory tree.
    const tree = await buildDirectoryTree(
      resolvedPath,
      path.basename(resolvedPath),
      1,
      params.depth || Number.MAX_SAFE_INTEGER,
      params.include_hidden || false,
      ig
    );

    // ツリーを表示用のテキストに変換
    // Convert the tree into display text.
    const treeText = generateTreeText(tree);

    return {
      content: [{ type: 'text', text: treeText }],
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      content: [{ type: 'text', text: `Failed to list directory: ${errorMessage}` }],
      isError: true,
    };
  }
}

/**
 * パスを解決する
 * Resolve the path.
 * @param dirPath 解決するパス (path to resolve)
 * @returns 絶対パス (absolute path)
 */
function resolvePath(dirPath: string): string {
  if (path.isAbsolute(dirPath)) {
    return dirPath;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return path.join(workspaceRoot, dirPath);
  }

  return path.resolve(dirPath);
}

/**
 * .gitignore パターンを読み込む
 * Load .gitignore patterns.
 * @param dirPath ディレクトリパス (directory path)
 * @returns .gitignore パターンの配列 (array of .gitignore patterns)
 */
async function loadGitignorePatterns(dirPath: string): Promise<string[]> {
  const patterns: string[] = [];

  try {
    // ルートディレクトリから .gitignore を検索
    // Search for .gitignore from the root directory.
    let currentDir = dirPath;

    while (currentDir) {
      const gitignorePath = path.join(currentDir, '.gitignore');
      const uri = vscode.Uri.file(gitignorePath);

      try {
        const content = await vscode.workspace.fs.readFile(uri);
        const lines = Buffer.from(content).toString('utf-8').split('\n');

        const validPatterns = lines.filter(line => {
          const trimmed = line.trim();
          return trimmed && !trimmed.startsWith('#');
        });

        patterns.push(...validPatterns);
      } catch {
        // .gitignore が存在しない場合は無視
        // Ignore when no .gitignore exists.
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    return patterns;
  } catch (error) {
    console.error('Error loading .gitignore patterns:', error);
    return [];
  }
}

/**
 * ディレクトリツリーを構築する
 * Build the directory tree.
 * @param fullPath 完全なパス (full path)
 * @param nodeName ノード名 (node name)
 * @param currentDepth 現在の深さ (current depth)
 * @param maxDepth 最大深さ (maximum depth)
 * @param includeHidden 隠しファイルを含めるかどうか (include hidden files)
 * @param ignorer ignore パターンチェッカー (ignore pattern checker)
 * @returns ツリーノード (tree node)
 */
async function buildDirectoryTree(
  fullPath: string,
  nodeName: string,
  currentDepth: number,
  maxDepth: number,
  includeHidden: boolean,
  ignorer: ignore.Ignore
): Promise<TreeNode> {
  const uri = vscode.Uri.file(fullPath);
  const root: TreeNode = {
    name: nodeName,
    isDirectory: true,
    children: [],
  };

  if (currentDepth > maxDepth) {
    return root;
  }

  try {
    // ディレクトリ内のエントリを取得
    // Retrieve entries within the directory.
    const entries = await vscode.workspace.fs.readDirectory(uri);

    // ファイル名でソート (ディレクトリ優先)
    // Sort by name, prioritizing directories.
    const sortedEntries = entries.sort((a, b) => {
      const aIsDir = !!(a[1] & vscode.FileType.Directory);
      const bIsDir = !!(b[1] & vscode.FileType.Directory);

      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;

      return a[0].localeCompare(b[0]);
    });

    for (const [name, type] of sortedEntries) {
      // 隠しファイルをスキップ (オプションで設定可能)
      // Skip hidden files unless configured otherwise.
      if (!includeHidden && name.startsWith('.')) {
        continue;
      }

      const entryPath = path.join(fullPath, name);
      const relativePath = path.relative(path.dirname(fullPath), entryPath);

      // .gitignore パターンに一致するかチェック
      // Check whether the path matches .gitignore patterns.
      if (ignorer.ignores(relativePath)) {
        continue;
      }

      const isDirectory = !!(type & vscode.FileType.Directory);

      if (isDirectory) {
        // 再帰的にサブディレクトリをスキャン
        // Recursively scan subdirectories.
        const childNode = await buildDirectoryTree(
          entryPath,
          name,
          currentDepth + 1,
          maxDepth,
          includeHidden,
          ignorer
        );
        root.children.push(childNode);
      } else {
        // ファイルノードを追加
        // Add a file node.
        root.children.push({
          name,
          isDirectory: false,
          children: [],
        });
      }
    }

    return root;
  } catch (error) {
    console.error(`Error reading directory ${fullPath}:`, error);
    return root;
  }
}

/**
 * ツリーノードをテキスト表現に変換
 * @param node ツリーノード
 * @param prefix 行の接頭辞
 * @param isLast 最後の子ノードかどうか
 * @returns ツリーテキスト
 */
function generateTreeText(node: TreeNode, prefix = '', isLast = true): string {
  let result = prefix;

  if (prefix !== '') {
    result += isLast ? '└── ' : '├── ';
  }

  result += `${node.name}${node.isDirectory ? '/' : ''}\n`;

  if (node.children.length > 0) {
    const newPrefix = prefix + (isLast ? '    ' : '│   ');

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const isLastChild = i === node.children.length - 1;
      result += generateTreeText(child, newPrefix, isLastChild);
    }
  }

  return result;
}
