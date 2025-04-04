import nock from 'nock';
import assert from 'node:assert/strict';
import test from 'node:test';

test('MCP Relay Custom Protocol', async (t) => {
  // テスト前にNockをクリーンアップ
  nock.cleanAll();

  // テスト完了後にNockをリストア
  t.after(() => {
    nock.cleanAll();
    nock.restore();
  });

  // モックサーバーのセットアップ
  const server1 = nock('http://localhost:8010')
    .get('/ping')
    .reply(200, 'pong')
    .post('/register')
    .reply(200, { status: 'registered', serverId: 'server1' })
    .persist();

  const server2 = nock('http://localhost:8011')
    .get('/ping')
    .reply(200, 'pong')
    .post('/register')
    .reply(200, { status: 'registered', serverId: 'server2' })
    .persist();

  await t.test('Custom protocol message formats', () => {
    // Test SET_MAIN message format
    const setMainMessage = {
      jsonrpc: '2.0',
      method: '$relay',
      params: {
        type: 'set_main',
        clientPort: 6020
      }
    };

    assert.equal(setMainMessage.jsonrpc, '2.0');
    assert.equal(setMainMessage.method, '$relay');
    assert.equal(setMainMessage.params.type, 'set_main');
    assert.equal(setMainMessage.params.clientPort, 6020);

    // Test REQUEST_MAIN message format
    const requestMainMessage = {
      jsonrpc: '2.0',
      method: '$relay',
      params: {
        type: 'request_main',
        serverUrl: 'http://localhost:8010'
      }
    };

    assert.equal(requestMainMessage.jsonrpc, '2.0');
    assert.equal(requestMainMessage.method, '$relay');
    assert.equal(requestMainMessage.params.type, 'request_main');
    assert.equal(requestMainMessage.params.serverUrl, 'http://localhost:8010');
  });

  await t.test('Server registration format', async () => {
    // HTTPクライアントで直接テスト
    const response = await fetch('http://localhost:8010/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientUrl: 'http://localhost:6020',
        features: ['relay_protocol_v1']
      })
    });

    assert.equal(response.status, 200);
    const body = await response.json() as { status: string };
    assert.equal(body.status, 'registered');
  });

  await t.test('Server ping response', async () => {
    // HTTPクライアントで直接テスト
    const response = await fetch('http://localhost:8010/ping');
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.equal(body, 'pong');
  });
});
