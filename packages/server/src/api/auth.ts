import { Router, Request, Response } from 'express';
import { verifyMessage, isAddress, getAddress } from 'viem';
import * as crypto from 'crypto';
import {
  createAuthNonce,
  consumeAuthNonce,
  createAuthSession,
  getAuthSessionPlayerId,
  revokeAuthSession,
  revokeAllSessionsForPlayer,
} from '../db';

const router = Router();

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
// Session lifetime: 7 days by default (env-overridable). Shorter than the old
// 30 days so a leaked Bearer token has a bounded blast radius; combined with
// revoke-on-login (see /verify) a new sign-in also kills any prior token.
const SESSION_TTL_MS = (() => {
  const days = Number(process.env.SESSION_TTL_DAYS);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 24 * 60 * 60 * 1000;
})();

// SIWE binding is server-controlled — NEVER derived from the request's
// Origin/Referer (attacker-controllable). EIP-4361's domain/URI exist to bind a
// signature to THIS app; sourcing them from the caller defeats that. Set
// SIWE_DOMAIN / SIWE_URI in prod env; defaults match the canonical deployment.
const SIWE_DOMAIN = process.env.SIWE_DOMAIN || 'thirdlife.vercel.app';
const SIWE_URI = process.env.SIWE_URI || `https://${SIWE_DOMAIN}`;
const SIWE_CHAIN_ID = process.env.SIWE_CHAIN_ID || '1';
const SIWE_STATEMENT = 'Sign in to ThirdLife. By signing, you authenticate as the owner of this wallet.';

function buildSiweMessage(address: string, nonce: string, issuedAt: string): string {
  return [
    `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    ``,
    SIWE_STATEMENT,
    ``,
    `URI: ${SIWE_URI}`,
    `Version: 1`,
    `Chain ID: ${SIWE_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

router.post('/challenge', (req: Request, res: Response) => {
  const { address } = req.body ?? {};
  if (typeof address !== 'string' || !isAddress(address, { strict: false })) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  // EIP-4361 requires the address embedded in the SIWE message to be EIP-55
  // checksummed. Recent MetaMask versions reject the sign with "address does
  // not match the provided address for verification" when the message has a
  // lowercase address. getAddress() throws on invalid checksum; isAddress
  // above ran with strict:false so we accept any-case input then normalize.
  const checksummed = getAddress(address);
  const lc = checksummed.toLowerCase();
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + NONCE_TTL_MS;
  createAuthNonce(lc, nonce, expiresAt);

  // domain/URI/chainId are SERVER-controlled (SIWE_* env), not from the
  // request header — see the constant block. /verify rebuilds this exact
  // message and requires a byte-for-byte match, so a signature obtained for
  // any other domain/chain can't be replayed here.
  const issuedAt = new Date().toISOString();
  const message = buildSiweMessage(checksummed, nonce, issuedAt);
  // Return the checksummed address so the client uses the same case for
  // personal_sign's `from` param — MetaMask compares the two case-sensitively
  // when the message is in EIP-4361 format.
  return res.json({ message, address: checksummed, nonce, expiresAt });
});

router.post('/verify', async (req: Request, res: Response) => {
  const { address, message, signature } = req.body ?? {};
  if (typeof address !== 'string' || typeof message !== 'string' || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing fields' });
  }
  if (!isAddress(address, { strict: false })) {
    return res.status(400).json({ error: 'Invalid address' });
  }
  const checksummed = getAddress(address);
  const lc = checksummed.toLowerCase();

  // Pull the nonce + issued-at out of the submitted message.
  const nonceMatch = message.match(/\nNonce: ([a-f0-9]+)\n/);
  const issuedMatch = message.match(/\nIssued At: (.+)$/);
  if (!nonceMatch || !issuedMatch) {
    return res.status(400).json({ error: 'Malformed SIWE message' });
  }
  const nonce = nonceMatch[1];
  const issuedAt = issuedMatch[1];

  // Issued-At must be a valid timestamp inside the nonce TTL window (with a
  // small clock-skew allowance) — blocks stale/pre-dated message replay.
  const issuedMs = Date.parse(issuedAt);
  const SKEW_MS = 60 * 1000;
  if (!Number.isFinite(issuedMs) || issuedMs > Date.now() + SKEW_MS || issuedMs < Date.now() - NONCE_TTL_MS - SKEW_MS) {
    return res.status(400).json({ error: 'SIWE message issued-at is stale or invalid' });
  }

  // Full EIP-4361 binding check: rebuild the canonical message from the
  // SERVER's domain/URI/chainId/statement + the submitted address/nonce/
  // issuedAt and require an exact match. This enforces domain, URI, Chain ID,
  // Version, and statement all at once — a message signed for any other site
  // or chain will not match and is rejected.
  const expected = buildSiweMessage(checksummed, nonce, issuedAt);
  if (message !== expected) {
    return res.status(400).json({ error: 'SIWE message does not match expected domain/URI/chain binding' });
  }

  if (!consumeAuthNonce(lc, nonce)) {
    return res.status(400).json({ error: 'Invalid or expired nonce' });
  }

  let valid = false;
  try {
    valid = await verifyMessage({
      address: checksummed as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return res.status(400).json({ error: 'Invalid signature format' });
  }
  if (!valid) return res.status(401).json({ error: 'Signature does not match address' });

  // Fresh login revokes every prior session for this wallet, so a leaked older
  // token can't outlive the new sign-in ("one wallet, one live session" — also
  // enforced at the Colyseus layer via wallet-takeover).
  revokeAllSessionsForPlayer(lc);

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
