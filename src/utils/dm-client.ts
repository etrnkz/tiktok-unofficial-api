import WebSocket from 'ws'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import * as path from 'path'
import protobuf from 'protobufjs'

const SERVICE = 0x2000051
const DEFAULT_APP_KEY = 'e252eea4204adef812c32f35a4b80f4b'
const ACCESS_KEY_SALT = 'f8a69f1719916z'
const WS_URL = 'wss://im-ws-sg.tiktok.com/ws/v2'
const WS_PROTOCOLS = ['binary', 'base64', 'pbbp2']

// ─── Types ──────────────────────────────────────────────

export interface DMClientConfig {
  deviceId: string
  uid: string
  appKey?: string
  fpid?: number
  service?: number
  aid?: number
  devicePlatform?: string
  sessionId?: string
}

export interface Conversation {
  id: string
  shortId: string
  type: number
  name: string
  avatar: string
  unreadCount: number
  lastMessage?: Message | null
  users: UserInfo[]
  isMuted: boolean
  isPinned: boolean
  createTime: number
}

export interface Message {
  id: string
  serverMessageId: string
  conversationId: string
  content: string
  type: number
  fromUserId: string
  fromUserSecId: string
  createTime: number
  status: number
}

export interface UserInfo {
  id: string
  secUid: string
  nickname: string
  avatar: string
}

export interface PaginatedResponse<T> {
  items: T[]
  cursor: string
  hasMore: boolean
}

export interface SendMessageResult {
  success: boolean
  messageId?: string
  serverMessageId?: string
  conversationId?: string
  status?: number
  error?: string
}

interface CapabilityTopicEntry {
  flag: number
  topicType: number
  cursor: bigint
}

// ─── DM Client ──────────────────────────────────────────

export class DMWebSocketClient {
  private ws: WebSocket | null = null
  private root: protobuf.Root | null = null
  private config: Required<DMClientConfig>
  private seqid = 10003
  private logidBase = Date.now() * 1000000
  private pending = new Map<number, { resolve: (data: any) => void; reject: (err: Error) => void }>()
  private connected = false
  private initPromise: Promise<void> | null = null
  private capabilityResolve: (() => void) | null = null
  private capabilityPayload: Buffer | null = null

  private Frame: protobuf.Type | null = null
  private Request: protobuf.Type | null = null
  private Response: protobuf.Type | null = null
  private RequestBody: protobuf.Type | null = null
  private ResponseBody: protobuf.Type | null = null
  private BsyncProtocol: protobuf.Type | null = null
  private BsyncTopic: protobuf.Type | null = null
  private DataItem: protobuf.Type | null = null
  private DataPayload: protobuf.Type | null = null

  // Response body message types (loaded lazily)
  private responseTypes = new Map<number, protobuf.Type>()

  constructor(config: DMClientConfig) {
    this.config = {
      appKey: DEFAULT_APP_KEY,
      fpid: 32,
      service: SERVICE,
      aid: 1988,
      devicePlatform: 'web',
      sessionId: '',
      ...config,
    }
  }

  // ─── Accessors ───────────────────────────────────────

  private get accessKey(): string {
    return crypto.createHash('md5')
      .update(`${this.config.fpid}${this.config.appKey}${this.config.deviceId}${ACCESS_KEY_SALT}`)
      .digest('hex')
  }

  private get frontierURL(): string {
    const params = new URLSearchParams({
      fpid: String(this.config.fpid),
      service: String(this.config.service),
      method: '2',
      aid: String(this.config.aid),
      device_id: this.config.deviceId,
      access_key: this.accessKey,
      device_platform: this.config.devicePlatform,
    })
    return `${WS_URL}?${params.toString()}`
  }

  get isConnected(): boolean {
    return this.connected
  }

  // ─── Lifecycle ───────────────────────────────────────

