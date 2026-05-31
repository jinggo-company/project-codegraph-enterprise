// MCP Server integration tests — T-2026-00134
// Tests for MCP tools with real SQLite index data (using sql.js)

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import initSqlJs from 'sql.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { LocalSqliteEngine } from '../src/index-engine/local.js';

// ─── Test SQLite helpers ───

async function createTestIndexFile(dir: string, projectId: string): Promise<string> {
  const projectDir = path.join(dir, projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  const dbPath = path.join(projectDir, 'index.db');

  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Create CodeGraph-style schema
  db.run(`
    CREATE TABLE symbols (
      name TEXT, kind TEXT, file TEXT, line INTEGER, column INTEGER,
      signature TEXT, documentation TEXT, language TEXT
    );
  `);
  db.run(`
    CREATE TABLE call_edges (
      caller TEXT, caller_file TEXT, caller_line INTEGER,
      callee TEXT, callee_file TEXT, callee_line INTEGER
    );
  `);
  db.run(`
    CREATE TABLE routes (
      method TEXT, path TEXT, handler TEXT, file TEXT, framework TEXT
    );
  `);
  db.run(`
    CREATE TABLE fts_content (
      file TEXT, line INTEGER, content TEXT
    );
  `);

  // Test symbols
  db.run("INSERT INTO symbols VALUES ('getUser', 'function', 'src/auth.ts', 10, 0, 'function getUser(id: string): User', 'Get user by ID', 'typescript')");
  db.run("INSERT INTO symbols VALUES ('User', 'class', 'src/types.ts', 5, 0, 'class User', 'User entity', 'typescript')");
  db.run("INSERT INTO symbols VALUES ('processOrder', 'function', 'src/orders.ts', 20, 0, 'function processOrder(order: Order): void', 'Process an order', 'typescript')");
  db.run("INSERT INTO symbols VALUES ('authenticate', 'function', 'src/auth.ts', 30, 0, 'function authenticate(req: Request): boolean', 'Authenticate request', 'typescript')");
  db.run("INSERT INTO symbols VALUES ('createUser', 'function', 'src/users.py', 15, 0, 'def create_user(name, email)', 'Create a new user', 'python')");

  // Test call edges
  db.run("INSERT INTO call_edges VALUES ('processOrder', 'src/orders.ts', 22, 'getUser', 'src/auth.ts', 10)");
  db.run("INSERT INTO call_edges VALUES ('processOrder', 'src/orders.ts', 25, 'authenticate', 'src/auth.ts', 30)");
  db.run("INSERT INTO call_edges VALUES ('getUser', 'src/auth.ts', 12, 'User', 'src/types.ts', 5)");
  db.run("INSERT INTO call_edges VALUES ('authenticate', 'src/auth.ts', 35, 'User', 'src/types.ts', 5)");
  db.run("INSERT INTO call_edges VALUES ('createUser', 'src/users.py', 18, 'User', 'src/types.ts', 5)");

  // Test routes
  db.run("INSERT INTO routes VALUES ('GET', '/api/users', 'getUsersHandler', 'src/routes/users.ts', 'express')");
  db.run("INSERT INTO routes VALUES ('POST', '/api/users', 'createUserHandler', 'src/routes/users.ts', 'express')");
  db.run("INSERT INTO routes VALUES ('GET', '/api/orders/:id', 'getOrderHandler', 'src/routes/orders.ts', 'fastify')");
  db.run("INSERT INTO routes VALUES ('DELETE', '/api/users/:id', 'deleteUserHandler', 'src/routes/users.ts', 'express')");

  // Test FTS content
  db.run("INSERT INTO fts_content VALUES ('src/auth.ts', 1, 'import { User } from \"./types\"; export function getUser(id) { ... }')");
  db.run("INSERT INTO fts_content VALUES ('src/orders.ts', 1, 'import { getUser } from \"./auth\"; export function processOrder(order) { ... }')");
  db.run("INSERT INTO fts_content VALUES ('src/auth.ts', 30, 'function authenticate(req) { return checkToken(req.headers.authorization); }')");

  // Write to disk
  const buffer = db.export();
  db.close();
  fs.writeFileSync(dbPath, Buffer.from(buffer));
  return dbPath;
}

// ─── MCP-002: search_code ───

describe('MCP-002: search_code', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns matching symbols by name', async () => {
    await engine.open('proj-001');
    const results = engine.searchCode('User');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.symbol === 'User')).toBe(true);
    expect(results.some((r) => r.symbol === 'getUser')).toBe(true);
  });

  it('filters by language', async () => {
    await engine.open('proj-001');
    const tsResults = engine.searchCode('create', { language: 'typescript' });
    const pyResults = engine.searchCode('create', { language: 'python' });
    expect(tsResults.length).toBe(0);
    expect(pyResults.length).toBe(1);
    expect(pyResults[0].symbol).toBe('createUser');
  });

  it('respects limit', async () => {
    await engine.open('proj-001');
    const results = engine.searchCode('', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ─── MCP-003: get_symbol ───

describe('MCP-003: get_symbol', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns symbol details', async () => {
    await engine.open('proj-001');
    const results = engine.getSymbol('getUser');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('getUser');
    expect(results[0].kind).toBe('function');
    expect(results[0].file).toBe('src/auth.ts');
    expect(results[0].line).toBe(10);
    expect(results[0].signature).toContain('getUser');
    expect(results[0].documentation).toContain('Get user by ID');
  });

  it('filters by kind', async () => {
    await engine.open('proj-001');
    expect(engine.getSymbol('User', { kind: 'function' }).length).toBe(0);
    expect(engine.getSymbol('User', { kind: 'class' }).length).toBe(1);
  });

  it('returns empty for unknown symbol', async () => {
    await engine.open('proj-001');
    expect(engine.getSymbol('nonexistentSymbol').length).toBe(0);
  });
});

