import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  WorkflowChangedFile,
  WorkflowChangedFileKind,
  WorkflowDiffResponse,
} from 'gas-city-dashboard-shared';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5_000;
const MAX_DIFF_BYTES = 512 * 1024;

export async function readWorkflowGitDiff(
  executionPath: string | null,
): Promise<WorkflowDiffResponse> {
  if (!executionPath) {
    return emptyDiff('path_unknown', null);
  }

  let rootPath: string;
  try {
    const result = await runGit(executionPath, ['rev-parse', '--show-toplevel']);
    rootPath = result.stdout.trim();
    if (rootPath.length === 0) return emptyDiff('not_git', null);
  } catch {
    return emptyDiff('not_git', null);
  }

  try {
    const [statusResult, unstagedResult, stagedResult] = await Promise.all([
      runGit(executionPath, ['status', '--porcelain=v1']),
      runGit(executionPath, ['diff', '--no-ext-diff', '--no-color'], true),
      runGit(executionPath, ['diff', '--cached', '--no-ext-diff', '--no-color'], true),
    ]);
    const status = statusResult.stdout
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    return {
      kind: 'ok',
      rootPath,
      status,
      changedFiles: status.map(parseStatusLine).filter(isChangedFile),
      unstagedDiff: cap(unstagedResult.stdout),
      stagedDiff: cap(stagedResult.stdout),
      truncated:
        statusResult.truncated ||
        unstagedResult.truncated ||
        stagedResult.truncated,
    };
  } catch {
    return {
      ...emptyDiff('error', rootPath),
      error: 'git diff failed',
    };
  }
}

function emptyDiff(
  kind: WorkflowDiffResponse['kind'],
  rootPath: string | null,
): WorkflowDiffResponse {
  return {
    kind,
    rootPath,
    status: [],
    changedFiles: [],
    unstagedDiff: '',
    stagedDiff: '',
    truncated: false,
  };
}

async function runGit(
  cwd: string,
  args: string[],
  allowLarge = false,
): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
  try {
    const result = await execFileAsync('git', ['-C', cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: allowLarge ? MAX_DIFF_BYTES : 128 * 1024,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        LANG: 'C.UTF-8',
        NO_COLOR: '1',
      },
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      truncated: false,
    };
  } catch (err) {
    const maybe = err as {
      stdout?: string;
      stderr?: string;
      code?: string;
      killed?: boolean;
    };
    if (allowLarge && typeof maybe.stdout === 'string' && maybe.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
      return {
        stdout: maybe.stdout,
        stderr: maybe.stderr ?? '',
        truncated: true,
      };
    }
    throw err;
  }
}

function parseStatusLine(line: string): WorkflowChangedFile | null {
  if (line.length < 4) return null;
  const rawStatus = line.slice(0, 2);
  const pathPart = line.slice(3);
  const normalizedPath = pathPart.includes(' -> ')
    ? pathPart.split(' -> ').at(-1) ?? pathPart
    : pathPart;
  const status = rawStatus === '??'
    ? '??'
    : rawStatus.replace(/\s/g, '').slice(0, 1);
  return {
    path: normalizedPath,
    status,
    kind: classifyChangedFile(normalizedPath),
  };
}

function classifyChangedFile(filePath: string): WorkflowChangedFileKind {
  const lower = filePath.toLowerCase();
  if (
    lower.endsWith('.test.ts') ||
    lower.endsWith('.test.tsx') ||
    lower.endsWith('.spec.ts') ||
    lower.endsWith('.spec.tsx') ||
    lower.includes('/test/') ||
    lower.includes('/tests/')
  ) {
    return 'test';
  }
  if (
    lower.endsWith('.md') ||
    lower.endsWith('.mdx') ||
    lower.includes('/docs/')
  ) {
    return 'docs';
  }
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.toml') ||
    lower.endsWith('.yaml') ||
    lower.endsWith('.yml') ||
    lower.endsWith('.config.ts') ||
    lower.endsWith('.config.js') ||
    lower === 'package.json' ||
    lower.endsWith('/package.json')
  ) {
    return 'config';
  }
  if (
    /\.(ts|tsx|js|jsx|go|rs|py|rb|java|kt|swift|c|cc|cpp|h|hpp|css|scss|html)$/.test(lower)
  ) {
    return 'code';
  }
  return 'other';
}

function cap(value: string): string {
  return value.length > MAX_DIFF_BYTES ? value.slice(0, MAX_DIFF_BYTES) : value;
}

function isChangedFile(value: WorkflowChangedFile | null): value is WorkflowChangedFile {
  return value !== null;
}
