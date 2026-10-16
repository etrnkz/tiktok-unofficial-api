import * as https from 'https'
import protobuf from 'protobufjs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as fs from 'fs'

const DOMAIN = 'im-api-sg.tiktok.com'

export interface DmRestConfig {
  deviceId: string
  uid: string
  cookies: Record<string, string>
  region?: string
}

export interface ComboCursor {
  type: number
  cursor: bigint
  interval: number
}

export interface DmConversation {
  conversationId: string
  conversationShortId: string
  conversationType: number
  participantsCount: number
  name?: string
  desc?: string
  ownerId?: string
  ticket?: string
  lastMessage?: string
  updatedAt?: number
}

export interface DmMessage {
  id: string
  conversationId: string
  conversationShortId: string
  conversationType: number
  senderId: string
  secSender?: string
  text: string
  rawContent?: string
  createTime: number
  clientMessageId?: string
}

const CAPTURED_PARAMS: [string, string][] = [
  ['aid', '1988'],
  ['app_name', 'tiktok_web'],
  ['channel', 'web'],
  ['device_platform', 'web_pc'],
  ['device_id', '7647502364471903776'],
  ['region', 'NL'],
  ['priority_region', 'NL'],
  ['os', 'windows'],
  ['referer', 'https://www.tiktok.com/login?lang=en&redirect_url=https%3A%2F%2Fwww.tiktok.com%2Fmessages'],
  ['root_referer', 'https://www.tiktok.com/login?lang=en&redirect_url=https%3A%2F%2Fwww.tiktok.com%2Fmessages'],
  ['cookie_enabled', 'true'],
  ['screen_width', '1536'],
  ['screen_height', '864'],
  ['browser_language', 'en-US'],
  ['browser_platform', 'Win32'],
  ['browser_name', 'Mozilla'],
  ['browser_version', '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
  ['browser_online', 'true'],
  ['verifyFp', ''],
  ['app_language', 'en'],
  ['webcast_language', 'en'],
  ['tz_name', 'Asia/Singapore'],
  ['is_page_visible', 'true'],
  ['focus_state', 'true'],
  ['is_fullscreen', 'false'],
  ['history_len', '4'],
  ['user_is_login', 'true'],
  ['data_collection_enabled', 'true'],
  ['from_appID', '1988'],
  ['locale', 'en'],
  ['user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
]

export class DmRestClient {
  private DmRestRequest: protobuf.Type | null = null
  private DmRestResponse: protobuf.Type | null = null
  private InitPayloadWrapper: protobuf.Type | null = null
  private Request: protobuf.Type | null = null
  private Response: protobuf.Type | null = null
  private config: DmRestConfig
  private logidBase: number
  private initCursor: bigint | null = null

  constructor(config: DmRestConfig) {
    this.config = config
    this.logidBase = 10000
  }

  async init(): Promise<void> {
    const protoPath = path.resolve(__dirname, 'dm.proto')
    const altProtoPath = path.resolve(__dirname, '../../src/utils/dm.proto')
    const resolvedPath = fs.existsSync(protoPath) ? protoPath : altProtoPath
    const root = await protobuf.load(resolvedPath)
    this.DmRestRequest = root.lookupType('DmRestRequest')
    this.DmRestResponse = root.lookupType('DmRestResponse')
    this.InitPayloadWrapper = root.lookupType('InitPayloadWrapper')
    this.Request = root.lookupType('Request')
    this.Response = root.lookupType('Response')
  }

  async doInit(): Promise<{ cursor: bigint } | null> {
    if (!this.DmRestRequest) await this.init()
    const params = this.buildParams()
    const metadata = this.buildInitMetadata()
    const msg = this.DmRestRequest!.create({
      seqid: 203,
      logid: this.nextLogid(),
      version: '1.7.0',
      empty: '',
      reqType: 3,
      unknown6: 0,
      callTrace: '3035f17:feat/call-trace-plugin',
      metadata,
      deviceId: this.config.deviceId,
      devicePlatform: 'web',
      params,
      field18: 1,
    })
    const buf = Buffer.from(this.DmRestRequest!.encode(msg).finish())
    const raw = await this.makeRequest('/v2/message/get_by_user_init', buf)
    if (!raw) return null

    const res = this.DmRestResponse!.decode(raw) as any
    if (res.statusCode !== 0) return null

    const cursor = this.parseInitPayload(Buffer.from(res.payload))
    if (cursor === null) return null

    this.initCursor = cursor
    return { cursor }
  }

  async doCombo(cursor?: bigint): Promise<ComboCursor[] | null> {
    if (!this.DmRestRequest) await this.init()
    const params = this.buildParams()
    const metadata = this.buildComboMetadata(cursor ?? this.initCursor ?? 0n)
    const msg = this.DmRestRequest!.create({
      seqid: 204,
      logid: this.nextLogid(),
      version: '1.7.0',
      empty: '',
      reqType: 3,
      unknown6: 0,
      callTrace: '3035f17:feat/call-trace-plugin',
      metadata,
      deviceId: this.config.deviceId,
      devicePlatform: 'web',
      params,
      field18: 1,
    })
    const buf = Buffer.from(this.DmRestRequest!.encode(msg).finish())
    const raw = await this.makeRequest('/v1/message/get_by_user_combo', buf)
    if (!raw) return null

    const res = this.DmRestResponse!.decode(raw) as any
    if (res.statusCode !== 0) return null

    const cursors = this.parseComboPayload(Buffer.from(res.payload))
    return cursors
  }

  async getConversations(): Promise<DmConversation[]> {
    if (!this.DmRestRequest) await this.init()
    const params = this.buildParams()
    const metadata = this.buildInitMetadata()
    const msg = this.DmRestRequest!.create({
      seqid: 203,
      logid: this.nextLogid(),
      version: '1.7.0',
      empty: '',
      reqType: 3,
      unknown6: 0,
      callTrace: '3035f17:feat/call-trace-plugin',
      metadata,
      deviceId: this.config.deviceId,
      devicePlatform: 'web',
      params,
      field18: 1,
    })
    const buf = Buffer.from(this.DmRestRequest!.encode(msg).finish())
    const raw = await this.makeRequest('/v2/message/get_by_user_init', buf)
    if (!raw) return []

    const res = this.DmRestResponse!.decode(raw) as any
    if (res.statusCode !== 0 || !res.payload) return []

    try {
      const decoded = this.InitPayloadWrapper!.decode(Buffer.from(res.payload)) as any
      const initBody = decoded?.initBody
      if (!initBody?.conversations) return []

      return initBody.conversations.map((c: any) => {
        const convMsgs = (initBody.messages || []).filter((m: any) => m.conversationId === c.conversationId)
        let lastMsgText = ''
        if (convMsgs.length > 0) {
          try {
            const parsed = JSON.parse(convMsgs[convMsgs.length - 1].content || '{}')
            lastMsgText = parsed.text || convMsgs[convMsgs.length - 1].content
          } catch {
            lastMsgText = convMsgs[convMsgs.length - 1].content || ''
          }
        }

        return {
          conversationId: c.conversationId,
          conversationShortId: String(c.conversationShortId || ''),
          conversationType: c.conversationType,
          participantsCount: c.participantsCount || 2,
          name: c.conversationCoreInfo?.name || '',
          desc: c.conversationCoreInfo?.desc || '',
          ownerId: String(c.conversationCoreInfo?.owner || ''),
          ticket: c.ticket || '',
          lastMessage: lastMsgText,
          updatedAt: Number(c.conversationCoreInfo?.infoVersion || 0),
        }
      })
    } catch {
      return []
    }
  }

  async getMessages(
    conversationId: string,
    conversationShortId?: string,
    limit = 50,
    cursor?: string
  ): Promise<{ messages: DmMessage[]; nextCursor: string; hasMore: boolean }> {
    if (!this.Request) await this.init()

    let shortId = conversationShortId
    if (!shortId) {
      const convs = await this.getConversations()
      const found = convs.find(c => c.conversationId === conversationId)
      shortId = found?.conversationShortId || '0'
    }

    const bodyMsg = {
      conversationId,
      conversationType: 1,
      conversationShortId: shortId,
      direction: 1,
      anchorIndex: cursor ? Number(cursor) : 0,
      limit,
    }

    const reqMsg = {
      cmd: 301,
      sequenceId: Date.now(),
      sdkVersion: '1.7.0',
      refer: 3,
      inboxType: 0,
      deviceId: this.config.deviceId,
      devicePlatform: 'web_pc',
      body: {
        messagesInConversationBody: bodyMsg,
      },
    }

    const reqBuf = Buffer.from(this.Request!.encode(this.Request!.create(reqMsg)).finish())
    const raw = await this.makeRequest('/v1/message/get_by_conversation', reqBuf)
    if (!raw) return { messages: [], nextCursor: '0', hasMore: false }

    try {
      const decoded = this.Response!.decode(raw) as any
      const body = decoded?.body?.messagesInConversationBody
      const rawMsgs = body?.messages || []

      const messages: DmMessage[] = rawMsgs.map((m: any) => {
        let text = ''
        try {
          const parsed = JSON.parse(m.content || '{}')
          text = parsed.text ?? m.content
        } catch {
          text = m.content || ''
        }

        return {
          id: String(m.serverMessageId || ''),
          conversationId: m.conversationId,
          conversationShortId: String(m.conversationShortId || ''),
          conversationType: m.conversationType,
          senderId: String(m.sender || ''),
          secSender: m.secSender || '',
          text,
          rawContent: m.content || '',
          createTime: Number(m.createTime || 0),
        }
      })

      return {
        messages,
        nextCursor: String(body?.nextCursor || '0'),
        hasMore: !!body?.hasMore,
      }
    } catch {
      return { messages: [], nextCursor: '0', hasMore: false }
    }
  }

  async sendMessage(
    conversationId: string,
    text: string,
    conversationShortId?: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.Request) await this.init()

    let shortId = conversationShortId
    if (!shortId) {
      const convs = await this.getConversations()
      const found = convs.find(c => c.conversationId === conversationId)
      shortId = found?.conversationShortId || '0'
    }

    const clientMsgId = crypto.randomUUID()
    const content = JSON.stringify({ aweType: 700, text })

    const sendBody = {
      conversationId,
      conversationType: 1,
      conversationShortId: shortId,
      content,
      messageType: 7, // 7 = text in ByteDance schema
      clientMessageId: clientMsgId,
      ext: [
        { key: 's:client_message_id', value: clientMsgId },
        { key: 'a:entrance_type', value: '1' },
        { key: 's:mode', value: '0' },
      ],
    }

    const reqMsg = {
      cmd: 100,
      sequenceId: Date.now(),
      sdkVersion: '1.7.0',
      refer: 3,
      inboxType: 0,
      deviceId: this.config.deviceId,
      devicePlatform: 'web_pc',
      body: {
        sendMessageBody: sendBody,
      },
    }

    const reqBuf = Buffer.from(this.Request!.encode(this.Request!.create(reqMsg)).finish())
    const raw = await this.makeRequest('/v1/message/send', reqBuf)
    if (!raw) return { success: false, error: 'Network request failed' }

    try {
      const decoded = this.Response!.decode(raw) as any
      const sendResp = decoded?.body?.sendMessageBody
      if (decoded.statusCode === 0 || decoded.errorDesc === 'OK') {
        return {
          success: true,
          messageId: String(sendResp?.serverMessageId || ''),
        }
      }
      return {
        success: false,
        error: decoded.errorDesc || `Status code: ${decoded.statusCode}`,
      }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  }

  // ─── Metadata Builders ──

  private buildInitMetadata(): Buffer {
    // Field 203 (tag da 0c), length 2, subfield 1 = 0
    return Buffer.from([0xda, 0x0c, 0x02, 0x08, 0x00])
  }

  private buildComboMetadata(cursor: bigint): Buffer {
    const entry0 = this.encodeEntry(0, cursor, 50, 8)
    const entry1 = this.encodeEntry(1, 0n, 50, 8)
    const entry2 = this.encodeEntry(3, 0n, 50, 8)
    const inner = Buffer.concat([entry0, entry1, entry2])
    const len = this.encodeVarint(BigInt(inner.length))
    return Buffer.concat([Buffer.from([0xe2, 0x0c]), len, inner])
  }

  private encodeEntry(type: number, cursor: bigint, limit: number, unk4: number): Buffer {
    const inner = Buffer.concat([
      Buffer.from([0x08, type]),
      Buffer.from([0x10, ...(cursor > 0n ? this.encodeVarint(cursor) : [0x00])]),
      Buffer.from([0x18, limit]),
      Buffer.from([0x20, unk4]),
    ])
    return Buffer.concat([Buffer.from([0x0a, inner.length]), inner])
  }

  private buildParams(): any[] {
    const params: any[] = CAPTURED_PARAMS.map(([k, v]) => ({ key: k, value: v }))
    const deviceIdx = params.findIndex((p: any) => p.key === 'device_id')
    if (deviceIdx >= 0) (params[deviceIdx] as any).value = this.config.deviceId
    return params
  }

  // ─── Payload Parsers ──

  private parseInitPayload(buf: Buffer): bigint | null {
    if (buf.length < 2) return null
    let pos = 0
    const tag = this.decodeVarint(buf, pos)
    if (!tag || (tag.value & 0x07n) !== 2n) return null
    pos += tag.bytes
    const len = this.decodeVarint(buf, pos)
    if (!len) return null
    pos += len.bytes
    const inner = buf.slice(pos, pos + Number(len.value))
    let ipos = 0
    while (ipos < inner.length) {
      const itag = this.decodeVarint(inner, ipos)
      if (!itag) break
      const ifield = Number(itag.value >> 3n)
      ipos += itag.bytes
      if ((itag.value & 0x07n) === 0n) {
        const v = this.decodeVarint(inner, ipos)
        if (!v) break
        ipos += v.bytes
        if (ifield === 3) return v.value
      } else {
        const l = this.decodeVarint(inner, ipos)
        if (!l) break
        ipos += l.bytes
        ipos += Number(l.value)
      }
    }
    return null
  }

  private parseComboPayload(buf: Buffer): ComboCursor[] | null {
    if (buf.length < 3) return null
    let pos = 0
    const tag = this.decodeVarint(buf, pos)
    if (!tag) return null
    pos += tag.bytes
    const len = this.decodeVarint(buf, pos)
    if (!len) return null
    pos += len.bytes
    const inner = buf.slice(pos, pos + Number(len.value))

    const cursors: ComboCursor[] = []
    let ipos = 0
    while (ipos < inner.length) {
      const itag = this.decodeVarint(inner, ipos)
      if (!itag) break
      const ifield = Number(itag.value >> 3n)
      ipos += itag.bytes
      if ((itag.value & 0x07n) !== 2n) {
        if ((itag.value & 0x07n) === 0n) {
          const v = this.decodeVarint(inner, ipos)
          if (!v) break; ipos += v.bytes
        } else { break }
        continue
      }
      const l = this.decodeVarint(inner, ipos)
      if (!l) break; ipos += l.bytes
      const entryRaw = inner.slice(ipos, ipos + Number(l.value))
      ipos += Number(l.value)
      if (ifield === 1) {
        const e = this.parseEntry(entryRaw)
        if (e) cursors.push(e)
      }
    }
    return cursors.length > 0 ? cursors : null
  }

  private parseEntry(buf: Buffer): ComboCursor | null {
    let type = -1, cursor = -1n, interval = 0
    let pos = 0
    while (pos < buf.length) {
      const tag = this.decodeVarint(buf, pos)
      if (!tag) break
      const field = Number(tag.value >> 3n)
      pos += tag.bytes
      if ((tag.value & 0x07n) === 0n) {
        const v = this.decodeVarint(buf, pos)
        if (!v) break; pos += v.bytes
        if (field === 1) type = Number(v.value)
        else if (field === 5) cursor = v.value
        else if (field === 6) interval = Number(v.value)
      } else {
        const l = this.decodeVarint(buf, pos)
        if (!l) break; pos += l.bytes; pos += Number(l.value)
      }
    }
    if (type < 0) return null
    return { type, cursor, interval }
  }

  // ─── HTTP ──

  private async makeRequest(endpointPath: string, body: Buffer): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const cookieStr = Object.entries(this.config.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ')
      const req = https.request({
        hostname: DOMAIN, path: endpointPath, method: 'POST',
        headers: {
          'Content-Type': 'application/x-protobuf',
          'Content-Length': body.length,
          'Accept': 'application/x-protobuf',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Origin': 'https://www.tiktok.com',
          'Referer': 'https://www.tiktok.com/',
          'Cookie': cookieStr,
        },
      }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve(Buffer.concat(chunks)))
      })
      req.on('error', () => resolve(null))
      req.end(body)
    })
  }

  // ─── Utilities ──

  private nextLogid(): number {
    return Number(this.logidBase++)
  }

  private decodeVarint(buf: Buffer, offset: number): { value: bigint; bytes: number } | null {
    let value = 0n
    let shift = 0
    let i = offset
    while (i < buf.length) {
      const byte = buf[i++]
      value |= BigInt(byte & 0x7f) << BigInt(shift)
      if (!(byte & 0x80)) return { value, bytes: i - offset }
      shift += 7
      if (shift > 63) break
    }
    return null
  }

  private encodeVarint(value: bigint): Buffer {
    const bytes: number[] = []
    let v = value
    while (v > 0n) {
      let byte = Number(v & 0x7fn)
      v >>= 7n
      if (v > 0n) byte |= 0x80
      bytes.push(byte)
    }
    if (bytes.length === 0) bytes.push(0)
    return Buffer.from(bytes)
  }
}