import * as fs from 'fs'
import * as path from 'path'

interface CookieJar {
  [name: string]: string
}

interface ProxySession {
  cookies: CookieJar
  initialData: Record<string, any> | null
  deviceId: string
  odinId: string
  msToken: string
}

/**
 * Proxy that makes API calls through a real Playwright browser context.
 * This bypasses TikTok's WAF challenge and provides valid X-Bogus/X-Gnarly tokens.
 *
 * Two modes:
 *   1) Launch headless browser (init)
 *   2) Connect to existing CDP browser (connectCDP)
 *
 * Social actions (follow, like, comment) are performed by navigating to the
 * target page and clicking the appropriate button — this triggers TikTok's
 * own JavaScript which correctly signs requests with X-Bogus, X-Gnarly,
 * x-secsdk-csrf-token, and tt-ticket-guard-* headers.
 */
export class PlaywrightProxy {
  browser: any = null
  context: any = null
  page: any = null
  private _initialData: Record<string, any> | null = null
  private cookieJar: CookieJar = {}

  async init(headless = true, initialCookies?: Record<string, string>): Promise<ProxySession> {
    if (this.page) return this.getSession()

    const { chromium } = require('playwright')
    this.browser = await chromium.launch({ headless })
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      viewport: { width: 1536, height: 864 },
      locale: 'en-US',
    })

    if (initialCookies) {
      const now = Math.floor(Date.now() / 1000)
      await this.context.addCookies(
        Object.entries(initialCookies).map(([name, value]) => ({
          name,
          value,
          domain: '.tiktok.com',
          path: '/',
          secure: true,
          httpOnly: false,
          sameSite: 'Lax' as const,
          expires: now + 86400 * 365,
        }))
      )
    }

    this.page = await this.context.newPage()
    await this._blockResources()
    await this.page.goto('https://www.tiktok.com/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await this._extractData()
    await this.syncCookies()
    return this.getSession()
  }

  async connectCDP(wsEndpoint?: string): Promise<void> {
    const { chromium } = require('playwright')
    if (wsEndpoint) {
      this.browser = await chromium.connect(wsEndpoint)
    } else {
      this.browser = await chromium.connectOverCDP('http://localhost:9222')
    }
    this.context = this.browser.contexts()[0]
    this.page = this.context.pages().find((p: any) =>
      p.url().includes('tiktok.com') && !p.url().includes('studio')
    ) || this.context.pages()[0]
    await this.syncCookies()
  }

  private async _blockResources(): Promise<void> {
    if (!this.page) return
    await this.page.route('**/*.{png,jpg,jpeg,gif,svg,woff,woff2,ttf,eot,mp4,webm}', (r: any) => r.abort())
  }

  private async _extractData(): Promise<void> {
    if (!this.page) return
    try {
      this._initialData = await this.page.evaluate(`(() => {
        try {
          var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
          if (el && el.textContent) return JSON.parse(el.textContent);
        } catch(e) {}
        return null;
      })()`)
    } catch { }
  }

  async syncCookies(): Promise<void> {
    if (!this.context) return
    const cookies = await this.context.cookies()
    this.cookieJar = {}
    for (const c of cookies) {
      this.cookieJar[c.name] = c.value
    }
  }

  getSession(): ProxySession {
    const scope = this._initialData?.__DEFAULT_SCOPE__
    const appCtx = scope?.['webapp.app-context'] || {}
    return {
      cookies: { ...this.cookieJar },
      initialData: this._initialData,
      deviceId: appCtx.deviceId || this.cookieJar['ttwid'] || '',
      odinId: appCtx.odinId || '',
      msToken: this.cookieJar['msToken'] || '',
    }
  }

  /**
   * Follow (or unfollow) a user by navigating to their profile and clicking
   * the follow button with `force: true` (bypasses modal overlay).
   */
  async follow(username: string): Promise<{ success: boolean; statusCode?: number; statusMsg?: string }> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(`https://www.tiktok.com/@${username}`, { waitUntil: 'load', timeout: 60000 })
    await this.page.waitForTimeout(3000)

    const btn = this.page.locator('[data-e2e="follow-button"]').first()
    if (!(await btn.isVisible({ timeout: 8000 }).catch(() => false))) {
      return { success: false, statusMsg: 'Follow button not found' }
    }

    const respPromise = this.page.waitForResponse(
      (r: any) => r.url().includes('/api/commit/follow/user/') && r.url().includes('X-Bogus'),
      { timeout: 15000 }
    ).catch(() => null)

    await btn.click({ timeout: 10000, force: true })
    const resp = await respPromise

    if (resp) {
      try {
        const json = await resp.json()
        return {
          success: json.status_code === 0,
          statusCode: json.status_code,
          statusMsg: json.status_msg,
        }
      } catch { }
    }
    return { success: true }
  }

  /**
   * Like a video by navigating to the video page and clicking the like button.
   * The like-icon is a span[data-e2e="like-icon"] inside a button.
   */
  async like(videoId: string): Promise<{ success: boolean; statusCode?: number; statusMsg?: string }> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(`https://www.tiktok.com/video/${videoId}`, { waitUntil: 'load', timeout: 60000 })
    await this.page.waitForTimeout(4000)

    const respPromise = this.page.waitForResponse(
      (r: any) => r.url().includes('/api/commit/item/digg/') && r.url().includes('X-Bogus'),
      { timeout: 15000 }
    ).catch(() => null)

    // Click the button containing the like-icon span
    const likeBtn = this.page.locator('button').filter({ has: this.page.locator('span[data-e2e="like-icon"]') }).first()
    if (await likeBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await likeBtn.click({ force: true, timeout: 5000 })
    } else {
      return { success: false, statusMsg: 'Like button not found' }
    }

    const resp = await respPromise
    if (resp) {
      try {
        const json = await resp.json()
        return {
          success: json.status_code === 0,
          statusCode: json.status_code,
          statusMsg: json.status_msg,
        }
      } catch { }
    }
    return { success: true }
  }

  /**
   * Publish a comment via the browser's SDK (page.evaluate + fetch).
   * The SDK intercepts the fetch, adds X-Bogus, X-Gnarly, CSRF token,
   * and ticket guard headers automatically.
   */
  async commentViaApi(videoId: string, text: string): Promise<{ success: boolean; statusCode?: number; statusMsg?: string; commentId?: string }> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(`https://www.tiktok.com/video/${videoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await this.page.waitForTimeout(3000)

    const result = await this.page.evaluate(function(opts: { videoId: string; text: string }) {
      return fetch('https://www.tiktok.com/api/comment/publish/?aid=1988&app_name=tiktok_web&device_platform=web_pc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({
          aweme_id: opts.videoId,
          text: opts.text,
          text_extra: '[]',
          channel_id: '0',
        }).toString(),
        credentials: 'include',
      }).then(function(r: Response) { return r.text() })
    }, { videoId, text })

    try {
      const json = JSON.parse(result)
      return {
        success: json.status_code === 0 || !!json.comment,
        statusCode: json.status_code,
        statusMsg: json.status_msg,
        commentId: json.comment?.cid || json.comment?.id || '',
      }
    } catch {
      return { success: false, statusMsg: 'Failed to parse response' }
    }
  }

  /**
   * Reply to a comment via the browser's SDK.
   */
  async replyComment(videoId: string, commentId: string, text: string): Promise<{ success: boolean; statusCode?: number; statusMsg?: string; commentId?: string }> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(`https://www.tiktok.com/video/${videoId}`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {})
    await this.page.waitForTimeout(3000)

    const result = await this.page.evaluate(function(opts: { videoId: string; commentId: string; text: string }) {
      return fetch('https://www.tiktok.com/api/comment/publish/?aid=1988&app_name=tiktok_web&device_platform=web_pc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({
          aweme_id: opts.videoId,
          text: opts.text,
          text_extra: '[]',
          channel_id: '0',
          reply_id: opts.commentId,
        }).toString(),
        credentials: 'include',
      }).then(function(r: Response) { return r.text() })
    }, { videoId, commentId, text })

    try {
      const json = JSON.parse(result)
      return {
        success: json.status_code === 0 || !!json.comment,
        statusCode: json.status_code,
        statusMsg: json.status_msg,
        commentId: json.comment?.cid || json.comment?.id || '',
      }
    } catch {
      return { success: false, statusMsg: 'Failed to parse response' }
    }
  }

  /**
   * Publish a comment on a video by navigating, clicking the comment button, filling
   * the Draft.js contenteditable div, and clicking the post button.
   */
  async comment(videoId: string, text: string): Promise<{ success: boolean; statusCode?: number; statusMsg?: string }> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(`https://www.tiktok.com/video/${videoId}`, { waitUntil: 'load', timeout: 60000 })
    await this.page.waitForTimeout(4000)

    // Open comment section by clicking the button containing the comment-icon span
    const commentBtn = this.page.locator('button').filter({ has: this.page.locator('span[data-e2e="comment-icon"]') }).first()
    if (await commentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await commentBtn.click({ force: true })
      await this.page.waitForTimeout(2000)
    }

    const respPromise = this.page.waitForResponse(
      (r: any) => r.url().includes('/api/comment/publish/') && r.url().includes('X-Bogus'),
      { timeout: 20000 }
    ).catch(() => null)

    // TikTok uses a Draft.js contenteditable div (not a textarea)
    const editableDiv = this.page.locator('div[contenteditable="true"][role="textbox"]').first()
    if (await editableDiv.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editableDiv.click({ force: true })
      await this.page.waitForTimeout(300)
      await this.page.keyboard.type(text, { delay: 30 })
      await this.page.waitForTimeout(500)

      // Submit via the post button
      const submitBtn = this.page.locator('button[data-e2e="comment-post"]')
      if (await submitBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click({ force: true })
      } else {
        return { success: false, statusMsg: 'Post button not enabled' }
      }
    } else {
      return { success: false, statusMsg: 'Comment input not found' }
    }

    const resp = await respPromise
    if (resp) {
      try {
        const json = await resp.json()
        return {
          success: json.status_code === 0 || !!json.comment,
          statusCode: json.status_code,
          statusMsg: json.status_msg,
        }
      } catch { }
    }
    return { success: true }
  }

  async request(url: string, options: { method?: string; body?: any; headers?: Record<string, string> } = {}): Promise<string> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized. Call init() first.')
    await this.syncCookies()

    url = url.replace(/&X_Bogus=[^&]*/, '').replace(/&X_Gnarly=[^&]*/, '').replace(/&msToken=[^&]*/, '')

    const result = await this.page.evaluate(async (opts: any) => {
      try {
        const res = await fetch(opts.url, {
          method: opts.method || 'GET',
          headers: opts.headers || { 'Accept': 'application/json, text/plain, */*' },
          body: opts.body || undefined,
          credentials: 'include',
        })
        return { ok: res.ok, status: res.status, text: await res.text() }
      } catch (err: any) {
        return { ok: false, status: 0, text: JSON.stringify({ error: err.message }) }
      }
    }, { url, method: options.method || 'GET', headers: { 'Accept': 'application/json, text/plain, */*', ...options.headers }, body: options.body })

    if (!result.ok) {
      const err: any = new Error(`Browser request failed: status ${result.status}`)
      err.responseText = result.text
      err.status = result.status
      throw err
    }
    return result.text
  }

  async login(email: string, password: string, headless = true): Promise<ProxySession> {
    if (this.page) await this.close()
    const { chromium } = require('playwright')
    this.browser = await chromium.launch({ headless })
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      viewport: { width: 1536, height: 864 },
      locale: 'en-US',
    })
    this.page = await this.context.newPage()
    await this._blockResources()
    await this.page.goto('https://www.tiktok.com/login/phone-or-email/email', { waitUntil: 'networkidle', timeout: 60000 })
    await this.page.waitForSelector('input[name="username"]', { timeout: 10000 })
    await this.page.fill('input[name="username"]', email)
    await this.page.fill('input[type="password"]', password)
    await this.page.click('button[type="submit"]')

    try {
      await this.page.waitForURL('https://www.tiktok.com/**', { timeout: 30000 })
    } catch {
      const currentUrl = this.page.url()
      if (currentUrl.includes('login')) {
        throw new Error('Login failed — captcha or invalid credentials')
      }
    }
    await this.page.waitForTimeout(3000)
    await this._extractData()
    await this.syncCookies()
    return this.getSession()
  }

  async navigate(url: string): Promise<Record<string, any> | null> {
    if (!this.page) throw new Error('PlaywrightProxy not initialized')
    await this.page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await this.page.waitForTimeout(2000)
    await this._extractData()
    await this.syncCookies()
    return this._initialData
  }

  async close(): Promise<void> {
    if (this.browser) {
      try { await this.browser.close() } catch { }
      this.browser = null
      this.context = null
      this.page = null
    }
  }
}

export async function extractSession(headless = true, proxy?: PlaywrightProxy): Promise<ProxySession> {
  const p = proxy || new PlaywrightProxy()
  if (!proxy) await p.init(headless)
  return p.getSession()
}

export async function loginWithBrowser(email: string, password: string, headless = true): Promise<ProxySession> {
  const p = new PlaywrightProxy()
  return p.login(email, password, headless)
}

export function saveBrowserSession(session: ProxySession, filePath: string): void {
  fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
}

export function loadBrowserSession(filePath: string): ProxySession {
  const data = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(data)
}
