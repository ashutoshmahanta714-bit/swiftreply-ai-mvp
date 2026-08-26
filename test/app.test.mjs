import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { extractOutputText, geminiGenerateUrl } from '../src/gemini.mjs';
import { createServer } from '../src/server.mjs';

test('extractOutputText reads Gemini generated content', () => {
  const value = extractOutputText({
    candidates: [{ content: { parts: [{ text: 'A polished reply.' }] } }],
  });
  assert.equal(value, 'A polished reply.');
});

async function withServer(run) {
  let capturedBody;
  let capturedUrl;
  let capturedHeaders;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options.headers;
    capturedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      model: 'test-model',
      candidates: [{ content: { parts: [{ text: 'Hello! How may I help?' }] } }],
      modelVersion: 'test-model',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const server = createServer({
    env: {
      NODE_ENV: 'production',
      GEMINI_API_KEY: 'test-key',
      GEMINI_MODEL: 'test-model',
      APP_PASSWORD: 'test-password',
      RATE_LIMIT_MAX: '10',
    },
    fetchImpl,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`, () => ({
      body: capturedBody,
      url: capturedUrl,
      headers: capturedHeaders,
    }));
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

test('generate endpoint calls Gemini with safe production options', async () => {
  await withServer(async (baseUrl, getCapturedRequest) => {
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

    const request = getCapturedRequest();
    const requestBody = request.body;
    assert.equal(request.url, geminiGenerateUrl('test-model'));
    assert.equal(request.headers['x-goog-api-key'], 'test-key');
    assert.equal(requestBody.contents[0].parts[0].text, 'Please reply to this.');
    assert.match(requestBody.systemInstruction.parts[0].text, /friendly tone/);
    assert.equal(requestBody.generationConfig.maxOutputTokens, 400);
  });
});
