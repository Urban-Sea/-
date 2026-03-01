/**
 * TOTP (RFC 6238) — Web Crypto API 実装
 * pyotp の代替。QR コードは Frontend で生成。
 */

const DIGITS = 6;
const PERIOD = 30;

/** Base32 デコード */
function base32Decode(input: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.replace(/[= ]/g, '').toUpperCase();
  const bits: number[] = [];
  for (const char of cleaned) {
    const val = alphabet.indexOf(char);
    if (val === -1) throw new Error('Invalid base32 character');
    bits.push(...[16, 8, 4, 2, 1].map(b => (val & b) ? 1 : 0));
  }
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = bits.slice(i * 8, (i + 1) * 8).reduce((acc, b) => (acc << 1) | b, 0);
  }
  return bytes;
}

/** Base32 エンコード */
function base32Encode(data: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of data) {
    bits += byte.toString(2).padStart(8, '0');
  }
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

/** ランダム Base32 シークレット生成 (pyotp.random_base32 相当) */
export function randomBase32(length: number = 32): string {
  const bytes = new Uint8Array(Math.ceil(length * 5 / 8));
  crypto.getRandomValues(bytes);
  return base32Encode(bytes).slice(0, length);
}

/** HOTP 計算 (RFC 4226) */
async function hotp(secret: Uint8Array, counter: bigint): Promise<string> {
  const counterBuf = new ArrayBuffer(8);
  const view = new DataView(counterBuf);
  view.setBigUint64(0, counter, false);

  const key = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, counterBuf);
  const macBytes = new Uint8Array(mac);

  // Dynamic truncation
  const offset = macBytes[macBytes.length - 1] & 0x0f;
  const code = (
    ((macBytes[offset] & 0x7f) << 24) |
    ((macBytes[offset + 1] & 0xff) << 16) |
    ((macBytes[offset + 2] & 0xff) << 8) |
    (macBytes[offset + 3] & 0xff)
  ) % (10 ** DIGITS);

  return code.toString().padStart(DIGITS, '0');
}

/** TOTP 生成 */
export async function generateTotp(secretBase32: string, timeStep?: number): Promise<string> {
  const secret = base32Decode(secretBase32);
  const counter = BigInt(Math.floor((timeStep ?? Math.floor(Date.now() / 1000)) / PERIOD));
  return hotp(secret, counter);
}

/** TOTP 検証 (valid_window=1: 前後30秒まで許容) */
export async function verifyTotp(
  secretBase32: string,
  code: string,
  validWindow: number = 1,
): Promise<boolean> {
  const secret = base32Decode(secretBase32);
  const now = Math.floor(Date.now() / 1000);
  const currentCounter = Math.floor(now / PERIOD);

  for (let i = -validWindow; i <= validWindow; i++) {
    const expected = await hotp(secret, BigInt(currentCounter + i));
    if (timingSafeEqualStr(code, expected)) {
      return true;
    }
  }
  return false;
}

/** otpauth:// URI 生成 (QRコード用) */
export function buildOtpUri(
  secretBase32: string,
  email: string,
  issuer: string = 'OpenRegime',
): string {
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedEmail = encodeURIComponent(email);
  return `otpauth://totp/${encodedIssuer}:${encodedEmail}?secret=${secretBase32}&issuer=${encodedIssuer}&digits=${DIGITS}&period=${PERIOD}`;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
