const possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function randomString(length: number): string {
  let result = ''
  for (let i = 0; i < length; i++) {
    result += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length))
  }
  return result
}

export function generateDeviceId(): string {
  return randomString(19) + (Math.floor(Math.random() * 9) + 1)
}

export function generateOdinId(): string {
  return randomString(16) + (Math.floor(Math.random() * 9) + 1)
}

export function generateWebId(): string {
  return randomString(19) + (Math.floor(Math.random() * 9) + 1)
}

export function generateMsToken(length = 107): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export function generateNonce(): string {
  return randomString(8) + '_' + randomString(10)
}

export function getBrowserInfo(): { browserName: string; browserVersion: string } {
  return {
    browserName: 'Mozilla',
    browserVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  }
}

let frontierSignModule: ((params: string) => { 'X-Bogus': string }) | null = null
let xbogusFallback: ((url: string, ua: string) => string) | null = null

function ensureSigner(): void {
  if (frontierSignModule || xbogusFallback) return
  try {
    frontierSignModule = require('../../frontierSign')
  } catch {
    try {
      xbogusFallback = require('xbogus')
    } catch {
      throw new Error('Neither frontierSign module nor xbogus package found')
    }
  }
}

export function generateXBogus(params: Record<string, string>, userAgent?: string): string {
  ensureSigner()
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  if (frontierSignModule) {
    const result = frontierSignModule(qs)
    return result['X-Bogus']
  }

  // Fallback to npm xbogus
  const ua = userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  const url = `https://www.tiktok.com/api/?${qs}`
  return xbogusFallback!(url, ua)
}

/**
 * Fetch a real msToken from TikTok's server by making a lightweight API call.
 * The returned msToken is server-issued (validated) rather than randomly generated.
 * Falls back to generateMsToken() if the request fails.
 */
export async function fetchMsToken(): Promise<string> {
  try {
    const fetch = require('node-fetch')
    const qs = `aid=1988&app_name=tiktok_web&device_platform=web_pc`
    let xBogus = ''
    try {
      const frontierSign = require('../../frontierSign')
      xBogus = frontierSign(qs)['X-Bogus']
    } catch {
      // no signer available, msToken will be random
    }
    const url = `https://www.tiktok.com/api/comment/publish/?${qs}${xBogus ? '&X-Bogus=' + encodeURIComponent(xBogus) : ''}`
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36' } })
    const setCookie = res.headers.raw()['set-cookie']
    if (setCookie) {
      for (const c of setCookie) {
        const m = c.match(/^msToken=([^;]+)/)
        if (m) return decodeURIComponent(m[1])
      }
    }
  } catch {}
  return generateMsToken()
}

export function generateXGnarly(queryString: string, body: string, userAgent: string): string {
  const { encodeXGnarly } = require('./xgnarly/encode')
  return encodeXGnarly(queryString, body, userAgent)
}
