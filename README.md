# tiktok-unofficial-api

Reverse-engineered TikTok Web & Direct Messaging (IM) client. Full HTTP/Protobuf implementation — no browser required for messaging or feeds.

> Rust version available in [rust/](rust/).

## Features

- **Direct Messages**: Fetch conversations, message history, and send text DMs directly over Protobuf HTTPS.
- **Video & Photo Posts**: Upload videos or photos with `#hashtags` and `@mentions` with auto-calculated offsets.
- **Engagement**: Like, unlike, follow, unfollow, comment, reply, bookmark/collect, and repost.
- **Video Tools**: Download clean MP4 streams without watermarks and report watch views.
- **Authentication**: Captcha-free QR code login and email/SMS code verification.

---

## Install

```bash
npm install tiktok-unofficial-api
```

---

## Quick Start

```typescript
import { TikTokClient } from 'tiktok-unofficial-api';
import * as fs from 'fs';

// Initialize with saved session cookies
const session = JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
const client = new TikTokClient({
  cookieJar: session.cookies || session,
});

// 1. Direct Messaging
const { conversations } = await client.getConversations();
if (conversations.length > 0) {
  const convId = conversations[0].id;

  // Send a DM
  const res = await client.sendMessage(convId, 'Hey there!');
  console.log('Message sent:', res.messageId);

  // Read chat history
  const { messages } = await client.getMessages(convId);
  for (const m of messages) {
    console.log(`[${m.senderId}]: ${m.content}`);
  }
}

// 2. Post Video with Hashtags & Mentions
await client.uploadVideo('./clip.mp4', {
  desc: 'Collab with @charlidamelio #dance #fyp',
  hashtags: ['viral'],
  mentions: ['tiktok'],
});

// 3. Download Clean Video Without Watermark
const clean = await client.downloadVideoNoWatermark('7196423999920227333');
console.log('No-watermark stream:', clean.url);

// 4. Like & Follow
await client.like('7196423999920227333');
await client.follow('MS4wLjABAAAAlewSEnlKhhcQjaLoNAiu0LNh7qHI-_vOvQEPTLgGJrmp2qev8ghRxFB5L7TqKCFG');
```

---

## QR Code Login

```typescript
const { TikTokClient } = require('tiktok-unofficial-api');
const client = new TikTokClient();

// 1. Get QR code
const qr = await client.getLoginQrCode();
console.log('Scan URL:', qr.qrCodeUrl);

// 2. Poll until confirmed in mobile app
const poll = setInterval(async () => {
  const check = await client.checkLoginQrCode(qr.token);
  if (check.status === 'confirmed') {
    clearInterval(poll);
    console.log('Logged in! Session:', check.sessionId);
  }
}, 2000);
```

---

## License

MIT
