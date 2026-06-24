/**
 * Cookie-based authentication for Arcade's internal extension API.
 * Reads session cookies from a file and handles Firebase token refresh.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as logger from '../util/logger.js';

function getFirebaseApiKey(): string {
  // Try reading from file first (saved by get-arcade-cookie.sh)
  const keyFile = process.env.ARCADE_FIREBASE_KEY_FILE ?? join(homedir(), '.arcade-firebase-key');
  if (existsSync(keyFile)) {
    const key = readFileSync(keyFile, 'utf-8').trim();
    if (key) return key;
  }

  // Try env var
  if (process.env.ARCADE_FIREBASE_API_KEY) {
    return process.env.ARCADE_FIREBASE_API_KEY;
  }

  throw new Error(
    'Firebase API key not found. Either:\n' +
    '  - Run scripts/get-arcade-cookie.sh (with Chrome closed) to extract it, or\n' +
    '  - Set ARCADE_FIREBASE_API_KEY env var, or\n' +
    '  - Save it to ~/.arcade-firebase-key\n' +
    '\n' +
    'To find the key manually: open app.arcade.software, DevTools -> Sources,\n' +
    'search for "AIzaSy" in the JS bundles.',
  );
}

export interface ArcadeAuth {
  cookie: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokensPayload {
  idToken: string;
  refreshToken: string;
}

function extractTokensFromCookie(cookie: string): TokensPayload {
  const match = cookie.match(/ArcadeApp\.AuthUserTokens=([^;]+)/);
  if (!match) {
    throw new Error('ArcadeApp.AuthUserTokens not found in cookie. Make sure you copied the full cookie header.');
  }

  const decoded = Buffer.from(match[1], 'base64').toString('utf-8');
  const parsed = JSON.parse(JSON.parse(decoded)) as TokensPayload;

  if (!parsed.idToken || !parsed.refreshToken) {
    throw new Error('Cookie is missing idToken or refreshToken');
  }

  return parsed;
}

function getTokenExpiry(idToken: string): number {
  const parts = idToken.split('.');
  if (parts.length !== 3) return 0;
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as { exp: number };
  return payload.exp * 1000;
}

function rebuildCookieWithNewTokens(originalCookie: string, tokens: TokensPayload): string {
  const newTokensJson = JSON.stringify(tokens);
  const newTokensB64 = Buffer.from(JSON.stringify(newTokensJson)).toString('base64');

  return originalCookie.replace(
    /ArcadeApp\.AuthUserTokens=[^;]+/,
    `ArcadeApp.AuthUserTokens=${newTokensB64}`,
  );
}

export function loadAuth(cookieFilePath: string): ArcadeAuth {
  const cookie = readFileSync(cookieFilePath, 'utf-8').trim();
  if (!cookie) {
    throw new Error(`Cookie file is empty: ${cookieFilePath}`);
  }

  const tokens = extractTokensFromCookie(cookie);
  const expiresAt = getTokenExpiry(tokens.idToken);

  logger.info('Loaded Arcade auth', {
    expiresAt: new Date(expiresAt).toISOString(),
    remainingMs: expiresAt - Date.now(),
  });

  return { cookie, idToken: tokens.idToken, refreshToken: tokens.refreshToken, expiresAt };
}

export async function refreshAuth(auth: ArcadeAuth): Promise<ArcadeAuth> {
  logger.info('Refreshing Arcade auth token...');

  const apiKey = getFirebaseApiKey();
  const tokenRefreshUrl = `https://securetoken.googleapis.com/v1/token?key=${apiKey}`;

  const response = await fetch(tokenRefreshUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Token refresh failed: ${response.status} ${body}`);
  }

  const data = await response.json() as { id_token: string; refresh_token: string };

  const newTokens: TokensPayload = {
    idToken: data.id_token,
    refreshToken: data.refresh_token,
  };

  const newCookie = rebuildCookieWithNewTokens(auth.cookie, newTokens);
  const expiresAt = getTokenExpiry(newTokens.idToken);

  logger.info('Token refreshed', {
    expiresAt: new Date(expiresAt).toISOString(),
    remainingMs: expiresAt - Date.now(),
  });

  return { cookie: newCookie, idToken: newTokens.idToken, refreshToken: newTokens.refreshToken, expiresAt };
}

export async function ensureValidAuth(auth: ArcadeAuth): Promise<ArcadeAuth> {
  const bufferMs = 5 * 60 * 1000; // refresh 5 min before expiry
  if (Date.now() + bufferMs >= auth.expiresAt) {
    return refreshAuth(auth);
  }
  return auth;
}
