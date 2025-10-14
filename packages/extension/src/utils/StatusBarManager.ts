import * as vscode from 'vscode';

export class StatusBarManager {
  private applyButton: vscode.StatusBarItem;
  private discardButton: vscode.StatusBarItem;
  private resolvePromise: ((value: boolean) => void) | null = null;

  constructor() {
    // ステータスバーにApplyボタンを作成（チェックマークアイコン）
    // Create the Apply button in the status bar (checkmark icon).
    this.applyButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Infinity);
    this.applyButton.text = "$(check)";
    this.applyButton.command = 'mcp.textEditor.applyChanges';
    this.applyButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.applyButton.tooltip = "Apply the pending changes";

  // ステータスバーにDiscardボタンを作成（×アイコン）
  // Create the Discard button in the status bar (x icon).
    this.discardButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, Infinity);
    this.discardButton.text = "$(x)";
    this.discardButton.command = 'mcp.textEditor.cancelChanges';
    this.discardButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.discardButton.tooltip = "Discard the pending changes";

    // コマンドの登録
    // Register the commands.
    this.registerCommands();
  }

  private registerCommands(): void {
    console.log('[StatusBarManager] Registering commands');

    // Register MCP text editor commands
    vscode.commands.registerCommand('mcp.textEditor.applyChanges', () => {
      console.log('[StatusBarManager] MCP apply command triggered');
      this.hide();
      this.resolvePromise?.(true);
      this.resolvePromise = null;
      return true;
    });

    vscode.commands.registerCommand('mcp.textEditor.cancelChanges', () => {
      console.log('[StatusBarManager] MCP cancel command triggered');
      this.hide();
      this.resolvePromise?.(false);
      this.resolvePromise = null;
      return false;
    });
  }

  /**
   * ステータスバーにボタンを表示し、ユーザーの選択を待機する
   * Display buttons in the status bar and wait for the user's choice.
   * @param applyLabel 適用ボタンのラベル（デフォルトは "Apply Change"） (label for the apply button)
   * @param discardLabel 拒否ボタンのラベル（デフォルトは "Discard Change"） (label for the discard button)
   * @returns ユーザーが適用ボタンを選択した場合はtrue、拒否ボタンを選択した場合はfalse (true if apply is chosen, false if discard is chosen)
   */
  async ask(applyLabel: string, discardLabel: string): Promise<boolean> {
    console.log('[StatusBarManager] ask method called');

    this.applyButton.text = `$(check) ${applyLabel}`;
    this.discardButton.text = `$(x) ${discardLabel}`;

    return new Promise<boolean>((resolve) => {
      console.log('[StatusBarManager] Setting resolvePromise and showing buttons');
      this.resolvePromise = resolve;
      this.show();
    });
  }

  /**
   * ステータスバーにボタンを表示する
   * Show the buttons in the status bar.
   */
  private show(): void {
    this.applyButton.show();
    this.discardButton.show();
  }

  /**
   * ステータスバーからボタンを非表示にする
   * Hide the buttons from the status bar.
   */
  hide(): void {
    this.applyButton.hide();
    this.discardButton.hide();
  }

  /**
   * リソースを解放する
   * Release resources.
   */
  dispose(): void {
    this.hide();
    this.applyButton.dispose();
    this.discardButton.dispose();
  }
}
