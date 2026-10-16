# tiktok-unofficial-api

Unofficial TikTok Web & Direct Messaging (IM) API client for **Node.js (TypeScript)** and **pure Rust**. Reverse-engineered from ByteDance's internal ByteSync protocol and Web endpoints.

## Features

- **Direct Messaging (DM)**: Fetch conversations, message history, and send text DMs via Protobuf-over-HTTPS (`im-api-sg.tiktok.com`).
- **Posting**: Upload and post videos and photo carousels with `#hashtags` and `@mentions`.
- **Actions**: Like, follow, comment, reply, bookmark/collect, and repost.
- **Video Tools**: Download clean videos without watermark and report play view telemetry.
- **Authentication**: Captcha-free QR code login and email/SMS code verification.
- **Dual Language**: First-class Node.js library with a complete pure Rust crate in `rust/`.

---

## Installation

```bash
npm install tiktok-unofficial-api
```

---

## Quick Start

```typescript
import { TikTokClient } from 'tiktok-unofficial-api';
import * as fs from 'fs';

// Load saved session or initialize fresh
const session = JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
const client = new TikTokClient({
  cookieJar: session.cookies || session,
});

// 1. Direct Messaging
const { conversations } = await client.getConversations();
console.log('Conversations:', conversations.length);

if (conversations.length > 0) {
  const convId = conversations[0].id;

  // Send a message
  const res = await client.sendMessage(convId, 'Hello from unofficial API!');
  console.log('Sent! Message ID:', res.messageId);

  // Fetch message history
  const { messages } = await client.getMessages(convId);
  for (const msg of messages) {
    console.log(`[${msg.senderId}]: ${msg.content}`);
  }
}

// 2. Post a Video with Hashtags & Mentions
await client.uploadVideo('./dance.mp4', {
  desc: 'Dancing with @charlidamelio! #dance #fyp',
  hashtags: ['viral'],
  mentions: ['tiktok'],
});

// 3. Download Clean Video Without Watermark
const clean = await client.downloadVideoNoWatermark('7196423999920227333');
console.log('No-watermark URL:', clean.url);

// 4. Like & Follow Actions
await client.like('7196423999920227333');
await client.follow('MS4wLjABAAAAlewSEnlKhhcQjaLoNAiu0LNh7qHI-_vOvQEPTLgGJrmp2qev8ghRxFB5L7TqKCFG');
```

---

## Captcha-Free QR Code Login

```typescript
const { TikTokClient } = require('tiktok-unofficial-api');
const client = new TikTokClient();

// 1. Request QR code token
const qr = await client.getLoginQrCode();
console.log('Scan URL:', qr.qrCodeUrl);

// 2. Poll until user confirms in the mobile app
const poll = setInterval(async () => {
  const check = await client.checkLoginQrCode(qr.token);
  console.log('Status:', check.status);

  if (check.status === 'confirmed') {
    clearInterval(poll);
    console.log('Logged in successfully! Session ID:', check.sessionId);
  }
}, 2000);
```

---

## Rust Version

A pure Rust implementation is available in the `rust/` directory:

```toml
[dependencies]
tiktok-api = { git = "https://github.com/etrnkz/tiktok-unofficial-api", subdirectory = "rust" }
tokio = { version = "1", features = ["full"] }
```

See [`rust/README.md`](rust/README.md) for full Rust documentation and examples.

---

## License

MIT
