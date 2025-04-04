#!/usr/bin/env node

import * as http from 'node:http';

// Interface for HTTP response
interface HttpResponse {
  statusCode: number;
  body: string;
}

// Interface for command line args
interface Args {
  relayPort: number;
  action: 'normal' | 'set-main' | 'request-main';
}

// Send a message to the relay to be forwarded to the MCP server
const sendMessage = (port: number, message: any): Promise<HttpResponse> => {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(message);

    const options = {
      hostname: 'localhost',
      port: port,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk.toString();
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 500,
          body: responseData
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(data);
    req.end();
  });
};

// Parse command line arguments
const parseArgs = (): Args => {
  const args = process.argv.slice(2);
  let relayPort = 6020; // Default relay port
  let action: 'normal' | 'set-main' | 'request-main' = 'normal';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      relayPort = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--set-main') {
      action = 'set-main';
    } else if (args[i] === '--request-main') {
      action = 'request-main';
    }
  }

  return { relayPort, action };
};

// Main function
const main = async (): Promise<void> => {
  const { relayPort, action } = parseArgs();

  try {
    switch (action) {
      case 'set-main':
        // Send SET_MAIN message to a server
        console.log(`Sending SET_MAIN message to relay on port ${relayPort}`);

        const setMainResponse = await sendMessage(relayPort, {
          jsonrpc: '2.0',
          method: '$relay',
          params: {
            type: 'set_main',
            clientPort: relayPort
          }
        });

        console.log('Response:', setMainResponse);
        break;

      case 'request-main':
        // Send REQUEST_MAIN message to the client
        console.log(`Sending REQUEST_MAIN message to relay on port ${relayPort}`);

        const requestMainResponse = await sendMessage(relayPort, {
          jsonrpc: '2.0',
          method: '$relay',
          params: {
            type: 'request_main',
            serverUrl: `http://localhost:${relayPort}`
          }
        });

        console.log('Response:', requestMainResponse);
        break;

      default:
        // Send a normal JSON-RPC message
        console.log(`Sending normal message to relay on port ${relayPort}`);

        const normalResponse = await sendMessage(relayPort, {
          jsonrpc: '2.0',
          id: '123',
          method: 'test',
          params: {
            hello: 'world'
          }
        });

        console.log('Response:', normalResponse);
        break;
    }
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
};

main();
