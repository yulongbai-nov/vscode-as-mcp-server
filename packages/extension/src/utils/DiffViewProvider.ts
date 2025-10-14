import * as diff from "diff";
import * as path from "path";
import stripBom from "strip-bom";
import * as vscode from "vscode";
import { DecorationController } from "./DecorationController";
import { diagnosticsToProblemsString, getNewDiagnostics } from "./diagnostics";
import { arePathsEqual } from "./path";

export const DIFF_VIEW_URI_SCHEME = "mcp-diff";

export class DiffViewProvider {
  editType?: "create" | "modify"
  isEditing = false
  originalContent: string | undefined
  private createdDirs: string[] = []
  private documentWasOpen = false
  private relPath?: string
  private newContent?: string
  private activeDiffEditor?: vscode.TextEditor
  private fadedOverlayController?: DecorationController
  private activeLineController?: DecorationController
  private streamedLines: string[] = []
  private preDiagnostics: [vscode.Uri, vscode.Diagnostic[]][] = []

  constructor(private cwd: string) { }

  async open(relPath: string): Promise<void> {
    console.log('DiffViewProvider.open:', {
      relPath,
      editType: this.editType,
      isEditing: this.isEditing
    });

    this.relPath = relPath
    const fileExists = this.editType === "modify"
    const absolutePath = path.resolve(this.cwd, relPath)

    console.log('DiffViewProvider.open: Resolved path:', absolutePath);

    this.isEditing = true
    // if the file is already open, ensure it's not dirty before getting its contents
    if (fileExists) {
      const existingDocument = vscode.workspace.textDocuments.find((doc) =>
        arePathsEqual(doc.uri.fsPath, absolutePath),
      )
      console.log('DiffViewProvider.open: Existing document:', {
        found: !!existingDocument,
        isDirty: existingDocument?.isDirty
      });

      if (existingDocument && existingDocument.isDirty) {
        await existingDocument.save()
      }
    }

    // get diagnostics before editing the file, we'll compare to diagnostics after editing to see if cline needs to fix anything
    this.preDiagnostics = vscode.languages.getDiagnostics()

    const uri = vscode.Uri.file(absolutePath);
    if (fileExists) {
      console.log('DiffViewProvider.open: Reading existing file');
      const content = await vscode.workspace.fs.readFile(uri);
      this.originalContent = Buffer.from(content).toString('utf-8');
      console.log('DiffViewProvider.open: Original content length:', this.originalContent.length);
    } else {
      console.log('DiffViewProvider.open: Creating new file');
      this.originalContent = ""
    }

    // for new files, create any necessary directories and keep track of new directories to delete if the user denies the operation
    this.createdDirs = await createDirectoriesForFile(absolutePath)
    console.log('DiffViewProvider.open: Created directories:', this.createdDirs);

    // make sure the file exists before we open it
    if (!fileExists) {
      await vscode.workspace.fs.writeFile(uri, Buffer.from('', 'utf-8'));
      console.log('DiffViewProvider.open: Created empty file');
    }

    // if the file was already open, close it (must happen after showing the diff view since if it's the only tab the column will close)
    this.documentWasOpen = false
    // close the tab if it's open (it's already saved above)
    const tabs = vscode.window.tabGroups.all
      .map((tg) => tg.tabs)
      .flat()
      .filter(
        (tab) => tab.input instanceof vscode.TabInputText && arePathsEqual(tab.input.uri.fsPath, absolutePath),
      )
    console.log('DiffViewProvider.open: Found existing tabs:', tabs.length);

    for (const tab of tabs) {
      if (!tab.isDirty) {
        await vscode.window.tabGroups.close(tab)
        console.log('DiffViewProvider.open: Closed tab');
      }
      this.documentWasOpen = true
    }

    console.log('DiffViewProvider.open: Opening diff editor');
    this.activeDiffEditor = await this.openDiffEditor()
    console.log('DiffViewProvider.open: Diff editor opened');

    this.fadedOverlayController = new DecorationController("fadedOverlay", this.activeDiffEditor)
    this.activeLineController = new DecorationController("activeLine", this.activeDiffEditor)
    // Apply faded overlay to all lines initially
    this.fadedOverlayController.addLines(0, this.activeDiffEditor.document.lineCount)
    this.scrollEditorToLine(0) // will this crash for new files?
    this.streamedLines = []

    console.log('DiffViewProvider.open: Setup complete');
  }

