import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExecuteCommandTool } from '../../tools/execute_command';
import { ConfirmationResult } from '../../utils/confirmation_ui';

// Extend ExecuteCommandTool to override the ask method for testing
class TestableExecuteCommandTool extends ExecuteCommandTool {
  public askCalled = false;

  constructor(cwd: string) {
    super(cwd);
  }

  // Override ask to avoid UI prompts during tests and track if it was called
  protected async ask(_command: string): Promise<ConfirmationResult> {
    this.askCalled = true;
    return { decision: 'approve' }; // Always approve during tests
  }
}

suite('Execute Command Tool Test Suite', function () {
  this.timeout(10000); // Set a longer timeout for all tests in this suite

  const tmpDir = path.join(__dirname, '../../test-tmp');
  let tool: TestableExecuteCommandTool; // Use the testable version for all tests
  let originalConfirmSetting: boolean;

  suiteSetup(async function () {
    console.log('Test setup - workspace folders:', vscode.workspace.workspaceFolders);
    console.log('Test setup - tmpDir:', tmpDir);

    // Save original setting
    const config = vscode.workspace.getConfiguration('mcpServer');
    originalConfirmSetting = config.get<boolean>('confirmNonDestructiveCommands', false);

    // Create test directory
    const uri = vscode.Uri.file(tmpDir);
    await vscode.workspace.fs.createDirectory(uri);

    // Create test file
    const testFile = vscode.Uri.file(path.join(tmpDir, 'test.txt'));
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('test content\n', 'utf-8'));

    // Initialize tool
    tool = new TestableExecuteCommandTool(tmpDir);

    console.log('Test setup - created test files');
  });

  suiteTeardown(async function () {
    // Restore original setting
    await vscode.workspace.getConfiguration('mcpServer').update(
      'confirmNonDestructiveCommands',
      originalConfirmSetting,
      vscode.ConfigurationTarget.Global
    );

    // Clean up test directory
    const uri = vscode.Uri.file(tmpDir);
    await vscode.workspace.fs.delete(uri, { recursive: true });
    console.log('Test teardown - removed test directory');
  });

  test('Basic command execution', async function () {
    console.log('Running basic command execution test');
    const targetFile = path.join(tmpDir, 'test.txt');
    const [userRejected, response] = await tool.execute(`cat ${JSON.stringify(targetFile)}`);
    console.log('Basic command execution result:', response);

    assert.strictEqual(userRejected, false, 'Command should not be user rejected');
    assert.match(response.text, /test content/, 'Output should contain file content');
  });

  test.skip('Command execution in subdirectory', async function () {
    console.log('Running subdirectory command test');

    // Create subdirectory and file
    const subDir = path.join(tmpDir, 'subdir');
    const subDirUri = vscode.Uri.file(subDir);
    await vscode.workspace.fs.createDirectory(subDirUri);

    const testFile = vscode.Uri.file(path.join(subDir, 'subtest.txt'));
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('subdir content\n', 'utf-8'));

    const [userRejected, response] = await tool.execute('cat subtest.txt', 'subdir');
    console.log('Subdirectory command test result:', response);

    assert.strictEqual(userRejected, false, 'Command should not be user rejected');
    assert.match(response.text, /subdir content/, 'Output should contain file content');
  });

  test('Failed command execution', async function () {
    console.log('Running failed command test');
    const [userRejected, response] = await tool.execute('cat nonexistent.txt');
    console.log('Failed command test result:', response);

    assert.strictEqual(userRejected, false, 'Command should not be user rejected');
    assert.match(response.text, /No such file/, 'Should show error message');
  });

  test('Non-existent working directory', async function () {
    console.log('Running non-existent directory test');
    const [userRejected, response] = await tool.execute('ls', path.join(tmpDir, 'nonexistent'));
    console.log('Non-existent directory test result:', response);

    assert.strictEqual(userRejected, false, 'Should not be user rejected');
    assert.match(response.text, /does not exist/, 'Should show directory error');
  });

  test('Long running command', async function () {
    console.log('Running long command test');

    const longCommandFile = path.join(tmpDir, 'long-command.txt');
    const fileUri = vscode.Uri.file(longCommandFile);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from('long task completed\n', 'utf-8'));

    const [userRejected, response] = await tool.execute(`sleep 1 && cat ${JSON.stringify(longCommandFile)}`);
    console.log('Long command test result:', response);

    assert.strictEqual(userRejected, false, 'Command should not be user rejected');
    assert.match(response.text, /long task completed/, 'Output should contain command result');
  });

  suite('ModifySomething Flag Tests', function () {
    setup(function () {
      // Reset the test tool before each test
      tool.askCalled = false;
    });

    test('Commands should require confirmation by default', async function () {
      // Execute with default modifySomething=true
      await tool.execute('echo "Default confirmation behavior"');

      // Confirm that ask was called
      assert.strictEqual(tool.askCalled, true, 'Confirmation should be requested by default');
    });

    test('Destructive commands should always require confirmation', async function () {
      // Execute with explicit modifySomething=true
      await tool.execute('rm -f test.txt', undefined, true);

      // Confirm that ask was called
      assert.strictEqual(tool.askCalled, true, 'Confirmation should be requested for destructive commands');
    });

    test('Non-destructive commands should skip confirmation when flag is false', async function () {
      // Make sure the setting is false to start
      await vscode.workspace.getConfiguration('mcpServer').update(
        'confirmNonDestructiveCommands',
        false,
        vscode.ConfigurationTarget.Global
      );

      // Reset the tracking flag
      tool.askCalled = false;

      // Execute with modifySomething=false
      await tool.execute('ls -la', undefined, false);

      // Confirm that ask was NOT called
      assert.strictEqual(tool.askCalled, false, 'Confirmation should be skipped for non-destructive commands');
    });

    test('Non-destructive commands should require confirmation when setting is enabled', async function () {
      // Enable the confirmNonDestructiveCommands setting
      await vscode.workspace.getConfiguration('mcpServer').update(
        'confirmNonDestructiveCommands',
        true,
        vscode.ConfigurationTarget.Global
      );

      // Reset the tracking flag
      tool.askCalled = false;

      // Execute with modifySomething=false
      await tool.execute('grep "pattern" test.txt', undefined, false);

      // Confirm that ask was called despite modifySomething being false
      assert.strictEqual(tool.askCalled, true, 'Confirmation should be requested when confirmNonDestructiveCommands=true');

      // Reset the setting
      await vscode.workspace.getConfiguration('mcpServer').update(
        'confirmNonDestructiveCommands',
        false,
        vscode.ConfigurationTarget.Global
      );
    });
  });

  suite('Background Mode and Timeout Tests', function () {
    test('Command should return immediately in background mode', async function () {
      console.log('Running background mode test');

      // Start a timer
      const startTime = Date.now();

      // Execute a command with background=true that would normally take 3 seconds
      const [userRejected, response] = await tool.execute('sleep 3 && echo "completed"', undefined, false, true);

      // Check how long it took
      const duration = Date.now() - startTime;

      // Background mode should return almost immediately
      assert.ok(duration < 1000, `Command returned in ${duration}ms, should be under 1000ms when in background mode`);
      assert.strictEqual(userRejected, false, 'Command should not be user rejected');
      assert.match(response.text, /background mode/, 'Response should mention background mode');
      assert.match(response.text, /terminal \(id: \d+\)/, 'Response should include terminal ID');
      assert.match(response.text, /get_terminal_output tool/, 'Response should mention how to check output later');
    });

    test('Command should respect timeout parameter', async function () {
      console.log('Running timeout test');

      // Start a timer
      const startTime = Date.now();

      // Execute a command with a short timeout (1000ms) but the command takes longer (2s)
      const [userRejected, response] = await tool.execute('sleep 2 && echo "timeout test"', undefined, false, false, 1000);

      // Check how long it took
      const duration = Date.now() - startTime;

      // Should respect the timeout (with some margin for code execution)
      assert.ok(duration < 1500, `Command returned in ${duration}ms, should be close to 1000ms timeout`);
      assert.strictEqual(userRejected, false, 'Command should not be user rejected');
      assert.match(response.text, /still running/, 'Response should indicate command is still running');
      assert.match(response.text, /timeout: 1000ms/, 'Response should mention the timeout value');
      assert.match(response.text, /terminal \(id: \d+\)/, 'Response should include terminal ID');
    });

    test('Command should include terminal ID in normal execution', async function () {
      console.log('Running terminal ID test for normal execution');

      const checkFile = path.join(tmpDir, 'terminal-check.txt');
      const checkUri = vscode.Uri.file(checkFile);
      await vscode.workspace.fs.writeFile(checkUri, Buffer.from('terminal check output\n', 'utf-8'));

      const [userRejected, response] = await tool.execute(`cat ${JSON.stringify(checkFile)}`, undefined, false);

      assert.strictEqual(userRejected, false, 'Command should not be user rejected');
      assert.match(response.text, /terminal \(id: \d+\)/, 'Response should include terminal ID');
      assert.match(response.text, /terminal check output/, 'Output should contain command result');
    });
  });
});
