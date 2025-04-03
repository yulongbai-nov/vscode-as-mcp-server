import * as path from 'path';
import * as vscode from 'vscode';
import { DiffAskHelper } from './DiffAskHelper';
import { DiffViewProvider } from './DiffViewProvider';

/**
 * ファイル操作を行うためのヘルパークラス
 * DiffViewProviderと連携して、ユーザーに変更を確認させる機能を提供
 */
export class FileOperationHelper {
  private diffViewProvider: DiffViewProvider;
  private askHelper: DiffAskHelper;
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    this.diffViewProvider = new DiffViewProvider(cwd);
    this.askHelper = new DiffAskHelper(this.diffViewProvider);
  }

  /**
   * ファイルの内容を更新し、ユーザーの承認を求める
   * @param relPath 対象ファイルの相対パス
   * @param newContent 新しい内容
   * @returns 結果オブジェクト
   */
  async updateFileContent(relPath: string, newContent: string): Promise<{
    approved: boolean;
    newProblemsMessage?: string;
    userEdits?: string;
    finalContent?: string;
  }> {
    try {
      // ファイルの絶対パスを取得
      const absolutePath = path.resolve(this.cwd, relPath);

      // ファイルが存在するか確認
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));
      } catch (error) {
        throw new Error(`ファイルが存在しません: ${relPath}`);
      }

      // 元のファイル内容を読み込む
      const fileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
      const originalContent = Buffer.from(fileContent).toString('utf8');

      // 変更がなければ処理を終了
      if (originalContent === newContent) {
        return { approved: true };
      }

      // DiffViewProviderの準備
      this.diffViewProvider.editType = "modify";

      // Diffビューを開く
      await this.diffViewProvider.open(relPath);
      await this.diffViewProvider.update(originalContent, false);
      this.diffViewProvider.scrollToFirstDiff();
      // 少し待機して画面が更新されるのを待つ
      await new Promise(resolve => setTimeout(resolve, 200));

      // 新しい内容で更新
      await this.diffViewProvider.update(newContent, true);

      // ユーザーに変更の承認を求める
      const didApprove = await this.askHelper.ask(`${path.basename(relPath)}の変更を適用しますか？`);

      if (!didApprove) {
        await this.diffViewProvider.revertChanges();
        return { approved: false };
      }

      // 変更を保存
      const { newProblemsMessage, userEdits, finalContent } = await this.diffViewProvider.saveChanges();

      // 後処理
      await this.diffViewProvider.reset();

      return {
        approved: true,
        newProblemsMessage,
        userEdits,
        finalContent
      };
    } catch (error) {
      console.error('ファイル操作エラー:', error);
      await this.diffViewProvider.reset();
      throw error;
    }
  }

  /**
   * リソースを解放する
   */
  dispose(): void {
    this.askHelper.dispose();
  }
}
