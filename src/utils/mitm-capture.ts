import { CDPPage } from './cdp'
import * as fs from 'fs'
import * as path from 'path'
import { makeTicketGuardHeaders, generateTicketGuardClientData } from './ticket-guard'

interface CapturedRequest {
  url: string
  method: string
  headers: Record<string, string>
  postData: string | null
  timestamp: number
}

export class MitmCapture {
  private page: CDPPage
  private captured: CapturedRequest[] = []
  private tsSign: string = ''
  private encryptTicket: string = ''
  private privateKeyPem: string = ''

  constructor() {
    this.page = new CDPPage()
  }

  async connectCDP(port = 9222): Promise<void> {
    await this.page.connect(port)
  }

  setKeys(tsSign: string, encryptTicket: string, privateKeyPem: string) {
    this.tsSign = tsSign
    this.encryptTicket = encryptTicket
    this.privateKeyPem = privateKeyPem
  }

  startCapture() {
    if (!this.page.ws) throw new Error('Not connected')

    const handler = (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        this.handleCDPMessage(msg)
      } catch {}
    }

    this.page.ws.on('message', handler)
  }

  private handleCDPMessage(msg: any) {
    // Capture request headers
    if (msg.method === 'Network.requestWillBeSent') {
      const req = msg.params.request
      const url = req.url
      // Only capture TikTok API requests with ticket guard
      if (url.includes('tiktok.com/api/') && req.headers['tt-ticket-guard-version']) {
        this.captured.push({
          url,
          method: req.method,
          headers: { ...req.headers },
          postData: req.postData || null,
          timestamp: Date.now(),
        })
        this.analyze(req)
      }
    }
  }

  private async analyze(req: any) {
    const clientData = req.headers['tt-ticket-guard-client-data']
    if (!clientData || !this.privateKeyPem) return

    // Decode the browser's ticket guard data
    const browserPayload = JSON.parse(Buffer.from(clientData, 'base64').toString())

    // Extract path from URL
    const url = new URL(req.url)
    const pathWithQuery = url.pathname + url.search

    // Generate our own ticket guard data for comparison
    const ourTimestamp = Math.floor(Date.now() / 1000)
    const ourHeaders = makeTicketGuardHeaders(
      pathWithQuery,
      { tsSign: this.tsSign, privateKeyPem: this.privateKeyPem, encryptTicket: this.encryptTicket }
    )

    const ourData = JSON.parse(Buffer.from(ourHeaders['tt-ticket-guard-client-data'], 'base64').toString())

    // Compare
    const diff: any = {}
    if (ourData.req_sign !== browserPayload.req_sign) diff.req_sign = { ours: ourData.req_sign, browser: browserPayload.req_sign }
    if (ourData.timestamp !== browserPayload.timestamp) diff.timestamp = { ours: ourData.timestamp, browser: browserPayload.timestamp }
    if (ourData.ts_sign !== browserPayload.ts_sign) diff.ts_sign = { ours: ourData.ts_sign, browser: browserPayload.ts_sign }

    console.log('\n=== Ticket Guard Capture ===')
    console.log('URL:', url.pathname)
    console.log('Browser ts_sign:', browserPayload.ts_sign)
    console.log('Our ts_sign:    ', ourData.ts_sign)
    console.log('Browser timestamp:', browserPayload.timestamp)
    console.log('Our timestamp:    ', ourData.timestamp)
    console.log('Browser req_sign:', browserPayload.req_sign?.slice(0, 50) + '...')
    console.log('Our req_sign:    ', ourData.req_sign?.slice(0, 50) + '...')

    if (Object.keys(diff).length === 0) {
      console.log('✓ MATCH - our implementation is correct!')
    } else {
      console.log('✗ DIFFERS:', JSON.stringify(diff).slice(0, 500))
      // Try signing different content to find what matches
      await this.bruteForceContent(url, browserPayload.req_sign)
    }
  }

  private async bruteForceContent(url: URL, browserReqSign: string) {
    const pubKey = require('crypto').createPublicKey(this.privateKeyPem)
    const ticket = this.tsSign.includes('.') ? this.tsSign.split('.').slice(2).join('').substring(0, 64) : this.tsSign.substring(0, 64)
    const path = url.pathname.replace(/\/$/, '') || url.pathname
    const ts = Math.floor(Date.now() / 1000)
    const content = `ticket=${ticket}&path=${path}&timestamp=${ts}`
    const v = require('crypto').createVerify('sha256')
    v.update(content)
    if (v.verify(pubKey, browserReqSign, 'base64')) {
      console.log(`MATCHED content: ${content}`)
    } else {
      console.log('No content match found')
    }
  }

  getCaptured(): CapturedRequest[] {
    return this.captured
  }

  async gotoAndWait(url: string, timeoutMs = 30000): Promise<void> {
    await this.page.goto(url)
    await this.page.waitForLoad(timeoutMs)
  }

  async findElementAndClick(selector: string): Promise<void> {
    await this.page.click(selector)
  }

  async evaluate(expr: string): Promise<any> {
    return this.page.evaluate(expr)
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}
