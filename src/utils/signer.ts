import { encodeXGnarly, XGnarlyCounters } from './xgnarly/encode'
import * as https from 'https'
import * as http from 'http'
import * as url from 'url'

export interface SignedRequest {
  url: string
  headers: Record<string, string>
  cookies: Record<string, string>
}

export interface SignerConfig {
  sessionCookies?: Record<string, string>
  userAgent?: string
  deviceId?: string
}

export class Signer {
  private sessionCookies: Record<string, string> = {}
  private userAgent: string
  private csrfToken: string = ''
  private csrfSessionId: string = ''
  private counters: XGnarlyCounters = {
    totalXHRRequests: 0,
    totalFetchRequests: 0,
    interceptedXHRRequests: 0,
    interceptedFetchRequests: 0,
  }

  constructor(config: SignerConfig = {}) {
    this.sessionCookies = { ...config.sessionCookies }
    this.userAgent = config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
  }

  setSessionCookies(cookies: Record<string, string>): void {
    this.sessionCookies = { ...cookies }
  }

  getSessionCookies(): Record<string, string> {
    return { ...this.sessionCookies }
  }

  getCsrfToken(): string {
    return this.csrfToken
  }

  getCsrfSessionId(): string {
    return this.csrfSessionId
  }

  async refreshCsrfToken(apiUrl: string): Promise<void> {
    const parsed = new url.URL(apiUrl)
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'HEAD',
      headers: {
        'User-Agent': this.userAgent,
        'x-secsdk-csrf-request': '1',
        'x-secsdk-csrf-version': '1.2.5',
        Cookie: this.formatCookies(),
      },
    }

    const { headers } = await new Promise<{ headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      const req = https.request(options, (res) => {
        resolve({ headers: res.headers })
        res.resume()
      })
      req.on('error', reject)
      req.end()
    })

    const wareToken = headers['x-ware-csrf-token']
    if (wareToken) {
      const parts = (Array.isArray(wareToken) ? wareToken[0] : wareToken).split(',')
      this.csrfToken = parts[1]?.trim() || parts[0]?.trim() || ''
    }

    const setCookies = headers['set-cookie']
    if (setCookies) {
      const arr = Array.isArray(setCookies) ? setCookies : [setCookies]
      for (const c of arr) {
        const m = c.match(/^([^=]+)=([^;]+)/)
        if (m) {
          const name = m[1].trim()
          const value = m[2].trim()
          if (name === 'csrf_session_id') {
            this.csrfSessionId = value
            this.sessionCookies[name] = value
          } else {
            this.sessionCookies[name] = value
          }
        }
      }
    }
  }

  signUrl(rawUrl: string, method: string = 'GET', body?: string): SignedRequest {
    const parsed = new url.URL(rawUrl)
    let queryString = parsed.search.replace(/^\?/, '')

    // Generate X-Bogus
    let xBogusVal: string = ''
    try {
      // Try frontierSign (VM-based)
      const frontierSign = require('../../frontierSign')
      xBogusVal = frontierSign(queryString)['X-Bogus']
    } catch {
      // Fallback to npm xbogus
      const xbogus = require('xbogus')
      xBogusVal = xbogus(rawUrl, this.userAgent)
    }
    const separator = queryString ? '&' : ''
    queryString += `${separator}X-Bogus=${encodeURIComponent(xBogusVal)}`
    queryString = queryString.replace(/msToken=[^&]*&?/, '').replace(/X-Gnarly=[^&]*&?/, '')

    // msToken
    const msToken = this.sessionCookies['msToken'] || ''
    if (msToken) {
      queryString += `&msToken=${encodeURIComponent(msToken)}`
    }

    // Generate X-Gnarly
    this.counters.totalFetchRequests!++
    const xGnarlyVal = encodeXGnarly(queryString, body || '', this.userAgent, this.counters)
    this.counters.interceptedFetchRequests!++

    const signedUrl = `https://${parsed.host}${parsed.pathname}?${queryString}&X-Gnarly=${encodeURIComponent(xGnarlyVal)}`

    // Build headers
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
      Accept: 'application/json, text/plain, */*',
      Referer: 'https://www.tiktok.com/',
      Origin: 'https://www.tiktok.com',
    }
    if (this.csrfToken) {
      headers['x-secsdk-csrf-token'] = this.csrfToken
      headers['tt-csrf-token'] = this.csrfToken
    }
    if (body && method !== 'GET') {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }

    return {
      url: signedUrl,
      headers,
      cookies: { ...this.sessionCookies },
    }
  }

  private formatCookies(): string {
    return Object.entries(this.sessionCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
}
