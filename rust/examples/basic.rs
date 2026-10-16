use std::error::Error;
use tiktok_api::{TikTokClient, TikTokConfig};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error + Send + Sync>> {
    println!("=== TikTok API Rust Client Example ===");

    // Try loading session from ../session.json or ./session.json
    let client = if std::path::Path::new("session.json").exists() {
        TikTokClient::from_session_file("session.json")?
    } else if std::path::Path::new("../session.json").exists() {
        TikTokClient::from_session_file("../session.json")?
    } else {
        println!("No session.json found, running in unauthenticated mode.");
        TikTokClient::new(TikTokConfig::default())
    };

    // 1. Fetch conversations
    println!("\n1. Fetching conversations...");
    match client.get_conversations().await {
        Ok(convs) => {
            println!("Found {} conversation(s):", convs.len());
            for c in &convs {
                println!("- [{}] Last message: {}", c.conversation_id, c.last_message);
            }
        }
        Err(e) => println!("Error fetching conversations: {}", e),
    }

    // 2. Resolve clean no-watermark download
    let test_video_id = "7196423999920227333";
    println!("\n2. Resolving clean video URL for {}...", test_video_id);
    match client.download_video_no_watermark(test_video_id).await {
        Ok(dl) => println!("Clean Stream URL: {}", dl.url),
        Err(e) => println!("Download resolve error: {}", e),
    }

    // 3. Report watch view telemetry
    println!("\n3. Reporting watch view telemetry...");
    match client.report_view(test_video_id, 10).await {
        Ok(res) => println!("View report result: {:?}", res),
        Err(e) => println!("View report error: {}", e),
    }

    Ok(())
}