  async update(accumulatedContent: string, isFinal: boolean) {
    console.log("DiffViewProvider.update called with:", {
      contentLength: accumulatedContent?.length || 0,
      content: accumulatedContent?.substring(0, 100) + (accumulatedContent?.length > 100 ? '...' : ''),
      isFinal
    });

    if (!this.relPath || !this.activeLineController || !this.fadedOverlayController) {
      throw new Error("Required values not set")
    }
    this.newContent = accumulatedContent
    const accumulatedLines = accumulatedContent.split("\n")
    if (!isFinal) {
      accumulatedLines.pop() // remove the last partial line only if it's not the final update
    }

    const diffEditor = this.activeDiffEditor
    const document = diffEditor?.document
    if (!diffEditor || !document) {
      throw new Error("User closed text editor, unable to edit file...")
    }

    // Place cursor at the beginning of the diff editor to keep it out of the way of the stream animation
    const beginningOfDocument = new vscode.Position(0, 0)
    diffEditor.selection = new vscode.Selection(beginningOfDocument, beginningOfDocument)

    const endLine = accumulatedLines.length
    // Replace all content up to the current line with accumulated lines
    const edit = new vscode.WorkspaceEdit()
    const rangeToReplace = new vscode.Range(0, 0, endLine + 1, 0)
    const contentToReplace = accumulatedLines.slice(0, endLine + 1).join("\n") + "\n"
    edit.replace(document.uri, rangeToReplace, this.stripAllBOMs(contentToReplace))
    await vscode.workspace.applyEdit(edit)
    // Update decorations
    this.activeLineController.setActiveLine(endLine)
    this.fadedOverlayController.updateOverlayAfterLine(endLine, document.lineCount)
    // Scroll to the current line
    this.scrollEditorToLine(endLine)

    // Update the streamedLines with the new accumulated content
    this.streamedLines = accumulatedLines
    if (isFinal) {
      // Handle any remaining lines if the new content is shorter than the original
      if (this.streamedLines.length < document.lineCount) {
        const edit = new vscode.WorkspaceEdit()
        edit.delete(document.uri, new vscode.Range(this.streamedLines.length, 0, document.lineCount, 0))
        await vscode.workspace.applyEdit(edit)
      }
      // Preserve empty last line if original content had one
      const hasEmptyLastLine = this.originalContent?.endsWith("\n")
      if (hasEmptyLastLine && !accumulatedContent.endsWith("\n")) {
        accumulatedContent += "\n"
      }
      // Apply the final content
      const finalEdit = new vscode.WorkspaceEdit()
      finalEdit.replace(
        document.uri,
        new vscode.Range(0, 0, document.lineCount, 0),
        this.stripAllBOMs(accumulatedContent),
      )
      await vscode.workspace.applyEdit(finalEdit)
      // Clear all decorations at the end (after applying final edit)
      this.fadedOverlayController.clear()
      this.activeLineController.clear()
    }
  }

