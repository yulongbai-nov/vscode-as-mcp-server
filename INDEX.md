# Repository Index

## Monorepo Layout
- [`pnpm-workspace.yaml:1`](pnpm-workspace.yaml#L1) declares a two-package workspace (`packages/*`) managed with pnpm.
- [`packages/extension/package.json:1`](packages/extension/package.json#L1) ships the VS Code MCP extension; build entry is `./dist/extension.js`.
- [`packages/relay/package.json:1`](packages/relay/package.json#L1) defines the standalone MCP relay CLI exposed through the `vscode-as-mcp-server` binary.

## Extension Runtime
- Entry point [`packages/extension/src/extension.ts:48`](packages/extension/src/extension.ts#L48) exports `activate`, wiring status bar UI, MCP server lifecycle, and command registration.
- [`packages/extension/src/extension.ts:70`](packages/extension/src/extension.ts#L70) hosts `startServer`/`stopServer` helpers that wrap the bidirectional HTTP transport and toggle the status indicator.
- [`packages/extension/src/bidi-http-transport.ts:7`](packages/extension/src/bidi-http-transport.ts#L7) implements the express-backed transport, including graceful handover restarts via `closeServer` and `restartDelayMs`.
- [`packages/extension/src/mcp-server.ts:39`](packages/extension/src/mcp-server.ts#L39) defines `ToolRegistry`, validating MCP tool descriptors and bridging into the SDK’s JSON-RPC handlers.
- [`packages/extension/src/mcp-server.ts:191`](packages/extension/src/mcp-server.ts#L191) exposes `createMcpServer`, seeding the MCP manifest and registering built-in VS Code tools.

## Tool Implementations
- [`packages/extension/src/tools/execute_command.ts:34`](packages/extension/src/tools/execute_command.ts#L34) encapsulates terminal orchestration, confirmation flow, and output handling; `execute` validates CWDs and streams terminal output.
- [`packages/extension/src/tools/text_editor.ts:570`](packages/extension/src/tools/text_editor.ts#L570) routes text editor operations (`view`, `str_replace`, `create`, `insert`, `undo_edit`) through the diff-driven `EditorManager`.
- [`packages/extension/src/tools/get_terminal_output.ts:12`](packages/extension/src/tools/get_terminal_output.ts#L12) surfaces buffered terminal output with optional tail trimming.
- Additional utilities live under [`packages/extension/src/tools/`](packages/extension/src/tools/) and use Zod schemas mirrored in [`packages/extension/src/mcp-server.ts:20`](packages/extension/src/mcp-server.ts#L20).

## Testing Guides
- Integration tests for the extension sit in [`packages/extension/src/test/tools/execute_command.test.ts:17`](packages/extension/src/test/tools/execute_command.test.ts#L17), [`packages/extension/src/test/tools/text_editor.test.ts:5`](packages/extension/src/test/tools/text_editor.test.ts#L5), and related suites inside [`packages/extension/src/test/`](packages/extension/src/test/).
- Transport coverage resides in [`packages/extension/src/test/bidi-http-transport.test.ts:45`](packages/extension/src/test/bidi-http-transport.test.ts#L45), spinning up mock HTTP servers to exercise handover and response pipelines.
- Run the suite with `pnpm --filter "./packages/extension" test`, which executes VS Code’s headless integration harness ([`packages/extension/package.json:43`](packages/extension/package.json#L43)).

## Relay CLI
- CLI entry point [`packages/relay/src/index.ts:16`](packages/relay/src/index.ts#L16) caches tool lists, proxies `tools/list` & `call_tool`, and persists results under `~/.vscode-as-mcp-relay-cache`.
- [`packages/relay/src/initial_tools.ts:1`](packages/relay/src/initial_tools.ts#L1) provides the bootstrapped tool manifest used when the extension server is unreachable.

## Contributor Docs
- [`AGENTS.md:1`](AGENTS.md#L1) contains the contributor onboarding and workflow guidelines produced for this repository.
