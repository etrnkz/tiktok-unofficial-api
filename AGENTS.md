# Project Summary

## What We Learned
- **Like endpoint** (`/api/commit/item/digg/`) requires BOTH ticket guard (ECDSA P-256) AND X-Bogus — from ANY context (browser XHR, fetch, Node.js)
- **Ticket guard content format**: signed data = `"ticket" + path + timestamp` (literal "ticket" string + URL pathname + unix seconds), ECDSA P-256 SHA-256, DER output base64
- **Ticket guard headers** (`tt-ticket-guard-*`): computed by the FRONTEND code (Axios interceptor), NOT by the secsdk CSRF interceptor
- **Two separate SDK layers**:
  1. **secsdk** (window.secsdk.csrf): handles CSRF token injection via patched `XHR.send()` — adds `x-secsdk-csrf-token` for paths in `protectionConfig` (e.g., Studio page covers `/api/commit/*`; main page only covers `webcast.tiktok.com`)
  2. **webmssdk** (byted_acrawler): handles X-Bogus computation and URL tracking params — intercepts paths in `enablePathList` (covers `/api/commit/item/digg/`, `/api/commit/follow/user/`, etc.)
- **X-Bogus** computed by `byted_acrawler.frontierSign()` from the webmssdk VM, needs `init({aid:1988})` first
- **msToken** added automatically by webmssdk interceptor after `init()` — appears as URL query param
- **ticket guard keys stored in localStorage** (double-JSON wrapped):
  - `security-sdk/s_sdk_crypt_sdk` → `{data: {ec_privateKey: "-----BEGIN PRIVATE KEY-----...", ec_publicKey: "..."}}`
  - `security-sdk/s_sdk_sign_data_key/tt_fetch` → `{data: {ts_sign: "ts.1.<128hex>", encrypt_ticket: "..."}}`
- **Rate limiting**: ~3-4 POST actions per ~30s window, `Content-Length: 0` response, 60s cooldown needed
- **ECDSA P-256 signatures are non-deterministic** (random nonce)

## Anti-Bot System Architecture
### Argus TLB Plugin (server-side middleware)
- Returns 403 "Web SDK blocked by Argus TLB Plugin" for requests missing X-Bogus or required tracking params
- Detected even from browser-context calls (CDP Runtime.evaluate) if URL lacks proper signing

### secsdk (CSRF Protection)
- Patches `XMLHttpRequest.prototype.send` (2103 chars) and `setRequestHeader`
- `open()` saved to `this.openArgs`; `send()` checks URL against `protectionConfig` and adds CSRF token
- ASYNC token fetch: `defenser.fetchToken(host, path).then(...)` — makes HEAD request to endpoint, falls back to DOWNGRADE on failure
- `window.secsdk.csrf` exposes: `nativeXMLHttpRequest`, `nativeFetch`, `tokenMap`, `protectionConfig`, `whiteListConfig`
- **Per-site protectionConfig differs**: Studio page has `www.tiktok.com/POST: [/api/commit/*]`; main page only has `webcast.tiktok.com`

### webmssdk (X-Bogus / Tracking)
- `window.byted_acrawler`: exposes `frontierSign()`, `init()`, `setUserMode()`, `getReferer()`
- Requires `init({aid:1988})` before `frontierSign()` works
- `_mssdk` object stores `cacheOpts` with `enablePathList` (paths that get X-Bogus signing) — covers `/api/commit/item/digg/`
- Intercepts fetch calls (`__ac_intercepted_fetch = true`); `_fetch` = original fetch; Adds URL params like `msToken`
- X-Bogus appears as URL query parameter in the final request

### Ticket Guard (Per-Endpoint Server-Side Check)
- **NOT bypassed from browser context** — even browser-originated XHRs get `tt-ticket-guard-result: 1101` for the like endpoint
- **Bypassed ONLY when the FRONTEND code adds tick guard headers** (via Axios interceptor + Web Crypto signing)
- **1004** = ticket guard headers present but signature invalid or key unregistered
- **1101** = ticket guard headers missing entirely
- Keys are session-bound: localStorage keys from a specific page load are valid only in that session
- **www.tiktok.com main page keys ARE valid** (SDK registers them with server); Studio page keys may not be

