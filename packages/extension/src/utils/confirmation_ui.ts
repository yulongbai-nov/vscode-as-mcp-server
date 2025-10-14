import * as vscode from 'vscode';
import { StatusBarManager } from './StatusBarManager';

export interface ConfirmationAction {
  id: string;
  label: string;
  description?: string;
  detail?: string;
  data?: unknown;
}

export interface ConfirmationResult {
  decision: 'approve' | 'deny';
  feedback?: string;
  actionId?: string;
  actionData?: unknown;
}

/**
 * 設定に基づいて確認UIを表示するユーティリティクラス
 * Utility class that displays confirmation UI based on settings.
 */
export class ConfirmationUI {
  // StatusBarManagerのシングルトンインスタンス
  // Singleton instance of StatusBarManager.
  private static statusBarManager: StatusBarManager | null = null;

  /**
   * StatusBarManagerのインスタンスを取得または初期化します
   * Retrieve or initialize the StatusBarManager instance.
   */
  private static getStatusBarManager(): StatusBarManager {
    if (!this.statusBarManager) {
      this.statusBarManager = new StatusBarManager();
    }
    return this.statusBarManager;
  }

  /**
   * 設定に基づいてコマンド実行前の確認UIを表示します
   * Display the confirmation UI before command execution based on settings.
   * @param message 確認メッセージ (confirmation message)
   * @param detail 追加の詳細情報（コマンドなど） (additional detail such as the command)
   * @param approveLabel 承認ボタンのラベル (approve button label)
   * @param denyLabel 拒否ボタンのラベル (deny button label)
   * @returns 承認/拒否と追加アクション情報を含む結果オブジェクト (result object containing approval/denial and optional action data)
   */
  static async confirm(
    message: string,
    detail: string,
    approveLabel: string,
    denyLabel: string,
    actions: ConfirmationAction[] = []
  ): Promise<ConfirmationResult> {
  // 設定から確認UI方法を取得
  // Retrieve the confirmation UI preference from settings.
    const config = vscode.workspace.getConfiguration('mcpServer');
    const confirmationUI = config.get<string>('confirmationUI', 'quickPick');

    console.log(`[ConfirmationUI] Using ${confirmationUI} UI for confirmation`);

    if (confirmationUI === 'quickPick' || actions.length > 0) {
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel, actions);
    } else {
      return await this.showStatusBarConfirmation(message, detail, approveLabel, denyLabel);
    }
  }

  /**
   * QuickPickを使用した確認UIを表示します
   * Display the confirmation UI using QuickPick.
   */
  private static async showQuickPickConfirmation(
    message: string,
    detail: string,
    approveLabel: string,
    denyLabel: string,
    actions: ConfirmationAction[]
  ): Promise<ConfirmationResult> {
  // QuickPickを作成
  // Create the QuickPick instance.
    const quickPick = vscode.window.createQuickPick();

    quickPick.title = message;
    quickPick.placeholder = detail || '';

    type ConfirmationQuickPickItem = vscode.QuickPickItem & {
      decision: 'approve' | 'deny';
      actionId?: string;
      actionData?: unknown;
    };

    const items: ConfirmationQuickPickItem[] = [
      { label: `$(check) ${approveLabel}`, decision: 'approve' }
    ];

    for (const action of actions) {
      items.push({
        label: action.label,
        description: action.description,
        detail: action.detail,
        decision: 'approve',
        actionId: action.id,
        actionData: action.data,
      });
    }

    items.push({ label: `$(x) ${denyLabel}`, decision: 'deny' });

    quickPick.items = items;
    quickPick.canSelectMany = false;
    quickPick.ignoreFocusOut = true;

    return new Promise<ConfirmationResult>((resolve) => {
      let resolved = false;
      let awaitingInput = false;
      quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0] as ConfirmationQuickPickItem | undefined;
        quickPick.hide();

        if (!selection) {
          resolved = true;
          resolve({ decision: 'deny' });
          return;
        }

        if (selection.decision === 'approve') {
          resolved = true;
          resolve({
            decision: 'approve',
            actionId: selection.actionId,
            actionData: selection.actionData,
          });
        } else {
          const inputBox = vscode.window.createInputBox();
          inputBox.title = "Feedback";
          inputBox.placeholder = "Add context for the agent (optional)";
          awaitingInput = true;

          inputBox.onDidAccept(() => {
            const feedback = inputBox.value.trim();
            inputBox.hide();
            resolved = true;
            awaitingInput = false;
            resolve({ decision: 'deny', feedback: feedback || undefined });
          });

          inputBox.onDidHide(() => {
            if (!resolved) {
              const feedback = inputBox.value.trim();
              resolved = true;
              awaitingInput = false;
              resolve({ decision: 'deny', feedback: feedback || undefined });
            }
          });

          inputBox.show();
        }
      });

      quickPick.onDidHide(() => {
  // Handle dismissal of the QuickPick
        if (!resolved && !awaitingInput) {
          resolved = true;
          resolve({ decision: 'deny' });
        }
      });

      quickPick.show();
    });
  }

  /**
   * ステータスバーを使用した確認UIを表示します
   * Display the confirmation UI using the status bar.
   */
  private static async showStatusBarConfirmation(
    message: string,
    detail: string,
    approveLabel: string,
    denyLabel: string
  ): Promise<ConfirmationResult> {
  // メッセージを表示
  // Display the message.
    vscode.window.showInformationMessage(`${message} ${detail ? `- ${detail}` : ''}`);

  // StatusBarManagerのインスタンスを取得
  // Obtain the StatusBarManager instance.
    try {
      const statusBarManager = this.getStatusBarManager();

  // StatusBarManagerを使用してユーザーの選択を待機
  // Use the StatusBarManager to await the user's choice.
      console.log('[ConfirmationUI] Using StatusBarManager for confirmation');
      const approved = await statusBarManager.ask(approveLabel, denyLabel);
      statusBarManager.hide();

  // 承認された場合は "Approve" を返す
  // Return "Approve" when the user approves.
      if (approved) {
        return { decision: 'approve' };
      }

  // 拒否された場合は追加のフィードバックを収集
  // Collect optional feedback when the user denies.
      const inputBox = vscode.window.createInputBox();
      inputBox.title = "Feedback";
      inputBox.placeholder = "Add context for the agent (optional)";

      return new Promise<ConfirmationResult>((resolve) => {
        inputBox.onDidAccept(() => {
          const feedback = inputBox.value.trim();
          inputBox.hide();
          resolve({ decision: 'deny', feedback: feedback || undefined });
        });

        inputBox.onDidHide(() => {
          const feedback = inputBox.value.trim();
          resolve({ decision: 'deny', feedback: feedback || undefined });
        });

        inputBox.show();
      });
    } catch (error) {
      console.error('Error using StatusBarManager:', error);
      // エラーが発生した場合はQuickPickにフォールバック
      // Fall back to the QuickPick confirmation when an error occurs.
      console.log('[ConfirmationUI] Falling back to QuickPick confirmation');
      return await this.showQuickPickConfirmation(message, detail, approveLabel, denyLabel, []);
    }
  }
}
