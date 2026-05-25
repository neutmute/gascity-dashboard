import { Router, type Request, type Response } from 'express';

const SESSION_ID_RE = /^(gc|td|th)-[a-z0-9-]{1,32}$/i;
const DEFAULT_HEARTBEAT_MS = 15_000;

export interface SessionStreamRouterOptions {
  supervisorUrl: string;
  cityName: string;
  heartbeatMs?: number;
}

export function sessionStreamRouter(opts: SessionStreamRouterOptions): Router {
  const router = Router();
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;

  router.get('/:id/stream', async (req: Request, res: Response) => {
    const id = req.params.id;
    if (typeof id !== 'string') {
      res.status(400).json({ error: 'invalid session id', kind: 'validation' });
      return;
    }
    if (!SESSION_ID_RE.test(id)) {
      res.status(400).json({ error: 'invalid session id', kind: 'validation' });
      return;
    }

    const upstream = new URL(
      `${opts.supervisorUrl}/v0/city/${encodeURIComponent(opts.cityName)}/session/${encodeURIComponent(id)}/stream`,
    );
    const lastEventId = lastEventIdFor(req);
    if (lastEventId) upstream.searchParams.set('after', lastEventId);

    const ctrl = new AbortController();
    req.on('close', () => ctrl.abort());

    let upstreamRes: globalThis.Response;
    try {
      upstreamRes = await fetch(upstream, {
        signal: ctrl.signal,
        headers: { accept: 'text/event-stream' },
      });
    } catch {
      if (!res.headersSent && !res.writableEnded) {
        res.status(502).json({ error: 'gc supervisor session stream unreachable', kind: 'upstream' });
      }
      return;
    }

    if (!upstreamRes.ok) {
      upstreamRes.body?.cancel().catch(() => undefined);
      res.status(502).json({ error: `gc supervisor returned ${upstreamRes.status}`, kind: 'upstream' });
      return;
    }
    if (!upstreamRes.body) {
      res.status(502).json({ error: 'gc supervisor session stream response had no body', kind: 'upstream' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(':\n\n');
    }, heartbeatMs);
    const reader = upstreamRes.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done || res.writableEnded) break;
        if (!res.write(value)) {
          await new Promise<void>((resolve) => {
            const doneDrain = (): void => {
              res.off('drain', doneDrain);
              res.off('close', doneDrain);
              resolve();
            };
            res.once('drain', doneDrain);
            res.once('close', doneDrain);
          });
        }
      }
    } catch {
      // Upstream errored or client disconnected. Cleanup below owns closure.
    } finally {
      clearInterval(heartbeat);
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
      ctrl.abort();
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}

function lastEventIdFor(req: Request): string | null {
  const headerVal = req.headers['last-event-id'];
  if (typeof headerVal === 'string' && headerVal.length > 0) return headerVal;
  const after = req.query.after;
  if (typeof after === 'string' && after.length > 0) return after;
  return null;
}