## CDP Write Proxy Architecture
- `CdpWriteProxy` (src/utils/cdp.ts): connects to Chrome via CDP, creates a hidden tab, exposes `xhr()` that runs in browser context
- **Two tab types needed**:
  1. **Studio tab** (`www.tiktok.com/tiktokstudio/content`): Used for follow/unfollow — Studio's secsdk protectionConfig covers `/api/commit/follow/user/`, CSRF only (no ticket guard req)
  2. **Main tab** (`www.tiktok.com`): Needed for like/unlike — main page has valid ticket guard keys in localStorage; X-Bogus requires webmssdk init
- **Cookies must be set BEFORE navigation** (via `Network.setCookie` before `Page.navigate`)
- **3-second extra wait** after page load critical for SDK initialization
- Read operations (GET) still work via pure Node.js HTTP with X-Bogus + X-Gnarly (via frontierSign VM)

## Verified Working
- `client.like(videoId)` — CDP main tab (ticket guard + X-Bogus), `status_code: 0, is_digg: 1`
- `client.unlike(videoId)` — CDP main tab (ticket guard + X-Bogus), `status_code: 0` ("url doesn't match" msg is informational)
- `client.follow(secUid)` — CDP Studio tab (CSRF-only), `status_code: 0, follow_status: 1`
- `client.unfollow(secUid)` — CDP Studio tab (CSRF-only), `status_code: 0, follow_status: 0`
- `client.publishComment(videoId, text)` — CDP main tab (ticket guard + X-Bogus), `status_code: 0`
- `client.replyToComment(videoId, commentId, text)` — CDP main tab (ticket guard + X-Bogus), `status_code: 0`
- `client.uploadVideo()` — full 7-step flow (VOD upload + post creation)
- `client.uploadImage()` — VOD upload + optional post creation with `post_type: 2`
- `client.getConversations()` — Pure Node.js HTTPS (protobuf) on `im-api-sg.tiktok.com/v2/message/get_by_user_init` (returns active conversations, short IDs, last messages)
- `client.getMessages(conversationId)` — Pure Node.js HTTPS (protobuf) on `im-api-sg.tiktok.com/v1/message/get_by_conversation` (cmd 301)
- `client.sendMessage(conversationId, text)` — Pure Node.js HTTPS (protobuf) on `im-api-sg.tiktok.com/v1/message/send` (cmd 100), successfully delivers message and returns serverMessageId
- VM X-Bogus validated live — Real TikTok API returned HTTP 200
- Ticket guard self-verifies — Web Crypto ECDSA signatures valid when verified with public key

## Implemented but UNVERIFIED
- `client.getNotifications(cursor)` — endpoint `/api/inbox/notice_list/` works (returns empty for inactive accounts)
- `client.getNotificationCount()` — endpoint `/api/inbox/unread_count/` returns "url doesn't match" (needs different path)
- `client.getInbox(cursor)` — calls same endpoint as getNotifications
- `client.getImUserProfile(userIds)` — needs verification on `im-api-sg.tiktok.com`

## SyncSdk Protocol Architecture (Reverse-Engineered from chunk)
### Transport
- **WebSocket** (`wss://im-ws-sg.tiktok.com/ws/v2`) with sub-protocol `pbbp2` is the PRIMARY transport for IM sync
- **HTTP pipeline** (`POST https://www.tiktok.com/v2/bytesync/api/pipeline?device_id=X&platform=0&aid=1988`) is the fallback when WS is unavailable
- SDK prefers WS; falls back to HTTP with `{useWs: false}`

### WS Connection Params (from CDP capture + chunk source)
```
wss://im-ws-sg.tiktok.com/ws/v2?fpid=32&service=33554513&method=2&aid=1988&device_id=X&access_key=Y&device_platform=web
```
- **fpid=32** (frontier protocol ID for IM sync)
- **service=33554513** (0x2000051 = IM bsync service)
- **method=2** (client→server)
- **aid=1988** (web app ID)
- **access_key = md5(fpid + appKey + device_id + "f8a69f1719916z")**
  - App key for IM sync: `e252eea4204adef812c32f35a4b80f4b`
  - Verified: `md5("32e252eea4204adef812c32f35a4b80f4b{device_id}f8a69f1719916z")` matches captured traffic
- Sub-protocols: `['binary', 'base64', 'pbbp2']`
- Server sends auth via cookies (sessionid)

