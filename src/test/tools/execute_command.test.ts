import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { ExecuteCommandTool } from '../../tools/execute_command';

suite('Execute Command Tool Test Suite', () => {
  const tmpDir = path.join(__dirname, '../../test-tmp');
  let tool: ExecuteCommandTool;

  suiteSetup(async () => {
    console.log('Test setup - workspace folders:', vscode.workspace.workspaceFolders);
    console.log('Test setup - tmpDir:', tmpDir);

    // Create test directory
    const uri = vscode.Uri.file(tmpDir);
    await vscode.workspace.fs.createDirectory(uri);

    // Create test file
    const testFile = vscode.Uri.file(path.join(tmpDir, 'test.txt'));
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('test content\n', 'utf-8'));

    // Initialize tool
    tool = new ExecuteCommandTool(tmpDir);

    console.log('Test setup - created test files');
  });

  suiteTeardown(async () => {
    // Clean up test directory
    const uri = vscode.Uri.file(tmpDir);
    await vscode.workspace.fs.delete(uri, { recursive: true });
    console.log('Test teardown - removed test directory');
  });

  test('Basic command execution', async () => {
    console.log('Running basic command execution test');
    const [success, response] = await tool.execute('cat test.txt');
    console.log('Basic command execution result:', response);

    assert.strictEqual(success, false, 'Command should complete');
    assert.match(response.text, /test content/, 'Output should contain file content');
    assert.match(response.text, /Exit code: 0/, 'Should exit with code 0');
  });

  test('Command execution in subdirectory', async () => {
    console.log('Running subdirectory command test');

    // Create subdirectory and file
    const subDir = path.join(tmpDir, 'subdir');
    const subDirUri = vscode.Uri.file(subDir);
    await vscode.workspace.fs.createDirectory(subDirUri);

    const testFile = vscode.Uri.file(path.join(subDir, 'subtest.txt'));
    await vscode.workspace.fs.writeFile(testFile, Buffer.from('subdir content\n', 'utf-8'));

    const [success, response] = await tool.execute('cat subtest.txt', 'subdir');
    console.log('Subdirectory command test result:', response);

    assert.strictEqual(success, false, 'Command should complete');
    assert.match(response.text, /subdir content/, 'Output should contain file content');
    assert.match(response.text, /Exit code: 0/, 'Should exit with code 0');
  });

  test('Failed command execution', async () => {
    console.log('Running failed command test');
    const [success, response] = await tool.execute('cat nonexistent.txt');
    console.log('Failed command test result:', response);

    assert.strictEqual(success, false, 'Command should complete');
    assert.match(response.text, /Exit code: 1/, 'Should exit with non-zero code');
    assert.match(response.text, /No such file/, 'Should show error message');
  });

  test('Non-existent working directory', async () => {
    console.log('Running non-existent directory test');
    const [success, response] = await tool.execute('ls', path.join(tmpDir, 'nonexistent'));
    console.log('Non-existent directory test result:', response);

    assert.strictEqual(success, false, 'Should fail');
    assert.match(response.text, /does not exist/, 'Should show directory error');
  });

  test('Long running command', async () => {
    console.log('Running long command test');
    const [success, response] = await tool.execute('sleep 2 && echo "done"');
    console.log('Long command test result:', response);

    assert.strictEqual(success, false, 'Command should complete');
    assert.match(response.text, /done/, 'Output should contain command result');
    assert.match(response.text, /Exit code: 0/, 'Should exit with code 0');
  });
});
