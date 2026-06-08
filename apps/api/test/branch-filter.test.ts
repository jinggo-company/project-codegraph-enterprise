// Unit tests for branch filtering logic (matchPattern + matchesBranch)
// Extracted from the webhook module for isolated testing
import { describe, it, expect } from 'vitest';

/**
 * Simple glob-like pattern matching for branch names.
 * Supports: exact match, * wildcard, ** for any path segment.
 */
function matchPattern(branch: string, pattern: string): boolean {
  if (pattern === branch) return true;
  if (pattern === '*') return true;

  const regex = pattern
    .replace(/\*\*/g, '__DOUBLESTAR__')
    .replace(/\*/g, '[^/]+')
    .replace(/__DOUBLESTAR__/g, '.*');

  return new RegExp(`^${regex}$`).test(branch);
}

interface BranchFilterConfig {
  allow?: string[];
  deny?: string[];
}

function matchesBranch(branch: string, filter: BranchFilterConfig | null | undefined): boolean {
  if (!filter || (!filter.allow?.length && !filter.deny?.length)) {
    return true;
  }

  if (filter.deny?.length) {
    for (const pattern of filter.deny) {
      if (matchPattern(branch, pattern)) {
        return false;
      }
    }
  }

  if (filter.allow?.length) {
    for (const pattern of filter.allow) {
      if (matchPattern(branch, pattern)) {
        return true;
      }
    }
    return false;
  }

  return true;
}

describe('Branch Filtering — matchPattern', () => {
  it('exact match', () => {
    expect(matchPattern('main', 'main')).toBe(true);
    expect(matchPattern('develop', 'main')).toBe(false);
  });

  it('single wildcard *', () => {
    expect(matchPattern('main', '*')).toBe(true);
    expect(matchPattern('feature/x', '*')).toBe(true);
    expect(matchPattern('feature/x', 'feature/*')).toBe(true);
    expect(matchPattern('feature/x/y', 'feature/*')).toBe(false);
  });

  it('double wildcard **', () => {
    expect(matchPattern('release/v1.0', 'release/**')).toBe(true);
    expect(matchPattern('release/v1.0/beta', 'release/**')).toBe(true);
    expect(matchPattern('feature/x', 'release/**')).toBe(false);
  });

  it('wildcard in middle', () => {
    expect(matchPattern('release/1.0', 'release/*')).toBe(true);
    expect(matchPattern('release/old', 'release/*')).toBe(true);
    expect(matchPattern('release/old/stale', 'release/*')).toBe(false);
  });
});

describe('Branch Filtering — matchesBranch', () => {
  it('no filter → allow all', () => {
    expect(matchesBranch('main', null)).toBe(true);
    expect(matchesBranch('random', undefined)).toBe(true);
    expect(matchesBranch('feature/x', {})).toBe(true);
  });

  it('allow list — branch in list → true', () => {
    const filter: BranchFilterConfig = { allow: ['main', 'develop'] };
    expect(matchesBranch('main', filter)).toBe(true);
    expect(matchesBranch('develop', filter)).toBe(true);
  });

  it('allow list — branch not in list → false', () => {
    const filter: BranchFilterConfig = { allow: ['main', 'develop'] };
    expect(matchesBranch('feature/x', filter)).toBe(false);
  });

  it('deny list — branch in deny → false', () => {
    const filter: BranchFilterConfig = { deny: ['release/old', 'deprecated/*'] };
    expect(matchesBranch('release/old', filter)).toBe(false);
    expect(matchesBranch('deprecated/thing', filter)).toBe(false);
  });

  it('deny list — branch not in deny → true', () => {
    const filter: BranchFilterConfig = { deny: ['release/old'] };
    expect(matchesBranch('main', filter)).toBe(true);
    expect(matchesBranch('develop', filter)).toBe(true);
  });

  it('deny takes precedence over allow', () => {
    const filter: BranchFilterConfig = {
      allow: ['main', 'release/*'],
      deny: ['release/old'],
    };
    expect(matchesBranch('main', filter)).toBe(true);
    expect(matchesBranch('release/v2', filter)).toBe(true);
    expect(matchesBranch('release/old', filter)).toBe(false);
  });

  it('wildcard patterns in allow list', () => {
    const filter: BranchFilterConfig = { allow: ['main', 'release/**', 'feature/*'] };
    expect(matchesBranch('main', filter)).toBe(true);
    expect(matchesBranch('release/v1', filter)).toBe(true);
    expect(matchesBranch('release/v1/beta', filter)).toBe(true);
    expect(matchesBranch('feature/login', filter)).toBe(true);
    expect(matchesBranch('feature/login/sub', filter)).toBe(false);
    expect(matchesBranch('hotfix/urgent', filter)).toBe(false);
  });
});