### Protocol Stack (VERIFIED WORKING)
```
Frame (protobuf, outer wrapper)
  ├── seqid (uint64) — auto-incrementing
  ├── logid (uint64) — timestamp
  ├── service (int32) — 33554513 for IM, 20032 for server push
  ├── method (int32) — 2 for client→server, 1 for server→client
  ├── headers[] (ExtendedEntry) — server push metadata only
  ├── payload_encoding (string) — "gzip" when compressed
  ├── payload_type (string) — "2" for protobuf
  └── payload (bytes) — serialized BsyncProtocol (often gzip)

BsyncProtocol (inner, core message)
  ├── header (BsyncHeader)
  │     ├── version (int32) — V2=2
  │     ├── uid (string) — user ID
  │     ├── did (string) — device ID
  │     ├── ts (int64) — timestamp
  │     ├── ctrl (int32) — Ctrl enum: Default=0, HttpPoll=1, HeartbeatPong=2
  │     └── infos (map<int32, bytes>) — field 255, populated by plugins
  └── topics[] (BsyncTopic)
        ├── flag (int32) — None=0, ACK=1, Data=2, Sync=3, Poll=4, FIN=5
        ├── bucket (int32) — Device=0, User=1
        ├── topic_type (int32) — SpecTopic=0, GlobalTopic=1, CustomTopic=2
        ├── sync_id (int64) — cursor/session id
        ├── ref_cursor (int64), new_cursor (int64)
        ├── packets[] (BsyncPacket)
        │     ├── cursor (BsyncCursor) — REQUIRED
        │     ├── payload (BsyncPayload)
        │     │     ├── business (int32) — REQUIRED
        │     │     ├── consume_type (int32)
        │     │     ├── md5 (string)
        │     │     └── data (bytes) — serialized inner Request/Response
        │     ├── status (int32)
        │     ├── ts (int64) — field 255 (0xFF!)
        │     └── extra (map<string, string>) — field 256 (0x100!)
        ├── topic_status (int32)
        ├── expire_time (int64)
        └── req_id (string) — field 255
```

### Key Field Corrections (critical)
- **BsyncPacket.ts** = FIELD 255 (0xFF), NOT field 4!
- **BsyncPacket.extra** = FIELD 256 (0x100) as `map<string,string>`, NOT field 5 string!
- **BsyncHeader.ctrl** = FIELD 5 (int32, Ctrl enum)
- **BsyncHeader.infos** = FIELD 255 (0xFF) as `map<int32, bytes>`
- These field numbers MUST match the server's schema exactly or protobuf decode fails

### Encoding Quirks
- Chunk's encoder writes `flag`, `topic_type`, `version`, `ctrl` fields **unconditionally** (no null/zero check)
- Standard protobufjs skips zero-value fields (int32=0, string="") — must use custom Writer to force-write
- Custom encode functions in `test_ws_sync2.js` use `protobuf.Writer` directly to replicate chunk behavior

### Business IDs (from sync capability response)
**Bucket 0 (Device):** 1,2,3,8,10,11,12,15,21,22,23,24,27,28,30,32,38,42,43,44,45,46,48,50,52,53,54,55,56,59,60,61,65,66,69,73,75,76,77,78,79,80,82,83,84,85,86,87,88
**Bucket 1 (User):** 4,5,6,7,13,14,16,17,25,26,29,31,40,41,47,49,51,58,62,63,64,67,68,70,71,72,74,81,89,90

### Message Flow (VERIFIED)
1. **Client → Server**: Frame(service=33554513, method=2) with BsyncProtocol(sync init → 3 Sync topics)
2. **Server → Client**: Frame(service=20032, method=1, gzip) with BsyncProtocol(12 topics: GlobalTopic sync_ids + SpecTopic subscriptions) — 2595B
3. **Client → Server**: Frame(service=33554513, method=2) with BsyncProtocol(Data, cmd, business)
4. **Server → Client**: Frame(service=20032, method=1, gzip) with BsyncProtocol(ACK topic only) — 139B
5. **NO reactive data push** was observed within 30s after sending multiple commands with various business IDs

### Current Status
- WS connection: ✅ Connected with correct access_key
- Sync init: ✅ Returns capability (79 business IDs, 12 topics)
- Data command send: ✅ Server ACKs (flag=1)
- Command processing: ❌ No data returned — server ACKs but doesn't process synchronously
- Async push: ❌ No data pushed within 30s after sending commands