  async init(): Promise<void> {
    this.root = await protobuf.load(path.join(__dirname, 'dm.proto'))
    this.Frame = this.root.lookupType('im_proto.Frame')
    this.Request = this.root.lookupType('im_proto.Request')
    this.Response = this.root.lookupType('im_proto.Response')
    this.RequestBody = this.root.lookupType('im_proto.RequestBody')
    this.ResponseBody = this.root.lookupType('im_proto.ResponseBody')
    this.BsyncProtocol = this.root.lookupType('im_proto.BsyncProtocol')
    this.BsyncTopic = this.root.lookupType('im_proto.BsyncTopic')
    this.DataItem = this.root.lookupType('im_proto.DataItem')
    this.DataPayload = this.root.lookupType('im_proto.DataPayload')
  }

  async connect(): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise<void>(async (resolve, reject) => {
      try {
        if (!this.root) await this.init()

        this.ws = new WebSocket(this.frontierURL, WS_PROTOCOLS)
        this.ws.binaryType = 'arraybuffer'

        this.ws.on('open', async () => {
          this.connected = true
          try {
            await this.sendInit()
            resolve()
          } catch (e) {
            reject(e)
          }
        })

        this.ws.on('message', (raw) => this.onMessage(raw))
        this.ws.on('close', () => this.onClose())
        this.ws.on('error', (err) => {
          if (!this.connected) reject(err)
        })
      } catch (e) {
        reject(e)
      }
    })

