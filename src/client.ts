import fetch, { Response } from 'node-fetch'
import * as fs from 'fs'
import * as path from 'path'
import * as cp from 'child_process'
import {
  TikTokClientConfig,
  TicketGuardKeys,
  AppContext,
  TikTokFeedResponse,
  TikTokUserProfile,
  TikTokVideoItem,
  TikTokComment,
  TikTokSearchResponse,
  TikTokExploreResponse,
  TikTokLiveStream,
  TikTokLoginResult,
  TikTokNotification,
  TikTokUploadResult,
  TikTokUploadConfig,
  TikTokMessageResult,
  TikTokConversation,
  TikTokConversationListResponse,
  TikTokMessage,
  TikTokMessageListResponse,
  TikTokActionResponse,
  DownloadResult,
  LoginConfig,
  TikTokQrCodeResult,
  TikTokQrCodeStatusResult,
  TikTokVerificationCodeResult,
  TikTokRegisterResult,
} from './types'
import { makeTicketGuardHeaders } from './utils/ticket-guard'
import {
  generateMsToken,
  generateDeviceId,
  generateOdinId,
  generateXBogus,
  generateXGnarly,
  getBrowserInfo,
  generateNonce,
} from './utils/device'
import { CDPPage, CdpWriteProxy } from './utils/cdp'
import { signVodRequest, VodCredentials } from './utils/vod-signer'
import { DmRestClient, DmMessage } from './utils/dm-rest-client'

const BASE_URL = 'https://www.tiktok.com'

export class TikTokClient {
  private config: Required<TikTokClientConfig>
  private commonParams: Record<string, string>
  private _appContext: AppContext | null = null
  private _initialData: Record<string, any> | null = null
  private _currentUser: TikTokUserProfile | null = null
  private _isLoggedIn = false
  private _proxy: any = null
  private _videoAuthorCache: Map<string, string> = new Map()
  private _videoDetailCache: Map<string, TikTokVideoItem | null> = new Map()
  private _ticketGuardKeys: TicketGuardKeys | null = null
  private _dmRestClient: DmRestClient | null = null
  private _messageListeners: ((msg: DmMessage) => void)[] = []
  private _messagePollingTimer: any = null
  private _lastKnownMessageId: string = ''

  private _getDmRestClient(): DmRestClient {
    if (!this._dmRestClient) {
      this._dmRestClient = new DmRestClient({
        deviceId: this.config.deviceId,
        uid: this.config.cookieJar['uid'] || this.config.deviceId,
        cookies: this.config.cookieJar,
        region: this.config.region,
      })
    }
    return this._dmRestClient
  }

  constructor(config: TikTokClientConfig = {}) {
    const browser = getBrowserInfo()
    this.config = {
      deviceId: config.deviceId || generateDeviceId(),
      odinId: config.odinId || generateOdinId(),
      region: config.region || 'US',
      language: config.language || 'en',
      proxy: config.proxy || '',
      msToken: config.msToken || '',
      xBogus: config.xBogus || '',
      xGnarly: config.xGnarly || '',
      cookieJar: config.cookieJar || {},
      timeout: config.timeout || 30000,
      useTicketGuard: config.useTicketGuard ?? false,
      ticketGuardKeys: config.ticketGuardKeys || null as any,
    }
    if (config.ticketGuardKeys) {
      this._ticketGuardKeys = config.ticketGuardKeys
    }
    this._isLoggedIn = !!(
      this.config.cookieJar['sessionid'] ||
      this.config.cookieJar['sid_tt'] ||
      this.config.cookieJar['sessionid_ss']
    )
    this.commonParams = {
      aid: '1988',
      app_language: this.config.language,
      app_name: 'tiktok_web',
      browser_language: 'en-US',
      browser_name: browser.browserName,
      browser_online: 'true',
      browser_platform: 'Win32',
      browser_version: browser.browserVersion,
      channel: 'tiktok_web',
      cookie_enabled: 'true',
      data_collection_enabled: 'false',
      device_id: this.config.deviceId,
      device_platform: 'web_pc',
      focus_state: 'true',
      from_page: 'fyp',
      history_len: '2',
      is_fullscreen: 'false',
      is_page_visible: 'true',
      language: this.config.language,
      odinId: this.config.odinId,
      os: 'windows',
      priority_region: '',
      referer: `${BASE_URL}/`,
      region: this.config.region,
      root_referer: `${BASE_URL}/`,
      screen_height: '864',
      screen_width: '1536',
      tz_name: 'America/New_York',
      user_is_login: this._isLoggedIn ? 'true' : 'false',
      webcast_language: 'en',
    }
  }

  get appContext(): AppContext | null { return this._appContext }
  get initialData(): Record<string, any> | null { return this._initialData }
  get currentUser(): TikTokUserProfile | null { return this._currentUser }
  get isLoggedIn(): boolean { return this._isLoggedIn }

  setTicketGuardKeys(keys: TicketGuardKeys): void {
    this._ticketGuardKeys = keys
  }

  getTicketGuardKeys(): TicketGuardKeys | null {
    return this._ticketGuardKeys
  }

  private getCookieHeader(): string {
    return Object.entries(this.config.cookieJar)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }

  private setCookiesFromResponse(res: Response): void {
    const setCookie = res.headers.raw()['set-cookie']
    if (!setCookie) return
    for (const cookie of setCookie) {
      const match = cookie.match(/^([^=]+)=([^;]+)/)
      if (match) {
        this.config.cookieJar[match[1]] = match[2]
      }
    }
  }

  private addAntiBotParams(params: Record<string, string>): void {
    params.msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
  }

  private buildUrl(path: string, extraParams: Record<string, string> = {}, skipXBogus = false): string {
    const params: Record<string, string> = { ...this.commonParams, ...extraParams }
    this.addAntiBotParams(params)
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const url = `${BASE_URL}${path}?${qs}`
    if (skipXBogus) return url
    const ua = this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36'
    const xBogusVal = this.config.xBogus || generateXBogus(params, ua)
    return `${url}&X-Bogus=${encodeURIComponent(xBogusVal)}`
  }

