/**
 * @fileoverview AES-256-GCM encryption helpers for securing mnemonic phrases at rest.
 *
 * Security Model:
 * - Key Derivation: scrypt with high cost parameters (N=2^17, r=8, p=1) to resist
 *   brute-force and hardware attacks. Each encryption uses a unique 32-byte salt.
 * - Encryption: AES-256-GCM provides authenticated encryption, ensuring both
 *   confidentiality and integrity. A unique 12-byte IV is generated per encryption.
 * - Output Format: `salt:iv:authTag:ciphertext` (all base64-encoded)
 *
 * The salt prevents rainbow table attacks on the password.
 * The IV ensures identical plaintexts produce different ciphertexts.
 * The authTag (16 bytes) detects any tampering with the ciphertext.
 *
 * @module crypto
 */

import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "crypto";

/** AES-256-GCM requires a 256-bit (32-byte) key */
const KEY_LENGTH = 32;

/** GCM recommended IV length is 96 bits (12 bytes) */
const IV_LENGTH = 12;

/** Salt length for scrypt key derivation */
const SALT_LENGTH = 32;

/** GCM authentication tag length */
const AUTH_TAG_LENGTH = 16;

/**
 * scrypt cost parameters (N=2^17, r=8, p=1)
 * - N (cost): 131072 iterations - high to resist GPU/ASIC attacks
 * - r (blockSize): 8 - memory hardness factor
 * - p (parallelization): 1 - sequential to prevent parallel attacks
 */
const SCRYPT_OPTIONS = {
  N: 2 ** 17, // 131072
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024, // 256 MB max memory
};

/**
 * Derives a 256-bit encryption key from a password using scrypt.
 *
 * @param password - The user's password
 * @param salt - A unique salt for this derivation
 * @returns A 32-byte key suitable for AES-256
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
}

/**
 * Encrypts a mnemonic phrase using AES-256-GCM with a password-derived key.
 *
 * The encryption process:
 * 1. Generate a random 32-byte salt
 * 2. Derive a 256-bit key from the password using scrypt
 * 3. Generate a random 12-byte IV
 * 4. Encrypt the mnemonic using AES-256-GCM
 * 5. Combine salt, IV, auth tag, and ciphertext into the output format
 *
 * @param mnemonic - The mnemonic phrase to encrypt (BIP-39 seed phrase)
 * @param password - The password to derive the encryption key from
 * @returns Base64-encoded string in format `salt:iv:authTag:ciphertext`
 * @throws {Error} If encryption fails
 *
 * @example
 * ```typescript
 * const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
 * const encrypted = encryptMnemonic(mnemonic, "my-secure-password");
 * // Returns: "base64salt:base64iv:base64tag:base64ciphertext"
 * ```
 */
export function encryptMnemonic(mnemonic: string, password: string): string {
  // Generate cryptographically secure random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);

  // Derive encryption key from password
  const key = deriveKey(password, salt);

  // Create cipher and encrypt
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(mnemonic, "utf8"),
    cipher.final(),
  ]);

  // Get the authentication tag
  const authTag = cipher.getAuthTag();

  // Format: salt:iv:authTag:ciphertext (all base64)
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    authTag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

/**
 * Decrypts an encrypted mnemonic phrase using AES-256-GCM.
 *
 * The decryption process:
 * 1. Parse the encrypted string to extract salt, IV, auth tag, and ciphertext
 * 2. Derive the same key from the password using the stored salt
 * 3. Decrypt and verify authenticity using GCM
 *
 * @param encrypted - The encrypted string in format `salt:iv:authTag:ciphertext`
 * @param password - The password used during encryption
 * @returns The original mnemonic phrase
 * @throws {Error} If the format is invalid, password is wrong, or data is tampered
 *
 * @example
 * ```typescript
 * const encrypted = "base64salt:base64iv:base64tag:base64ciphertext";
 * const mnemonic = decryptMnemonic(encrypted, "my-secure-password");
 * // Returns: "abandon abandon abandon ..."
 * ```
 */
export function decryptMnemonic(encrypted: string, password: string): string {
  // Parse the encrypted format
  const parts = encrypted.split(":");

  if (parts.length !== 4) {
    throw new Error(
      "Invalid encrypted format. Expected: salt:iv:authTag:ciphertext"
    );
  }

  const [saltB64, ivB64, authTagB64, ciphertextB64] = parts;

  // Decode from base64
  const salt = Buffer.from(saltB64, "base64");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");

  // Validate component lengths
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Invalid salt length: expected ${SALT_LENGTH}, got ${salt.length}`);
  }
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH}, got ${iv.length}`);
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error(`Invalid auth tag length: expected ${AUTH_TAG_LENGTH}, got ${authTag.length}`);
  }

  // Derive the same key from password
  const key = deriveKey(password, salt);

  // Create decipher and set auth tag
  const decipher = createDecipheriv("aes-256-gcm", key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  // Decrypt and verify authenticity
  try {
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (error) {
    // GCM will throw if auth tag doesn't match (wrong password or tampered data)
    throw new Error(
      "Decryption failed: invalid password or corrupted data"
    );
  }
}