    return this.initPromise
  }

  async close(): Promise<void> {
    this.stopHeartbeat()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.initPromise = null
    this.capabilityResolve = null
    this.capabilityPayload = null
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }

  // ─── Init / Subscription ─────────────────────────────

  private async sendInit(): Promise<void> {
    const now = Date.now()

    // Step 1: Send INIT (device_info + 3 subscribe_level subscriptions in one frame)
    const uid = this.config.uid || this.config.deviceId
    const initBody = this.buildInitPayload(this.config.deviceId, uid, now)
    await this.sendFrame(10001, now, this.config.service, 2, initBody)

    // Wait for capability push (saves decompressed payload in capabilityPayload)
    await new Promise<void>((resolve) => {
      this.capabilityResolve = resolve
    })

    // Step 2: Parse capability payload to extract topic entries for subscription
    const topicEntries = this.parseCapabilityTopics(this.capabilityPayload)
    const subBody = this.buildSubscriptionPayload(this.config.deviceId, uid, now + 1, topicEntries)
    await this.sendFrame(10002, now + 1, this.config.service, 2, subBody)

    this.seqid = 10003

    // Wait a moment for server to fully process handshake before any data commands
    await new Promise<void>(resolve => setTimeout(resolve, 1500))
  }

  /**
   * Parse topic entries from the capability push payload.
   * The capability push contains: DeviceInfo (field=1) + repeated TopicEntry (field=2).
   * Small entries (<100 bytes) carry flag + topic_type + cursor values needed for subscription.
   */
  private parseCapabilityTopics(payload: Buffer | null): CapabilityTopicEntry[] {
    if (!payload || payload.length < 4) return []
    const entries: CapabilityTopicEntry[] = []
    let pos = 0
    while (pos < payload.length) {
      const tag = payload[pos++]
      const fn = tag >> 3
      const wt = tag & 7
      if (fn === 2 && wt === 2) {
        let len = 0, shift = 0
        while (true) { const b = payload[pos]; len |= (b & 0x7f) << shift; shift += 7; pos++; if (!(b & 0x80)) break }
        const raw = payload.slice(pos, pos + len)
        pos += len

        // Skip large entries (business data payloads, not topic descriptors)
        if (raw.length > 100) continue

        let ep = 0
        let flag = 0, topicType = 0
        let cursor = 0n
        while (ep < raw.length) {
          const t = raw[ep++]
          const f = t >> 3
          const w = t & 7
          if (w === 0) {
            let v = 0n, s = 0
            while (true) { const b = raw[ep]; v |= BigInt(b & 0x7f) << BigInt(s); s += 7; ep++; if (!(b & 0x80)) break }
            if (f === 2) flag = Number(v)
            if (f === 3) topicType = Number(v)
            if (f === 4) cursor = v
          } else if (w === 2) {
            let l = 0, sh = 0
            while (true) { const b = raw[ep]; l |= (b & 0x7f) << sh; sh += 7; ep++; if (!(b & 0x80)) break }
            ep += l
          }
        }
        entries.push({ flag, topicType, cursor })
      } else {
        // Skip non-field-2 bytes
        if (wt === 0) { let v = 0, s = 0; while (true) { const b = payload[pos]; v |= (b & 0x7f) << s; s += 7; pos++; if (!(b & 0x80)) break } }
        else if (wt === 2) { let l = 0, sh = 0; while (true) { const b = payload[pos]; l |= (b & 0x7f) << sh; sh += 7; pos++; if (!(b & 0x80)) break } pos += l }
        else if (wt === 5) pos += 4
        else if (wt === 1) pos += 8
      }
    }
    return entries
  }

  private buildInitPayload(deviceId: string, uid: string, timestamp: number): Buffer {
    const deviceIdBuf = Buffer.from(deviceId)
    const uidBuf = Buffer.from(uid || deviceId)
    const innerBody = Buffer.concat([
      Buffer.from([0x08, 0x02]),
      Buffer.from([0x12, uidBuf.length]),
      uidBuf,
      Buffer.from([0x1a, deviceIdBuf.length]),
      deviceIdBuf,
      Buffer.from([0x20]),
      this.encodeVarint(timestamp - 1000),
    ])
    return Buffer.concat([
      Buffer.from([0x0a, innerBody.length]),
      innerBody,
      Buffer.from([0x12, 0x04, 0x08, 0x03, 0x18, 0x00]),
      Buffer.from([0x12, 0x04, 0x08, 0x03, 0x18, 0x01]),
      Buffer.from([0x12, 0x04, 0x08, 0x03, 0x18, 0x02]),
    ])
  }

  private buildSubscriptionPayload(deviceId: string, uid: string, timestamp: number, entries: CapabilityTopicEntry[]): Buffer {
    const deviceIdBuf = Buffer.from(deviceId)
    const uidBuf = Buffer.from(uid || deviceId)
    const tsBuf = this.encodeVarint(timestamp - 1000)
    const deviceInner = Buffer.concat([
      Buffer.from([0x08, 0x02]),
      Buffer.from([0x12, uidBuf.length]),
      uidBuf,
      Buffer.from([0x1a, deviceIdBuf.length]),
      deviceIdBuf,
      Buffer.from([0x20]),
      tsBuf,
    ])
    const devicePart = Buffer.concat([
      Buffer.from([0x0a, deviceInner.length]),
      deviceInner,
    ])

    // Build topic subscription entries (type=4) matching the capability entries (type=3)
    // Each entry: field=2, sub-message {type=4, flag, topic_type, cursor}
    const topicParts = entries.map(e => {
      const inner = Buffer.concat([
        Buffer.from([0x08, 0x04]),
        Buffer.from([0x10, e.flag]),
        Buffer.from([0x18, e.topicType]),
        Buffer.from([0x20]),
        this.encodeVarint(e.cursor),
      ])
      return Buffer.concat([
        Buffer.from([0x12, inner.length]),
        inner,
      ])
    })

    return Buffer.concat([devicePart, ...topicParts])
  }

  // ─── Frame I/O ───────────────────────────────────────

  private async sendFrame(
    seqid: number,
    logid: number,
    service: number,
    method: number,
    payload: Buffer,
    payloadEncoding?: string,
  ): Promise<void> {
    const msg: any = {
      seqid: seqid,
      logid: logid,
      service,
      method,
      payload,
      payload_type: '2',
    }
    if (payloadEncoding) msg.payload_encoding = payloadEncoding
    const frame = this.Frame!.create(msg)
    const bytes = Buffer.from(this.Frame!.encode(frame).finish())
    this.ws!.send(bytes)
  }

  private nextSeqid(): number {
    return this.seqid++
  }

  private nextLogid(): number {
    this.logidBase++
    return Number(this.logidBase)
  }

  // ─── Request / Response ──────────────────────────────

  /**
   * Send an IM command and wait for response.
   * Sends gzip(Request) inside a Frame — NOT BsyncProtocol-wrapped.
   * The server responds with a Frame containing gzip(Response).
   */
  async executeCommand(cmd: number, bodyObj: any, timeout = 15000): Promise<any> {
    if (!this.connected) throw new Error('DM client not connected')

    const seqid = this.nextSeqid()

    // Build RequestBody with the correct cmd-specific sub-body
    const bodyFieldName = this.cmdToBodyFieldName(cmd)
    const requestBodyMsg: any = {}
    if (bodyFieldName) {
      requestBodyMsg[bodyFieldName] = bodyObj
    }

    const requestMsg: any = {
      cmd,
      sequenceId: seqid,
      sdkVersion: '',
      token: this.config.sessionId || '',
      refer: 1,
      inboxType: 0,
      buildNumber: '',
      body: requestBodyMsg,
      deviceId: this.config.uid,
      channel: '',
      devicePlatform: 'web',
      deviceType: '',
      osVersion: '',
      versionCode: '',
      configId: 0,
      authType: this.config.sessionId ? 1 : 2,
    }
    const requestBytes = Buffer.from(this.Request!.encode(requestMsg).finish())
    const compressed = zlib.gzipSync(requestBytes)

    await this.sendFrame(seqid, Date.now(), this.config.service, 2, compressed, 'gzip')

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seqid)
        reject(new Error(`Timeout waiting for response to cmd ${cmd} (seqid ${seqid})`))
      }, timeout)
      this.pending.set(seqid, {
        resolve: (data) => {
          clearTimeout(timer)
          resolve(data)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        },
      })
    })
  }

  private cmdToBodyFieldName(cmd: number): string | null {
    // protobufjs converts snake_case to camelCase internally
    switch (cmd) {
      case 100: return 'sendMessageBody'
      case 301: return 'messagesInConversationBody'
      case 610: return 'getConversationInfoListV2Body'
      case 2006: return 'getConversationListBody'
      default: return null
    }
  }

  private getCmdBodyType(cmd: number, direction: 'request' | 'response'): protobuf.Type | null {
    if (!this.root) return null
    const nameMap: Record<number, { request: string; response: string }> = {
      2006: { request: 'im_proto.GetUserConversationListRequestBody', response: 'im_proto.GetUserConversationListResponseBody' },
      301: { request: 'im_proto.MessagesInConversationRequestBody', response: 'im_proto.MessagesInConversationResponseBody' },
      100: { request: 'im_proto.SendMessageRequestBody', response: 'im_proto.SendMessageResponseBody' },
    }
    const entry = nameMap[cmd]
    if (!entry) return null
    try {
      return this.root.lookupType(entry[direction])
    } catch { return null }
  }

  private unwrapResponseBody(cmd: number, body: Buffer): Buffer | null {
    if (!body || body.length < 2) return null
    try {
      let pos = 0
      let tag = 0
      let shift = 0
      while (pos < body.length) {
        const byte = body[pos++]
        tag |= (byte & 0x7f) << shift
        shift += 7
        if (!(byte & 0x80)) break
      }
      const expectedTag = cmd * 8 + 2
      if (tag !== expectedTag) return null
      let len = 0
      shift = 0
      while (pos < body.length) {
        const byte = body[pos++]
        len |= (byte & 0x7f) << shift
        shift += 7
        if (!(byte & 0x80)) break
      }
      return Buffer.from(body.slice(pos, pos + len))
    } catch {
      return null
    }
  }

  // ─── Message Handler ─────────────────────────────────

  private async onMessage(raw: WebSocket.Data): Promise<void> {
    if (!(raw instanceof Buffer || raw instanceof ArrayBuffer)) return
    const buf = Buffer.from(raw as any)
    try {
      const frame = this.Frame!.decode(buf)
      let payload = Buffer.from(frame.payload)
      if (frame.payloadEncoding === 'gzip') {
        payload = zlib.gunzipSync(payload)
      }

      // Server push (has headers) = capability response, sync response, or notification
      if (frame.headers && frame.headers.length > 0) {
        const xMethod = frame.headers.find((h: any) => h.key === 'X-Method')?.value
        if (xMethod === 'PayloadRelatedMethod') {
          this.startHeartbeat()
          if (this.capabilityResolve && !this.capabilityPayload) {
            this.capabilityPayload = payload
            this.capabilityResolve()
            this.capabilityResolve = null
          }
        }
      }

      // Direct Response decode — most IM commands respond this way
      try {
        const resp = this.Response!.decode(payload)
        const seqid = Number(resp.sequenceId)
        const pending = this.pending.get(seqid)
        if (pending) {
          this.pending.delete(seqid)
          pending.resolve(resp)
          return
        }
      } catch {
        // Not a Response — try BsyncProtocol
      }

      // Fallback: BsyncProtocol (capability push, sync push, legacy command responses)
      try {
        const bsync = this.BsyncProtocol!.decode(payload)
        if (bsync.topics) {
          for (const topic of bsync.topics) {
            if ((topic.flag === 2 || topic.flag === 3) && topic.packets) {
              for (const packet of topic.packets) {
                const dataPayload = packet.payload as any
                if (!dataPayload || !dataPayload.data) continue
                try {
                  const resp = this.Response!.decode(dataPayload.data)
                  const seqid = Number(resp.sequenceId)
                  const pending = this.pending.get(seqid)
                  if (pending) {
                    this.pending.delete(seqid)
                    pending.resolve(resp)
                  }
                } catch {
                  // Packet data isn't a Response
                }
              }
            }
          }
        }
      } catch {
        // Not BsyncProtocol either — skip
      }
    } catch {
      // Skip malformed frames
    }
  }

  private onClose(): void {
    this.connected = false
    this.stopHeartbeat()
    if (this.capabilityResolve) {
      this.capabilityResolve()
      this.capabilityResolve = null
    }
    for (const [, pending] of this.pending) {
      pending.reject(new Error('Connection closed'))
    }
    this.pending.clear()
  }

  // ─── Heartbeat ───────────────────────────────────────

  private heartbeatTimer: NodeJS.Timeout | null = null

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return
    this.heartbeatTimer = setInterval(() => {}, 30000)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ─── IM Commands ─────────────────────────────────────

  async getConversations(cursor = ''): Promise<PaginatedResponse<Conversation>> {
    const body = this.buildGetConversationsBody(cursor)
    const resp = await this.executeCommand(2006, body)
    return this.parseConversationsResponse(resp)
  }

  async getMessages(conversationId: string, cursor = ''): Promise<PaginatedResponse<Message>> {
    const body = this.buildGetMessagesBody(conversationId, cursor)
    const resp = await this.executeCommand(301, body)
    return this.parseMessagesResponse(resp, conversationId)
  }

  async sendMessage(conversationId: string, text: string, messageType = 10001): Promise<SendMessageResult> {
    const body = this.buildSendMessageBody(conversationId, text, messageType)
    const resp = await this.executeCommand(100, body)
    return this.parseSendMessageResponse(resp, conversationId)
  }

  // ─── Body Builders ───────────────────────────────────

  private buildGetConversationsBody(cursor: string): any {
    const parts: any = {
      sortType: 4,
      conType: 0,
      limit: 20,
      withCold: true,
    }
    if (cursor) {
      parts.cursor = BigInt(cursor)
    }
    return parts
  }

  private buildGetMessagesBody(conversationId: string, cursor: string): any {
    const parts: any = {
      conversationId: conversationId,
      conversationType: 1,
      direction: 3,
      limit: 50,
    }
    if (cursor) {
      parts.anchorIndex = BigInt(cursor)
    }
    return parts
  }

  private buildSendMessageBody(conversationId: string, text: string, messageType: number): any {
    const clientMsgId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
    return {
      conversationId: conversationId,
      conversationType: 1,
      content: text,
      messageType: messageType,
      clientMessageId: clientMsgId,
    }
  }

  // ─── Response Parsers ────────────────────────────────

  private parseConversationsResponse(resp: any): PaginatedResponse<Conversation> {
    // resp.body is now a ResponseBody message
    const body: any = resp.body
    if (!body) return { items: [], cursor: '', hasMore: false }

    // For cmd=2006, the ResponseBody has get_conversation_list_body
    const listBody = body.get_conversation_list_body || body.getConversationListBody
    if (!listBody) return { items: [], cursor: '', hasMore: false }

    const items: Conversation[] = []
    if (listBody.list && listBody.list.length) {
      for (const convInfo of listBody.list) {
        items.push(this.convertConversationInfo(convInfo))
      }
    }
    const cursor = listBody.next_cursor ? String(listBody.next_cursor) : ''
    const hasMore = !!listBody.has_more
    return { items, cursor, hasMore }
  }

  private convertConversationInfo(convInfo: any): Conversation {
    const core = convInfo.conversation_core_info || convInfo.conversationCoreInfo || {}
    const setting = convInfo.conversation_setting_info || convInfo.conversationSettingInfo || {}
    const userInfo = convInfo.user_info || convInfo.userInfo

    const users: UserInfo[] = []
    if (userInfo) {
      users.push({
        id: String(userInfo.user_id ?? userInfo.userId ?? ''),
        secUid: userInfo.sec_uid || userInfo.secUid || '',
        nickname: userInfo.nickname || '',
        avatar: userInfo.avatar || '',
      })
    }

    return {
      id: convInfo.conversation_id || convInfo.conversationId || '',
      shortId: String(convInfo.conversation_short_id ?? convInfo.conversationShortId ?? ''),
      type: convInfo.conversation_type ?? convInfo.conversationType ?? 0,
      name: core.name || '',
      avatar: core.icon || '',
      unreadCount: 0,
      lastMessage: null,
      users,
      isMuted: setting.mute === 1,
      isPinned: setting.stick_on_top === 1 || setting.stickOnTop === 1,
      createTime: 0,
    }
  }

  private decodeConversationInfo(buf: Buffer): Conversation {
    let pos = 0
    const info: any = {}
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 2) info.shortId = val.toString()
        if (fieldNum === 3) info.type = Number(val)
        if (fieldNum === 7) info.participantsCount = Number(val)
        if (fieldNum === 8) info.isParticipant = !!val
        if (fieldNum === 9) info.inboxType = Number(val)
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1) info.id = raw.toString()
        if (fieldNum === 4) info.ticket = raw.toString('hex')
        if (fieldNum === 5) {
          info.firstPageUsers = this.decodeParticipantsPage(raw)
        }
        if (fieldNum === 20) {
          info.userInfo = this.decodeParticipant(raw)
        }
        if (fieldNum === 50) {
          info.coreInfo = this.decodeConversationCoreInfo(raw)
        }
        if (fieldNum === 51) {
          info.settingInfo = this.decodeConversationSettingInfo(raw)
        }
      }
    }

    const core = info.coreInfo || {}
    const setting = info.settingInfo || {}
    const name = core.name || ''
    const avatar = core.icon || ''
    const ownerId = core.owner ? String(core.owner) : ''
    const isMuted = setting.mute === 1
    const isPinned = setting.stick_on_top === 1
    const unreadCount = 0

    const userInfo: UserInfo[] = []
    if (info.userInfo) {
      userInfo.push(info.userInfo)
    }
    if (info.firstPageUsers) {
      for (const u of info.firstPageUsers) {
        if (!userInfo.find((x) => x.id === u.id)) {
          userInfo.push(u)
        }
      }
    }

    return {
      id: info.id || info.shortId || '',
      shortId: info.shortId || '',
      type: info.type || 0,
      name,
      avatar,
      unreadCount,
      lastMessage: null,
      users: userInfo,
      isMuted,
      isPinned,
      createTime: 0,
    }
  }

  private decodeConversationCoreInfo(buf: Buffer): any {
    let pos = 0
    const info: any = {}
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 4) info.infoVersion = val.toString()
        if (fieldNum === 8) info.inboxType = Number(val)
        if (fieldNum === 12) info.owner = val.toString()
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1) info.conversationId = raw.toString()
        if (fieldNum === 5) info.name = raw.toString('utf8')
        if (fieldNum === 6) info.desc = raw.toString('utf8')
        if (fieldNum === 7) info.icon = raw.toString()
        if (fieldNum === 13) info.secOwner = raw.toString()
      }
    }
    return info
  }

  private decodeConversationSettingInfo(buf: Buffer): any {
    let pos = 0
    const info: any = {}
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 4) info.minIndex = val.toString()
        if (fieldNum === 5) info.readIndex = val.toString()
        if (fieldNum === 6) info.mute = Number(val)
        if (fieldNum === 7) info.stickOnTop = Number(val)
        if (fieldNum === 11) info.favorite = Number(val)
        if (fieldNum === 12) info.setTopTime = val.toString()
        if (fieldNum === 13) info.setFavoriteTime = val.toString()
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1) info.conversationId = raw.toString()
        if (fieldNum === 2) info.shortId = raw.toString()
      }
    }
    return info
  }

  private decodeParticipant(buf: Buffer): UserInfo | null {
    let pos = 0
    const info: any = {}
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 1) info.id = val.toString()
        if (fieldNum === 5) info.role = Number(val)
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 2) info.secUid = raw.toString()
        if (fieldNum === 3) info.nickname = raw.toString('utf8')
        if (fieldNum === 4) info.avatar = raw.toString()
      }
    }
    if (!info.id) return null
    return {
      id: info.id,
      secUid: info.secUid || '',
      nickname: info.nickname || '',
      avatar: info.avatar || '',
    }
  }

  private decodeParticipantsPage(buf: Buffer): UserInfo[] {
    let pos = 0
    const users: UserInfo[] = []
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1 || fieldNum === 2) {
          const user = this.decodeParticipant(raw)
          if (user) users.push(user)
        }
      } else if (wireType === 0) {
        let val = 0
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= (byte & 0x7f) << shift
          shift += 7
          if (!(byte & 0x80)) break
        }
      }
    }
    return users
  }

  private parseMessagesResponse(resp: any, conversationId: string): PaginatedResponse<Message> {
    const body = resp.body
    if (!body || !(body instanceof Buffer)) {
      return { items: [], cursor: '', hasMore: false }
    }
    const innerBody = this.unwrapResponseBody(resp.cmd, body)
    if (!innerBody) {
      return { items: [], cursor: '', hasMore: false }
    }
    return this.decodeMessagesListBody(innerBody, conversationId)
  }

  private decodeMessagesListBody(body: Buffer, conversationId: string): PaginatedResponse<Message> {
    const items: Message[] = []
    let cursor = ''
    let hasMore = false
    let pos = 0
    while (pos < body.length) {
      const tag = body[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = body[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 2) cursor = val.toString()
        if (fieldNum === 3) hasMore = !!val
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = body[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = body.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1) {
          const msg = this.decodeMessageBody(raw, conversationId)
          items.push(msg)
        }
      }
    }
    return { items, cursor, hasMore }
  }

  private decodeMessageBody(buf: Buffer, conversationId: string): Message {
    let pos = 0
    const info: any = {}
    while (pos < buf.length) {
      const tag = buf[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = buf[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 2) info.conversationType = Number(val)
        if (fieldNum === 3) info.serverMessageId = val.toString()
        if (fieldNum === 4) info.index = val.toString()
        if (fieldNum === 5) info.shortId = val.toString()
        if (fieldNum === 6) info.messageType = Number(val)
        if (fieldNum === 7) info.sender = val.toString()
        if (fieldNum === 10) info.createTime = Number(val)
        if (fieldNum === 11) info.version = val.toString()
        if (fieldNum === 12) info.status = Number(val)
        if (fieldNum === 13) info.order = val.toString()
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = buf[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = buf.slice(pos, pos + len)
        pos += len
        if (fieldNum === 1) info.conversationId = raw.toString()
        if (fieldNum === 8) info.content = raw.toString('utf8')
        if (fieldNum === 14) info.secSender = raw.toString()
      }
    }
    return {
      id: info.serverMessageId || '',
      serverMessageId: info.serverMessageId || '',
      conversationId: info.conversationId || conversationId,
      content: info.content || '',
      type: info.messageType || 0,
      fromUserId: info.sender || '',
      fromUserSecId: info.secSender || '',
      createTime: info.createTime || 0,
      status: info.status || 0,
    }
  }

  private parseSendMessageResponse(resp: any, conversationId: string): SendMessageResult {
    const body = resp.body
    if (!body || !(body instanceof Buffer)) {
      return { success: false, conversationId, error: 'No response body' }
    }
    const innerBody = this.unwrapResponseBody(resp.cmd, body)
    if (!innerBody) {
      return { success: false, conversationId, error: 'Failed to unwrap response body' }
    }
    return this.decodeSendMessageResponse(innerBody, conversationId)
  }

  private decodeSendMessageResponse(body: Buffer, conversationId: string): SendMessageResult {
    let pos = 0
    let serverMessageId = ''
    let clientMessageId = ''
    let status = -1
    let checkCode = 0
    while (pos < body.length) {
      const tag = body[pos++]
      const fieldNum = tag >> 3
      const wireType = tag & 7
      if (wireType === 0) {
        let val = 0n
        let shift = 0
        while (true) {
          const byte = body[pos++]
          val |= BigInt(byte & 0x7f) << BigInt(shift)
          shift += 7
          if (!(byte & 0x80)) break
        }
        if (fieldNum === 1) serverMessageId = val.toString()
        if (fieldNum === 3) status = Number(val)
        if (fieldNum === 5) checkCode = Number(val)
      } else if (wireType === 2) {
        let len = 0
        let shift = 0
        while (true) {
          const byte = body[pos]
          len |= (byte & 0x7f) << shift
          shift += 7
          pos++
          if (!(byte & 0x80)) break
        }
        const raw = body.slice(pos, pos + len)
        pos += len
        if (fieldNum === 2) {} // extra_info
        if (fieldNum === 4) clientMessageId = raw.toString()
        if (fieldNum === 6) {} // check_message
      }
    }
    return {
      success: status === 0,
      serverMessageId,
      messageId: clientMessageId,
      conversationId,
      status,
    }
  }

  // ─── Utilities ───────────────────────────────────────

  private encodeVarint(value: number | bigint): Buffer {
    if (typeof value === 'bigint') {
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
    const bytes: number[] = []
    let v = value >>> 0
    while (v > 127) {
      bytes.push((v & 127) | 128)
      v >>>= 7
    }
    bytes.push(v)
    return Buffer.from(bytes)
  }
}
