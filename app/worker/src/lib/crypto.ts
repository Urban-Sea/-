/**
 * AES-256-GCM 暗号化/復号 — Web Crypto API
 * admin_mfa.py の _encrypt_secret / _decrypt_secret のポート
 * 保存形式: nonce_hex:ciphertext_hex (Python と互換)
 */

/** 16進数文字列をバイト配列に変換 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** バイト配列を16進数文字列に変換 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** AES-256-GCM で暗号化 → "nonce_hex:ciphertext_hex" */
export async function encryptSecret(plaintext: string, keyHex: string): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt']);

  const nonce = new Uint8Array(12); // 96-bit nonce
  crypto.getRandomValues(nonce);

  const plaintextBytes = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintextBytes,
  );

  return `${bytesToHex(nonce)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}

/** "nonce_hex:ciphertext_hex" を AES-256-GCM で復号 */
export async function decryptSecret(encrypted: string, keyHex: string): Promise<string> {
  const [nonceHex, ciphertextHex] = encrypted.split(':');
  if (!nonceHex || !ciphertextHex) {
    throw new Error('Invalid encrypted format');
  }

  const keyBytes = hexToBytes(keyHex);
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);

  const nonce = hexToBytes(nonceHex);
  const ciphertext = hexToBytes(ciphertextHex);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plaintext);
}
