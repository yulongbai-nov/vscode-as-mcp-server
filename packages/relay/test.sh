#!/bin/bash

# Build TypeScript files
echo "Building TypeScript files..."
pnpm build

# Run unit tests
echo "Running unit tests..."
pnpm test

# Run integration tests
echo "Running integration tests..."
pnpm tsx src/integration-test.ts

# Check for test failures
if [ $? -ne 0 ]; then
  echo "Tests failed!"
  exit 1
fi

echo "All tests passed!"
