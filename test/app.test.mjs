import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { extractOutputText } from '../src/openai.mjs';
import { createServer } from '../src/server.mjs';

test('extractOutputText reads Responses API message output', () => {
  const value = extractOutputText({
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: 'A polished reply.' }],
    }],
  });
  assert.equal(value, 'A polished reply.');
});

async function withServer(run) {
  let capturedBody;
  const fetchImpl = async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: 'test-model',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello! How may I help?' }] }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const server = createServer({
    env: {
      NODE_ENV: 'production',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'test-model',
      APP_PASSWORD: 'test-password',
      RATE_LIMIT_MAX: '10',
    },
    fetchImpl,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, () => capturedBody);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('health endpoint reports configuration without exposing secrets', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: 'ok',
      configured: true,
      model: 'test-model',
    });
  });
});

test('generate endpoint requires the app password', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' }),
    });
    assert.equal(response.status, 401);
  });
});

test('generate endpoint calls OpenAI with safe production options', async () => {
  await withServer(async (baseUrl, getCapturedBody) => {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-App-Password': 'test-password',
      },
      body: JSON.stringify({ message: 'Please reply to this.', tone: 'friendly' }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reply, 'Hello! How may I help?');

    const requestBody = getCapturedBody();
    assert.equal(requestBody.model, 'test-model');
    assert.equal(requestBody.input, 'Please reply to this.');
    assert.equal(requestBody.store, false);
    assert.match(requestBody.instructions, /friendly tone/);
  });
});
