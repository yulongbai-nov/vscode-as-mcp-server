#!/bin/bash

# Start test servers
echo "Starting test servers..."
node --import tsx test-server.js &
TEST_SERVER_PID=$!

# Give servers a moment to start
sleep 2

# Start the relay in the background
echo "Starting MCP relay..."
node --import tsx index.js --server-url http://localhost:6010 --listen-port 6020 &
RELAY_PID=$!

# Give relay a moment to start and register
sleep 3

# Send a test message
echo "Sending normal message..."
node --import tsx test-client.js --port 6020

# Send a SET_MAIN message
echo "Sending SET_MAIN message..."
node --import tsx test-client.js --port 6020 --set-main

# Send a REQUEST_MAIN message
echo "Sending REQUEST_MAIN message..."
node --import tsx test-client.js --port 6020 --request-main

# Allow user to see results
echo "Test complete. Press Enter to clean up and exit."
read

# Cleanup
kill $RELAY_PID
kill $TEST_SERVER_PID
echo "Test processes terminated."
