import { createReadStream } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MODEL, generateReply } from './nvidia.mjs';

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_DIR = join(ROOT_DIR, 'public');
const MAX_BODY_BYTES = 32 * 1024;
const ALLOWED_TONES = new Set(['professional', 'friendly', 'concise', 'empathetic']);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function securityHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function sendJson(response, statusCode, body, extraHeaders = {}) {
  response.writeHead(statusCode, {
    ...securityHeaders(),
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function passwordsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function clientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket.remoteAddress || 'unknown';
}

function createRateLimiter({ maxRequests, windowMs }) {
  const clients = new Map();

  return (ip) => {
    const now = Date.now();
    const existing = clients.get(ip);
    const record = !existing || now >= existing.resetAt
      ? { count: 0, resetAt: now + windowMs }
      : existing;

    record.count += 1;
    clients.set(ip, record);

    return {
      allowed: record.count <= maxRequests,
      remaining: Math.max(0, maxRequests - record.count),
      resetAt: record.resetAt,
    };
  };
}

async function serveStatic(pathname, response) {
  const routes = {
    '/': 'index.html',
    '/index.html': 'index.html',
    '/styles.css': 'styles.css',
    '/app.js': 'app.js',
  };
  const fileName = routes[pathname];
  if (!fileName) return false;

  const filePath = join(PUBLIC_DIR, fileName);
  await access(filePath);
  const fileStats = await stat(filePath);
  response.writeHead(200, {
    ...securityHeaders(MIME_TYPES[extname(filePath)] || 'application/octet-stream'),
    'Content-Length': fileStats.size,
    'Cache-Control': pathname === '/' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(filePath).pipe(response);
  return true;
}

export function createServer({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const apiKey = env.NVIDIA_API_KEY || '';
  const appPassword = env.APP_PASSWORD || '';
  const model = env.NVIDIA_MODEL || DEFAULT_MODEL;
  const isProduction = env.NODE_ENV === 'production';
  const maxRequests = Math.max(1, Number.parseInt(env.RATE_LIMIT_MAX || '10', 10));
  const windowMs = Math.max(60_000, Number.parseInt(env.RATE_LIMIT_WINDOW_MS || '3600000', 10));
  const checkRateLimit = createRateLimiter({ maxRequests, windowMs });

  return createHttpServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        sendJson(response, 200, {
          status: 'ok',
          configured: Boolean(apiKey && appPassword),
          model,
        });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/generate') {
        if (!apiKey) {
          sendJson(response, 503, { error: 'The server is missing NVIDIA_API_KEY.' });
          return;
        }

        if (isProduction && !appPassword) {
          sendJson(response, 503, { error: 'The server is missing APP_PASSWORD.' });
          return;
        }

        if (appPassword && !passwordsMatch(request.headers['x-app-password'], appPassword)) {
          sendJson(response, 401, { error: 'Incorrect app password.' });
          return;
        }

        const rate = checkRateLimit(clientIp(request));
        if (!rate.allowed) {
          sendJson(
            response,
            429,
            { error: 'Hourly request limit reached. Please try again later.' },
            { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) },
          );
          return;
        }

        const body = await readJson(request);
        const message = typeof body.message === 'string' ? body.message.trim() : '';
        const tone = ALLOWED_TONES.has(body.tone) ? body.tone : 'professional';

        if (!message) {
          sendJson(response, 400, { error: 'Enter the message you want to answer.' });
          return;
        }
        if (message.length > 4000) {
          sendJson(response, 400, { error: 'Message must be 4,000 characters or fewer.' });
          return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45_000);
        try {
          const result = await generateReply({
            message,
            tone,
            apiKey,
            model,
            fetchImpl,
            signal: controller.signal,
          });
          sendJson(response, 200, {
            ...result,
            remainingRequests: rate.remaining,
          });
        } finally {
          clearTimeout(timeout);
        }
        return;
      }

      if (request.method === 'GET' && await serveStatic(url.pathname, response)) {
        return;
      }

      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      const isAbort = error?.name === 'AbortError';
      const statusCode = isAbort ? 504 : (error?.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500);
      const message = isAbort
        ? 'The AI request timed out. Please try again.'
        : (statusCode < 500 ? error.message : 'Unable to generate a reply right now.');
      console.error('Request failed:', error?.message || error);
      sendJson(response, statusCode, { error: message });
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const host = process.env.HOST || '0.0.0.0';
  const server = createServer();
  server.listen(port, host, () => {
    console.log(`SwiftReply AI is running on http://${host}:${port}`);
  });
}
