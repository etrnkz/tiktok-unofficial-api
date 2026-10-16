# tiktok-unofficial-api

Unofficial, reverse-engineered TikTok Web & IM API client available for both **Node.js (TypeScript)** and **pure Rust**.

Replicates full browser & ByteSync protocol behavior including:
- **Direct Messaging (DM)** via Protobuf-over-HTTPS (`im-api-sg.tiktok.com`) & real-time message streaming
- **Video & Photo Post Creation** with `#hashtags` and `@mentions` via TikTok Studio
- **Engagement Actions** (Like, Follow, Comment, Reply, Collect/Bookmark, Repost)
- **Video View & Play Telemetry** reporting
- **Clean No-Watermark Video Downloading**
- **Captcha-Free QR Code & Code Authentication**

---

## Packages Available

1. **Node.js / TypeScript**: `npm install tiktok-unofficial-api` (Root package)
2. **Pure Rust Crate**: `cargo add tiktok-api` (Located in `rust/`)

---

## 1. Node.js / TypeScript Usage

### Installation

```bash
npm install tiktok-unofficial-api
```

### Quick Start

```typescript
import { TikTokClient } from 'tiktok-unofficial-api';
import * as fs from 'fs';

// Initialize with cookies from session.json or manual configuration
const session = JSON.parse(fs.readFileSync('./session.json', 'utf-8'));
const client = new TikTokClient({
  cookieJar: session.cookies || session,
  deviceId: '7647502364471903776',
});
```

---

### Direct Messaging (DM)

All DM endpoints run directly in Node.js via Protobuf-over-HTTPS without requiring headless browsers:

```typescript
// 1. Get active conversations
const convs = await client.getConversations();
console.log(`Found ${convs.conversations.length} conversations:`);
for (const c of convs.conversations) {
  console.log(`- [${c.id}] ${c.name} (Last message: "${c.lastMessage?.content}")`);
}

// 2. Fetch message history for a conversation
const history = await client.getMessages('0:1:7196423999920227333:7647100016888120340');
for (const msg of history.messages) {
  console.log(`- [${msg.senderId}]: ${msg.content}`);
}

// 3. Send a text message
const sendRes = await client.sendMessage(
  '0:1:7196423999920227333:7647100016888120340',
  'Hello from unofficial API!'
);
console.log('Delivered! Message ID:', sendRes.messageId);

// 4. Real-time message streaming listener
client.onMessage((msg) => {
  console.log(`Incoming DM in ${msg.conversationId} from ${msg.senderId}: ${msg.text}`);
});
await client.startMessageListener(3000); // Polls every 3 seconds
```

---

### Video & Photo Posting (with Hashtags & Mentions)

```typescript
// Upload and post a video with hashtags and user mentions
const uploadRes = await client.uploadVideo('./dance.mp4', {
  title: 'Incredible choreography!',
  // Add hashtags (with or without #)
  hashtags: ['dance', 'fyp', 'viral'],
  // Add mentions (with or without @, or with user IDs)
  mentions: [
    'tiktok',
    '@charlidamelio',
    { username: 'bellapoarch', userId: '123456789' }
  ],
  privacyLevel: 0, // 0 = Public, 1 = Friends, 2 = Private
  allowComment: true,
  allowDuet: true,
  allowStitch: true,
});

// Or type hashtags and mentions directly in the caption:
await client.uploadVideo('./clip.mp4', {
  desc: 'Huge thanks to @tiktok for the love! #fyp #creator',
});

// Upload a photo carousel post
await client.uploadImage('./photo.jpg', {
  desc: 'Photo dump 📸 #photography with @friend',
});
```

---

### Actions (Like, Follow, Comment, Bookmark)

```typescript
// Like and unlike videos
await client.like('7196423999920227333');
await client.unlike('7196423999920227333');

// Follow and unfollow users (by secUid or username)
await client.follow('MS4wLjABAAAAlewSEnlKhhcQjaLoNAiu0LNh7qHI-_vOvQEPTLgGJrmp2qev8ghRxFB5L7TqKCFG');
await client.unfollow('MS4wLjABAAAAlewSEnlKhhcQjaLoNAiu0LNh7qHI-_vOvQEPTLgGJrmp2qev8ghRxFB5L7TqKCFG');

// Comment and reply
const comment = await client.publishComment('7196423999920227333', 'Awesome video!');
await client.replyToComment('7196423999920227333', comment.commentId, 'Replying here!');

// Bookmark / Favorite
await client.collect('7196423999920227333');
await client.uncollect('7196423999920227333');

// Report Video View (play telemetry)
await client.reportView('7196423999920227333', 10); // 10 seconds watch time
```

---

### Video Downloading (Watermarked & No-Watermark)

```typescript
// Download clean video without watermark
const noWm = await client.downloadVideoNoWatermark('7196423999920227333');
console.log('Clean stream URL:', noWm.url);

// Get direct buffer of no-watermark video
const { buffer } = await client.downloadVideoNoWatermarkBuffer('7196423999920227333');
fs.writeFileSync('clean_video.mp4', buffer);
```

---

### Authentication & Login Flows

#### Captcha-Free QR Code Login (Recommended)
```typescript
// 1. Generate QR Code token & URL
const qr = await client.getLoginQrCode();
console.log('Scan URL:', qr.qrCodeUrl); // or display qr.qrCodeDataUrl (base64 image)

// 2. Poll status until user confirms on mobile app
const poll = setInterval(async () => {
  const check = await client.checkLoginQrCode(qr.token);
  console.log('Status:', check.status); // 'waiting' | 'scanned' | 'confirmed'
  if (check.status === 'confirmed') {
    clearInterval(poll);
    console.log('Logged in successfully! Session ID:', check.sessionId);
  }
}, 2000);
```

#### Email / SMS Verification Code Login & Signup
```typescript
// Send verification code
await client.sendVerificationCode('user@example.com', 'email');

// Login with verification code
const loginRes = await client.loginWithCode('user@example.com', '123456', 'email');

// Register / Sign up new account
const signupRes = await client.signupWithCode('newuser@example.com', '123456', 'MyPassword123!');
```

---

## 2. Pure Rust Crate (`rust/`)

The pure Rust implementation lives in the `rust/` directory.

### Cargo.toml

```toml
[dependencies]
tiktok-api = { path = "./rust" }
tokio = { version = "1", features = ["full"] }
```

### Rust Quickstart

```rust
use tiktok_api::{TikTokClient, TikTokConfig};
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    // Initialize from session.json
    let client = TikTokClient::from_session_file("./session.json")?;

    // 1. Fetch Conversations
    let convs = client.get_conversations().await?;
    println!("Found {} conversations", convs.len());
    for c in &convs {
        println!("- [{}] Last message: {}", c.conversation_id, c.last_message);
    }

    // 2. Send a Direct Message
    if let Some(target) = convs.first() {
        let msg_id = client.send_message(
            &target.conversation_id,
            "Hello from pure Rust!",
            Some(&target.conversation_short_id),
        ).await?;
        println!("Message sent! ID: {}", msg_id);

        // 3. Fetch Message History
        let history = client.get_messages(&target.conversation_id, None, 10, 0).await?;
        for m in history.messages {
            println!("- [{}]: {}", m.sender_id, m.text);
        }
    }

    // 4. Download Video Without Watermark
    let dl = client.download_video_no_watermark("7196423999920227333").await?;
    println!("Clean stream URL: {}", dl.url);

    // 5. Report View Telemetry
    client.report_view("7196423999920227333", 10).await?;

    Ok(())
}
```

---

## License

MIT
