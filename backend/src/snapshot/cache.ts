import type { SourceName, SourceState } from 'gas-city-dashboard-shared';

// TTL + single-flight + stale-while-error + fixture-fallback cache.
// Ported from demo-dash src/server/cache.ts (gascity-dashboard-glw).
//
// Three invariants downstream beads need to know:
//
// 1. Single-flight is keyed by closure identity. One SourceCache instance
//    represents one source; two concurrent .get() calls coalesce because
//    they share `this.inFlight`. This is DIFFERENT from GcClient's
//    URL-keyed inflight map (backend/src/gc-client.ts): two SourceCache
//    instances for the same source name do NOT share a request.
//
// 2. snapshot() returns a synthetic status='error' state when the cache
//    has never been fetched. Callers that need to distinguish
//    "never tried" from "tried and failed" should check `fetchedAt !==
//    null`.
//
// 3. A successful live refresh wipes `fixtureEntry`. If the cache fell
//    back to fixture, then the next live load succeeds, the fixture is
//    forgotten; a subsequent failure that triggers fixture fallback will
//    re-invoke loadFixture(). This is intentional — fixtures are a
//    degraded-mode fallback, never a persistent shadow store. Note: once
//    `liveEntry` exists, the stale-while-error path takes precedence over
//    fixture fallback on the next failure, so fixture only re-activates
//    when there is no live entry at all (e.g., cold start or after a
//    forced cache reset by callers — none exist today).

export interface SourceCacheOptions<T> {
  source: SourceName;
  ttlMs: number;
  load: () => Promise<T> | T;
  loadFixture?: () => Promise<T> | T;
  useFixture?: boolean;
  now?: () => Date;
}

interface CacheEntry<T> {
  data: T;
  fetchedAtMs: number;
}

export class SourceCache<T> {
  private readonly source: SourceName;
  private readonly ttlMs: number;
  private readonly load: () => Promise<T> | T;
  private readonly loadFixture?: () => Promise<T> | T;
  private readonly useFixture: boolean;
  private readonly now: () => Date;
  private liveEntry: CacheEntry<T> | null = null;
  private fixtureEntry: CacheEntry<T> | null = null;
  private lastError: string | null = null;
  private inFlight: Promise<SourceState<T>> | null = null;

  constructor(options: SourceCacheOptions<T>) {
    if (options.ttlMs <= 0 || !Number.isFinite(options.ttlMs)) {
      throw new Error('SourceCache ttlMs must be a positive finite number.');
    }

    this.source = options.source;
    this.ttlMs = options.ttlMs;
    this.load = options.load;
    this.loadFixture = options.loadFixture;
    this.useFixture = options.useFixture ?? false;
    this.now = options.now ?? (() => new Date());
  }

  async get(options: { force?: boolean } = {}): Promise<SourceState<T>> {
    const current = this.currentState();

    if (!options.force && current && current.status !== 'stale') {
      return current;
    }

    return await this.refresh();
  }

  async refresh(): Promise<SourceState<T>> {
    if (this.inFlight) {
      return await this.inFlight;
    }

    this.inFlight = this.refreshUnshared().finally(() => {
      this.inFlight = null;
    });

    return await this.inFlight;
  }

  snapshot(): SourceState<T> {
    return (
      this.currentState() ?? {
        source: this.source,
        status: 'error',
        fetchedAt: null,
        staleAt: null,
        error: this.lastError,
        data: null,
      }
    );
  }

  private async refreshUnshared(): Promise<SourceState<T>> {
    try {
      const data = await this.load();
      this.liveEntry = {
        data,
        fetchedAtMs: this.now().getTime(),
      };
      this.fixtureEntry = null;
      this.lastError = null;
      return this.stateFromEntry(this.liveEntry, 'fresh', null);
    } catch (error) {
      this.lastError = errorMessage(error);

      if (this.useFixture && this.loadFixture) {
        try {
          const data = await this.loadFixture();
          this.fixtureEntry = {
            data,
            fetchedAtMs: this.now().getTime(),
          };
          return this.stateFromEntry(this.fixtureEntry, 'fixture', this.lastError);
        } catch (fixtureError) {
          this.lastError = `${this.lastError}; fixture failed: ${errorMessage(fixtureError)}`;
        }
      }

      if (this.liveEntry) {
        return this.stateFromEntry(this.liveEntry, 'stale', this.lastError);
      }

      if (this.fixtureEntry) {
        return this.stateFromEntry(this.fixtureEntry, 'fixture', this.lastError);
      }

      return {
        source: this.source,
        status: 'error',
        fetchedAt: null,
        staleAt: null,
        error: this.lastError,
        data: null,
      };
    }
  }

  private currentState(): SourceState<T> | null {
    if (this.liveEntry) {
      const status =
        this.now().getTime() < this.liveEntry.fetchedAtMs + this.ttlMs
          ? 'fresh'
          : 'stale';
      return this.stateFromEntry(
        this.liveEntry,
        status,
        status === 'stale' ? this.lastError : null,
      );
    }

    if (this.fixtureEntry) {
      return this.stateFromEntry(this.fixtureEntry, 'fixture', this.lastError);
    }

    return null;
  }

  private stateFromEntry(
    entry: CacheEntry<T>,
    status: SourceState<T>['status'],
    error: string | null,
  ): SourceState<T> {
    return {
      source: this.source,
      status,
      fetchedAt: new Date(entry.fetchedAtMs).toISOString(),
      staleAt: new Date(entry.fetchedAtMs + this.ttlMs).toISOString(),
      error,
      data: entry.data,
    };
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error);
}
