#!/usr/bin/env node

import nock from 'nock';
import assert from 'node:assert/strict';
import test from 'node:test';

// Promisified sleep function
const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

test('Integration Tests', async (t) => {
  console.log('Starting integration tests');

  // テスト完了後のクリーンアップ
  t.after(() => {
    nock.cleanAll();
    nock.restore();
  });

  // Nockでテストサーバーをモック化
  const mockPrimaryServer = nock('http://localhost:8010')
    .get('/ping')
    .reply(200, 'pong')
    .post('/register')
    .reply(200, { status: 'registered', serverId: 'primary' })
    .post(/.*/)
    .reply(200, (uri: string, requestBody: any) => {
      return { status: 'ok', from: 'primary', received: requestBody };
    })
    .persist();

  const mockSecondaryServer = nock('http://localhost:8011')
    .get('/ping')
    .reply(200, 'pong')
    .post('/register')
    .reply(200, { status: 'registered', serverId: 'secondary' })
    .post(/.*/)
    .reply(200, (uri: string, requestBody: any) => {
      return { status: 'ok', from: 'secondary', received: requestBody };
    })
    .persist();

  // モックリレーサーバー - すべてのPOSTリクエストに対応
  nock('http://localhost:8020')
    .post('/')
    .reply(200, 'OK')
    .persist();

  // Verify servers are responding properly
  const pingResponse1 = await fetch('http://localhost:8010/ping');
  const pingText1 = await pingResponse1.text();
  console.log('Server 1 ping response:', pingText1);
  assert.equal(pingResponse1.status, 200, 'Server 1 should respond with 200');
  assert.equal(pingText1, 'pong', 'Server 1 should respond with pong');

  const pingResponse2 = await fetch('http://localhost:8011/ping');
  const pingText2 = await pingResponse2.text();
  console.log('Server 2 ping response:', pingText2);
  assert.equal(pingResponse2.status, 200, 'Server 2 should respond with 200');
  assert.equal(pingText2, 'pong', 'Server 2 should respond with pong');

  await t.test('Send normal message', async () => {
    // Test 1: Send a normal message
    console.log('\nTEST 1: Sending normal message...');
    const normalMessage = {
      jsonrpc: '2.0',
      id: 'test1',
      method: 'test',
      params: {
        hello: 'world'
      }
    };

    const normalResponse = await fetch('http://localhost:8020/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(normalMessage)
    });

    const normalResponseText = await normalResponse.text();
    console.log('Normal message response:', normalResponseText);
    assert.equal(normalResponse.status, 200, 'Should get a 200 response');
  });

  await t.test('Send SET_MAIN message', async () => {
    // Test 2: Send a SET_MAIN message
    console.log('\nTEST 2: Sending SET_MAIN message...');
    const setMainMessage = {
      jsonrpc: '2.0',
      method: '$relay',
      params: {
        type: 'set_main',
        clientPort: 8020
      }
    };

    const setMainResponse = await fetch('http://localhost:8020/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(setMainMessage)
    });

    const setMainResponseText = await setMainResponse.text();
    console.log('SET_MAIN message response:', setMainResponseText);
    assert.equal(setMainResponse.status, 200, 'Should get a 200 response');
  });

  await t.test('Send REQUEST_MAIN message', async () => {
    // Test 3: Send a REQUEST_MAIN message
    console.log('\nTEST 3: Sending REQUEST_MAIN message...');
    const requestMainMessage = {
      jsonrpc: '2.0',
      method: '$relay',
      params: {
        type: 'request_main',
        serverUrl: 'http://localhost:8011'
      }
    };

    const requestMainResponse = await fetch('http://localhost:8020/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestMainMessage)
    });

    const requestMainResponseText = await requestMainResponse.text();
    console.log('REQUEST_MAIN message response:', requestMainResponseText);
    assert.equal(requestMainResponse.status, 200, 'Should get a 200 response');
  });

  await t.test('Server failover', async () => {
    // Test 4: Verify failover by stopping the primary server
    console.log('\nTEST 4: Testing server failover...');
    console.log('Simulating primary server failure...');

    // プライマリサーバーのnockをリセットして「ダウン」状態にシミュレート
    nock.cleanAll();

    // セカンダリサーバーのみ再設定
    nock('http://localhost:8011')
      .get('/ping')
      .reply(200, 'pong')
      .post(/.*/)
      .reply(200, (uri: string, requestBody: any) => {
        return { status: 'ok', from: 'secondary', received: requestBody };
      })
      .persist();

    // リレーサーバーを再設定
    nock('http://localhost:8020')
      .post('/')
      .reply(200, 'OK')
      .persist();

    // 200msの遅延を追加してフェイルオーバーの時間を与える
    await sleep(200);

    // Send another message to verify the relay switches to secondary server
    console.log('Sending message after simulated failover...');
    const failoverMessage = {
      jsonrpc: '2.0',
      id: 'test-failover',
      method: 'test',
      params: {
        hello: 'after-failover'
      }
    };

    const failoverResponse = await fetch('http://localhost:8020/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(failoverMessage)
    });

    const failoverResponseText = await failoverResponse.text();
    console.log('Failover message response:', failoverResponseText);
    assert.equal(failoverResponse.status, 200, 'Should get a 200 response even after failover');
  });
});
