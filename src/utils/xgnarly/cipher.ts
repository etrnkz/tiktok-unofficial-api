// MIT License — adapted from haig233/tiktok-xgnarly-decoded
// ChaCha-flavor stream cipher used to encrypt the X-Gnarly payload.
// NOT RFC 8439 ChaCha20 — uses custom sigma constants and variable rounds.

const SIGMA = [1196819126, 600974999, 3863347763, 1451689750]

const u32 = (x: number) => x >>> 0
const rotl = (v: number, c: number) => u32((v << c) | (v >>> (32 - c)))

function quarter(s: number[], a: number, b: number, c: number, d: number): void {
  s[a] = u32(s[a] + s[b])
  s[d] = rotl(s[d] ^ s[a], 16)
  s[c] = u32(s[c] + s[d])
  s[b] = rotl(s[b] ^ s[c], 12)
  s[a] = u32(s[a] + s[b])
  s[d] = rotl(s[d] ^ s[a], 8)
  s[c] = u32(s[c] + s[d])
  s[b] = rotl(s[b] ^ s[c], 7)
}

function chachaBlock(initial: number[], rounds: number): number[] {
  const s = initial.slice()
  let r = 0
  while (r < rounds) {
    quarter(s, 0, 4, 8, 12)
    quarter(s, 1, 5, 9, 13)
    quarter(s, 2, 6, 10, 14)
    quarter(s, 3, 7, 11, 15)
    if (++r >= rounds) break
    quarter(s, 0, 5, 10, 15)
    quarter(s, 1, 6, 11, 12)
    quarter(s, 2, 7, 12, 13)
    quarter(s, 3, 4, 13, 14)
    r++
  }
  for (let i = 0; i < 16; i++) s[i] = u32(s[i] + initial[i])
  return s
}

export function chachaXor(bytes: Uint8Array, keyWords: number[], rounds: number): Uint8Array {
  const state = [...SIGMA, ...keyWords]
  for (let off = 0; off < bytes.length; off += 64) {
    const stream = chachaBlock(state, rounds)
    state[12] = u32(state[12] + 1)
    const lim = Math.min(64, bytes.length - off)
    for (let i = 0; i < lim; i++) {
      const word = stream[i >>> 2]
      const byte_ = (word >>> (8 * (i & 3))) & 0xff
      bytes[off + i] ^= byte_
    }
  }
  return bytes
}

export function deriveRounds(keyWords: number[]): number {
  let r = 0
  for (const w of keyWords) r = (r + (w & 15)) & 15
  return r + 5
}
