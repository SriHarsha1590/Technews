// Checks Firebase ID tokens without the Firebase Admin SDK or a service account:
// Firebase signs them with Google's public keys, which jose fetches and caches.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

export type VerifyToken = (token: string) => Promise<{ uid: string }>;

export class AuthError extends Error {
  constructor(message: string, readonly code: 'unauthorized' | 'auth_not_configured') {
    super(message);
  }
}

const GOOGLE_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export function firebaseVerifier(projectId: string, keys: JWTVerifyGetKey = createRemoteJWKSet(new URL(GOOGLE_KEYS))): VerifyToken {
  if (!projectId) {
    return async () => {
      throw new AuthError('Sign-in is not set up on this server (FIREBASE_PROJECT_ID is empty)', 'auth_not_configured');
    };
  }
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
        algorithms: ['RS256'],
      });
      if (!payload.sub) throw new Error('token has no subject');
      return { uid: payload.sub };
    } catch {
      throw new AuthError('Your sign-in has expired or is invalid; sign in again', 'unauthorized');
    }
  };
}

export function bearerToken(header: string | undefined): string | null {
  const m = header?.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}
