import { createDecipheriv, createCipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * The WeCom callback cipher (`WXBizMsgCrypt`): AES-256-CBC with a PKCS7 pad, a 16-byte random prefix, the message,
 * and the corp id as the plaintext tail — the signature is SHA1 over the sorted [token, timestamp, nonce, encrypted].
 *
 * This module is pure and dependency-free: `node:crypto` is everything the scheme needs, so the WeCom bridge stays
 * installable with nothing but Node — the one platform whose transport is plain HTTP(S), like Telegram's.
 *
 * Honest scope note: the vectors in its tests are round-trips through this same code, not official samples — the
 * official docs publish the algorithm, not a test vector a bridge can pin. The first live callback (the URL
 * verification echo) is the real verdict; it is logged in full so the operator can see exactly where it failed.
 */

/** The 43-char EncodingAESKey decodes (base64 + '=') to exactly 32 bytes — the AES-256 key. */
export const aesKeyFrom = encodingKey => {
  const key = Buffer.from(String(encodingKey ?? '') + '=', 'base64')
  if (key.length !== 32) {
    throw new Error(`EncodingAESKey must be 43 characters (decodes to 32 bytes), got key of ${key.length} bytes`)
  }
  return key
}

/** SHA1 over the sorted concatenation — the callback's signature check. */
export const signatureOf = (token, timestamp, nonce, encrypted) => createHash('sha1')
  .update([token, timestamp, nonce, encrypted].sort().join(''))
  .digest('hex')

/** PKCS7 unpad (block 32 here, as the scheme specifies) — a wrong pad reads as a malformed message, not empty. */
const unpadded = plain => {
  const pad = plain.at(-1)
  if (pad === undefined || pad < 1 || pad > 32 || pad > plain.length) {
    throw new Error('malformed PKCS7 padding in decrypted payload')
  }
  return plain.subarray(0, plain.length - pad)
}

/**
 * Decrypt one callback body: AES-256-CBC, then [16 random bytes][message xml][corpId] — and the corpId tail is
 * CHECKED, because a body from another corp decrypting by accident is exactly the kind of silent cross-talk a
 * signature alone does not rule out.
 */
export const decrypt = (aesKey, encryptedBase64, expectedCorpId) => {
  const decipher = createDecipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  const plain = Buffer.concat([decipher.update(Buffer.from(String(encryptedBase64 ?? ''), 'base64')), decipher.final()])
  const body = unpadded(plain)
  const message = body.subarray(16, body.length - expectedCorpId.length).toString('utf8')
  const corpId = body.subarray(body.length - expectedCorpId.length).toString('utf8')
  if (corpId !== expectedCorpId) {
    throw new Error(`callback corpId mismatch: got ${corpId}, expected ${expectedCorpId} — this key is not for this corp`)
  }
  return message
}

/** Encrypt a reply (passive mode): the same scheme, outbound. Kept for symmetry and for tests. */
export const encrypt = (aesKey, corpId, plainText) => {
  const payload = Buffer.concat([randomBytes(16), Buffer.from(String(plainText ?? ''), 'utf8'), Buffer.from(corpId, 'utf8')])
  const pad = 32 - (payload.length % 32)
  const padded = Buffer.concat([payload, Buffer.alloc(pad, pad)])
  const cipher = createCipheriv('aes-256-cbc', aesKey, aesKey.subarray(0, 16))
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
}

/**
 * The whole verification in one step: check the signature, decrypt, return the plaintext XML.
 * The signature check happens FIRST — decrypting an unsigned body is the "guard that looks present and does
 * nothing" shape, because the signature is the only thing binding the request to this app's token.
 */
export const verifiedDecrypt = ({ token, aesKey, corpId, timestamp, nonce, msgSignature, encrypted }) => {
  const expected = signatureOf(token, timestamp, nonce, encrypted)
  if (expected !== msgSignature) {
    throw new Error(`msg_signature mismatch: expected ${expected}, got ${msgSignature} — not from this app's callback config`)
  }
  return decrypt(aesKey, encrypted, corpId)
}