  async saveChanges(): Promise<{
    newProblemsMessage: string | undefined
    userEdits: string | undefined
  // 新たに追加：ユーザーフィードバックを含めるフィールド
  // Newly added field to capture user feedback alongside edits
  userFeedback: string | undefined
    finalContent: string | undefined
  }> {
    if (!this.relPath || !this.newContent || !this.activeDiffEditor) {
      return { newProblemsMessage: undefined, userEdits: undefined, userFeedback: undefined, finalContent: undefined }
    }
    const absolutePath = path.resolve(this.cwd, this.relPath)
    const updatedDocument = this.activeDiffEditor.document
    const editedContent = updatedDocument.getText()
    if (updatedDocument.isDirty) {
      await updatedDocument.save()
    }

    await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), { preview: false })
    await this.closeAllDiffViews()

    /*
    Getting diagnostics before and after the file edit is a better approach than
    automatically tracking problems in real-time. This method ensures we only
    report new problems that are a direct result of this specific edit.
    Since these are new problems resulting from MCP Server's edit, we know they're
    directly related to the work he's doing. This eliminates the risk of MCP Server
    going off-task or getting distracted by unrelated issues, which was a problem
    with the previous auto-debug approach. Some users' machines may be slow to
    update diagnostics, so this approach provides a good balance between automation
    and avoiding potential issues where MCP Server might get stuck in loops due to
    outdated problem information. If no new problems show up by the time the user
    accepts the changes, they can always debug later using the '@problems' mention.
    This way, MCP Server only becomes aware of new problems resulting from his edits
    and can address them accordingly. If problems don't change immediately after
    applying a fix, won't be notified, which is generally fine since the
    initial fix is usually correct and it may just take time for linters to catch up.
    */
    const postDiagnostics = vscode.languages.getDiagnostics()
    const newProblems = await diagnosticsToProblemsString(
      getNewDiagnostics(this.preDiagnostics, postDiagnostics),
      [
        vscode.DiagnosticSeverity.Error, // only including errors since warnings can be distracting (if user wants to fix warnings they can use the @problems mention)
      ],
      this.cwd,
    ) // will be empty string if no errors
    const newProblemsMessage =
      newProblems.length > 0 ? `\n\nNew problems detected after saving the file:\n${newProblems}` : ""

    // If the edited content has different EOL characters, we don't want to show a diff with all the EOL differences.
    const newContentEOL = this.newContent.includes("\r\n") ? "\r\n" : "\n"
    const normalizedEditedContent = editedContent.replace(/\r\n|\n/g, newContentEOL).trimEnd() + newContentEOL

    return { newProblemsMessage, userEdits: undefined, userFeedback: undefined, finalContent: normalizedEditedContent }
  }

  async revertChanges(): Promise<void> {
    if (!this.relPath || !this.activeDiffEditor) {
      return
    }
    const fileExists = this.editType === "modify"
    const updatedDocument = this.activeDiffEditor.document
    const absolutePath = path.resolve(this.cwd, this.relPath)
    const uri = vscode.Uri.file(absolutePath);

    if (!fileExists) {
      if (updatedDocument.isDirty) {
        await updatedDocument.save()
      }
      await this.closeAllDiffViews()
      try {
        await vscode.workspace.fs.delete(uri);
        // Remove only the directories we created, in reverse order
        for (let i = this.createdDirs.length - 1; i >= 0; i--) {
          const dirUri = vscode.Uri.file(this.createdDirs[i]);
          await vscode.workspace.fs.delete(dirUri);
          console.log(`Directory ${this.createdDirs[i]} has been deleted.`)
        }
        console.log(`File ${absolutePath} has been deleted.`)
      } catch (error) {
        console.error('Error deleting file or directories:', error);
      }
    } else {
      // revert document
      const edit = new vscode.WorkspaceEdit()
      const fullRange = new vscode.Range(
        updatedDocument.positionAt(0),
        updatedDocument.positionAt(updatedDocument.getText().length),
      )
      edit.replace(updatedDocument.uri, fullRange, this.originalContent ?? "")
      // Apply the edit and save
      await vscode.workspace.applyEdit(edit)
      await updatedDocument.save()
      console.log(`File ${absolutePath} has been reverted to its original content.`)
      if (this.documentWasOpen) {
        await vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
          preview: false,
        })
      }
      await this.closeAllDiffViews()
    }

    // edit is done
    await this.reset()
  }

  private async closeAllDiffViews() {
    const tabs = vscode.window.tabGroups.all
      .flatMap((tg) => tg.tabs)
      .filter(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME,
      )
    for (const tab of tabs) {
      // trying to close dirty views results in save popup
      if (!tab.isDirty) {
        await vscode.window.tabGroups.close(tab)
      }
    }
  }

  private async openDiffEditor(): Promise<vscode.TextEditor> {
    if (!this.relPath) {
      throw new Error("No file path set")
    }
    const uri = vscode.Uri.file(path.resolve(this.cwd, this.relPath))
    // If this diff editor is already open (ie if a previous write file was interrupted) then we should activate that instead of opening a new diff
    const diffTab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.input instanceof vscode.TabInputTextDiff &&
          tab.input?.original?.scheme === DIFF_VIEW_URI_SCHEME &&
          arePathsEqual(tab.input.modified.fsPath, uri.fsPath),
      )

    console.log('DiffViewProvider.openDiffEditor:', {
      existingTab: !!diffTab,
      uri: uri.fsPath,
      scheme: DIFF_VIEW_URI_SCHEME
    });

    if (diffTab && diffTab.input instanceof vscode.TabInputTextDiff) {
      const editor = await vscode.window.showTextDocument(diffTab.input.modified)
      return editor
    }

    // Open new diff editor
    return new Promise<vscode.TextEditor>((resolve, reject) => {
      const fileName = path.basename(uri.fsPath)
      const fileExists = this.editType === "modify"

      console.log('DiffViewProvider.openDiffEditor: Creating new diff view', {
        fileName,
        fileExists,
        originalContentLength: this.originalContent?.length
      });

      const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && arePathsEqual(editor.document.uri.fsPath, uri.fsPath)) {
          disposable.dispose()
          resolve(editor)
        }
      })

      vscode.commands.executeCommand(
        "vscode.diff",
        vscode.Uri.parse(`${DIFF_VIEW_URI_SCHEME}:${fileName}`).with({
          query: Buffer.from(this.originalContent ?? "").toString("base64"),
        }),
        uri,
        `${fileName}: ${fileExists ? "Original ↔ MCP's Changes" : "New File"} (Editable)`,
      )

      // This may happen on very slow machines ie project idx
      setTimeout(() => {
        disposable.dispose()
        reject(new Error("Failed to open diff editor, please try again..."))
      }, 10_000)
    })
  }

  private scrollEditorToLine(line: number) {
    if (this.activeDiffEditor) {
      const scrollLine = line + 4
      this.activeDiffEditor.revealRange(
        new vscode.Range(scrollLine, 0, scrollLine, 0),
        vscode.TextEditorRevealType.InCenter,
      )
    }
  }

  scrollToFirstDiff() {
    if (!this.activeDiffEditor) {
      return
    }
    const currentContent = this.activeDiffEditor.document.getText()
    const diffs = diff.diffLines(this.originalContent || "", currentContent)
    let lineCount = 0
    for (const part of diffs) {
      if (part.added || part.removed) {
        // Found the first diff, scroll to it
        this.activeDiffEditor.revealRange(
          new vscode.Range(lineCount, 0, lineCount, 0),
          vscode.TextEditorRevealType.InCenter,
        )
        return
      }
      if (!part.removed) {
        lineCount += part.count || 0
      }
    }
  }

  // アクティブなエディタを取得するメソッド
  // Retrieves the currently active diff editor instance
  getActiveEditor(): vscode.TextEditor {
    if (!this.activeDiffEditor) {
      throw new Error("No active diff editor available");
    }
    return this.activeDiffEditor;
  }

  getChangedRanges(): vscode.Range[] {
    console.log('DiffViewProvider.getChangedRanges called', {
      hasActiveDiffEditor: !!this.activeDiffEditor,
      hasOriginalContent: !!this.originalContent,
      originalContentLength: this.originalContent?.length
    });

    if (!this.activeDiffEditor || !this.originalContent) {
      console.log('DiffViewProvider.getChangedRanges - returning empty array (missing editor or content)');
      return [];
    }

    const currentContent = this.activeDiffEditor.document.getText();
    console.log('Current content length:', currentContent.length);

    const diffs = diff.diffLines(this.originalContent, currentContent);
    console.log('Diff parts:', diffs.length);

    const ranges: vscode.Range[] = [];
    let lineNumber = 0;

    for (const part of diffs) {
      console.log('Diff part:', {
        added: part.added,
        removed: part.removed,
        count: part.count,
        value: part.value.substring(0, 20) + (part.value.length > 20 ? '...' : '')
      });

      if (part.added || part.removed) {
        const range = new vscode.Range(
          new vscode.Position(lineNumber, 0),
          new vscode.Position(lineNumber + (part.count || 0), 0)
        );
        console.log('Adding range:', `${range.start.line}-${range.end.line}`);
        ranges.push(range);
      }
      if (!part.removed) {
        lineNumber += part.count || 0;
      }
    }

    console.log('DiffViewProvider.getChangedRanges - returning ranges:', ranges.length);
    return ranges;
  }

  private stripAllBOMs(input: string): string {
    let result = input
    let previous
    do {
      previous = result
      result = stripBom(result)
    } while (result !== previous)
    return result
  }

  async reset() {
    console.log('DiffViewProvider.reset: Resetting state');
    this.editType = undefined
    this.isEditing = false
    this.originalContent = undefined
    this.createdDirs = []
    this.documentWasOpen = false
    this.activeDiffEditor = undefined
    this.fadedOverlayController = undefined
    this.activeLineController = undefined
    this.streamedLines = []
    this.preDiagnostics = []
  }
}

