import * as vscode from 'vscode';
import { DiffViewProvider } from './DiffViewProvider';
import { StatusBarManager } from './StatusBarManager';

/**
 * DiffViewProviderとStatusBarManagerを連携させて
 * ユーザーに変更の承認を求めるためのヘルパークラス
 */
export class DiffAskHelper {
  private statusBarManager: StatusBarManager;

  constructor(private readonly diffViewProvider: DiffViewProvider) {
    this.statusBarManager = new StatusBarManager();
  }

  /**
   * DiffViewProviderでの変更をステータスバーに表示し、ユーザーの承認を求める
   * @param message 表示するメッセージ（任意）
   * @returns ユーザーが承認した場合はtrue、そうでない場合はfalse
   */
  async ask(message?: string): Promise<boolean> {
    if (message) {
      vscode.window.showInformationMessage(message);
    }

    // DiffViewProviderの処理が完了したことを確認する例
    console.log(`Asking for approval on file: ${this.diffViewProvider.getActiveEditor().document.fileName}`);

    return await this.statusBarManager.ask();
  }

  /**
   * ステータスバーのボタンを非表示にする
   */
  hide(): void {
    this.statusBarManager.hide();
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    this.statusBarManager.dispose();
  }
}
