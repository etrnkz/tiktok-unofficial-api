# tiktok-api-rs

Pure Rust unofficial client for TikTok Web & Direct Messaging (IM) API. Reverse-engineered from ByteDance's internal ByteSync protocol and Web endpoints.

> TypeScript version available [here](../).

## Features

- **Direct Messaging (DM)**:
  - Fetch active conversations with short IDs, participant counts, and last messages.
  - Pull paginated message history.
  - Send direct text messages via Protobuf-over-HTTPS (`im-api-sg.tiktok.com`).
- **Video Downloads**:
  - Resolve clean, no-watermark MP4 streams directly.
  - Download video bytes into memory.
- **Video View & Telemetry**:
  - Report video watch time and view metrics (`report_view`).
- **Authentication**:
  - Captcha-free QR code login workflow (`get_login_qr_code`, `check_login_qr_code`).
  - Seamless session loading from `session.json`.

---

## Installation

Add this to your `Cargo.toml`:

```toml
[dependencies]
tiktok-api = { git = "https://github.com/etrnkz/tiktok-api-rs" }
tokio = { version = "1", features = ["full"] }
```

---

## Quick Start

```rust
use tiktok_api::{TikTokClient, TikTokConfig};
use std::error::Error;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    // Initialize from session.json
    let client = TikTokClient::from_session_file("./session.json")?;

    // 1. Fetch Conversations
    let convs = client.get_conversations().await?;
    println!("Found {} conversation(s):", convs.len());
    for c in &convs {
        println!("- [{}] {}: Last message: {}", c.conversation_id, c.name, c.last_message);
    }

    // 2. Fetch Message History
    if let Some(target) = convs.first() {
        let history = client.get_messages(&target.conversation_id, None, 10, 0).await?;
        println!("\nFetched {} messages:", history.messages.len());
        for m in history.messages {
            println!("- [{}]: {}", m.sender_id, m.text);
        }

        // 3. Send a Direct Message
        let msg_id = client.send_message(
            &target.conversation_id,
            "Hello from pure Rust!",
            Some(&target.conversation_short_id),
        ).await?;
        println!("\nMessage delivered! Server ID: {}", msg_id);
    }

    // 4. Download Video Without Watermark
    let dl = client.download_video_no_watermark("7196423999920227333").await?;
    println!("\nClean video URL: {}", dl.url);

    // 5. Report Watch View Telemetry
    client.report_view("7196423999920227333", 10).await?;

    Ok(())
}
```

---

## QR Code Login Example

```rust
use tiktok_api::{TikTokClient, TikTokConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut client = TikTokClient::new(TikTokConfig::default());

    // 1. Get QR code token
    let qr = client.get_login_qr_code().await?;
    println!("Scan this QR code in your TikTok mobile app: {}", qr.qr_code_url);

    // 2. Poll until user scans and confirms
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
        let status = client.check_login_qr_code(&qr.token).await?;
        println!("Status: {}", status.status);

        if status.status == "confirmed" {
            println!("Logged in! Session ID: {:?}", status.session_id);
            break;
        }
    }

    Ok(())
}
```

---

## Architecture & ByteSync Protobuf

This library interfaces directly with TikTok's Direct Messaging gateway on `im-api-sg.tiktok.com`:
- **`POST /v2/message/get_by_user_init`** (Field 203) $\to$ Returns active conversations (`ConversationInfoV2`) and recent messages (`MessageBody`).
- **`POST /v1/message/get_by_conversation`** (`cmd = 301`) $\to$ Fetches conversation history.
- **`POST /v1/message/send`** (`cmd = 100`) $\to$ Transmits text messages directly with zero browser dependencies.

---

## License

MIT License. See [LICENSE](LICENSE) for details.
