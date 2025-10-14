import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';
import * as vscode from 'vscode';

// Module-level log to verify the module loads
const moduleLoadLog = '/tmp/vscode-test-module-load.log';
try {
  fs.appendFileSync(moduleLoadLog, `${new Date().toISOString()} Module loaded, __dirname: ${__dirname}\n`);
  fs.appendFileSync(moduleLoadLog, `${new Date().toISOString()} typeof run: ${typeof run}\n`);
} catch (e) {
  console.error('[module-load] Failed to write log:', e);
}

// Log that we're exporting run
console.log('[index.ts] Module loading, will export run function');

async function findTestFiles(directory: string, accumulator: string[] = []): Promise<string[]> {
  const entries = await fs.promises.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await findTestFiles(entryPath, accumulator);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      accumulator.push(entryPath);
    }
  }

  return accumulator;
}

export async function run(): Promise<void> {
  const logFile = '/tmp/vscode-test-runner.log';
  const log = (msg: string) => {
    console.log(msg);
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${msg}\n`);
    } catch (e) {
      console.error('[test-runner] Failed to write log:', e);
    }
  };

  log('[test-runner] Starting Mocha harness.');
  const config = vscode.workspace.getConfiguration('mcpServer');
  const originalStartOnActivate = config.get<boolean>('startOnActivate', true);

  await config.update('startOnActivate', false, vscode.ConfigurationTarget.Global);
  log(`[test-runner] Disabled auto-start (previous value: ${originalStartOnActivate}).`);

  try {
    try {
      await vscode.commands.executeCommand('mcpServer.stopServer');
      log('[test-runner] Invoked stopServer command to ensure clean slate.');
    } catch (err) {
      log(`[test-runner] stopServer command invocation failed: ${err}`);
    }

    const mocha = new Mocha({
      color: true,
      ui: 'tdd',
    });

    const testsRoot = path.resolve(__dirname, '..');
    log(`[test-runner] Searching for tests in: ${testsRoot}`);
    log(`[test-runner] __dirname is: ${__dirname}`);
    const testFiles = await findTestFiles(testsRoot);
    log(`[test-runner] Discovered ${testFiles.length} test file(s) under ${testsRoot}`);
    if (testFiles.length > 0) {
      log('[test-runner] Test files found:');
      testFiles.forEach(f => log(`  - ${f}`));
    }

    if (testFiles.length === 0) {
      throw new Error(`No test files found under ${testsRoot}`);
    }

    for (const file of testFiles) {
      mocha.addFile(file);
    }

    await mocha.loadFilesAsync();

    await new Promise<void>((resolve, reject) => {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
    });
    log('[test-runner] Mocha run completed successfully.');
  } catch (error) {
    log(`[test-runner] Error during test execution: ${error}`);
    throw error;
  } finally {
    await config.update('startOnActivate', originalStartOnActivate, vscode.ConfigurationTarget.Global);
    log('[test-runner] Restored auto-start setting after tests.');
  }
}