### Likely Missing Pieces
- **Poll/Subscribe handshake**: After capability response, SDK likely sends Poll messages with sync_ids to request data
- **Business ID mapping**: Need to map IM commands to correct business_id (not just the business IDs from capability)
- **CommonParams in infos**: The `getReportMsg` function passes `{infos: commonParams}` to `getSyncHeader`, which may contain session auth data
- **Plugin modifications**: `createSendData` applies plugins that may add auth data to infos
- **SDK reference**: The chunk's full protocol implementation (SyncSdk class) handles all these steps — best reproduced by running the actual SDK

### Key Files
- `syncsdk_chunk_64887.js` — Complete SyncSdk implementation (~800KB)
- `test_ws_sync2.js` — Working WS connection with sync init + data commands
- `sync_response.bin` / `sync_response_base64.txt` — Captured sync capability response
- `test_fixed_encode.js` — HTTP pipeline test (sync init returns same 2595B capability)

## Key Architecture Decisions
- `buildUrl()`: generates all params + X-Bogus (via VM frontierSign), returns URL — used for GET-only
- `request()`: extracts query from URL (without X-Bogus), computes X-Gnarly, appends it — used for GET-only
- **Write operations must go through CDP proxy** (browser context) — Node.js HTTP for writes is blocked by Argus TLB
- **Like/Unlike/Comment/Reply** use main TikTok tab (www.tiktok.com) with ticket guard + X-Bogus (VM-computed, not browser)
- **Follow/Unfollow** work via Studio tab with CSRF-only (no ticket guard required)
- **X-Bogus is computed via the frontierSign VM** (not from the browser's webmssdk) — the VM's `generateXBogus()` is called from Node.js, the result is added as a URL param before the XHR goes through the browser
- **Ticket guard headers are computed in the browser** via `makeTicketGuardHeadersBrowser()` which reads localStorage keys and signs with Web Crypto
- **msToken** is passed as a URL param (generated by `generateMsToken()` or from cookie) — webmssdk browser init is optional

## DM REST API (i  im-api-sg.tiktok.com)
### Endpoints
- **Init** (`POST /v2/message/get_by_user_init`): Returns a 24B payload with a session cursor. Always called BEFORE combo.
- **Combo** (`POST /v1/message/get_by_user_combo`): Returns cursor entries for types 0/1/3 (64B payload). Used for polling.

### Protocol
- Content-Type: `application/x-protobuf`
- Domain: `im-api-sg.tiktok.com`
- Request body: `DmRestRequest` proto, wrapped response in `DmRestResponse`

### Key Findings (VERIFIED WORKING)
- **seqid is per-endpoint, NOT a message counter**: Init always uses seqid=203, Combo always uses seqid=204. Calling combo with seqid=205 returns 200001. BUT combo can be called REPEATEDLY with seqid=204 (we did 3 sequential combos).
- **Metadata structure differs per endpoint**:
  - Init metadata = field 203 wrapper (`da 0c 02 08 00` → field 203, length 2, subfield 1=0)
  - Combo metadata = field 204 wrapper (`e2 0c <len>` with 3 cursor entries for types 0/1/3)
- **field18 = 1 REQUIRED** for both init and combo. Missing this causes 200001.
- **Web-Sdk-Ms-Token (field 21) NOT required** — both endpoints work without it.
- **Status response**: field 3 = statusCode (0=OK, 500=proto error), field 4 = statusStr ("OK"), field 6 = payload bytes
- **Init response payload** (field 6, type `da 0c` = field 203): contains cursor at inner field 3, metadata at fields 4-8/11
- **Combo response payload** (field 6, type `e2 0c` = field 204): 3 cursor entries (types 0/1/3): each has type, cursor_rs (field 5, only type 0), interval_ms (field 6: 600 for type 0, 7200 for types 1/3), unknown (fields 7=0, 10=0)
- **Combo returns cursors only, NOT conversations** — actual conversation data requires WebSocket protocol
- **Referer param matters**: captured request uses long login redirect URL as referer, not just `/messages`
- **`device_platform` param = `web_pc`** (not `web`), but top-level `devicePlatform` field = `web`
- **Cookie auth only** — no X-Bogus/ticket guard needed; sessionid + msToken cookies suffice
- **Can call combo repeatedly** with same seqid=204 — server allows polling every ~600ms for type 0

### Response Structure (raw protobuf walk)
```
Init response (119B):
  field 1: seqid (=203)
  field 2: logid (=10002)
  field 3: statusCode (=0)
  field 4: statusStr ("OK")
  field 5: unknown (=0)
  field 6: payload (24B) → field 203 wrapper → cursor + metadata
  field 7: logIdStr ("20260607...")
  field 10/11: timestamps (ms)
  field 14: serverRegion ("Singapore-Central")
  field 15: large uint (uid/device_id)

Combo response (159B):
  Same structure but field 6 = 64B field 204 wrapper with 3 cursor entries
```

### REST ↔ WS Cursor Flow
1. Call init(seqid=203) → get cursor from field 3 of inner payload
2. Call combo(seqid=204) with that cursor → get polling intervals + cursor updates
3. The cursor from init is used as type-0 cursor in combo request metadata
4. Poll combo repeatedly to maintain session (not for data)

### Implementation
- `src/utils/dm-rest-client.ts`: DmRestClient class with doInit()/doCombo() methods
- `src/utils/dm.proto`: DmRestRequest/DmRestResponse messages + inner cursor types

## DM / Messaging (WebSocket Protocol)
### Architecture (REVERSE-ENGINEERED, WORKING)
- **No REST API** — all DM endpoints dead (`/api/im/*` returns `"url doesn't match"`)
- **WebSocket-only** via `wss://im-ws-sg.tiktok.com/ws/v2` with sub-protocol `pbbp2`
- **SyncSdk chunk**: `64887.ba0a9df5.js` (801 KB) — full protobuf-based protocol implementation
- **Module system**: webpack chunk 64887, module 235242, loaded via `n.e("64887").then(n.bind(n,235242))`

### Connection Parameters (from SyncSdk)
```
WS URL: wss://im-ws-sg.tiktok.com/ws/v2?fpid=32&service=33554513&method=2&aid=1988&device_id=X&access_key=Y&device_platform=web
```
- `fpid` = 32 (constant from SDK defaults)
- `service` = `0x2000051` = 33554513
- `method` = 2
- `aid` = 1988
- `device_id` = uid (when logged in) OR wid (when guest)
- `access_key` = **`md5(fpid + appKey + device_id + "f8a69f1719916z")`** — verified against captured traffic
- `appKey` = `"e252eea4204adef812c32f35a4b80f4b"` (from chunk source)
- `device_platform` = `"web"`
- Sub-protocols: `["binary", "base64", "pbbp2"]`

### Protocol Stack
```
Frame (protobuf, outer wrapper)
  ├── seqid (uint64)
  ├── logid (uint64)
  ├── service (int32) — 0x2000051 for regular, 20032 for server push
  ├── method (int32) — 2 for client→server, 1 for server→client
  ├── headers[] (ExtendedEntry) — server push metadata only
  ├── payload_encoding (string) — "gzip" when compressed
  └── payload (bytes)
        ├── Init: raw protobuf body (no Request wrapper)
        │     ├── device_info {type=2, uid="0", device_id, timestamp}
        │     └── subscriptions[] {type=3, subscribe_level=N}
        ├── Subscription: same format as Init
        └── IM Command: gzip(Request{cmd, sequence_id, body})
              └── Response{cmd, sequence_id, body}
```

### Message Flow (VERIFIED WORKING)
1. **Client → Server**: Frame(service=0x2000051, method=2) with raw init body + device info + subscription flags
2. **Server → Client**: Frame(service=20032, method=1) with gzip-compressed response + headers (X-Method=PayloadRelatedMethod, X-PSM=bytedance.bsync.cache_svr) — capability list
3. **Client → Server**: Frame(service=0x2000051, method=2) with subscription/ack body
4. **Client → Server**: Frame(service=0x2000051, method=2, encoding=gzip) with Request{cmd, sequence_id, body}
5. **Server → Client**: Frame(service=0x2000051, method=1, encoding=gzip) with Response{cmd, sequence_id, body}

### IMCMD Enum (CORE COMMANDS)
```
SEND_MESSAGE = 100
GET_MESSAGES_BY_USER = 200
GET_MESSAGES_BY_USER_INIT_V2 = 203
GET_MESSAGE_INFO_BY_SERVER_ID = 211
GET_MESSAGES_BY_CONVERSATION = 301
GET_MESSAGES_CHECKINFO_IN_CONVERSATION = 302
SEND_USER_ACTION = 410
SEND_INPUT_STATUS = 411
NEW_MSG_NOTIFY = 500
NEW_BROADCAST_MSG_NOTIFY = 505
CREATE_CONVERSATION_V2 = 609
GET_CONVERSATION_INFO_LIST_V2 = 610
GET_CONVERSATION_INFO_LIST_BY_FAVORITE_V2 = 611
GET_CONVERSATION_INFO_LIST_BY_TOP_V2 = 612
DISSOLVE_CONVERSATION = 614
GET_CONVERSATIONS_CHECKINFO = 615
CONVERSATION_PARTICIPANTS_LIST = 605
ADD_CONVERSATION_PARTICIPANTS = 650
REMOVE_CONVERSATION_PARTICIPANTS = 651
LEAVE_CONVERSATION = 652
UPDATE_CONVERSATION_PARTICIPANT = 655
DELETE_MESSAGE = 701
RECALL_MESSAGE = 702
SET_MESSAGE_PROPERTY = 705
GET_CONVERSATION_CORE_INFO = 901
SET_CONVERSATION_CORE_INFO = 902
GET_STRANGER_CONVERSATION_LIST = 1001
GET_STRANGER_MESSAGES_IN_CONVERSATION = 1002
GET_MEDIA_UPLOAD_TOKEN = 2003
GET_MEDIA_URLS = 2004
GET_TICKET = 2005
```

### Protobuf Message Types (key fields from chunk source)
```
SendMessageRequestBody: conversation_id, conversation_type, conversation_short_id, content, ext, message_type, ticket, client_message_id, mentioned_users, ref_msg_info
SendMessageResponseBody: server_message_id, extra_info, status, client_message_id, check_code, check_message
GetConversationInfoListV2RequestBody: conversation_info_list[]
ConversationInfo: conversation_id, conversation_short_id, conversation_type, ticket, first_page_participants, participants_count, is_participant, inbox_type, user_info, conversation_core_info, conversation_setting_info
GetStrangerConversationListResponseBody: next_cursor, has_more, conversation_list[]
CreateConversationV2RequestBody: participants[], biz_ext{}
```

### Conversation Type Enum
```
ONE_TO_ONE_CHAT = 1
GROUP_CHAT = 2
LIVE_CHAT = 3
BROADCAST_CHAT = 4
```

### Message Type Enum (modern)
```
MESSAGE_TYPE_TEXT = 10001
MESSAGE_TYPE_STICKER = 10002
MESSAGE_TYPE_IMAGE = 10003
MESSAGE_TYPE_VIDEO = 10004
MESSAGE_TYPE_FILE = 10005
MESSAGE_TYPE_AUDIO = 10006
MESSAGE_TYPE_LOCATION = 10007
MESSAGE_TYPE_SYSTEM = 10008
MESSAGE_TYPE_LINK = 10009
```

### Implementation Files
- `src/utils/dm.proto` — protobuf schema for Frame, Request, Response, InitBody, Subscription
- `src/utils/dm-client.ts` — DMWebSocketClient class with connect, sendMessage, getConversations, getMessages
- `syncsdk_chunk_64887.js` — 801 KB full SyncSdk source (for reference)
- `ws_capture.json` — captured WebSocket frames
- `chunk_manifest.json` — TikTok webapp chunk manifest (65067 bytes)

### Connection Test Result (VERIFIED)
- Access key formula CONFIRMED: `md5("32e252eea4204adef812c32f35a4b80f4b{device_id}f8a69f1719916z")`
- Server accepted init message, returned capability payload (1680 bytes gzip-compressed)
- Two sequential server responses received (identical structure to captured traffic)

## TODO
- DM getConversations, getMessages, sendMessage body construction — needs WebSocket protocol implementation (REST combo only returns cursors)
- Publish `frontierSign` VM module as standalone npm package (e.g. `tiktok-acrawler`)
- Clean up ~50+ temp exploration files
- Handle CDP proxy tab refresh if tab crashes/stalls
- Verify collect/uncollect follow the same ticket guard pattern as like (they're also `/api/commit/` endpoints)
- Verify `getNotificationCount()` needs different path (returns "url doesn't match")

## VM Files (not in dist/, loaded at runtime)
- `frontierSign/index.js` — Bootstraps webmssdk VM, exports `frontierSign(queryString)` and `getReferer()`
- `extracted_vm.json` — 0.8 MB serialized VM state (bytecodes, handlers, constants)
- `standalone_vm2.js` — Full annotated reference reconstruction
- These are loaded via `require('../../frontierSign')` from `dist/utils/device.js`
