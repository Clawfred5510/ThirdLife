import { Router, Request, Response } from 'express';
import { verifyMessage, isAddress } from 'viem';
import * as crypto from 'crypto';
import {
  createAuthNonce,
  consumeAuthNonce,
  createAuthSession,
  getAuthSessionPlayerId,
  revokeAuthSession,
} from '../db';

const router = Router();

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function buildSiweMessage(address: string, nonce: string, domain: string, uri: string): string {
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    ``,
    `Sign in to ThirdLife. By signing, you authenticate as the owner of this wallet.`,
    ``,
    `URI: ${uri}`,
    `Version: 1`,
    `Chain ID: 1`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join('\n');
}

router.post('/challenge', (req: Request, res: Response) => {
  const { address } = req.body ?? {};
  if (typeof address !== 'string' || !isAddress(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  const lc = address.toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + NONCE_TTL_MS;
  createAuthNonce(lc, nonce, expiresAt);

  // Domain + URI come from the request so dev/prod both get correct binding.
  const host = req.get('origin') || req.get('referer') || 'thirdlife.vercel.app';
  const url = (() => { try { return new URL(host); } catch { return null; } })();
  const domain = url?.host ?? 'thirdlife.vercel.app';
  const uri = url?.origin ?? 'https://thirdlife.vercel.app';

  const message = buildSiweMessage(address, nonce, domain, uri);
  return res.json({ message, nonce, expiresAt });
});

router.post('/verify', async (req: Request, res: Response) => {
  const { address, message, signature } = req.body ?? {};
  if (typeof address !== 'string' || typeof message !== 'string' || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!isAddress(address)) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  const lc = address.toLowerCase();

  const m = message.match(/Nonce: ([a-f0-9]+)/);
  if (!m) return res.status(400).json({ error: 'Malformed message: no nonce' });
  const nonce = m[1];
  const messageContainsAddress = message.includes(address) || message.includes(lc);
  if (!messageContainsAddress) {
    return res.status(400).json({ error: 'Message does not bind to address' });
  }

  if (!consumeAuthNonce(lc, nonce)) {
    return res.status(400).json({ error: 'Invalid or expired nonce' });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return res.status(400).json({ error: 'Invalid signature format' });
  }
  if (!valid) return res.status(401).json({ error: 'Signature does not match address' });

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  createAuthSession(token, lc, expiresAt);
  return res.json({ token, playerId: lc, expiresAt });
});

router.post('/logout', (req: Request, res: Response) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.body?.token as string | undefined);
  if (typeof token === 'string' && token.length > 0) {
    revokeAuthSession(token);
  }
  return res.json({ ok: true });
});

router.get('/whoami', (req: Request, res: Response) => {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.json({ playerId: null });
  const playerId = getAuthSessionPlayerId(token);
  return res.json({ playerId });
});

export default router;
