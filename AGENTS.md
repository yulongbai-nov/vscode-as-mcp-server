# Repository Guidelines

## Project Structure & Module Organization
- Root workspace is a pnpm monorepo; run commands from repository root.
- `packages/extension/` contains the VS Code extension (TypeScript sources in `src/`, compiled JavaScript in `dist/`, tests in `src/test/`).
- `packages/relay/` provides the standalone MCP relay CLI (`src/` for TypeScript, `dist/` for emitted JS).
- `dist-release/` and `node_modules/` are build outputs; do not edit by hand.
- Shared configuration lives in `pnpm-workspace.yaml`, `tsconfig.json` files inside each package, and the per-package `package.json`.

## Build, Test, and Development Commands
- `pnpm install` — install workspace dependencies (required after cloning or updating lockfile).
- `pnpm --filter extension compile` — type-check and bundle the VS Code extension.
- `pnpm --filter extension watch` — incremental rebuild for local development.
- `pnpm --filter extension test` — run VS Code integration tests via `vscode-test`.
- `pnpm --filter relay build` / `pnpm --filter relay dev` — compile the relay once or start it with hot reload.
- `pnpm --filter relay test` — execute Node’s built-in test runner for the relay package.

## Coding Style & Naming Conventions
- TypeScript everywhere; keep two-space indentation and trailing commas where helpful to minimize diffs.
- Use `camelCase` for functions/variables, `PascalCase` for classes, and hyphenated file names (e.g., `bidi-http-transport.ts`) following existing patterns.
- Prefer named exports from modules; keep public APIs in `index.ts` and internal helpers in `utils/` or `tools/`.
- Run `pnpm --filter extension check-types` if you touch complex types; treat TypeScript warnings as errors.

## Testing Guidelines
- Extension tests live under `packages/extension/src/test/*.test.ts`; mirror the folder of the code under test.
- Keep flaky tests gated with explicit skips and a tracking comment. Remove the skip before merging fixes.
- Relay tests should cover CLI inputs/outputs; add fixtures under `packages/relay/testdata/` if scenarios grow.
- Aim to keep the existing test suite green locally (`pnpm --filter ... test`) before pushing; include coverage notes in PRs when functionality changes.

## Commit & Pull Request Guidelines
- Follow the conventional commit style observed in history (`fix:`, `chore:`, `feat:` with optional scope like `fix(test): …`).
- Keep commits scoped and reversible; run formatting and tests before committing.
- PRs need a concise summary, linked issues (e.g., `Closes #42`), test results, and recordings or screenshots for UI-facing tweaks.
- Highlight any configuration changes (ports, command approvals) in the PR description so reviewers can retest with matching settings.
