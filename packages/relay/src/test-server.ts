#!/usr/bin/env node

import * as http from 'node:http';

// Create a simple test server that responds to MCP relay requests
const createTestServer = (port: number, serverName: string): http.Server => {
  const server = http.createServer((req, res) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      console.log(`[${serverName} on port ${port}] Received: ${req.url}`);

      if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('pong');
        return;
      }

      if (req.url === '/register') {
        console.log(`[${serverName}] Registration request:`, body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'registered' }));
        return;
      }

      if (body.length > 0) {
        console.log(`[${serverName}] Received message:`, body);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
    });
  });

  server.listen(port, () => {
    console.log(`Test ${serverName} server running on port ${port}`);
  });

  return server;
};

// Create multiple test servers
const servers = [
  createTestServer(8010, 'Primary'),
  createTestServer(8011, 'Secondary'),
  createTestServer(8012, 'Tertiary')
];

// Handle shutdown
process.on('SIGINT', () => {
  console.log('Shutting down test servers...');
  servers.forEach(server => server.close());
  process.exit();
});

console.log('Test servers running. Press Ctrl+C to stop.');
