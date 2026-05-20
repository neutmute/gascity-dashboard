import { describe, expect, it } from 'vitest';
import { beadProject, mailProject, sessionProject } from './projectOf';

describe('beadProject', () => {
  it.each([
    ['gc-1920', 'gc'],
    ['agent-diagnostics-503', 'agent-diagnostics'],
    ['code-intel-digest-mp5', 'code-intel-digest'],
    ['codeprobe-gg9f', 'codeprobe'],
    ['codeprobe-4cl6.2', 'codeprobe'],
    ['co-ysv', 'co'],
  ])('parses %s → %s', (id, expected) => {
    expect(beadProject({ id } as never)).toBe(expected);
  });

  it('falls back to the raw id when no suffix is found', () => {
    expect(beadProject({ id: 'noprefix' } as never)).toBe('noprefix');
  });
});

describe('sessionProject', () => {
  it('uses basename of rig path', () => {
    expect(sessionProject({ rig: '/home/ds/gascity' } as never)).toEqual({
      key: 'gascity',
      label: 'gascity',
    });
    expect(sessionProject({ rig: '/home/ds/projects/zeldascension' } as never)).toEqual({
      key: 'zeldascension',
      label: 'zeldascension',
    });
  });

  it('falls back to pool then template when rig is missing', () => {
    expect(sessionProject({ pool: 'codex' } as never)).toEqual({
      key: 'codex',
      label: 'codex',
    });
    expect(sessionProject({ template: '/some/path/foo' } as never)).toEqual({
      key: 'foo',
      label: 'foo',
    });
  });

  it('returns "(no rig)" bucket when no candidate exists', () => {
    expect(sessionProject({} as never)).toEqual({
      key: '(no rig)',
      label: '(no rig)',
    });
  });

  it('normalizes the key for case + separator drift while preserving the display label', () => {
    // The whole point of the {key, label} shape: rig paths with mixed
    // case or underscores must bucket together while the header shows
    // the original form. See useListFilters' bucketer.
    expect(sessionProject({ rig: '/home/ds/projects/GEO' } as never)).toEqual({
      key: 'geo',
      label: 'GEO',
    });
    expect(sessionProject({ rig: 'scix_experiments' } as never)).toEqual({
      key: 'scix-experiments',
      label: 'scix_experiments',
    });
  });
});

describe('mailProject', () => {
  it('uses rig directly', () => {
    expect(mailProject({ rig: 'ds-research' } as never)).toBe('ds-research');
  });

  it('falls back to "(no rig)" when missing', () => {
    expect(mailProject({} as never)).toBe('(no rig)');
    expect(mailProject({ rig: '' } as never)).toBe('(no rig)');
  });
});