// ─── MCP-004: get_callers ───

describe('MCP-004: get_callers', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns callers of a symbol', async () => {
    await engine.open('proj-001');
    const callers = engine.getCallers('getUser');
    expect(callers.length).toBe(1);
    expect(callers[0].caller).toBe('processOrder');
    expect(callers[0].callerFile).toBe('src/orders.ts');
  });

  it('returns empty for symbol with no callers', async () => {
    await engine.open('proj-001');
    expect(engine.getCallers('nonexistentSymbol').length).toBe(0);
  });
});

// ─── MCP-005: get_callees ───

describe('MCP-005: get_callees', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns callees of a symbol', async () => {
    await engine.open('proj-001');
    const callees = engine.getCallees('processOrder');
    expect(callees.length).toBe(2);
    const calleeNames = callees.map((c) => c.callee);
    expect(calleeNames).toContain('getUser');
    expect(calleeNames).toContain('authenticate');
  });

  it('returns empty for symbol with no callees', async () => {
    await engine.open('proj-001');
    expect(engine.getCallees('nonexistentSymbol').length).toBe(0);
  });
});

// ─── MCP-006: get_impact ───

describe('MCP-006: get_impact', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns BFS impact analysis', async () => {
    await engine.open('proj-001');
    const impact = engine.getImpact('processOrder');
    expect(impact.length).toBeGreaterThan(0);

    // Distance 1: direct callees
    const distance1 = impact.filter((i) => i.distance === 1);
    expect(distance1.some((i) => i.symbol === 'getUser')).toBe(true);
    expect(distance1.some((i) => i.symbol === 'authenticate')).toBe(true);

    // Distance 2: transitive callees
    const distance2 = impact.filter((i) => i.distance === 2);
    expect(distance2.some((i) => i.symbol === 'User')).toBe(true);
  });

  it('returns empty for unknown symbol', async () => {
    await engine.open('proj-001');
    expect(engine.getImpact('nonexistentSymbolXYZ').length).toBe(0);
  });
});

// ─── MCP-007: search_routes ───

describe('MCP-007: search_routes', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns all routes', async () => {
    await engine.open('proj-001');
    const routes = engine.searchRoutes();
    expect(routes.length).toBe(4);
  });

  it('filters by urlPattern', async () => {
    await engine.open('proj-001');
    expect(engine.searchRoutes({ urlPattern: '/api/users' }).length).toBe(3);
    expect(engine.searchRoutes({ urlPattern: '/api/orders' }).length).toBe(1);
  });

  it('filters by framework', async () => {
    await engine.open('proj-001');
    expect(engine.searchRoutes({ framework: 'express' }).length).toBe(3);
    expect(engine.searchRoutes({ framework: 'fastify' }).length).toBe(1);
  });
});

// ─── MCP-008: search_fulltext ───

describe('MCP-008: search_fulltext', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-001');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns LIKE fallback results', async () => {
    await engine.open('proj-001');
    const results = engine.searchFulltext('authenticate');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.content.includes('authenticate'))).toBe(true);
  });

  it('returns results for common keyword', async () => {
    await engine.open('proj-001');
    const results = engine.searchFulltext('import');
    expect(results.length).toBeGreaterThan(0);
  });

  it('respects limit', async () => {
    await engine.open('proj-001');
    const results = engine.searchFulltext('function', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ─── MCP-010: Multi-project isolation ───

describe('MCP-010: Multi-project isolation', () => {
  let tmpDir: string;
  let engine: LocalSqliteEngine;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
    engine = new LocalSqliteEngine(tmpDir);
    await createTestIndexFile(tmpDir, 'proj-alpha');
    await createTestIndexFile(tmpDir, 'proj-beta');
  });

  afterEach(() => {
    engine.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('isolates queries by project_id', async () => {
    await engine.open('proj-alpha');
    const alphaResults = engine.searchCode('User');
    engine.close();

    await engine.open('proj-beta');
    const betaResults = engine.searchCode('User');
    engine.close();

    // Both projects have identical test data
    expect(alphaResults.length).toBe(betaResults.length);
    expect(alphaResults.length).toBeGreaterThan(0);
  });

  it('throws when opening non-existent project', async () => {
    await expect(engine.open('nonexistent')).rejects.toThrow();
  });

  it('returns false for hasIndex on non-existent project', () => {
    expect(engine.hasIndex('nonexistent')).toBe(false);
  });
});

// ─── MCP-009: Protocol version ───

describe('MCP-009: Protocol compatibility', () => {
  it('McpServer constructor accepts name and version', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const server = new McpServer({
      name: 'codegraph-test',
      version: '0.0.1-test',
    });
    expect(server).toBeDefined();
    expect(server.server).toBeDefined();
  });
});