/**
 * Asynchronously creates all non-existing subdirectories for a given file path
 * and collects them in an array for later deletion.
 *
 * @param filePath - The full path to a file.
 * @returns A promise that resolves to an array of newly created directories.
 */
export async function createDirectoriesForFile(filePath: string): Promise<string[]> {
  const newDirectories: string[] = []
  const normalizedFilePath = path.normalize(filePath)
  const directoryPath = path.dirname(normalizedFilePath)

  let currentPath = directoryPath
  const dirsToCreate: string[] = []

  // Traverse up the directory tree and collect missing directories
  while (!(await fileExistsAtPath(currentPath))) {
    dirsToCreate.push(currentPath)
    currentPath = path.dirname(currentPath)
  }

  // Create directories from the topmost missing one down to the target directory
  for (let i = dirsToCreate.length - 1; i >= 0; i--) {
    const dirUri = vscode.Uri.file(dirsToCreate[i]);
    await vscode.workspace.fs.createDirectory(dirUri);
    newDirectories.push(dirsToCreate[i])
  }

  return newDirectories
}

/**
 * Helper function to check if a path exists.
 *
 * @param path - The path to check.
 * @returns A promise that resolves to true if the path exists, false otherwise.
 */
export async function fileExistsAtPath(filePath: string): Promise<boolean> {
  try {
    const uri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
