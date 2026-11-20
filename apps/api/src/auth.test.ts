// Real token checks with locally made keys: proves we enforce issuer, audience, expiry and signature.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { firebaseVerifier, bearerToken } from './auth';

const PROJECT = 'technews-test';

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const verify = firebaseVerifier(PROJECT, createLocalJWKSet({ keys: [jwk] }));
  const sign = (claims: { iss?: string; aud?: string; exp?: string; sub?: string } = {}, key = privateKey) =>
    new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(claims.iss ?? `https://securetoken.google.com/${PROJECT}`)
      .setAudience(claims.aud ?? PROJECT)
      .setSubject(claims.sub ?? 'user-123')
      .setIssuedAt()
      .setExpirationTime(claims.exp ?? '1h')
      .sign(key);
  return { verify, sign };
}

test('accepts a valid Firebase-style token', async () => {
  const { verify, sign } = await setup();
  assert.deepEqual(await verify(await sign()), { uid: 'user-123' });
});

test('rejects wrong project, wrong issuer, expired, or forged tokens', async () => {
  const { verify, sign } = await setup();
  const other = await generateKeyPair('RS256');
  for (const token of [
    await sign({ aud: 'someone-elses-project' }),
    await sign({ iss: 'https://evil.example.com' }),
    await sign({ exp: '-1m' }),
    await sign({}, other.privateKey), // signed by a key Google never published
  ]) {
    await assert.rejects(verify(token), { code: 'unauthorized' });
  }
});

test('without a project id, sign-in reports "not configured" instead of failing silently', async () => {
  await assert.rejects(firebaseVerifier('')('anything'), { code: 'auth_not_configured' });
});

test('reads the Bearer header', () => {
  assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
  assert.equal(bearerToken('Basic abc'), null);
  assert.equal(bearerToken(undefined), null);
});
