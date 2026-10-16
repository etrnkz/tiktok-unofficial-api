// MIT License — adapted from haig233/tiktok-xgnarly-decoded
// Custom base64 alphabet used by webmssdk (constant across all versions)

const ALPHABET = "u09tbS3UvgDEe6r-ZVMXzLpsAohTn7mdINQlW412GqBjfYiyk8JORCF5/xKHwacP="

const LUT: Record<string, number> = {}
for (let i = 0; i < ALPHABET.length; i++) {
  LUT[ALPHABET[i]] = i
}

export function encodeBase64(bytes: Uint8Array): string {
  let out = ""
  let i = 0
  for (; i + 3 <= bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + ALPHABET[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + "=="
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + "="
  }
  return out
}

export function decodeBase64(str: string): Uint8Array {
  let end = str.length
  while (end > 0 && str[end - 1] === "=") end--
  const clean = str.slice(0, end)
  const out: number[] = []
  let i = 0
  for (; i + 4 <= clean.length; i += 4) {
    const n = (LUT[clean[i]] << 18) | (LUT[clean[i + 1]] << 12) | (LUT[clean[i + 2]] << 6) | LUT[clean[i + 3]]
    out.push((n >>> 16) & 255, (n >>> 8) & 255, n & 255)
  }
  const rem = clean.length - i
  if (rem === 2) {
    const n = (LUT[clean[i]] << 6) | LUT[clean[i + 1]]
    out.push((n >>> 4) & 255)
  } else if (rem === 3) {
    const n = (LUT[clean[i]] << 12) | (LUT[clean[i + 1]] << 6) | LUT[clean[i + 2]]
    out.push((n >>> 10) & 255, (n >>> 2) & 255)
  }
  return Uint8Array.from(out)
}
