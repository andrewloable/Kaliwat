/**
 * Tests for the passphrase-encrypted export.
 * Uses iterations=1000 to keep tests fast (production uses 600_000).
 */
import { describe, it, expect } from 'vitest';
import { encryptData, decryptData, parseHeader, checkPassphraseStrength } from './encrypt';

const PASS = 'correct-horse-battery-staple-42!';
const LOW_ITER = 1_000; // fast for tests

function text(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe('encryptData / decryptData', () => {
  it('round-trip: encrypt then decrypt returns original data', async () => {
    const plain = text('Hello, GEDCOM world!');
    const cipher = await encryptData(plain, { passphrase: PASS, iterations: LOW_ITER });
    const result = await decryptData(cipher, PASS);
    expect(result instanceof Uint8Array).toBe(true);
    expect(new TextDecoder().decode(result as Uint8Array)).toBe('Hello, GEDCOM world!');
  });

  it('wrong passphrase → wrong-passphrase error', async () => {
    const cipher = await encryptData(text('secret'), { passphrase: PASS, iterations: LOW_ITER });
    const result = await decryptData(cipher, 'wrong-passphrase');
    expect((result as { kind: string }).kind).toBe('wrong-passphrase');
  });

  it('corrupt file (bad magic) → corrupt-file error', async () => {
    const cipher = await encryptData(text('data'), { passphrase: PASS, iterations: LOW_ITER });
    const corrupted = new Uint8Array(cipher);
    corrupted[0] = 0x00; // smash magic
    const result = await decryptData(corrupted, PASS);
    expect((result as { kind: string }).kind).toBe('corrupt-file');
  });

  it('corrupt file (truncated) → corrupt-file error', async () => {
    const result = await decryptData(new Uint8Array(10), PASS);
    expect((result as { kind: string }).kind).toBe('corrupt-file');
  });

  it('corrupt ciphertext (bit flip in body) → wrong-passphrase (GCM auth fail)', async () => {
    const cipher = await encryptData(text('data'), { passphrase: PASS, iterations: LOW_ITER });
    const corrupted = new Uint8Array(cipher);
    corrupted[corrupted.length - 5] ^= 0xff; // flip bits in ciphertext
    const result = await decryptData(corrupted, PASS);
    expect((result as { kind: string }).kind).toBe('wrong-passphrase');
  });

  it('empty plaintext round-trips correctly', async () => {
    const cipher = await encryptData(new Uint8Array(0), { passphrase: PASS, iterations: LOW_ITER });
    const result = await decryptData(cipher, PASS);
    expect(result instanceof Uint8Array).toBe(true);
    expect((result as Uint8Array).length).toBe(0);
  });

  it('large blob (>4MB) encrypts chunked and round-trips', async () => {
    const large = new Uint8Array(5 * 1024 * 1024); // 5 MB
    for (let i = 0; i < large.length; i++) large[i] = i & 0xff;
    const cipher = await encryptData(large, { passphrase: PASS, iterations: LOW_ITER });
    const result = await decryptData(cipher, PASS);
    expect(result instanceof Uint8Array).toBe(true);
    expect((result as Uint8Array).length).toBe(large.length);
    // spot-check a few bytes
    const r = result as Uint8Array;
    expect(r[0]).toBe(0);
    expect(r[255]).toBe(255);
    expect(r[4 * 1024 * 1024]).toBe((4 * 1024 * 1024) & 0xff);
  }, 30_000); // allow 30s for large blob test
});

describe('parseHeader()', () => {
  it('parses versioned header fields correctly', async () => {
    const cipher = await encryptData(text('x'), { passphrase: PASS, iterations: LOW_ITER });
    const header = parseHeader(cipher);
    expect('version' in header).toBe(true);
    if ('version' in header) {
      expect(header.version).toBe(1);
      expect(header.kdf).toBe(1);
      expect(header.iterations).toBe(LOW_ITER);
      expect(header.salt.length).toBe(16);
      expect(header.baseIv.length).toBe(12);
    }
  });

  it('rejects bad magic', () => {
    const bad = new Uint8Array(38);
    const h = parseHeader(bad);
    expect((h as { kind: string }).kind).toBe('corrupt-file');
  });
});

describe('checkPassphraseStrength()', () => {
  it('short passphrase → error', () => {
    expect(checkPassphraseStrength('short')).not.toBeNull();
  });

  it('all-lowercase 12+ chars → error (no complexity)', () => {
    expect(checkPassphraseStrength('aaaaaaaaaaaa')).not.toBeNull();
  });

  it('has uppercase → null (ok)', () => {
    expect(checkPassphraseStrength('LongEnoughPassphrase')).toBeNull();
  });

  it('has digit → null (ok)', () => {
    expect(checkPassphraseStrength('longpassword1234')).toBeNull();
  });

  it('has symbol → null (ok)', () => {
    expect(checkPassphraseStrength('longpassword!!')).toBeNull();
  });
});
