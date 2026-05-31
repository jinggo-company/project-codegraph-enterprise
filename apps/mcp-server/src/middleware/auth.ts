/**
 * API Key authentication middleware for MCP server.
 *
 * Validates that incoming MCP requests carry a valid API key.
 * The key is checked via the `x-api-key` header or MCP initialization params.
 */

import crypto from 'node:crypto';

export interface AuthContext {
  /** API key hash for comparison */
  keyHash: string;
}

/**
 * Hash an API key (one-way, for storage/comparison).
 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key against a stored key or hash.
 * If storedKey is a 64-char hex string, treat it as SHA-256 hash.
 * Otherwise, do a direct string comparison.
 */
export function validateApiKey(candidate: string, storedKey: string): boolean {
  const isHexHash = /^[0-9a-f]{64}$/i.test(storedKey);
  if (isHexHash) {
    const candidateHash = hashApiKey(candidate);
    return crypto.timingSafeEqual(
      Buffer.from(candidateHash, 'hex'),
      Buffer.from(storedKey, 'hex'),
    );
  }
  return candidate === storedKey;
}

/**
 * Extract API key from a request-like object.
 * Checks x-api-key header first, then falls back to _meta.
 */
export function extractApiKey(headers?: Record<string, unknown>): string | null {
  if (headers?.['x-api-key'] && typeof headers['x-api-key'] === 'string') {
    return headers['x-api-key'] as string;
  }
  if (headers?.['X-Api-Key'] && typeof headers['X-Api-Key'] === 'string') {
    return headers['X-Api-Key'] as string;
  }
  if (headers?.['apiKey'] && typeof headers['apiKey'] === 'string') {
    return headers['apiKey'] as string;
  }
  return null;
}

/**
 * Check if auth is required (API key is configured).
 */
export function isAuthRequired(apiKey: string): boolean {
  return apiKey.length > 0;
}
