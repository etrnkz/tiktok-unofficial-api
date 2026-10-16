import * as http from 'http'
import WebSocket from 'ws'

const TIKTOK_STUDIO = 'https://www.tiktok.com/tiktokstudio/content'
const CSRF_TOKEN_COOKIE = 'tt_csrf_token'

export class CDPPage {
  ws: WebSocket | null = null
  msgId = 0
  callbacks = new Map<number, (msg: any) => void>()

  async connect(port = 9222): Promise<void> {
    const tabs = await this._fetch<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${port}/json/version`)
    this.ws = new WebSocket(tabs.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      this.ws!.on('open', resolve)
      this.ws!.on('error', reject)
    })
    this.ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.callbacks.has(msg.id)) {
        this.callbacks.get(msg.id)!(msg)
        this.callbacks.delete(msg.id)
      }
    })
    await this.send('Page.enable')
    await this.send('Network.enable')
  }

  private _fetch<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => resolve(JSON.parse(data)))
      }).on('error', reject)
    })
  }

  async send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve) => {
      const id = ++this.msgId
      this.callbacks.set(id, resolve)
      this.ws!.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<any> {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result?.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text || 'Eval error')
    }
    return result?.result?.result?.value
  }

  async goto(url: string): Promise<void> {
    await this.send('Page.navigate', { url })
  }

  async waitForLoad(timeoutMs = 30000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await this.evaluate('document.readyState')
        if (ready === 'complete') return
      } catch { }
      await new Promise(r => setTimeout(r, 1000))
    }
  }

  async click(selector: string): Promise<boolean> {
    const result = await this.evaluate(`
      (function() {
        const el = document.querySelector('${selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}');
        if (el) { el.click(); return true; }
        return false;
      })()
    `)
    return result === true
  }

  async getCookies(): Promise<Record<string, string>> {
    const { result } = await this.send('Network.getAllCookies')
    const cookies: Record<string, string> = {}
    for (const c of result?.cookies || []) {
      cookies[c.name] = c.value
    }
    return cookies
  }

  async waitForTimeout(ms: number): Promise<void> {
    await new Promise(r => setTimeout(r, ms))
  }

  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}

export class CdpWriteProxy {
  private ws: WebSocket | null = null
  private msgId = 0
  private callbacks = new Map<number, (msg: any) => void>()
  private sessionId: string | null = null
  private targetId: string | null = null
  private csrfToken = ''
  private port = 9222

  async connect(port = 9222, csrfToken = '', initialCookies: Record<string, string> = {}, pageUrl: string = TIKTOK_STUDIO): Promise<void> {
    this.port = port
    this.csrfToken = csrfToken

    const info = await this._fetch<{ webSocketDebuggerUrl: string }>(`http://127.0.0.1:${port}/json/version`)
    this.ws = new WebSocket(info.webSocketDebuggerUrl)
    await new Promise<void>((resolve, reject) => {
      this.ws!.on('open', resolve)
      this.ws!.on('error', reject)
    })
    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.id && this.callbacks.has(msg.id)) {
          this.callbacks.get(msg.id)!(msg)
          this.callbacks.delete(msg.id)
        }
      } catch { }
    })

    // Create hidden tab and attach
    const createResult = await this._send('Target.createTarget', { url: 'about:blank' })
    this.targetId = createResult.result.targetId

    const attachResult = await this._send('Target.attachToTarget', {
      targetId: this.targetId,
      flatten: true,
    })
    this.sessionId = attachResult.result.sessionId

    await this._send('Page.enable')
    await this._send('Runtime.enable')

    // Set cookies BEFORE navigation so the page loads fully authenticated
    for (const [name, value] of Object.entries(initialCookies)) {
      if (!value) continue
      try {
        await this._send('Network.setCookie', {
          name, value, domain: '.tiktok.com', path: '/', secure: true,
        })
      } catch { }
    }

    // Navigate to specified page
    await this._send('Page.navigate', { url: pageUrl })
    await this._waitForPageLoad(pageUrl, 30000)
  }

  private async _waitForPageLoad(pageUrl: string, timeoutMs = 30000): Promise<void> {
    const start = Date.now()
    const isStudio = pageUrl.includes('tiktokstudio')
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1000))
      try {
        const ready = await this._send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })
        if (ready?.result?.result?.value !== 'complete') continue

        if (isStudio) {
          const r = await this._send('Runtime.evaluate', {
            expression: 'document.title && document.title.includes("TikTok Studio") ? 1 : 0',
            returnByValue: true,
          })
          if (r?.result?.result?.value === 1) {
            await new Promise(r => setTimeout(r, 3000))
            return
          }
        } else {
          await new Promise(r => setTimeout(r, 5000))
          return
        }
      } catch { }
    }
    throw new Error(`Timeout waiting for page to load: ${pageUrl}`)
  }

  async initWebmssdk(): Promise<void> {
    await this._send('Runtime.evaluate', {
      expression: 'window.byted_acrawler && window.byted_acrawler.init ? window.byted_acrawler.init({aid:1988}) : null',
      awaitPromise: true,
    })
  }

  async getTicketGuardKeysFromPage(): Promise<{ tsSign: string; privateKeyPem: string } | null> {
    const expression = `
      (function() {
        try {
          var ttFetch = JSON.parse(localStorage.getItem('security-sdk/s_sdk_sign_data_key/tt_fetch'));
          var tsSign = JSON.parse(ttFetch.data).ts_sign;
          var cryptKey = JSON.parse(localStorage.getItem('security-sdk/s_sdk_crypt_sdk'));
          var privateKeyPem = JSON.parse(cryptKey.data).ec_privateKey;
          return JSON.stringify({ tsSign: tsSign, privateKeyPem: privateKeyPem });
        } catch(e) { return JSON.stringify({error: e.message}); }
      })()
    `
    const result = await this._send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
    if (result?.result?.exceptionDetails) return null
    const raw = result?.result?.result?.value || '{}'
    try {
      const parsed = JSON.parse(raw)
      if (parsed.error) return null
      return { tsSign: parsed.tsSign, privateKeyPem: parsed.privateKeyPem }
    } catch { return null }
  }

  async xhr(
    method: string,
    url: string,
    body = '',
    extraHeaders: Record<string, string> = {},
  ): Promise<{ status: number; body: string }> {
    if (!this.sessionId) throw new Error('CDP proxy not connected')

    const headerLines = Object.entries(extraHeaders)
      .map(([k, v]) => `xhr.setRequestHeader(${JSON.stringify(k)}, ${JSON.stringify(v)});`)
      .join('')

    const csrfHeader = this.csrfToken
      ? `xhr.setRequestHeader('tt-csrf-token', '${this.csrfToken.replace(/'/g, "\\'")}');`
      : ''

    const expression = `
      (async function() {
        return new Promise(function(resolve) {
          try {
            var xhr = new XMLHttpRequest();
            xhr.open('${method}', ${JSON.stringify(url)}, true);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            xhr.setRequestHeader('x-secsdk-csrf-token', 'DOWNGRADE');
            ${csrfHeader}
            ${headerLines}
            xhr.onload = function() {
              resolve(JSON.stringify({s: xhr.status, b: xhr.responseText.substring(0, 50000)}));
            };
            xhr.onerror = function() {
              resolve(JSON.stringify({s: 0, b: 'xhr error'}));
            };
            xhr.send(${JSON.stringify(body)});
          } catch(e) {
            resolve(JSON.stringify({s: 0, b: 'exception: ' + e.message}));
          }
        });
      })()
    `

    const result = await this._send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })

    if (result?.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text || 'XHR eval error')
    }

    const raw = result?.result?.result?.value || '{}'
    try {
      const parsed = JSON.parse(raw)
      return { status: parsed.s, body: parsed.b || '' }
    } catch {
      return { status: 0, body: raw }
    }
  }

  // Compute ticket guard headers inside the browser using Web Crypto API
  async makeTicketGuardHeadersBrowser(pathname: string): Promise<Record<string, string>> {
    const expression = `
      (async function() {
        try {
          var keys = {};
          try {
            var ttFetch = JSON.parse(localStorage.getItem('security-sdk/s_sdk_sign_data_key/tt_fetch'));
            keys.tsSign = JSON.parse(ttFetch.data).ts_sign;
          } catch(e) { return JSON.stringify({error: 'tsSign: ' + e.message}); }
          try {
            var cryptKey = JSON.parse(localStorage.getItem('security-sdk/s_sdk_crypt_sdk'));
            keys.privateKeyPem = JSON.parse(cryptKey.data).ec_privateKey;
          } catch(e) { return JSON.stringify({error: 'privateKey: ' + e.message}); }

          var tsSign = keys.tsSign;
          var pem = keys.privateKeyPem;

          var timestamp = Math.floor(Date.now() / 1000);
          var content = tsSign + ${JSON.stringify(pathname)} + timestamp;

          var pemHeader = '-----BEGIN PRIVATE KEY-----';
          var pemFooter = '-----END PRIVATE KEY-----';
          var pemContents = pem.substring(pem.indexOf(pemHeader) + pemHeader.length, pem.indexOf(pemFooter));
          var pemClean = pemContents.replace(/\\s/g, '');
          var derStr = atob(pemClean);
          var binaryDer = new Uint8Array(derStr.length);
          for (var i = 0; i < derStr.length; i++) binaryDer[i] = derStr.charCodeAt(i);

          var key = await crypto.subtle.importKey('pkcs8', binaryDer, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
          var sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(content));
          var sigBytes = new Uint8Array(sig);
          var combined = new Uint8Array(64);
          combined.set(sigBytes.subarray(0, 32), 0);
          combined.set(sigBytes.subarray(32, 64), 32);
          var sigStr = '';
          for (var i = 0; i < 64; i++) sigStr += String.fromCharCode(combined[i]);
          var rawSigB64 = btoa(sigStr);

          var jwk = await crypto.subtle.exportKey('jwk', key);
          function b64urldecode(s) { s = s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4) s+='='; return atob(s); }
          var xStr = b64urldecode(jwk.x), yStr = b64urldecode(jwk.y);
          var rawPubKey = new Uint8Array(65);
          rawPubKey[0] = 0x04;
          for (var i = 0; i < 32; i++) rawPubKey[1 + i] = xStr.charCodeAt(i);
          for (var i = 0; i < 32; i++) rawPubKey[33 + i] = yStr.charCodeAt(i);
          var pubStr = '';
          for (var i = 0; i < 65; i++) pubStr += String.fromCharCode(rawPubKey[i]);
          var pubKeyB64 = btoa(pubStr);

          var payload = {
            ts_sign: tsSign,
            req_content: 'ticket,path,timestamp',
            req_sign: rawSigB64,
            timestamp: timestamp,
          };
          var clientData = btoa(JSON.stringify(payload));

          return JSON.stringify({
            'tt-ticket-guard-client-data': clientData,
            'tt-ticket-guard-public-key': pubKeyB64,
            'tt-ticket-guard-version': '2',
            'tt-ticket-guard-web-version': '1',
            'tt-ticket-guard-iteration-version': '0',
          });
        } catch(e) { return JSON.stringify({error: e.message, stack: e.stack}); }
      })()
    `;

    const result = await this._send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result?.result?.exceptionDetails) {
      throw new Error(result.result.exceptionDetails.text || 'TG header error')
    }

    const raw = result?.result?.result?.value || '{}'
    try {
      const parsed = JSON.parse(raw)
      if (parsed.error) throw new Error('TG browser: ' + parsed.error)
      return parsed
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('TG browser:')) throw e
      return {}
    }
  }

  async setCookies(cookies: Record<string, string>, domain = '.tiktok.com'): Promise<void> {
    if (!this.sessionId) throw new Error('CDP proxy not connected')
    for (const [name, value] of Object.entries(cookies)) {
      if (!value) continue
      try {
        await this._send('Network.setCookie', { name, value, domain, path: '/', secure: true })
      } catch { }
    }
  }

  async getCookies(): Promise<Record<string, string>> {
    if (!this.sessionId) throw new Error('CDP proxy not connected')
    const result = await this._send('Network.getAllCookies')
    const cookies: Record<string, string> = {}
    for (const c of result?.result?.cookies || []) {
      cookies[c.name] = c.value
    }
    return cookies
  }

  async close(): Promise<void> {
    try {
      if (this.targetId) {
        await this._send('Target.closeTarget', { targetId: this.targetId }).catch(() => {})
      }
    } catch { }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.sessionId = null
    this.targetId = null
  }

  private async _send(method: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId
      const timeout = setTimeout(() => {
        this.callbacks.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 30000)
      this.callbacks.set(id, (m: any) => {
        clearTimeout(timeout)
        resolve(m)
      })
      const msg: any = { id, method, params }
      if (this.sessionId && method !== 'Target.createTarget' && method !== 'Target.attachToTarget' && method !== 'Target.closeTarget') {
        msg.sessionId = this.sessionId
      }
      this.ws!.send(JSON.stringify(msg))
    })
  }

  private _fetch<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      http.get(url, (res) => {
        let data = ''
        res.on('data', c => data += c)
        res.on('end', () => resolve(JSON.parse(data)))
      }).on('error', reject)
    })
  }
}