  private async request<T>(url: string, options: { method?: string; body?: any; headers?: Record<string, string>; formData?: boolean; skipSigning?: boolean; skipCsrfTokenDowngrade?: boolean; useTicketGuard?: boolean } = {}): Promise<T> {
    if (this._proxy?.request) {
      const headers: Record<string, string> = {
        'Accept': 'application/json, text/plain, */*',
        'Referer': BASE_URL + '/',
        ...options.headers,
      }
      const cookie = this.getCookieHeader()
      if (cookie) headers['Cookie'] = cookie

      if (options.formData) {
        delete headers['Content-Type']
      } else if (options.body) {
        headers['Content-Type'] = typeof options.body === 'string' && !options.body.startsWith('{')
          ? 'application/x-www-form-urlencoded'
          : 'application/json'
      }

      const text = await this._proxy.request(url, {
        method: options.method || 'GET',
        headers,
        body: options.body,
      })
      try {
        return JSON.parse(text) as T
      } catch {
        return text as unknown as T
      }
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': BASE_URL,
      'Referer': BASE_URL + '/',
      ...options.headers,
    }
    if (!options.formData) {
      headers['Accept'] = 'application/json, text/plain, */*'
      headers['Content-Type'] = options.body && typeof options.body === 'string'
        ? 'application/x-www-form-urlencoded'
        : 'application/json'
    } else {
      delete headers['Content-Type']
    }
    const cookie = this.getCookieHeader()
    if (cookie) headers['Cookie'] = cookie

    // Add X-Gnarly if not already in URL (skip if options.skipSigning)
    let finalUrl = url
    if (!options.skipSigning) {
      if (!url.includes('X-Gnarly') && !this.config.xGnarly) {
        const ua = headers['User-Agent']
        try {
          const parsedUrl = new URL(url)
          const searchWithoutBogus = [...parsedUrl.searchParams.entries()]
            .filter(([k]) => k !== 'X-Bogus')
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
            .join('&')
          const bodyStr = typeof options.body === 'string' ? options.body : ''
          const xGnarlyVal = generateXGnarly(searchWithoutBogus, bodyStr, ua)
          finalUrl = url + (url.includes('?') ? '&' : '?') + 'X-Gnarly=' + encodeURIComponent(xGnarlyVal)
        } catch {
          // X-Gnarly generation failed, proceed without it
        }
      } else if (this.config.xGnarly) {
        finalUrl = url + (url.includes('?') ? '&' : '?') + 'X-Gnarly=' + encodeURIComponent(this.config.xGnarly)
      }
    }
    const shouldUseGuard = options.useTicketGuard || (options.method === 'POST' && this.config.useTicketGuard)
    if (shouldUseGuard && this._ticketGuardKeys) {
      const path = finalUrl.startsWith('https://www.tiktok.com') ? finalUrl.replace('https://www.tiktok.com', '') : finalUrl
      const pathname = path.includes('?') ? path.split('?')[0] : path
      const ticketHeaders = makeTicketGuardHeaders(pathname, this._ticketGuardKeys)
      Object.assign(headers, ticketHeaders, this._buildCsrfHeader())
      options.skipCsrfTokenDowngrade = true
    }

    if (options.method === 'POST' && !options.skipCsrfTokenDowngrade) {
      const csrfToken = this.config.cookieJar['tt_csrf_token'] || ''
      headers['x-secsdk-csrf-token'] = 'DOWNGRADE'
      if (csrfToken) headers['tt-csrf-token'] = csrfToken
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)

    try {
      const res = await fetch(finalUrl, {
        method: options.method || 'GET',
        headers,
        body: options.body,
        signal: controller.signal,
      })
      this.setCookiesFromResponse(res)
      const text = await res.text()
      try {
        return JSON.parse(text) as T
      } catch {
        return text as unknown as T
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async fetchInitialData(username?: string): Promise<Record<string, any>> {
    const pageUrl = username ? `${BASE_URL}/@${username}` : BASE_URL + '/'
    const html = await this.request<string>(pageUrl)
    const match = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
    if (!match) {
      if (!username) return this.fetchInitialData('tiktok')
      throw new Error('TikTok WAF challenge active — use initFromBrowser() or loadSession() to bypass')
    }
    const data = JSON.parse(match[1])
    this._initialData = data
    const scope = data['__DEFAULT_SCOPE__']
    if (scope && scope['webapp.app-context']) {
      this._appContext = scope['webapp.app-context'] as AppContext
    }
    return data
  }

  async login(email: string, password: string): Promise<TikTokLoginResult> {
    try {
      await this.fetchInitialData()
      const csrfToken = this._appContext?.csrfToken || ''
      this.setCookie('csrfToken', csrfToken)

      const encodedPassword = Buffer.from(password).toString('base64')
      const body = new URLSearchParams({
        email,
        password: encodedPassword,
        csrf_token: csrfToken,
        mix_mode: '1',
        username: email,
        type: 'email',
      }).toString()

      const url = this.buildUrl('/passport/web/account/login/', {
        request_code: '0',
        type: 'email',
        username: email,
      })

      const result = await this.request<any>(url, {
        method: 'POST',
        body,
        headers: {
          'X-CSRFToken': csrfToken,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (result?.data?.user_id || result?.data?.session_key) {
        this._isLoggedIn = true
        this.commonParams.user_is_login = 'true'
        if (result.data.user_info_str) {
          try {
            const userInfo = JSON.parse(result.data.user_info_str)
            this._currentUser = mapUserProfile({ user: userInfo })
          } catch { }
        }
        return {
          success: true,
          sessionId: result.data.session_key || result.data.sessionid,
          csrfToken,
          user: this._currentUser?.user,
        }
      }

      if (result?.message?.includes('captcha') || result?.data?.captcha || result?.captcha) {
        return { success: false, error: 'Captcha required — login from a real browser and use loadSession()' }
      }

      return { success: false, error: result?.message || result?.description || 'Login failed' }
    } catch (err: any) {
      return { success: false, error: err.message || 'Login request failed' }
    }
  }

  async getLoginQrCode(): Promise<TikTokQrCodeResult> {
    const url = this.buildUrl('/passport/web/qr/get_code/', {
      aid: '1988',
      service: 'https://www.tiktok.com',
    })
    const res = await this.request<any>(url)
    const data = res?.data || {}
    return {
      token: data.token || '',
      qrCodeUrl: data.qrcode_index_url || data.scan_url || '',
      qrCodeDataUrl: data.qrcode || '',
      expireTime: data.expire_time ? Number(data.expire_time) : undefined,
    }
  }

  async checkLoginQrCode(token: string): Promise<TikTokQrCodeStatusResult> {
    const url = this.buildUrl('/passport/web/qr/check_status/', {
      token,
      aid: '1988',
      service: 'https://www.tiktok.com',
    })
    const res = await this.request<any>(url)
    const data = res?.data || {}
    const rawStatus = (data.status || '').toLowerCase()

    let status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error' = 'waiting'
    if (rawStatus === 'confirmed' || rawStatus === 'success' || data.is_confirmed) {
      status = 'confirmed'
      this._isLoggedIn = true
      this.commonParams.user_is_login = 'true'
      if (data.session_key || data.sessionid) {
        this.config.cookieJar['sessionid'] = data.session_key || data.sessionid
        this.config.cookieJar['sessionid_ss'] = data.session_key || data.sessionid
      }
      return {
        status: 'confirmed',
        sessionId: data.session_key || data.sessionid,
        cookies: this.config.cookieJar,
        user: data.user_info ? mapUser(data.user_info) : undefined,
      }
    } else if (rawStatus === 'scanned') {
      status = 'scanned'
    } else if (rawStatus === 'expired' || rawStatus === 'timeout') {
      status = 'expired'
    }

    return { status }
  }

  async sendVerificationCode(target: string, type: 'email' | 'mobile' = 'email'): Promise<TikTokVerificationCodeResult> {
    await this.fetchInitialData().catch(() => {})
    const csrfToken = this._appContext?.csrfToken || this.config.cookieJar['tt_csrf_token'] || ''
    const bodyObj: Record<string, string> = {
      type: type === 'email' ? '34' : '37',
      aid: '1988',
      ...(type === 'email' ? { email: target } : { mobile: target }),
    }
    const url = this.buildUrl('/passport/web/account/send_code/', {})
    try {
      const res = await this.request<any>(url, {
        method: 'POST',
        body: new URLSearchParams(bodyObj).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrfToken,
        },
      })
      if (res?.data?.captcha || res?.message?.includes('captcha')) {
        return { success: false, captcha: true, error: 'Captcha required for verification code' }
      }
      return {
        success: res?.data?.success ?? (res?.message === 'success' || res?.status_code === 0),
        error: res?.data?.description || res?.message,
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async loginWithCode(target: string, code: string, type: 'email' | 'mobile' = 'email'): Promise<TikTokLoginResult> {
    const url = this.buildUrl('/passport/web/account/login/', {
      type: type === 'email' ? 'email' : 'mobile',
    })
    const bodyObj: Record<string, string> = {
      code,
      type: type === 'email' ? 'email' : 'mobile',
      ...(type === 'email' ? { email: target, username: target } : { mobile: target }),
    }
    try {
      const res = await this.request<any>(url, {
        method: 'POST',
        body: new URLSearchParams(bodyObj).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      if (res?.data?.session_key || res?.data?.user_id) {
        this._isLoggedIn = true
        this.commonParams.user_is_login = 'true'
        const sessionId = res.data.session_key || res.data.sessionid
        if (sessionId) {
          this.config.cookieJar['sessionid'] = sessionId
          this.config.cookieJar['sessionid_ss'] = sessionId
        }
        return {
          success: true,
          sessionId,
          user: res.data.user_info ? mapUser(res.data.user_info) : undefined,
        }
      }
      return {
        success: false,
        error: res?.data?.description || res?.message || 'Code login failed',
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async signupWithCode(email: string, code: string, password?: string): Promise<TikTokRegisterResult> {
    const url = this.buildUrl('/passport/web/account/register/', {
      type: 'email',
    })
    const bodyObj: Record<string, string> = {
      email,
      code,
      type: 'email',
      ...(password ? { password: Buffer.from(password).toString('base64') } : {}),
    }
    try {
      const res = await this.request<any>(url, {
        method: 'POST',
        body: new URLSearchParams(bodyObj).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
      if (res?.data?.user_id || res?.data?.session_key) {
        this._isLoggedIn = true
        this.commonParams.user_is_login = 'true'
        const sessionId = res.data.session_key || res.data.sessionid
        if (sessionId) {
          this.config.cookieJar['sessionid'] = sessionId
        }
        return {
          success: true,
          sessionId,
          user: res.data.user_info ? mapUser(res.data.user_info) : undefined,
        }
      }
      return {
        success: false,
        error: res?.data?.description || res?.message || 'Registration failed',
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async initFromBrowser(headless = true): Promise<void> {
    const { PlaywrightProxy } = require('./utils/browser')
    this._proxy = new PlaywrightProxy()
    const existingCookies = Object.keys(this.config.cookieJar).length > 0 ? this.config.cookieJar : undefined
    const session = await this._proxy.init(headless, existingCookies)
    for (const [k, v] of Object.entries(session.cookies)) {
      this.config.cookieJar[k] = v as string
    }
    if (session.initialData) {
      this._initialData = session.initialData
      const scope = session.initialData['__DEFAULT_SCOPE__']
      if (scope?.['webapp.app-context']) {
        this._appContext = scope['webapp.app-context'] as AppContext
      }
    }
    if (session.cookies['sessionid'] || session.cookies['sid_tt']) {
      this._isLoggedIn = true
      this.commonParams.user_is_login = 'true'
    }
    this.config.msToken = session.msToken || session.cookies['msToken'] || this.config.msToken
    this.commonParams.device_id = session.deviceId || this.config.deviceId
    this.commonParams.odinId = session.odinId || this.config.odinId
  }

  async loginWithBrowser(email: string, password: string, headless = true): Promise<TikTokLoginResult> {
    try {
      const { PlaywrightProxy } = require('./utils/browser')
      this._proxy = new PlaywrightProxy()
      const session = await this._proxy.login(email, password, headless)
      for (const [k, v] of Object.entries(session.cookies)) {
        this.config.cookieJar[k] = v as string
      }
      if (session.initialData) {
        this._initialData = session.initialData
        const scope = session.initialData['__DEFAULT_SCOPE__']
        if (scope?.['webapp.app-context']) {
          this._appContext = scope['webapp.app-context'] as AppContext
        }
      }
      this._isLoggedIn = true
      this.commonParams.user_is_login = 'true'
      this.config.msToken = session.msToken || session.cookies['msToken'] || this.config.msToken
      this.commonParams.device_id = session.deviceId || this.config.deviceId
      this.commonParams.odinId = session.odinId || this.config.odinId
      return {
        success: true,
        sessionId: session.cookies['sessionid'] || session.cookies['sid_tt'],
        csrfToken: session.cookies['tt_csrf_token'],
      }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  async closeBrowser(): Promise<void> {
    if (this._proxy) {
      await this._proxy.close()
      this._proxy = null
    }
  }

  /**
   * Connect to an existing Chrome instance via CDP (Chrome DevTools Protocol).
   * Launches Chrome with --remote-debugging-port=9222 if not already running.
   * This enables browser-based social actions (like/unlike) that require
   * the TikTok web SDK's ticket guard signing.
   */
  async connectCDP(port = 9222): Promise<void> {
    // Try to connect first
    const available = await this._checkCDP(port)
    if (!available) {
      this._launchChrome(port)
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000))
        if (await this._checkCDP(port)) break
      }
    }

    const page = new CDPPage()
    await page.connect(port)
    await page.waitForLoad()

    const cookies = await page.getCookies()
    for (const [name, value] of Object.entries(cookies)) {
      this.config.cookieJar[name] = value
    }
    this._isLoggedIn = !!(this.config.cookieJar['sessionid'] || this.config.cookieJar['sid_tt'])
    this.commonParams.user_is_login = this._isLoggedIn ? 'true' : 'false'

    const csrfToken = this.config.cookieJar['tt_csrf_token'] || ''
    // Create Studio tab for follow/unfollow
    const studioProxy = new CdpWriteProxy()
    await studioProxy.connect(port, csrfToken, this.config.cookieJar as Record<string, string>)
    // Create main TikTok tab for like/unlike (needs valid ticket guard keys)
    const mainProxy = new CdpWriteProxy()
    await mainProxy.connect(port, csrfToken, this.config.cookieJar as Record<string, string>,
      'https://www.tiktok.com')
    // Initialize webmssdk on main tab for X-Bogus/msToken injection
    await mainProxy.initWebmssdk().catch(() => {})

    const _buildCdpUrl = (path: string, extraParams: Record<string, string>) => {
      return `${BASE_URL}${path}?${new URLSearchParams({ aid: '1988', ...extraParams })}`
    }

    this._proxy = {
      page,
      studioProxy,
      mainProxy,
      like: async (videoId: string) => {
        const pathname = '/api/commit/item/digg/'
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          WebIdLastTime: String(Math.floor(Date.now() / 1000)),
          aweme_id: videoId,
          from_page: 'video',
          history_len: '4',
          type: '1',
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, '', tgHeaders)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg, body }
      },
      unlike: async (videoId: string) => {
        const pathname = '/api/commit/item/undigg/'
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          WebIdLastTime: String(Math.floor(Date.now() / 1000)),
          aweme_id: videoId,
          from_page: 'video',
          history_len: '4',
          type: '1',
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, '', tgHeaders)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg, body }
      },
      follow: async (secUid: string) => {
        const url = _buildCdpUrl('/api/commit/follow/user/', {
          action_type: '1', type: '1', sec_user_id: secUid,
        })
        const res = await studioProxy.xhr('POST', url)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg }
      },
      unfollow: async (secUid: string) => {
        const url = _buildCdpUrl('/api/commit/follow/user/', {
          action_type: '0', type: '0', sec_user_id: secUid,
        })
        const res = await studioProxy.xhr('POST', url)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg }
      },
      commentViaApi: async (videoId: string, text: string) => {
        const pathname = '/api/comment/publish/'
        const body = new URLSearchParams({
          aweme_id: videoId, text, text_extra: '[]',
          comment_mark: '', comment_quality_score: '4',
          is_self_see: '0', filter_warn: '0', from_mss: 'true',
        }).toString()
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          req_id: '' + Math.random().toString(36).slice(2),
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', app_name: 'tiktok_web', device_platform: 'web', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, body, tgHeaders)
        const parsed = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return {
          success: !!parsed.comment || parsed.status_code === 0,
          statusCode: parsed.status_code,
          statusMsg: parsed.status_msg,
          commentId: parsed.comment?.id || parsed.comment?.cid || parsed.data?.comment_id || '',
        }
      },
      replyComment: async (videoId: string, commentId: string, text: string) => {
        const pathname = '/api/comment/publish/'
        const body = new URLSearchParams({
          aweme_id: videoId, text, text_extra: '[]',
          comment_mark: '', comment_quality_score: '4',
          is_self_see: '0', filter_warn: '0', from_mss: 'true',
          reply_id: commentId,
        }).toString()
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          req_id: '' + Math.random().toString(36).slice(2),
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', app_name: 'tiktok_web', device_platform: 'web', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, body, tgHeaders)
        const parsed = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return {
          success: !!parsed.comment || parsed.status_code === 0,
          statusCode: parsed.status_code,
          statusMsg: parsed.status_msg,
          commentId: parsed.comment?.id || parsed.comment?.cid || parsed.data?.comment_id || '',
        }
      },
      collect: async (videoId: string) => {
        const pathname = '/api/commit/item/collect/'
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          WebIdLastTime: String(Math.floor(Date.now() / 1000)),
          aweme_id: videoId,
          from_page: 'video',
          history_len: '4',
          type: '1',
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, '', tgHeaders)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg, body }
      },
      uncollect: async (videoId: string) => {
        const pathname = '/api/commit/item/collect/'
        const msToken = this.config.cookieJar['msToken'] || this.config.msToken || generateMsToken()
        const urlParams = {
          WebIdLastTime: String(Math.floor(Date.now() / 1000)),
          aweme_id: videoId,
          from_page: 'video',
          history_len: '4',
          type: '2',
          msToken,
          device_id: this.config.deviceId,
          odinId: this.config.odinId,
        }
        const qs = new URLSearchParams({ aid: '1988', ...urlParams })
        const xbogus = generateXBogus(Object.fromEntries(qs), this.config.cookieJar['User-Agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36')
        const url = `${BASE_URL}${pathname}?${qs}&X-Bogus=${encodeURIComponent(xbogus)}`
        const tgHeaders = await mainProxy.makeTicketGuardHeadersBrowser(pathname)
        const res = await mainProxy.xhr('POST', url, '', tgHeaders)
        const body = (() => { try { return JSON.parse(res.body) } catch { return {} } })()
        return { success: body.status_code === 0, statusCode: body.status_code, statusMsg: body.status_msg, body }
      },
      close: async () => {
        await studioProxy.close().catch(() => {})
        await mainProxy.close().catch(() => {})
        page.close().catch(() => {})
      },
    }
  }

  private async _checkCDP(port: number): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 2000)
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal })
      clearTimeout(timer)
      return res.ok
    } catch {
      return false
    }
  }

  private _launchChrome(port: number): void {
    const candidates = [
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
    for (const exe of candidates) {
      if (fs.existsSync(exe)) {
        try {
          cp.spawn(exe, [`--remote-debugging-port=${port}`, '--new-window', 'https://www.tiktok.com'], {
            detached: true,
            stdio: 'ignore',
          })
          return
        } catch { }
      }
    }
  }

  async loginWithSession(sessionId: string, csrfToken?: string): Promise<void> {
    this.setCookie('sessionid', sessionId)
    if (csrfToken) this.setCookie('csrfToken', csrfToken)
    this._isLoggedIn = true
    this.commonParams.user_is_login = 'true'
  }

  saveSession(filePath: string): void {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const session: Record<string, any> = {
      cookies: this.config.cookieJar,
      deviceId: this.config.deviceId,
      odinId: this.config.odinId,
      msToken: this.config.msToken,
      region: this.config.region,
    }
    if (this._ticketGuardKeys) {
      session.ticketGuardKeys = this._ticketGuardKeys
    }
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2))
  }

  loadSession(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false
    try {
      const session = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (session.cookies) {
        this.config.cookieJar = { ...session.cookies }
        if (session.deviceId) this.config.deviceId = session.deviceId
        if (session.odinId) this.config.odinId = session.odinId
        if (session.msToken) this.config.msToken = session.msToken
        if (session.region) this.config.region = session.region
        if (session.ticketGuardKeys) {
          this._ticketGuardKeys = session.ticketGuardKeys
        }
      } else {
        this.config.cookieJar = { ...session }
      }
      this._isLoggedIn = !!(
        this.config.cookieJar['sessionid'] ||
        this.config.cookieJar['sid_tt'] ||
        this.config.cookieJar['sessionid_ss']
      )
      this.commonParams.user_is_login = this._isLoggedIn ? 'true' : 'false'
      return true
    } catch {
      return false
    }
  }

  logout(): void {
    delete this.config.cookieJar['sessionid']
    delete this.config.cookieJar['sid_tt']
    delete this.config.cookieJar['sessionid_ss']
    delete this.config.cookieJar['csrfToken']
    this._isLoggedIn = false
    this._currentUser = null
    this.commonParams.user_is_login = 'false'
  }

  async getMyProfile(): Promise<TikTokUserProfile | null> {
    if (!this._isLoggedIn) return null

    const raw = await this.request<any>('https://www.tiktok.com/passport/web/account/info/', {
      headers: { 'Accept': 'application/json, text/plain, */*' },
      skipSigning: true,
    })
    if (raw?.data) {
      const d = raw.data
      this._currentUser = {
        user: {
          id: String(d.user_id || ''),
          uniqueId: d.username || d.screen_name || '',
          nickname: d.screen_name || d.username || '',
          avatarLarger: d.avatar_url || d.avatar_larger || '',
          avatarMedium: d.avatar_url || d.avatar_medium || '',
          avatarThumb: d.avatar_url || d.avatar_thumb || '',
          signature: d.description || d.signature || '',
          verified: false,
          secUid: d.sec_user_id || '',
          secret: false,
          ftc: false,
          relation: 0,
          openFavorite: false,
        },
        stats: { followingCount: 0, followerCount: 0, heartCount: 0, videoCount: 0, diggCount: 0, favoriteCount: 0 },
        isUnderAge18: false,
      }
      return this._currentUser
    }

    const url = this.buildUrl('/api/user/me/')
    const apiRaw = await this.request<any>(url)
    if (apiRaw?.user || apiRaw?.data?.user) {
      this._currentUser = mapUserProfile(apiRaw.user || apiRaw.data)
    }
    return this._currentUser
  }

  async like(videoId: string): Promise<TikTokActionResponse> {
    if (this._proxy?.like) {
      return this._proxy.like(videoId)
    }
    const verifyFp = this.config.cookieJar['s_v_web_id'] || ''
    const extraParams: Record<string, string> = {
      WebIdLastTime: String(Math.floor(Date.now() / 1000)),
      aweme_id: videoId,
      from_page: 'video',
      history_len: '4',
      type: '1',
      ...(verifyFp ? { verifyFp } : {}),
    }
    const url = this.buildUrl('/api/commit/item/digg/', extraParams)

    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async unlike(videoId: string): Promise<TikTokActionResponse> {
    if (this._proxy?.unlike) {
      return this._proxy.unlike(videoId)
    }
    if (this._proxy?.like) {
      return this._proxy.like(videoId)
    }
    const verifyFp = this.config.cookieJar['s_v_web_id'] || ''
    const extraParams: Record<string, string> = {
      WebIdLastTime: String(Math.floor(Date.now() / 1000)),
      aweme_id: videoId,
      from_page: 'video',
      history_len: '4',
      type: '1',
      ...(verifyFp ? { verifyFp } : {}),
    }
    const url = this.buildUrl('/api/commit/item/undigg/', extraParams)

    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  private _buildCsrfHeader(): Record<string, string> {
    const token = this.config.cookieJar['tt_csrf_token'] || ''
    return token ? { 'tt-csrf-token': token } : {}
  }

  async follow(secUid: string): Promise<TikTokActionResponse> {
    if (this._proxy?.follow) {
      return this._proxy.follow(secUid)
    }
    const raw = await this.request<any>(this.buildUrl('/api/commit/follow/user/', {
      action_type: '1', type: '1', sec_user_id: secUid,
    }), { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async unfollow(secUid: string): Promise<TikTokActionResponse> {
    if (this._proxy?.unfollow) {
      return this._proxy.unfollow(secUid)
    }
    const raw = await this.request<any>(this.buildUrl('/api/commit/follow/user/', {
      action_type: '0', type: '0', sec_user_id: secUid,
    }), { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async followByUsername(username: string): Promise<TikTokActionResponse> {
    const profile = await this.getUserProfile(username)
    if (!profile || !profile.user.secUid) return { success: false, statusMsg: 'User not found' }
    return this.follow(profile.user.secUid)
  }

  async unfollowByUsername(username: string): Promise<TikTokActionResponse> {
    const profile = await this.getUserProfile(username)
    if (!profile || !profile.user.secUid) return { success: false, statusMsg: 'User not found' }
    return this.unfollow(profile.user.secUid)
  }

  async getFollowers(userId: string, cursor = ''): Promise<{ users: TikTokUserProfile[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl('/api/user/follower_list/', {
      userId,
      count: '30',
      cursor,
      sourceType: '1',
    })
    const raw = await this.request<any>(url)
    return {
      users: (raw.followers || raw.followerList || raw.userList || []).map(mapUserProfile),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getFollowing(userId: string, cursor = ''): Promise<{ users: TikTokUserProfile[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl('/api/user/following_list/', {
      userId,
      count: '30',
      cursor,
      sourceType: '1',
    })
    const raw = await this.request<any>(url)
    return {
      users: (raw.followings || raw.followingList || raw.userList || []).map(mapUserProfile),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  private _commentCsrfToken: string | null = null

  private async _refreshCommentCsrfToken(): Promise<string> {
    const cookieJar = this.config.cookieJar
    const cookieStr = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch('https://www.tiktok.com/api/comment/publish/', {
        method: 'HEAD',
        headers: {
          'x-secsdk-csrf-request': '1',
          'x-secsdk-csrf-version': '1.2.22',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
          'Cookie': cookieStr,
          'Origin': BASE_URL,
          'Referer': BASE_URL + '/',
        },
        signal: controller.signal,
      })
      clearTimeout(timeout)
      const tokenHeader = res.headers.get('x-ware-csrf-token') || ''
      const parts = tokenHeader.split(',')
      if (parts[0] === '0' && parts[1]) {
        this._commentCsrfToken = parts[1]
        const csrfSessionId = parts[4]
        if (csrfSessionId && !cookieJar['csrf_session_id']) {
          cookieJar['csrf_session_id'] = csrfSessionId
        }
        return parts[1]
      }
    } catch { /* token fetch failed */ }
    return ''
  }

  private async _buildCommentRequest(videoId: string, text: string, replyTo?: string): Promise<{ url: string; headers: Record<string, string>; body: string }> {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
    const msToken = generateMsToken()

    const params: Record<string, string> = {
      aid: '1988',
      app_name: 'tiktok_web',
      device_platform: 'web_pc',
      msToken,
    }
    const queryStr = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    const xbogus = generateXBogus(params, ua)
    const queryWithBogus = queryStr + '&X-Bogus=' + encodeURIComponent(xbogus)

    const body = new URLSearchParams({
      aweme_id: videoId,
      text,
      text_extra: '[]',
      channel_id: '0',
      ...(replyTo ? { reply_to: replyTo, type: '0' } : {}),
    }).toString()

    const xgnarly = generateXGnarly(queryStr, body, ua)
    const url = BASE_URL + '/api/comment/publish/?' + queryWithBogus + '&X-Gnarly=' + encodeURIComponent(xgnarly)

    // Get or refresh CSRF token
    if (!this._commentCsrfToken) {
      await this._refreshCommentCsrfToken()
    }
    const csrfToken = this._commentCsrfToken || ''

    // Ticket guard headers
    const ticketHeaders = this._ticketGuardKeys
      ? makeTicketGuardHeaders('/api/comment/publish/', this._ticketGuardKeys)
      : {}

    const cookieStr = Object.entries(this.config.cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')

    const headers: Record<string, string> = {
      'User-Agent': ua,
      'Accept': '*/*',
      'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      ...(csrfToken ? { 'x-secsdk-csrf-token': csrfToken } : {}),
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/video/${videoId}`,
      'Cookie': cookieStr,
      ...ticketHeaders,
    }

    return { url, headers, body }
  }

  async publishComment(videoId: string, text: string): Promise<TikTokActionResponse> {
    if (this._proxy?.page) {
      const result = await this._proxy.commentViaApi(videoId, text)
      return {
        success: result.success,
        statusCode: result.statusCode || 0,
        statusMsg: result.statusMsg || '',
        commentId: result.commentId || '',
      }
    }
    const { url, headers, body } = await this._buildCommentRequest(videoId, text)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      this.setCookiesFromResponse(res)
      const rawText = await res.text()
      const raw = (() => { try { return JSON.parse(rawText) } catch { return rawText } })() as any
      const commentId = raw?.comment?.id || raw?.comment?.cid || raw?.data?.comment_id || ''
      return {
        success: !!raw?.comment || raw?.status_code === 0,
        statusCode: raw?.status_code,
        statusMsg: raw?.status_msg,
        commentId,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async replyToComment(videoId: string, commentId: string, text: string): Promise<TikTokActionResponse> {
    if (this._proxy?.page) {
      const result = await this._proxy.replyComment(videoId, commentId, text)
      return {
        success: result.success,
        statusCode: result.statusCode || 0,
        statusMsg: result.statusMsg || '',
        commentId: result.commentId || '',
      }
    }
    const { url, headers, body } = await this._buildCommentRequest(videoId, text, commentId)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)
    try {
      const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal })
      this.setCookiesFromResponse(res)
      const rawText = await res.text()
      const raw = (() => { try { return JSON.parse(rawText) } catch { return rawText } })() as any
      const replyId = raw?.comment?.id || raw?.comment?.cid || raw?.data?.comment_id || ''
      return {
        success: !!raw?.comment || raw?.status_code === 0,
        statusCode: raw?.status_code,
        statusMsg: raw?.status_msg,
        commentId: replyId,
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  async deleteComment(videoId: string, commentId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/comment/delete/', {
      aweme_id: videoId,
      comment_id: commentId,
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async likeComment(commentId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/comment/digg/', {
      comment_id: commentId,
      type: '1',
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async unlikeComment(commentId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/comment/undigg/', {
      comment_id: commentId,
      type: '1',
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async pinComment(videoId: string, commentId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/comment/pin/', {
      item_id: videoId,
      comment_id: commentId,
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async unpinComment(videoId: string, commentId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/comment/unpin/', {
      item_id: videoId,
      comment_id: commentId,
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async collect(videoId: string): Promise<TikTokActionResponse> {
    if (this._proxy?.collect) {
      return this._proxy.collect(videoId)
    }
    const verifyFp = this.config.cookieJar['s_v_web_id'] || ''
    const extraParams: Record<string, string> = {
      WebIdLastTime: String(Math.floor(Date.now() / 1000)),
      aweme_id: videoId,
      from_page: 'video',
      history_len: '4',
      type: '1',
      ...(verifyFp ? { verifyFp } : {}),
    }
    const url = this.buildUrl('/api/commit/item/collect/', extraParams)

    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async uncollect(videoId: string): Promise<TikTokActionResponse> {
    if (this._proxy?.uncollect) {
      return this._proxy.uncollect(videoId)
    }
    const verifyFp = this.config.cookieJar['s_v_web_id'] || ''
    const extraParams: Record<string, string> = {
      WebIdLastTime: String(Math.floor(Date.now() / 1000)),
      aweme_id: videoId,
      from_page: 'video',
      history_len: '4',
      type: '2',
      ...(verifyFp ? { verifyFp } : {}),
    }
    const url = this.buildUrl('/api/commit/item/collect/', extraParams)
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async repost(videoId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/commit/item/repost/', {
      item_id: videoId,
      type: '1',
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async unrepost(videoId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/commit/item/repost/', {
      item_id: videoId,
      type: '2',
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async share(videoId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/commit/item/share/', {
      item_id: videoId,
      type: '1',
    })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  // ─── Messaging / IM (endpoints may be stale — need re-discovery) ────

  async getSpotlightRelation(): Promise<any> {
    const url = this.buildUrl('/api/im/spotlight/relation/', { count: '90' })
    return this.request<any>(url)
  }

  async getConversations(cursor = ''): Promise<TikTokConversationListResponse> {
    try {
      const dmRest = this._getDmRestClient()
      const list = await dmRest.getConversations()
      if (list && list.length > 0) {
        return {
          conversations: list.map(c => ({
            id: c.conversationId,
            type: c.conversationType,
            name: c.name || `Chat with ${c.conversationId.split(':').pop()}`,
            avatar: '',
            lastMessage: c.lastMessage ? {
              id: '',
              conversationId: c.conversationId,
              content: c.lastMessage,
              type: 1,
              fromUser: null,
              createTime: c.updatedAt || 0,
              status: 0,
            } : null,
            unreadCount: 0,
            users: [],
            isMuted: false,
            isVerified: false,
            createTime: c.updatedAt || 0,
          })),
          cursor: 0,
          hasMore: false,
        }
      }
    } catch {
      // Fallback
    }

    const url = this.buildUrl('/api/im/conversation/list/', { count: '20', cursor })
    const raw = await this.request<any>(url)
    return {
      conversations: (raw.conversations || raw.conversation_list || []).map(mapConversation),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getMessages(conversationId: string, cursor = ''): Promise<TikTokMessageListResponse> {
    try {
      const dmRest = this._getDmRestClient()
      const res = await dmRest.getMessages(conversationId, undefined, 50, cursor)
      if (res && res.messages && res.messages.length > 0) {
        return {
          messages: res.messages.map(m => ({
            id: m.id,
            conversationId: m.conversationId,
            content: m.text,
            type: m.conversationType,
            fromUser: null,
            createTime: m.createTime,
            status: 0,
          })),
          cursor: Number(res.nextCursor || 0),
          hasMore: res.hasMore,
        }
      }
    } catch {
      // Fallback
    }

    const url = this.buildUrl('/api/im/message/list/', { conversation_id: conversationId, count: '50', cursor })
    const raw = await this.request<any>(url)
    return {
      messages: (raw.messages || raw.message_list || []).map((m: any) => mapMessage(m, conversationId)),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async sendMessage(conversationId: string, text: string): Promise<TikTokMessageResult> {
    try {
      const dmRest = this._getDmRestClient()
      const res = await dmRest.sendMessage(conversationId, text)
      if (res.success) {
        return {
          success: true,
          messageId: res.messageId || '',
          conversationId,
        }
      }
      return { success: false, error: res.error || 'Failed to send message' }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  async getImUserProfile(userIds: string[]): Promise<any> {
    const url = this.buildUrl('/tiktok/v1/im/user/profile/', { user_ids: JSON.stringify(userIds) })
    return this.request<any>(url)
  }

  onMessage(callback: (msg: DmMessage) => void): () => void {
    this._messageListeners.push(callback)
    return () => {
      this._messageListeners = this._messageListeners.filter(l => l !== callback)
    }
  }

  async startMessageListener(intervalMs = 3000): Promise<void> {
    if (this._messagePollingTimer) return
    const dmRest = this._getDmRestClient()

    try {
      const convs = await dmRest.getConversations()
      if (convs && convs.length > 0) {
        const msgs = await dmRest.getMessages(convs[0].conversationId, convs[0].conversationShortId, 5)
        if (msgs.messages.length > 0) {
          this._lastKnownMessageId = msgs.messages[0].id
        }
      }
    } catch {}

    this._messagePollingTimer = setInterval(async () => {
      try {
        const convs = await dmRest.getConversations()
        if (!convs || convs.length === 0) return
        for (const c of convs) {
          const res = await dmRest.getMessages(c.conversationId, c.conversationShortId, 5)
          for (const m of res.messages) {
            if (this._lastKnownMessageId && BigInt(m.id || 0) > BigInt(this._lastKnownMessageId || 0)) {
              this._lastKnownMessageId = m.id
              for (const listener of this._messageListeners) {
                try { listener(m) } catch {}
              }
            }
          }
        }
      } catch {}
    }, intervalMs)
  }

  stopMessageListener(): void {
    if (this._messagePollingTimer) {
      clearInterval(this._messagePollingTimer)
      this._messagePollingTimer = null
    }
  }

  async reportView(videoId: string, watchTimeSeconds = 5): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/api/item/view/', {
      item_id: videoId,
      play_delta: String(watchTimeSeconds * 1000),
      action_time: String(Date.now()),
      signal: '1',
    })
    try {
      const raw = await this.request<any>(url, { method: 'POST' })
      return {
        success: raw?.status_code === 0 || raw?.statusCode === 0 || raw?.status_code === undefined,
        statusCode: raw?.status_code ?? 0,
        statusMsg: raw?.status_msg ?? 'view reported',
      }
    } catch (e: any) {
      return { success: false, statusMsg: e.message }
    }
  }

  // ──────────────────────────────────────────────────────────────────

  async getFavorites(cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl('/api/favorite/item_list/', { count: '30', cursor })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw?.itemList || [])
    return {
      items: (raw?.itemList || []).map(mapVideoItem),
      cursor: Number(raw?.cursor || 0),
      hasMore: raw?.hasMore ?? false,
    }
  }

  async getReposts(cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl('/api/repost/item_list/', { count: '30', cursor })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw?.itemList || [])
    return {
      items: (raw?.itemList || []).map(mapVideoItem),
      cursor: Number(raw?.cursor || 0),
      hasMore: raw?.hasMore ?? false,
    }
  }

  async getFriendFeed(cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl('/api/friend/item/list/', { count: '30', cursor })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw?.itemList || [])
    return {
      items: (raw?.itemList || []).map(mapVideoItem),
      cursor: Number(raw?.cursor || 0),
      hasMore: raw?.hasMore ?? false,
    }
  }

  async getUploadAuth(): Promise<{ uploadUrl?: string; url?: string; accessKey: string; policy: string; signature: string; key: string } | null> {
    const url = this.buildUrl('/api/v1/web/project/auth/')
    const raw = await this.request<any>(url)
    if (raw?.data) return raw.data
    if (raw?.upload_url || raw?.url) return raw
    return null
  }

  /**
   * Get VOD STS credentials for upload
   */
  private async _getVodAuth(): Promise<VodCredentials | null> {
    const url = this.buildUrl('/api/v1/video/upload/auth/')
    const raw = await this.request<any>(url)
    if (!raw?.video_token_v5) return null
    const tok = raw.video_token_v5
    return {
      accessKeyId: tok.access_key_id,
      secretAccessKey: tok.secret_acess_key,
      sessionToken: tok.session_token,
      region: 'ap-singapore-1',
    }
  }

  private async _vodRequest<T>(
    method: string,
    path: string,
    query: Record<string, string>,
    auth: VodCredentials,
    body?: string
  ): Promise<T> {
    const extraHeaders: Record<string, string> = {}
    if (method === 'POST' && body) {
      extraHeaders['content-type'] = 'text/plain;charset=UTF-8'
    }
    const cookieStr = Object.entries(this.config.cookieJar)
      .filter(([k]) => !k.startsWith('_'))
      .map(([k, v]) => k + '=' + v)
      .join('; ')
    if (cookieStr) extraHeaders['Cookie'] = cookieStr
    const { headers } = signVodRequest(method, path, query, auth, body || '', extraHeaders)
    const qs = Object.keys(query).sort().map(k => k + '=' + encodeURIComponent(query[k])).join('&')
    const fullUrl = 'https://www.tiktok.com' + path + '?' + qs

    const opts: any = { method, headers }
    if (method === 'POST' && body) opts.body = body

    const res = await fetch(fullUrl, opts)
    const text = await res.text()
    if (!res.ok) throw new Error('VOD request failed: ' + text.slice(0, 200))
    return JSON.parse(text)
  }

  // Simple CRC32 for TOS upload header
  private _crc32(buf: Buffer): string {
    let crc = 0xFFFFFFFF
    const table = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      }
      table[i] = c
    }
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
    }
    return ((crc ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')
  }

  async uploadVideo(
    filePath: string,
    config: TikTokUploadConfig = {}
  ): Promise<TikTokUploadResult> {
    // Step 1: Get VOD STS credentials
    const vodAuth = await this._getVodAuth()
    if (!vodAuth) return { success: false, error: 'Could not get VOD upload authorization' }

    const fileBuffer = fs.readFileSync(filePath)
    const fileSize = fileBuffer.length

    // Step 2: GetUploadCandidates
    const candResult = await this._vodRequest<{ Result: { Candidates: Array<{ Cluster: string; Domains: Array<{ Name: string }> }> } }>(
      'GET', '/top/v1',
      { Action: 'GetUploadCandidates', Version: '2020-11-19', SpaceName: 'tiktok', 'X-Amz-Expires': '604800' },
      vodAuth
    )
    const candidates = candResult.Result?.Candidates || []
    const bestHosts = candidates
      .filter(c => c.Cluster === 'my' || c.Cluster === 'my2')
      .flatMap(c => c.Domains.map(d => d.Name))
      .join(',')

    // Step 3: ApplyUploadInner
    const applyQuery: Record<string, string> = {
      Action: 'ApplyUploadInner',
      Version: '2020-11-19',
      SpaceName: 'tiktok',
      FileType: 'video',
      IsInner: '1',
      'X-Amz-Expires': '604800',
      device_platform: 'web',
    }
    if (bestHosts) applyQuery.ClientBestHosts = bestHosts

    const applyResult = await this._vodRequest<{
      Result: {
        InnerUploadAddress: {
          UploadNodes: Array<{
            Vid: string
            StoreInfos: Array<{ StoreUri: string; Auth: string; UploadID?: string }>
            UploadHost: string
            SessionKey: string
          }>
        }
      }
    }>('GET', '/top/v1', applyQuery, vodAuth)

    const nodes = applyResult.Result?.InnerUploadAddress?.UploadNodes
    if (!nodes?.length) return { success: false, error: 'ApplyUploadInner returned no upload nodes' }

    const node = nodes[0]
    const storeInfo = node.StoreInfos[0]
    const uploadHost = node.UploadHost
    const uploadId = storeInfo.UploadID || ''
    const storeUri = storeInfo.StoreUri
    const authToken = storeInfo.Auth

    // Step 4: Upload video file to TOS CDN
    const uploadUrl = `https://${uploadHost}/upload/v1/${storeUri}${uploadId ? '?uploadid=' + uploadId + '&device_platform=web' : '?device_platform=web'}`
    const userId = this.config.cookieJar['uid_tt'] || ''
    const crc32 = this._crc32(fileBuffer)

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/octet-stream',
        'Content-CRC32': crc32,
        'Content-Disposition': 'attachment; filename="video.mp4"',
        'X-Storage-U': userId,
        'Origin': 'https://www.tiktok.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      },
      body: fileBuffer,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '')
      return { success: false, error: `TOS upload failed: status ${uploadRes.status} ${errText}` }
    }

    const uploadRespText = await uploadRes.text()
    let uploadResp: any
    try { uploadResp = JSON.parse(uploadRespText) } catch {}
    if (!uploadResp || uploadResp.code !== 2000) {
      return { success: false, error: `TOS upload response error: ${uploadRespText.slice(0, 200)}` }
    }

    // Step 5: CommitUploadInner
    const sessionKey = node.SessionKey
    const commitBody = JSON.stringify({ SessionKey: sessionKey, Functions: [] })

    const commitResult = await this._vodRequest<{
      ResponseMetadata: { Action: string }
      Result?: { RequestId: string; Results?: Array<{ Vid?: string; Uri?: string; UriStatus?: number }> }
    }>('POST', '/top/v1',
      { Action: 'CommitUploadInner', Version: '2020-11-19', SpaceName: 'tiktok' },
      vodAuth,
      commitBody
    )

    const commitResults = commitResult.Result?.Results
    const commitSuccess = commitResults?.some(r => r.Vid || r.UriStatus === 2000)
    if (!commitSuccess) {
      return { success: false, error: 'CommitUploadInner failed' }
    }

    const vid = commitResults?.find(r => r.Vid)?.Vid || ''

    // Step 6: Navigate to upload page for proper context
    if (this._proxy) {
      await this._proxy.navigate('https://www.tiktok.com/tiktokstudio/upload')
    }

    // Step 7: Create post via TikTok Studio API
    const creationId = Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 5)
    const videoDuration = config.duration || 6600
    const text = buildPostText(config.desc || config.title || '', config.hashtags, config.mentions)
    const textExtra = buildTextExtra(text, config.hashtags, config.mentions)
    const musicInfo: Record<string, any> = { origin_volume: '100' }
    if (config.musicId) {
      musicInfo.id = config.musicId
    }
    const postBody = JSON.stringify({
      post_common_info: {
        creation_id: creationId,
        enter_post_page_from: 8,
        post_type: 3,
      },
      feature_common_info_list: [{
        geofencing_regions: [],
        playlist_name: '',
        playlist_id: '',
        tcm_params: '{"commerce_toggle_info":{}}',
        sound_exemption: 0,
        anchors: [],
        vedit_common_info: {
          draft: '',
          video_id: vid,
        },
        privacy_setting_info: {
          visibility_type: config.privacyLevel ?? 0,
          allow_duet: config.allowDuet === true ? true : null,
          allow_stitch: config.allowStitch === true ? true : null,
          allow_comment: config.allowComment === false ? 0 : 1,
          allow_content_reuse: 1,
        },
        content_check_id: '',
      }],
      single_post_req_list: [{
        batch_index: 0,
        video_id: vid,
        is_long_video: 0,
        single_post_feature_info: {
          text,
          text_extra: textExtra,
          markup_text: text,
          music_info: musicInfo,
          cover_info: {
            isProcessingInitialCover: false,
            frame_duration: 0,
            cover_width: 720,
            cover_height: 960,
            cover_type: 1,
            crop_type: 2,
            isAutoCropFirstFrame: true,
            poster_delay: 0,
          },
          poster_delay: 0,
          has_original_audio: 1,
          is_upload_audio_track: false,
          video_track_time_range_list: [{
            start_time_in_ms: 0,
            end_time_in_ms: videoDuration,
          }],
        },
      }],
    })

    const postUrl = this.buildUrl('/tiktok/web/project/post/v1/', {})
    const postResult = await this.request<any>(postUrl, {
      method: 'POST',
      body: postBody,
      headers: { 'Content-Type': 'application/json' },
    })

    if (postResult?.status_code === 0 && postResult?.single_post_resp_list?.[0]?.item_id) {
      return {
        success: true,
        videoId: String(postResult.single_post_resp_list[0].item_id),
      }
    }
    const errMsg = JSON.stringify(postResult) || 'Failed to create post'
    return { success: false, error: errMsg }
  }

  async uploadImage(
    filePath: string,
    config: TikTokUploadConfig = {}
  ): Promise<TikTokUploadResult> {
    const vodAuth = await this._getVodAuth()
    if (!vodAuth) return { success: false, error: 'Could not get VOD upload authorization' }

    const fileBuffer = fs.readFileSync(filePath)
    const fileSize = fileBuffer.length

    const candResult = await this._vodRequest<{
      Result: { Candidates: Array<{ Cluster: string; Domains: Array<{ Name: string }> }> }
    }>('GET', '/top/v1',
      { Action: 'GetUploadCandidates', Version: '2020-11-19', SpaceName: 'tiktok', 'X-Amz-Expires': '604800' },
      vodAuth
    )
    const candidates = candResult.Result?.Candidates || []
    const bestHosts = candidates
      .filter(c => c.Cluster === 'my' || c.Cluster === 'my2')
      .flatMap(c => c.Domains.map(d => d.Name))
      .join(',')

    const applyQuery: Record<string, string> = {
      Action: 'ApplyUploadInner',
      Version: '2020-11-19',
      SpaceName: 'tiktok',
      FileType: 'image',
      IsInner: '1',
      FileSize: String(fileSize),
      'X-Amz-Expires': '604800',
      device_platform: 'web',
    }
    if (bestHosts) applyQuery.ClientBestHosts = bestHosts

    const applyResult = await this._vodRequest<{
      Result: {
        InnerUploadAddress?: {
          UploadNodes: Array<{
            StoreInfos: Array<{ StoreUri: string; Auth: string; UploadID?: string }>
            UploadHost: string
            SessionKey: string
          }>
        }
        UploadAddress?: {
          StoreInfos: Array<{ StoreUri: string; Auth: string; UploadID?: string }>
          UploadHosts: string[]
          SessionKey?: string
        }
      }
    }>('GET', '/top/v1', applyQuery, vodAuth)

    let storeInfo: { StoreUri: string; Auth: string; UploadID?: string }
    let uploadHost: string
    let sessionKey: string

    if (applyResult.Result?.InnerUploadAddress?.UploadNodes?.length) {
      const node = applyResult.Result.InnerUploadAddress.UploadNodes[0]
      storeInfo = node.StoreInfos[0]
      uploadHost = node.UploadHost
      sessionKey = node.SessionKey
    } else if (applyResult.Result?.UploadAddress?.StoreInfos?.length) {
      storeInfo = applyResult.Result.UploadAddress.StoreInfos[0]
      uploadHost = applyResult.Result.UploadAddress.UploadHosts[0]
      sessionKey = applyResult.Result.UploadAddress.SessionKey || ''
    } else {
      return { success: false, error: 'ApplyUploadInner returned no upload address' }
    }

    const uploadId = storeInfo.UploadID || ''
    const storeUri = storeInfo.StoreUri
    const authToken = storeInfo.Auth

    const uploadUrl = `https://${uploadHost}/upload/v1/${storeUri}${uploadId ? '?uploadid=' + uploadId + '&device_platform=web' : '?device_platform=web'}`
    const userId = this.config.cookieJar['uid_tt'] || ''
    const crc32 = this._crc32(fileBuffer)

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': authToken,
        'Content-Type': 'application/octet-stream',
        'Content-CRC32': crc32,
        'Content-Disposition': 'attachment; filename="image.jpg"',
        'X-Storage-U': userId,
        'Origin': 'https://www.tiktok.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
      },
      body: fileBuffer,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text().catch(() => '')
      return { success: false, error: `TOS upload failed: status ${uploadRes.status} ${errText}` }
    }

    const uploadRespText = await uploadRes.text()
    let uploadResp: any
    try { uploadResp = JSON.parse(uploadRespText) } catch {}
    if (!uploadResp || uploadResp.code !== 2000) {
      return { success: false, error: `TOS upload response error: ${uploadRespText.slice(0, 200)}` }
    }

    const commitBody = JSON.stringify({ SessionKey: sessionKey, Functions: [] })

    const commitResult = await this._vodRequest<{
      ResponseMetadata: { Action: string }
      Result?: { RequestId: string; Results?: Array<{ Uri?: string; UriStatus?: number }> }
    }>('POST', '/top/v1',
      { Action: 'CommitUploadInner', Version: '2020-11-19', SpaceName: 'tiktok' },
      vodAuth,
      commitBody
    )

    const commitResults = commitResult.Result?.Results
    const commitSuccess = commitResults?.some(r => r.UriStatus === 2000)
    if (!commitSuccess) {
      return { success: false, error: 'CommitUploadInner failed' }
    }

    const imageUri = commitResults?.find(r => r.Uri)?.Uri || storeUri

    // Step 6: Create post if title or desc is provided
    const text = buildPostText(config.desc || config.title || '', config.hashtags, config.mentions)
    if (!text.trim()) {
      return { success: true, imageUri }
    }

    const textExtra = buildTextExtra(text, config.hashtags, config.mentions)
    const creationId = Math.random().toString(36).slice(2, 15) + Math.random().toString(36).slice(2, 5)
    const postBody = JSON.stringify({
      post_common_info: {
        creation_id: creationId,
        enter_post_page_from: 8,
        post_type: 2,
      },
      feature_common_info_list: [{
        geofencing_regions: [],
        playlist_name: '',
        playlist_id: '',
        tcm_params: '{"commerce_toggle_info":{}}',
        sound_exemption: 0,
        anchors: [],
        post_photo_info: { image_uris: [imageUri] },
        privacy_setting_info: {
          visibility_type: config.privacyLevel ?? 0,
          allow_duet: null,
          allow_stitch: null,
          allow_comment: config.allowComment === false ? 0 : 1,
          allow_content_reuse: 1,
        },
        content_check_id: '',
      }],
      single_post_req_list: [{
        batch_index: 0,
        single_post_feature_info: {
          text,
          text_extra: textExtra,
          markup_text: text,
        },
      }],
    })

    const postUrl = this.buildUrl('/tiktok/web/project/post/v1/', {})
    const postResult = await this.request<any>(postUrl, {
      method: 'POST',
      body: postBody,
      headers: { 'Content-Type': 'application/json' },
    })

    if (postResult?.status_code === 0 && postResult?.single_post_resp_list?.[0]?.item_id) {
      return {
        success: true,
        videoId: String(postResult.single_post_resp_list[0].item_id),
        imageUri,
      }
    }

    const errMsg = JSON.stringify(postResult) || 'Failed to create post'
    return { success: false, error: errMsg, imageUri }
  }

  async getNotifications(cursor = ''): Promise<{ notifications: TikTokNotification[]; cursor: number; hasMore: boolean; unreadCount: number }> {
    const url = this.buildUrl('/api/inbox/notice_list/', { cursor, count: '20' })
    const raw = await this.request<any>(url)
    return {
      notifications: (raw.notifications || raw.notice_list || raw.itemList || []).map(mapNotification),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
      unreadCount: Number(raw.unread_count || raw.unreadCount || 0),
    }
  }

  async getNotificationCount(): Promise<number> {
    const url = this.buildUrl('/api/inbox/notice_list/', { count: '1', cursor: '0' })
    const raw = await this.request<any>(url)
    return Number(raw?.unread_count || raw?.unreadCount || raw?.count || 0)
  }

  async getInbox(cursor = ''): Promise<{ notifications: TikTokNotification[]; cursor: number; hasMore: boolean; unreadCount: number }> {
    const url = this.buildUrl('/api/inbox/notice_list/', { cursor, count: '30' })
    const raw = await this.request<any>(url)
    return {
      notifications: (raw.notifications || raw.notice_list || raw.itemList || []).map(mapNotification),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
      unreadCount: Number(raw.unread_count || raw.unreadCount || 0),
    }
  }

  async getUserProfile(username: string): Promise<TikTokUserProfile> {
    let raw: any = {}
    let fromApi = false

    const apiUrl = this.buildUrl(`/api/user/detail/`, { uniqueId: username }, true)
    raw = await this.request<any>(apiUrl, { skipSigning: true })
    if (raw?.user || raw?.userInfo) fromApi = true

    if (!fromApi) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const html = await this.request<string>(`${BASE_URL}/@${username}`, { skipSigning: true })
        if (html.length > 100) {
          const match = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
          if (match) {
            try {
              const data = JSON.parse(match[1])
              const scope = data['__DEFAULT_SCOPE__'] || data
              for (const key of Object.keys(scope)) {
                const val = scope[key]
                const userData = val?.user || val?.userInfo?.user || val?.userInfo
                if (userData?.secUid && userData?.uniqueId === username) {
                  raw = { user: userData, stats: val?.stats || {} }
                  fromApi = true
                  break
                }
              }
            } catch { }
          }
          if (fromApi) break
        }
        if (attempt < 2) await new Promise(r => setTimeout(r, 2000))
      }
    }
    return mapUserProfile(raw)
  }

  async getUserVideos(username: string, cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl(`/api/post/item_list/`, {
      secUid: '',
      userId: (this._appContext?.wid || ''),
      count: '30',
      cursor,
      type: '1',
      uniqueId: username,
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getUserLikedVideos(username: string, cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl(`/api/favorite/item_list/`, {
      uniqueId: username,
      count: '30',
      cursor,
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getVideoDetail(videoId: string): Promise<TikTokVideoItem | null> {
    const cached = this._videoDetailCache.get(videoId)
    if (cached !== undefined) return cached

    const url = this.buildUrl(`/api/item/detail/`, {
      itemId: videoId,
      uniqueId: '',
    })
    const raw = await this.request<any>(url)
    if (raw?.item) {
      const item = mapVideoItem(raw.item)
      this._videoDetailCache.set(videoId, item)
      return item
    }

    const username = this._videoAuthorCache.get(videoId)

    if (this._proxy) {
      const item = await this._extractDetailViaBrowser(videoId, username)
      if (item) {
        const mapped = mapVideoItem(item)
        this._videoDetailCache.set(videoId, mapped)
        return mapped
      }
    }

    try {
      const { extractVideoDetail } = require('./utils/extract')
      const item = await extractVideoDetail(videoId, {
        username,
        cookieJar: this.config.cookieJar,
      })
      if (item) {
        const mapped = mapVideoItem(item)
        this._videoDetailCache.set(videoId, mapped)
        return mapped
      }
    } catch { }

    this._videoDetailCache.set(videoId, null)
    return null
  }

  private async _extractDetailViaBrowser(videoId: string, username?: string): Promise<any | null> {
    const page = this._proxy?.page
    if (!page) return null

    const videoUrl = username
      ? `${BASE_URL}/@${username}/video/${videoId}`
      : `${BASE_URL}/video/${videoId}`

    try {
      await page.goto(videoUrl, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(2000)

      const data: any = await this._proxy.page.evaluate(`(function() {
        var el = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__');
        if (el && el.textContent) return JSON.parse(el.textContent);
        return null;
      })()`)

      if (data) {
        const scope = data.__DEFAULT_SCOPE__
        const videoDetail = scope?.['webapp.video-detail']
        if (videoDetail?.itemInfo?.itemStruct) {
          const author = videoDetail.itemInfo.itemStruct.author || videoDetail.itemInfo.itemStruct.owner
          if (author?.uniqueId) this._videoAuthorCache.set(videoId, author.uniqueId)
          return videoDetail.itemInfo.itemStruct
        }
      }
    } catch { }

    return null
  }

  async getComments(videoId: string, cursor = ''): Promise<{ comments: TikTokComment[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/comment/list/`, {
      aweme_id: videoId,
      count: '20',
      cursor,
      item_type: '0',
    })
    const raw = await this.request<any>(url)
    return {
      comments: (raw.comments || []).map(mapComment),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getCommentReplies(commentId: string, videoId: string, cursor = ''): Promise<{ replies: TikTokComment[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/comment/list/reply/`, {
      comment_id: commentId,
      item_id: videoId,
      count: '20',
      cursor,
    })
    const raw = await this.request<any>(url)
    return {
      replies: (raw.comments || []).map(mapComment),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async searchVideos(keyword: string, cursor = ''): Promise<TikTokSearchResponse> {
    const url = this.buildUrl(`/api/search/item/full/`, {
      keyword,
      count: '20',
      cursor,
      type: '1',
      is_personalized: '1',
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || raw.data || [])
    return {
      items: (raw.itemList || raw.data || []).map(mapVideoItem),
      cursor: raw.cursor || 0,
      hasMore: raw.hasMore ?? false,
    }
  }

  async searchUsers(keyword: string, cursor = ''): Promise<{ users: TikTokUserProfile[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/search/user/full/`, {
      keyword,
      count: '20',
      cursor,
      type: '1',
    })
    const raw = await this.request<any>(url)
    return {
      users: (raw.userList || raw.data || []).map(mapUserProfile),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async searchHashtags(keyword: string, cursor = ''): Promise<{ hashtags: any[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/search/challenge/full/`, {
      keyword,
      count: '20',
      cursor,
      type: '1',
    })
    const raw = await this.request<any>(url)
    return {
      hashtags: (raw.challengeList || raw.data || []).map((h: any) => ({
        id: String(h.challenge?.id || h.id || ''),
        name: h.challenge?.chaName || h.chaName || '',
        title: h.challenge?.title || h.title || '',
        cover: h.challenge?.coverLarger || h.coverLarger || '',
        stats: {
          videoCount: Number(h.challenge?.stats?.videoCount || h.stats?.videoCount || 0),
          viewCount: Number(h.challenge?.stats?.viewCount || h.stats?.viewCount || 0),
        },
      })),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async searchLive(keyword: string, cursor = ''): Promise<{ streams: TikTokLiveStream[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/search/live/full/`, {
      keyword,
      count: '20',
      cursor,
      type: '1',
    })
    const raw = await this.request<any>(url)
    return {
      streams: (raw.data || []).map((s: any) => ({
        id: String(s.room?.id || s.id || ''),
        title: s.room?.title || s.title || '',
        status: s.room?.status || s.status || 0,
        streamUrl: s.room?.streamUrl || s.streamUrl || '',
        coverUrl: s.room?.coverUrl || s.coverUrl || '',
        user: mapUser(s.room?.owner || s.owner || s.user || {}),
        stats: {
          viewerCount: Number(s.room?.stats?.viewerCount || s.stats?.viewerCount || 0),
          likeCount: Number(s.room?.stats?.likeCount || s.stats?.likeCount || 0),
        },
        roomId: s.room?.id || s.id || '',
      })),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getExplore(categoryType = 120, cursor = ''): Promise<TikTokExploreResponse> {
    const url = this.buildUrl('/api/prefetch/explore/item_list/', {
      categoryType: String(categoryType),
      count: '30',
      cursor,
      pullType: cursor ? '2' : '1',
      video_encoding: 'dash',
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getHashtagFeed(hashtagName: string, cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl(`/api/challenge/item_list/`, {
      challengeName: hashtagName,
      count: '30',
      cursor,
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getHashtagDetail(hashtagName: string): Promise<any> {
    const url = this.buildUrl(`/api/challenge/detail/`, {
      challengeName: hashtagName,
    })
    return this.request<any>(url)
  }

  async getMusicFeed(musicId: string, cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl(`/api/music/item_list/`, {
      musicId,
      count: '30',
      cursor,
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getMusicDetail(musicId: string): Promise<any> {
    const url = this.buildUrl(`/api/music/detail/`, { musicId })
    return this.request<any>(url)
  }

  async searchMusic(keyword: string, cursor = ''): Promise<{ music: any[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl(`/api/search/music/full/`, {
      keyword,
      count: '20',
      cursor,
      type: '1',
    })
    const raw = await this.request<any>(url)
    return {
      music: (raw.musicList || raw.data || []).map((m: any) => ({
        id: String(m.music?.id || m.id || ''),
        title: m.music?.title || m.title || '',
        author: m.music?.author || m.author || '',
        duration: Number(m.music?.duration || m.duration || 0),
        cover: m.music?.coverLarge || m.coverLarge || '',
      })),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getLoginConfig(): Promise<LoginConfig> {
    const url = this.buildUrl('/node-webapp/api/login-config')
    return this.request<LoginConfig>(url)
  }

  async getFeed(count = 12, cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl('/api/recommend/item_list/', {
      count: String(count),
      coverFormat: '2',
      isNonPersonalized: 'false',
      itemID: cursor,
      pullType: cursor ? '2' : '1',
      video_encoding: 'dash',
      device_type: 'web_h265',
      ...(cursor ? {} : { is_new_user: 'true' }),
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || raw.items || [])
    return {
      items: ((raw.itemList || raw.items || []) as any[]).map(mapVideoItem),
      cursor: Number(raw.cursor || raw.extra?.now || 0),
      hasMore: raw.hasMore ?? true,
      preloadSize: raw.preloadSize,
    }
  }

  private _cacheVideoAuthors(items: any[]): void {
    for (const item of items) {
      const id = String(item.id || item.itemId || item.item_id || item.aweme_id || item.group_id || '')
      if (id) {
        const author = item.author || item.owner || {}
        const uniqueId = author.uniqueId || author.unique_id || ''
        if (uniqueId) this._videoAuthorCache.set(id, uniqueId)
      }
    }
  }

  async getTrendingFeed(cursor = ''): Promise<TikTokFeedResponse> {
    return this.getFeed(12, cursor)
  }

  async getFollowingFeed(cursor = ''): Promise<TikTokFeedResponse> {
    const url = this.buildUrl('/api/following/item_list/', {
      count: '30',
      cursor,
    })
    const raw = await this.request<any>(url)
    this._cacheVideoAuthors(raw.itemList || [])
    return {
      items: (raw.itemList || []).map(mapVideoItem),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async downloadVideo(videoId: string): Promise<DownloadResult> {
    const detail = await this.getVideoDetail(videoId)
    if (!detail || !detail.video.playAddr) {
      throw new Error(`Could not retrieve video ${videoId}`)
    }
    return { url: detail.video.playAddr, metadata: detail }
  }

  async downloadVideoBuffer(videoId: string): Promise<{ buffer: Buffer; metadata: TikTokVideoItem | null }> {
    const { url, metadata } = await this.downloadVideo(videoId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'Referer': BASE_URL + '/',
          'Cookie': this.getCookieHeader(),
        },
      })
      if (!res.ok) throw new Error(`Download failed with status ${res.status}`)
      const buffer = await res.buffer()
      return { buffer, metadata }
    } finally {
      clearTimeout(timeout)
    }
  }

  async downloadVideoNoWatermark(videoId: string): Promise<DownloadResult> {
    const detail = await this.getVideoDetail(videoId)
    if (!detail) {
      throw new Error(`Could not retrieve video detail for ${videoId}`)
    }

    let playUrl = detail.video.playAddr || ''

    try {
      const parsed = new URL(playUrl)
      if (parsed.searchParams.has('watermark')) {
        parsed.searchParams.delete('watermark')
        playUrl = parsed.toString()
      }
    } catch {}

    if (!playUrl || playUrl.includes('watermark')) {
      try {
        const res = await fetch(`https://www.tikwm.com/api/?url=https://www.tiktok.com/@tiktok/video/${videoId}`)
        const data = await res.json()
        if (data?.data?.play) {
          playUrl = data.data.play
        }
      } catch {}
    }

    return {
      url: playUrl,
      metadata: detail,
    }
  }

  async downloadVideoNoWatermarkBuffer(videoId: string): Promise<{ buffer: Buffer; metadata: TikTokVideoItem | null }> {
    const { url, metadata } = await this.downloadVideoNoWatermark(videoId)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeout)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
          'Referer': BASE_URL + '/',
        },
      })
      if (!res.ok) throw new Error(`Download failed with status ${res.status}`)
      const buffer = await res.buffer()
      return { buffer, metadata }
    } finally {
      clearTimeout(timeout)
    }
  }

  async getLiveStreams(cursor = ''): Promise<{ streams: TikTokLiveStream[]; cursor: number; hasMore: boolean }> {
    const url = this.buildUrl('/webcast/feed/list/', {
      cursor,
      count: '30',
      type: 'recommend',
    })
    const raw = await this.request<any>(url)
    return {
      streams: (raw.data || []).map((s: any) => ({
        id: String(s.room?.id || s.id || ''),
        title: s.room?.title || s.title || '',
        status: s.room?.status || s.status || 0,
        streamUrl: s.room?.streamUrl || s.streamUrl || '',
        coverUrl: s.room?.coverUrl || s.coverUrl || '',
        user: mapUser(s.room?.owner || s.owner || s.user || {}),
        stats: {
          viewerCount: Number(s.room?.stats?.viewerCount || s.stats?.viewerCount || 0),
          likeCount: Number(s.room?.stats?.likeCount || s.stats?.likeCount || 0),
        },
        roomId: s.room?.id || s.id || '',
      })),
      cursor: Number(raw.cursor || 0),
      hasMore: raw.hasMore ?? false,
    }
  }

  async getLiveRoomInfo(roomId: string): Promise<any> {
    const url = this.buildUrl('/webcast/room/info/', { room_id: roomId })
    return this.request<any>(url)
  }

  async enterLiveRoom(roomId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/webcast/room/enter/', { room_id: roomId })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async sendLiveChat(roomId: string, text: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/webcast/room/chat/', { room_id: roomId, content: text })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async likeLive(roomId: string, count = 1): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/webcast/room/like/', { room_id: roomId, count: String(count) })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  async shareLive(roomId: string): Promise<TikTokActionResponse> {
    const url = this.buildUrl('/webcast/room/share/', { room_id: roomId })
    const raw = await this.request<any>(url, { method: 'POST' })
    return { success: raw?.status_code === 0 || raw?.statusCode === 0, statusCode: raw?.status_code, statusMsg: raw?.status_msg }
  }

  getCookie(name: string): string | undefined {
    return this.config.cookieJar[name]
  }

  getCookies(): Record<string, string> {
    return { ...this.config.cookieJar }
  }

  setCookie(name: string, value: string): void {
    this.config.cookieJar[name] = value
    if (name === 'sessionid' || name === 'sid_tt' || name === 'sessionid_ss') {
      this._isLoggedIn = true
      this.commonParams.user_is_login = 'true'
    }
  }

  setMsToken(token: string): void {
    this.config.msToken = token
  }

  setSignatures(xBogus: string, xGnarly: string): void {
    this.config.xBogus = xBogus
    this.config.xGnarly = xGnarly
  }
}

function mapUser(raw: any): import('./types').TikTokUser {
  return {
    id: String(raw.id || raw.uid || raw.userId || raw.user_id || ''),
    uniqueId: raw.uniqueId || raw.unique_id || raw.nickname || '',
    nickname: raw.nickname || raw.nickName || raw.displayId || raw.display_id || '',
    avatarLarger: raw.avatarLarger || raw.avatar_larger || raw.avatar?.larger || raw.avatar_168x168 || '',
    avatarMedium: raw.avatarMedium || raw.avatar_medium || raw.avatar?.medium || raw.avatar_300x300 || '',
    avatarThumb: raw.avatarThumb || raw.avatar_thumb || raw.avatar?.thumb || raw.avatar_24x24 || '',
    signature: raw.signature || raw.desc || raw.bio || '',
    verified: !!raw.verified || !!raw.isVerified || !!raw.enterprise_verify_reason,
    secUid: raw.secUid || raw.sec_uid || '',
    secret: !!raw.secret || !!raw.isSecret,
    ftc: !!raw.ftc,
    relation: raw.relation || 0,
    openFavorite: !!raw.openFavorite,
    bioLink: raw.bioLink || raw.bio_link || (raw.bioUrl ? { link: raw.bioUrl, risk: 0 } : undefined),
  }
}

function mapVideo(item: any): import('./types').TikTokVideo {
  const v = item.video || item
  return {
    id: String(v.id || item.id || ''),
    height: v.height || v.video_height || 0,
    width: v.width || v.video_width || 0,
    duration: v.duration || v.video_duration || 0,
    ratio: v.ratio || '',
    cover: v.cover || v.originCover || v.cover?.url || v.coverData || '',
    originCover: v.originCover || v.cover?.url || '',
    dynamicCover: v.dynamicCover || v.dynamic_cover || v.coverData?.url || '',
    playAddr: v.playAddr || v.play_address || v.play_url || v.downloadAddr || '',
    downloadAddr: v.downloadAddr || v.download_addr || '',
    shareCover: v.shareCover || v.share_cover || [],
    reflowCover: v.reflowCover || '',
    bitrate: v.bitrate || 0,
    encodedType: v.encodedType || v.encoded_type || '',
    format: v.format || '',
    videoQuality: v.videoQuality || v.video_quality || '',
    definition: v.definition || '',
  }
}

function mapVideoItem(raw: any): TikTokVideoItem {
  const author = raw.author || raw.owner || {}
  const music = raw.music || raw.sound || {}
  return {
    id: String(raw.id || raw.itemId || raw.item_id || raw.aweme_id || raw.group_id || ''),
    desc: raw.desc || raw.description || '',
    createTime: Number(raw.createTime || raw.create_time || 0),
    scheduleTime: Number(raw.scheduleTime || 0),
    video: mapVideo(raw),
    author: mapUser(author),
    music: {
      id: String(music.id || music.mid || music.music_id || ''),
      title: music.title || music.musicName || music.music_name || '',
      author: music.author || music.artist || '',
      album: music.album || '',
      coverLarge: music.coverLarge || music.cover_large || music.cover?.large || '',
      coverMedium: music.coverMedium || music.cover_medium || music.cover?.medium || '',
      coverThumb: music.coverThumb || music.cover_thumb || music.cover?.thumb || '',
      playUrl: music.playUrl || music.play_url || '',
      duration: Number(music.duration || 0),
      original: !!music.original,
    },
    challenges: (raw.challenges || raw.hashtags || []).map((h: any) => ({
      id: String(h.id || h.cid || h.challenge?.id || ''),
      name: h.chaName || h.name || h.challenge?.chaName || '',
      title: h.title || h.challenge?.title || '',
      cover: h.coverLarger || h.cover_larger || h.challenge?.coverLarger || '',
      coverMedium: h.coverMedium || h.cover_medium || '',
      coverThumb: h.coverThumb || h.cover_thumb || '',
      stats: {
        videoCount: Number(h.stats?.videoCount || h.videoCount || 0),
        viewCount: Number(h.stats?.viewCount || h.viewCount || 0),
      },
    })),
    stats: {
      diggCount: Number(raw.stats?.diggCount || raw.stats?.digg_count || raw.diggCount || 0),
      shareCount: Number(raw.stats?.shareCount || raw.stats?.share_count || raw.shareCount || 0),
      commentCount: Number(raw.stats?.commentCount || raw.stats?.comment_count || raw.commentCount || 0),
      playCount: Number(raw.stats?.playCount || raw.stats?.play_count || raw.playCount || raw.play_count || 0),
      collectCount: Number(raw.stats?.collectCount || raw.stats?.collect_count || raw.collectCount || 0),
    },
    duetEnabled: raw.duetEnabled ?? raw.duet_enabled ?? true,
    stitchEnabled: raw.stitchEnabled ?? raw.stitch_enabled ?? true,
    shareEnabled: raw.shareEnabled ?? true,
    isAd: !!raw.isAd || !!raw.is_ad,
    isTop: !!raw.isTop || !!raw.is_top,
    diversificationLabels: raw.diversificationLabels || [],
    suggestWords: raw.suggestWords || [],
    contents: raw.contents || [],
  }
}

function mapComment(raw: any): TikTokComment {
  return {
    id: String(raw.id || raw.cid || raw.comment_id || ''),
    text: raw.text || raw.content || '',
    diggCount: Number(raw.diggCount || raw.digg_count || raw.likeCount || 0),
    replyCount: Number(raw.replyCount || raw.reply_count || raw.commentCount || 0),
    createTime: Number(raw.createTime || raw.create_time || 0),
    user: mapUser(raw.user || raw.owner || {}),
    isPinned: !!raw.isPinned || !!raw.pinned,
    replies: (raw.replies || []).map(mapComment),
  }
}

function mapConversation(raw: any): TikTokConversation {
  const users = (raw.conversation_users || raw.users || []).map(mapUser)
  const lastMsg = raw.last_message || raw.lastMessage || raw.last_msg
  return {
    id: String(raw.id || raw.conversation_id || raw.conversationId || raw.cid || ''),
    type: Number(raw.type || raw.conversation_type || raw.conversationType || 1),
    name: raw.name || raw.conversation_name || raw.conversationName || raw.display_name || users[0]?.nickname || '',
    avatar: raw.avatar || raw.conversation_avatar || raw.conversationAvatar || users[0]?.avatarMedium || '',
    lastMessage: lastMsg ? mapMessage(lastMsg, String(raw.id || raw.conversation_id || '')) : null,
    unreadCount: Number(raw.unread_count || raw.unreadCount || raw.unread || 0),
    users,
    isMuted: !!raw.is_muted || !!raw.isMuted || !!raw.muted,
    isVerified: !!raw.is_verified || !!raw.isVerified || users[0]?.verified || false,
    createTime: Number(raw.create_time || raw.createTime || 0),
  }
}

function mapMessage(raw: any, conversationId: string): TikTokMessage {
  return {
    id: String(raw.id || raw.message_id || raw.messageId || raw.mid || ''),
    conversationId: String(conversationId || raw.conversation_id || raw.conversationId || ''),
    content: raw.content || raw.text || raw.message || '',
    type: Number(raw.type || raw.message_type || raw.messageType || 1),
    fromUser: raw.user || raw.from_user || raw.fromUser ? mapUser(raw.user || raw.from_user || raw.fromUser) : null,
    createTime: Number(raw.create_time || raw.createTime || raw.timestamp || raw.send_time || 0),
    status: Number(raw.status || raw.message_status || raw.messageStatus || 0),
  }
}

function mapUserProfile(raw: any): TikTokUserProfile {
  const u = raw.user || raw
  return {
    user: mapUser(u),
    stats: {
      followingCount: Number(raw.stats?.followingCount || raw.followingCount || u.followingCount || 0),
      followerCount: Number(raw.stats?.followerCount || raw.followerCount || u.followerCount || raw.fans || 0),
      heartCount: Number(raw.stats?.heartCount || raw.heartCount || u.heartCount || raw.totalFavorited || 0),
      videoCount: Number(raw.stats?.videoCount || raw.videoCount || u.videoCount || raw.awemeCount || 0),
      diggCount: Number(raw.stats?.diggCount || raw.diggCount || u.diggCount || 0),
      favoriteCount: Number(raw.stats?.favoriteCount || raw.favoriteCount || u.favoriteCount || 0),
    },
    isUnderAge18: !!raw.isUnderAge18,
  }
}

function mapNotification(raw: any): TikTokNotification {
  return {
    id: String(raw.id || raw.notice_id || raw.notification_id || ''),
    type: Number(raw.type || raw.notice_type || 0),
    text: raw.text || raw.content || raw.notice || '',
    createTime: Number(raw.createTime || raw.create_time || 0),
    fromUser: raw.fromUser ? mapUser(raw.fromUser) : raw.user ? mapUser(raw.user) : undefined,
    video: raw.video ? mapVideoItem(raw.video) : undefined,
    extra: raw.extra || raw.extend || undefined,
  }
}

function buildPostText(
  description: string,
  hashtags?: string[],
  mentions?: Array<string | { username: string; userId?: string; secUid?: string }>
): string {
  let text = description || ''

  if (mentions && mentions.length > 0) {
    const mentionTags = mentions
      .map(m => typeof m === 'string' ? (m.startsWith('@') ? m : `@${m}`) : (m.username.startsWith('@') ? m.username : `@${m.username}`))
      .filter(m => !text.includes(m))
    if (mentionTags.length > 0) {
      text = text ? `${text} ${mentionTags.join(' ')}` : mentionTags.join(' ')
    }
  }

  if (hashtags && hashtags.length > 0) {
    const tags = hashtags
      .map(t => (t.startsWith('#') ? t : `#${t}`))
      .filter(t => !text.includes(t))
    if (tags.length > 0) {
      text = text ? `${text} ${tags.join(' ')}` : tags.join(' ')
    }
  }

  return text
}

function buildTextExtra(
  text: string,
  hashtags?: string[],
  mentions?: Array<string | { username: string; userId?: string; secUid?: string }>
): any[] {
  const extra: any[] = []

  // 1. Process hashtags (#tag) -> type: 1
  const tagSet = new Set<string>()
  if (hashtags) {
    for (const h of hashtags) tagSet.add(h.replace(/^#/, ''))
  }
  const hashtagRegex = /#([\w\u0080-\uFFFF]+)/g
  let match: RegExpExecArray | null
  while ((match = hashtagRegex.exec(text)) !== null) {
    tagSet.add(match[1])
  }

  for (const tag of tagSet) {
    const formatted = `#${tag}`
    let pos = 0
    while ((pos = text.indexOf(formatted, pos)) !== -1) {
      extra.push({
        start: pos,
        end: pos + formatted.length,
        hashtag_name: tag,
        type: 1,
      })
      pos += formatted.length
    }
  }

  // 2. Process mentions (@username) -> type: 0
  const mentionMap = new Map<string, { userId?: string; secUid?: string }>()
  if (mentions) {
    for (const m of mentions) {
      if (typeof m === 'string') {
        mentionMap.set(m.replace(/^@/, ''), {})
      } else {
        mentionMap.set(m.username.replace(/^@/, ''), { userId: m.userId, secUid: m.secUid })
      }
    }
  }
  const mentionRegex = /@([\w.-]+)/g
  while ((match = mentionRegex.exec(text)) !== null) {
    const uname = match[1]
    if (!mentionMap.has(uname)) {
      mentionMap.set(uname, {})
    }
  }

  for (const [uname, meta] of mentionMap.entries()) {
    const formatted = `@${uname}`
    let pos = 0
    while ((pos = text.indexOf(formatted, pos)) !== -1) {
      extra.push({
        start: pos,
        end: pos + formatted.length,
        user_name: uname,
        user_id: meta.userId || '',
        sec_uid: meta.secUid || '',
        type: 0,
      })
      pos += formatted.length
    }
  }

  extra.sort((a, b) => a.start - b.start)
  return extra
}
