/**
 * Google でログインしたときにもらう ID トークン（JWT）を確かめる。
 * 署名は Google の公開鍵（JWKS）で RS256 を検証し、発行元・宛先・期限も見る。
 */

const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let cachedKeys = null; // { keys: Map<kid, CryptoKey>, until: ms }

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const decodeJson = (part) => JSON.parse(new TextDecoder().decode(b64urlToBytes(part)));

/** Google の公開鍵を取ってくる（Cache-Control の間は覚えておく）。 */
async function googleKeys(fetchImpl) {
  if (cachedKeys && cachedKeys.until > Date.now()) return cachedKeys.keys;
  const res = await fetchImpl(JWKS_URL);
  if (!res.ok) throw new Error(`公開鍵を取れませんでした (${res.status})`);
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  const { keys } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== 'RSA') continue;
    map.set(jwk.kid, await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    ));
  }
  cachedKeys = { keys: map, until: Date.now() + maxAge * 1000 };
  return map;
}

/** テストで鍵の覚えを消すため。 */
export function resetKeyCache() { cachedKeys = null; }

/**
 * ID トークンを確かめ、中身（sub・email・name・picture）を返す。だめなら例外。
 * @param {string} token
 * @param {string} clientId この Web アプリの OAuth クライアント ID（宛先 aud と一致すること）
 * @param {object} [opts] { fetch, now }（テスト用）
 */
export async function verifyGoogleIdToken(token, clientId, opts = {}) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID が設定されていません');
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('トークンの形が違います');
  const [h, p, sig] = parts;
  const header = decodeJson(h);
  if (header.alg !== 'RS256') throw new Error('署名の方式が違います');
  const keys = await googleKeys(opts.fetch ?? fetch);
  const key = keys.get(header.kid);
  if (!key) throw new Error('署名の鍵が見つかりません');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new Error('署名が合いません');
  const claims = decodeJson(p);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (!ISSUERS.includes(claims.iss)) throw new Error('発行元が違います');
  if (claims.aud !== clientId) throw new Error('宛先が違います');
  if (typeof claims.exp !== 'number' || claims.exp < now - 60) throw new Error('期限が切れています');
  if (!claims.sub) throw new Error('アカウント ID がありません');
  return {
    sub: String(claims.sub),
    email: claims.email_verified === false ? null : (claims.email ?? null),
    name: claims.name ?? null,
    picture: claims.picture ?? null,
  };
}
