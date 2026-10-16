// MIT License — adapted from haig233/tiktok-xgnarly-decoded
// 16-field TLV payload encoder/decoder for X-Gnarly

const FIELD_ORDER = [1, 2, 6, 7, 8, 9, 10, 11, 4, 5, 3, 12, 13, 14, 15, 0]

function intToBytes(n: number): Uint8Array {
  if (n < 0 || !Number.isInteger(n)) throw new Error("non-int")
  if (n === 0) return Uint8Array.of(0)
  const out: number[] = []
  while (n > 0) {
    out.unshift(n & 0xff)
    n = Math.floor(n / 256)
  }
  return Uint8Array.from(out)
}

export interface XGnarlyFields {
  [key: number]: number | string
}

export function encodePayload(fields: XGnarlyFields): Uint8Array {
  const present: number[] = []
  for (const k of FIELD_ORDER) {
    if (k === 0) continue
    if (fields[k] === undefined) continue
    present.push(k)
  }

  let xorHeader = 0
  for (const k of present) {
    const v = fields[k]
    if (typeof v === "number") xorHeader = (xorHeader ^ v) >>> 0
  }

  const order = [...present, 0]
  const fieldsWith0: XGnarlyFields = { ...fields, 0: xorHeader }

  const out: number[] = [fieldsWith0[0] !== undefined ? order.length : present.length]
  for (const k of order) {
    const v = fieldsWith0[k]
    let valueBytes: Uint8Array
    if (typeof v === "number") {
      valueBytes = intToBytes(v)
    } else if (typeof v === "string") {
      valueBytes = new TextEncoder().encode(v)
    } else {
      throw new Error(`unsupported field ${k} type: ${typeof v}`)
    }
    out.push(k & 0xff)
    const len = valueBytes.length
    out.push((len >>> 8) & 0xff, len & 0xff)
    for (const b of valueBytes) out.push(b)
  }
  return Uint8Array.from(out)
}

export function decodePayload(bytes: Uint8Array): XGnarlyFields {
  const fields: XGnarlyFields = {}
  if (bytes.length === 0) return fields
  let p = 0
  const count = bytes[p++]
  let parsed = 0
  while (p + 3 <= bytes.length && parsed < count) {
    const key = bytes[p++]
    const len = (bytes[p] << 8) | bytes[p + 1]
    p += 2
    if (p + len > bytes.length) break
    const value = bytes.slice(p, p + len)
    p += len
    if (len <= 4) {
      let n = 0
      for (const b of value) n = (n << 8) | b
      fields[key] = n >>> 0
    } else {
      fields[key] = new TextDecoder().decode(value)
    }
    parsed++
  }
  return fields
}
