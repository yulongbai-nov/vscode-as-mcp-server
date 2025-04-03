import * as vscode from 'vscode';

export class StatusBarManager {
  private applyButton: vscode.StatusBarItem;
  private discardButton: vscode.StatusBarItem;
  private isVisible: boolean = false;
  private resolvePromise: ((value: boolean) => void) | null = null;

  constructor() {
    // ステータスバーにApplyボタンを作成（チェックマークアイコン）
    this.applyButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.applyButton.text = "$(check) Apply Change";
    this.applyButton.command = 'statusBar.applyChanges';
    this.applyButton.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    this.applyButton.tooltip = "Apply the pending changes";

    // ステータスバーにDiscardボタンを作成（×アイコン）
    this.discardButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.discardButton.text = "$(x) Discard Change";
    this.discardButton.command = 'statusBar.cancelChanges';
    this.discardButton.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.discardButton.tooltip = "Discard the pending changes";

    // コマンドの登録
    this.registerCommands();
  }

  private registerCommands(): void {
    console.log('[StatusBarManager] Registering commands');
    vscode.commands.registerCommand('statusBar.applyChanges', () => {
      console.log('[StatusBarManager] Apply command triggered');
      this.hide();
      if (this.resolvePromise) {
        this.resolvePromise(true);
        this.resolvePromise = null;
      }
    });

    vscode.commands.registerCommand('statusBar.cancelChanges', () => {
      console.log('[StatusBarManager] Cancel command triggered');
      this.hide();
      if (this.resolvePromise) {
        this.resolvePromise(false);
        this.resolvePromise = null;
      }
    });
  }

  /**
   * ステータスバーにボタンを表示し、ユーザーの選択を待機する
   * @returns ユーザーが「Apply Change」を選択した場合はtrue、「Discard Change」を選択した場合はfalse
   */
  async ask(): Promise<boolean> {
    console.log('[StatusBarManager] ask method called');
    return new Promise<boolean>((resolve) => {
      console.log('[StatusBarManager] Setting resolvePromise and showing buttons');
      this.resolvePromise = resolve;
      this.show();
    });
  }

  /**
   * ステータスバーにボタンを表示する
   */
  private show(): void {
    if (!this.isVisible) {
      this.applyButton.show();
      this.discardButton.show();
      this.isVisible = true;
    }
  }

  /**
   * ステータスバーからボタンを非表示にする
   */
  hide(): void {
    if (this.isVisible) {
      this.applyButton.hide();
      this.discardButton.hide();
      this.isVisible = false;
    }
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    this.hide();
    this.applyButton.dispose();
    this.discardButton.dispose();
  }
}
