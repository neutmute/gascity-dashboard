import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import express from 'express';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AddressInfo } from 'node:net';
import { GcClient } from '../src/gc-client.js';
import { workflowsRouter } from '../src/routes/workflows.js';
import { sessionStreamRouter } from '../src/routes/session-stream.js';

const execFileAsync = promisify(execFile);

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void;

interface FakeSupervisor {
  baseUrl: string;
  requests: string[];
  setHandler(h: Handler): void;
  close(): Promise<void>;
}

function startFakeSupervisor(): Promise<FakeSupervisor> {
  return new Promise((resolve) => {
    let handler: Handler = (_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    };
    const requests: string[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = http.createServer((req, res) => {
      requests.push(req.url ?? '');
      handler(req, res);
    });
    server.on('connection', (sock) => {
      sockets.add(sock);
      sock.on('close', () => sockets.delete(sock));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        requests,
        setHandler(h: Handler) {
          handler = h;
        },
        close() {
          for (const sock of sockets) sock.destroy();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  });
}

async function startApp(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

function buildApp(fakeUrl: string, rigRoot = ''): express.Express {
  const gc = new GcClient({
    baseUrl: fakeUrl,
    cityName: 'racoon-city',
    defaultTimeoutMs: 500,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/workflows', workflowsRouter(gc, { rigRoot }));
  app.use('/api/sessions', sessionStreamRouter({
    supervisorUrl: fakeUrl,
    cityName: 'racoon-city',
    heartbeatMs: 10_000,
  }));
  return app;
}

function graphV2Snapshot(workDir?: string) {
  return {
    workflow_id: 'gc-root',
    root_bead_id: 'gc-root',
    root_store_ref: 'city:racoon-city',
    resolved_root_store: 'city:racoon-city',
    scope_kind: 'city',
    scope_ref: 'racoon-city',
    snapshot_version: 7,
    snapshot_event_seq: 42,
    root: {
      id: 'gc-root',
      title: 'Adopt PR #42',
      status: 'in_progress',
      issue_type: 'convoy',
      metadata: {
        'gc.formula_contract': 'graph.v2',
        'gc.formula': 'mol-adopt-pr-v2',
        ...(workDir ? { 'gc.work_dir': workDir } : {}),
      },
    },
    beads: [
      {
        id: 'gc-root',
        title: 'Adopt PR #42',
        status: 'in_progress',
        issue_type: 'convoy',
        metadata: {
          'gc.formula_contract': 'graph.v2',
          'gc.formula': 'mol-adopt-pr-v2',
          ...(workDir ? { 'gc.work_dir': workDir } : {}),
        },
      },
      {
        id: 'gc-loop-1',
        title: 'Review Loop',
        status: 'in_progress',
        issue_type: 'task',
        metadata: {
          'gc.kind': 'ralph',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop',
          'gc.max_attempts': '3',
        },
      },
      {
        id: 'gc-codex-iter1',
        title: 'Codex Review',
        status: 'closed',
        assignee: 'gc-session-a',
        issue_type: 'task',
        metadata: {
          'gc.kind': 'task',
          'gc.step_id': 'review-codex',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.1.review-codex',
          'gc.attempt': '1',
          session_name: 'codex-review-1',
        },
      },
      {
        id: 'gc-codex-iter2',
        title: 'Codex Review',
        status: 'in_progress',
        assignee: 'gc-session-b',
        issue_type: 'task',
        metadata: {
          'gc.kind': 'task',
          'gc.step_id': 'review-codex',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex',
          'gc.attempt': '2',
          session_name: 'codex-review-2',
        },
      },
      {
        id: 'gc-scope-check',
        title: 'Review scope check',
        status: 'closed',
        issue_type: 'task',
        metadata: {
          'gc.kind': 'scope-check',
          'gc.step_ref': 'mol-adopt-pr-v2.review-loop.iteration.2.review-codex-scope-check',
        },
      },
    ],
    deps: [
      { from: 'gc-loop-1', to: 'gc-codex-iter2', kind: 'execution' },
    ],
  };
}

describe('workflows detail route', () => {
  let fake: FakeSupervisor;

  beforeEach(async () => {
    fake = await startFakeSupervisor();
  });

  afterEach(async () => {
    await fake.close();
  });

  test('returns graph.v2 display nodes without exposing internal ralph terminology', async () => {
    fake.setHandler((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(graphV2Snapshot()));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/workflows/gc-root?scope_kind=city&scope_ref=racoon-city`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.workflowId, 'gc-root');
      assert.equal(body.formula, 'mol-adopt-pr-v2');
      assert.equal(body.snapshotVersion, 7);
      assert.ok(
        fake.requests.includes('/v0/city/racoon-city/workflow/gc-root?scope_kind=city&scope_ref=racoon-city'),
        `unexpected upstream requests: ${fake.requests.join(', ')}`,
      );

      const wire = JSON.stringify(body).toLowerCase();
      assert.equal(wire.includes('ralph'), false);

      const loopNode = body.nodes.find((node: { constructKind?: string }) => node.constructKind === 'check-loop');
      assert.ok(loopNode, 'expected check-loop display node');

      const codexNode = body.nodes.find((node: { semanticNodeId?: string }) => node.semanticNodeId === 'review-codex');
      assert.ok(codexNode, 'expected semantic review-codex node');
      assert.equal(codexNode.visibleIteration, 2);
      assert.equal(codexNode.hasHistoricalIterations, true);
      assert.equal(codexNode.executionInstances.length, 2);
      assert.equal(codexNode.executionInstances[0].historical, true);
      assert.equal(codexNode.executionInstances[1].currentIteration, true);
      assert.equal(codexNode.executionInstances[1].streamable, true);
      assert.equal(codexNode.executionInstances[1].sessionLink.sessionId, 'gc-session-b');
      assert.ok(
        codexNode.controlBadges.some((badge: { label?: string }) => badge.label === 'scope check'),
        'expected scope-check to collapse into a badge',
      );
    } finally {
      await close();
    }
  });

  test('rejects invalid workflow ids before calling supervisor', async () => {
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/workflows/../../etc/passwd`);
      assert.equal(res.status, 404);
      assert.equal(fake.requests.length, 0);
    } finally {
      await close();
    }
  });

  test('returns current git working tree diff for the server-owned execution path', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-diff-'));
    await execFileAsync('git', ['-C', repo, 'init']);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\n');
    await execFileAsync('git', ['-C', repo, 'add', 'README.md']);
    await execFileAsync('git', [
      '-C',
      repo,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '-m',
      'base',
    ]);
    await fs.writeFile(path.join(repo, 'README.md'), 'base\nnext\n');

    fake.setHandler((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(graphV2Snapshot(repo)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl, '/should-not-be-used'));
    try {
      const res = await fetch(`${url}/api/workflows/gc-root/diff?path=/tmp/evil`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'ok');
      assert.equal(body.rootPath, await fs.realpath(repo));
      assert.deepEqual(body.changedFiles, [
        { path: 'README.md', status: 'M', kind: 'docs' },
      ]);
      assert.match(body.unstagedDiff, /^\+next$/m);
    } finally {
      await close();
      await fs.rm(repo, { recursive: true, force: true });
    }
  });

  test('diff endpoint quietly reports not_git for execution folders outside git', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow-not-git-'));
    fake.setHandler((_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(graphV2Snapshot(dir)));
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/workflows/gc-root/diff`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.kind, 'not_git');
      assert.equal(body.rootPath, null);
      assert.deepEqual(body.changedFiles, []);
    } finally {
      await close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('session stream route', () => {
  let fake: FakeSupervisor;

  beforeEach(async () => {
    fake = await startFakeSupervisor();
  });

  afterEach(async () => {
    await fake.close();
  });

  test('proxies supervisor session SSE and forwards Last-Event-ID', async () => {
    fake.setHandler((req, res) => {
      assert.equal(req.url, '/v0/city/racoon-city/session/gc-session-b/stream?after=41');
      res.statusCode = 200;
      res.setHeader('content-type', 'text/event-stream');
      res.end('id: 42\nevent: turn\ndata: {"role":"assistant","text":"still working"}\n\n');
    });
    const { url, close } = await startApp(buildApp(fake.baseUrl));
    try {
      const res = await fetch(`${url}/api/sessions/gc-session-b/stream`, {
        headers: { 'Last-Event-ID': '41' },
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
      const text = await res.text();
      assert.match(text, /event: turn/);
      assert.match(text, /still working/);
    } finally {
      await close();
    }
  });
});
