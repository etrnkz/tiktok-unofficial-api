// MIT License — adapted from haig233/tiktok-xgnarly-decoded
// X-Gnarly URL parameter value encoder

import { randomBytes, createHash } from 'crypto'
import { encodeBase64 } from './alphabet'
import { chachaXor, deriveRounds } from './cipher'
import { encodePayload } from './payload'

const MAGIC_BYTE = 75

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')

export interface XGnarlyCounters {
  totalXHRRequests?: number
  totalFetchRequests?: number
  interceptedXHRRequests?: number
  interceptedFetchRequests?: number
}

export interface XGnarlyOptions {
  ubcode?: number
  sdkVersion?: string
  timestampMs?: number
  randomKey?: Buffer
  randomLow16?: Buffer
  random32?: Buffer
}

export function encodeXGnarly(
  queryString: string,
  body: string,
  userAgent: string,
  counters: XGnarlyCounters = {},
  options: XGnarlyOptions = {},
): string {
  const ts = options.timestampMs ?? Date.now()
  const ubcode = options.ubcode ?? 4
  const sdkVersion = options.sdkVersion ?? '1.0.0.368'

  const r14LowBytes = options.randomLow16 ?? randomBytes(2)
  const field14 = (65 << 16) | (r14LowBytes[0] << 8) | r14LowBytes[1]

  const r15Bytes = options.random32 ?? randomBytes(4)
  const field15 = ((r15Bytes[0] << 24) | (r15Bytes[1] << 16) | (r15Bytes[2] << 8) | r15Bytes[3]) >>> 0

  const fields = {
    1: 65,
    2: ubcode,
    3: md5(queryString),
    4: md5(body),
    5: md5(userAgent),
    6: Math.floor(ts / 1000),
    7: 3181061566,
    8: ts % 0x80000000,
    9: '5.1.3-ZTCA',
    10: sdkVersion,
    11: 1,
    12: (counters.totalXHRRequests ?? 0) + (counters.totalFetchRequests ?? 0),
    13: (counters.interceptedXHRRequests ?? 0) + (counters.interceptedFetchRequests ?? 0),
    14: field14,
    15: field15,
  }

  const plaintext = encodePayload(fields)
  const keyBytes = options.randomKey ?? randomBytes(48)
  const keyWords = new Array(12)
  for (let i = 0; i < 12; i++) {
    const o = i * 4
    keyWords[i] = ((keyBytes[o] | (keyBytes[o + 1] << 8) | (keyBytes[o + 2] << 16) | (keyBytes[o + 3] << 24)) >>> 0)
  }
  const rounds = deriveRounds(keyWords)

  const cipher = new Uint8Array(plaintext)
  chachaXor(cipher, keyWords, rounds)

  const xLen = cipher.length
  const mod = xLen + 1
  let sum = 0
  for (const b of keyBytes) sum = (sum + b) % mod
  for (const b of cipher) sum = (sum + b) % mod
  const insertPos = sum

  const out = new Uint8Array(1 + xLen + 48)
  out[0] = MAGIC_BYTE
  out.set(cipher.subarray(0, insertPos), 1)
  out.set(keyBytes, 1 + insertPos)
  out.set(cipher.subarray(insertPos), 1 + insertPos + 48)

  return encodeBase64(out)
}
