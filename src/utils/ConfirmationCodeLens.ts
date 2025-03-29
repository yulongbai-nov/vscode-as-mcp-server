import * as vscode from 'vscode';

export class ConfirmationCodeLens implements vscode.CodeLensProvider {
  private codeLenses: vscode.CodeLens[] = [];
  private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private document: vscode.TextDocument | undefined;
  private ranges: vscode.Range[] = [];

  constructor() {
    this.codeLenses = [];
  }

  public updateRanges(document: vscode.TextDocument, ranges: vscode.Range[]) {
    this.document = document;
    this.ranges = ranges;
    this._onDidChangeCodeLenses.fire();
  }

  public clear() {
    this.document = undefined;
    this.ranges = [];
    this._onDidChangeCodeLenses.fire();
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (this.document?.uri.toString() !== document.uri.toString() || this.ranges.length === 0) {
      return [];
    }

    this.codeLenses = [];

    for (const range of this.ranges) {
      this.codeLenses.push(
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

    return this.codeLenses;
  }
}
