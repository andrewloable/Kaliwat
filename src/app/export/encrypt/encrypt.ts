/**
 * Passphrase-encrypted .gdz export.
 *
 * File format (versioned, big-endian):
 *   Offset  Len  Field
 *   0       4    magic: "KALI" (0x4b 0x41 0x4c 0x49)
 *   4       1    format version: 1
 *   5       1    KDF ID: 1 = PBKDF2-SHA256
 *   6       4    PBKDF2 iterations (BE u32)
 *   10      16   salt
 *   26      12   base IV (AES-GCM nonce)
 *   38      …    chunks: [4-byte len BE][ciphertext + 16-byte GCM auth tag] …
 *   last    4    terminator: 4 zero bytes
 *
 * Each chunk's IV = base_iv XOR (chunk_index as BE u32 in bytes 8–11).
 * Chunking avoids loading the entire blob into memory at once.
 */

const MAGIC = new Uint8Array([0x4b, 0x41, 0x4c, 0x49]); // "KALI"
const FORMAT_VERSION = 1;
const KDF_PBKDF2_SHA256 = 1;
const HEADER_SIZE = 38;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB

export interface EncryptOptions {
  passphrase: string;
  /** PBKDF2 iterations; default 600_000. Use lower only in tests. */
  iterations?: number;
}

export type DecryptError =
  | { kind: 'wrong-passphrase' }
  | { kind: 'corrupt-file'; detail: string };

// ── internals ─────────────────────────────────────────────────────────────────

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(passphrase);
  const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function chunkIv(baseIv: Uint8Array, idx: number): Uint8Array<ArrayBuffer> {
  const buf = new ArrayBuffer(12);
  const iv = new Uint8Array(buf);
  iv.set(baseIv);
  new DataView(buf).setUint32(8, new DataView(buf).getUint32(8) ^ idx);
  return iv;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Encrypt `data` with the given passphrase. Returns the full encrypted blob
 * including the versioned header.
 */
export async function encryptData(
  data: Uint8Array,
  opts: EncryptOptions,
): Promise<Uint8Array> {
  const iterations = opts.iterations ?? 600_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const baseIv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(opts.passphrase, salt, iterations);

  const header = new Uint8Array(HEADER_SIZE);
  header.set(MAGIC, 0);
  header[4] = FORMAT_VERSION;
  header[5] = KDF_PBKDF2_SHA256;
  new DataView(header.buffer).setUint32(6, iterations);
  header.set(salt, 10);
  header.set(baseIv, 26);

  const parts: Uint8Array[] = [header];
  let pos = 0, idx = 0;
  while (pos < data.length) {
    // Copy slice into a fresh ArrayBuffer so WebCrypto types are satisfied
    const sliceLen = Math.min(CHUNK_SIZE, data.length - pos);
    const sliceBuf = new ArrayBuffer(sliceLen);
    new Uint8Array(sliceBuf).set(data.subarray(pos, pos + sliceLen));
    const enc = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv: chunkIv(baseIv, idx) }, key, sliceBuf),
    );
    const lenBuf = new Uint8Array(4);
    new DataView(lenBuf.buffer).setUint32(0, enc.length);
    parts.push(lenBuf, enc);
    pos += CHUNK_SIZE;
    idx++;
  }
  parts.push(new Uint8Array(4)); // terminator

  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}

/**
 * Decrypt a blob previously produced by `encryptData`.
 * Returns the plaintext, or a typed error for wrong passphrase / corrupt file.
 */
export async function decryptData(
  data: Uint8Array,
  passphrase: string,
): Promise<Uint8Array | DecryptError> {
  if (data.length < HEADER_SIZE)
    return { kind: 'corrupt-file', detail: 'too short' };
  for (let i = 0; i < 4; i++)
    if (data[i] !== MAGIC[i]) return { kind: 'corrupt-file', detail: 'bad magic' };
  if (data[4] !== FORMAT_VERSION)
    return { kind: 'corrupt-file', detail: `unknown version ${data[4]}` };
  if (data[5] !== KDF_PBKDF2_SHA256)
    return { kind: 'corrupt-file', detail: `unknown KDF ${data[5]}` };

  const dv = new DataView(data.buffer, data.byteOffset);
  const iterations = dv.getUint32(6);
  const saltBuf = new ArrayBuffer(16); new Uint8Array(saltBuf).set(data.subarray(10, 26));
  const salt = new Uint8Array(saltBuf);
  const ivBuf = new ArrayBuffer(12); new Uint8Array(ivBuf).set(data.subarray(26, 38));
  const baseIv = new Uint8Array(ivBuf);

  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, salt, iterations);
  } catch {
    return { kind: 'wrong-passphrase' };
  }

  const plains: Uint8Array[] = [];
  let pos = HEADER_SIZE, idx = 0;

  while (pos < data.length) {
    if (pos + 4 > data.length)
      return { kind: 'corrupt-file', detail: 'truncated chunk length' };
    const len = dv.getUint32(pos); pos += 4;
    if (len === 0) break;
    if (pos + len > data.length)
      return { kind: 'corrupt-file', detail: 'truncated chunk body' };

    const cipherBuf = new ArrayBuffer(len);
    new Uint8Array(cipherBuf).set(data.subarray(pos, pos + len));
    pos += len;
    let plain: ArrayBuffer;
    try {
      plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunkIv(baseIv, idx) }, key, cipherBuf,
      );
    } catch {
      // GCM auth failure = wrong passphrase (we already validated magic above)
      return { kind: 'wrong-passphrase' };
    }
    plains.push(new Uint8Array(plain));
    idx++;
  }

  const total = plains.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of plains) { out.set(p, w); w += p.length; }
  return out;
}

/** Parse and validate a versioned header without decrypting. */
export function parseHeader(data: Uint8Array): {
  version: number;
  kdf: number;
  iterations: number;
  salt: Uint8Array;
  baseIv: Uint8Array;
} | DecryptError {
  if (data.length < HEADER_SIZE) return { kind: 'corrupt-file', detail: 'too short' };
  for (let i = 0; i < 4; i++)
    if (data[i] !== MAGIC[i]) return { kind: 'corrupt-file', detail: 'bad magic' };
  const dv = new DataView(data.buffer, data.byteOffset);
  return {
    version: data[4],
    kdf: data[5],
    iterations: dv.getUint32(6),
    salt: new Uint8Array(data.buffer.slice(data.byteOffset + 10, data.byteOffset + 26)),
    baseIv: new Uint8Array(data.buffer.slice(data.byteOffset + 26, data.byteOffset + 38)),
  };
}

/** Returns null if passphrase is strong enough; else an explanation string. */
export function checkPassphraseStrength(p: string): string | null {
  if (p.length < 12) return 'Passphrase must be at least 12 characters.';
  const hasUpper = /[A-Z]/.test(p);
  const hasDigit = /[0-9]/.test(p);
  const hasSymbol = /[^a-zA-Z0-9]/.test(p);
  if (!hasUpper && !hasDigit && !hasSymbol)
    return 'Add uppercase letters, numbers, or symbols for a stronger passphrase.';
  return null;
}
