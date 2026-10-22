import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const { AGENT_ID, WAYLO_API_KEY, WORKSPACE_ID } = process.env;
const WAYLO_API_URL = process.env.WAYLO_API_URL?.replace(/\/+$/, '');
const PORT = Number(process.env.PORT ?? 5190);
const HOST = process.env.HOST ?? '127.0.0.1';
const UPSTREAM_TIMEOUT_MS = 10_000;

const FILES = {
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['dist/app.js', 'text/javascript; charset=utf-8'],
};

const missing = Object.entries({ AGENT_ID, WAYLO_API_KEY, WAYLO_API_URL, WORKSPACE_ID })
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  throw new Error(`Missing ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
}

function apiErrorCode(body) {
  try {
    return JSON.parse(body.toString()).error?.code ?? 'unknown_error';
  } catch {
    return 'unknown_error';
  }
}

async function createWebSession(agentId, metadata) {
  try {
    const upstream = await fetch(`${WAYLO_API_URL}/sessions/web`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${WAYLO_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspaceId: WORKSPACE_ID, agentId, metadata }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const body = Buffer.from(await upstream.arrayBuffer());

    if (!upstream.ok) {
      console.error(`Waylo API returned ${upstream.status} ${apiErrorCode(body)}`);
    }

    return { body, status: upstream.status };
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError';

    console.error(
      `Waylo API request failed: ${timedOut ? 'timeout' : (error?.cause?.code ?? error?.name)}`,
    );

    return { error: timedOut ? 'api_timeout' : 'api_unreachable' };
  }
}

function isJsonRequest(request) {
  const [type] = (request.headers['content-type'] ?? '').split(';');

  return type.trim().toLowerCase() === 'application/json';
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(request) {
  let raw = '';

  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('body too large');
  }

  return JSON.parse(raw);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function serveFile(response, [path, type]) {
  const body = await readFile(new URL(path, import.meta.url)).catch(() => undefined);

  if (!body) {
    sendJson(response, 404, { error: 'not_found' });

    return;
  }

  response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

async function session(request, response) {
  // Check your own user's login and access to this agent here (401 / 403).
  if (!isJsonRequest(request)) {
    sendJson(response, 415, { error: 'json_required' });

    return;
  }

  const body = await readJson(request).catch(() => undefined);

  if (
    !isPlainObject(body) ||
    typeof body.agentId !== 'string' ||
    body.agentId.trim() === '' ||
    (body.metadata !== undefined && !isPlainObject(body.metadata))
  ) {
    sendJson(response, 400, { error: 'invalid_request' });

    return;
  }

  if (body.agentId !== AGENT_ID) {
    sendJson(response, 403, { error: 'access_denied' });

    return;
  }

  const upstream = await createWebSession(body.agentId, body.metadata);

  if (upstream.error) {
    sendJson(response, upstream.error === 'api_timeout' ? 504 : 502, { error: upstream.error });

    return;
  }

  // A Waylo 401 or 403 is about this server's key, not the visitor's login; never pass it on as is.
  if (upstream.status < 200 || upstream.status > 299) {
    sendJson(response, upstream.status === 429 ? 429 : 502, { error: 'api_error' });

    return;
  }

  response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(upstream.body);
}

const handle = async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost');
  const route = `${request.method} ${pathname}`;

  switch (route) {
    case 'POST /api/waylo/session': {
      await session(request, response);

      break;
    }
    case 'GET /api/example/agent': {
      sendJson(response, 200, { agentId: AGENT_ID });

      break;
    }
    default:
      if (request.method === 'GET' && FILES[pathname]) {
        await serveFile(response, FILES[pathname]);
      } else {
        sendJson(response, 404, { error: 'not_found' });
      }
  }
};

createServer((request, response) => {
  handle(request, response).catch(error => {
    console.error(`request failed: ${error?.name ?? 'Error'}`);

    if (response.headersSent) {
      response.destroy();
    } else {
      sendJson(response, 500, { error: 'internal_error' });
    }
  });
}).listen(PORT, HOST, () => {
  console.log(`example app on http://${HOST}:${PORT}`);
});
