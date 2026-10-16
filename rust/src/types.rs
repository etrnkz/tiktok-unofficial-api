use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokUser {
    pub id: String,
    pub unique_id: String,
    pub nickname: String,
    pub avatar_thumb: String,
    pub sec_uid: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokVideo {
    pub id: String,
    pub height: u32,
    pub width: u32,
    pub duration: u32,
    pub play_addr: String,
    pub download_addr: String,
    pub cover: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokVideoItem {
    pub id: String,
    pub desc: String,
    pub create_time: u64,
    pub author: TikTokUser,
    pub video: TikTokVideo,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadResult {
    pub url: String,
    pub video_id: String,
    pub is_no_watermark: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokActionResponse {
    pub success: bool,
    pub status_code: i32,
    pub status_msg: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokQrCodeResult {
    pub token: String,
    pub qr_code_url: String,
    pub qr_code_data_url: String,
    pub expire_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TikTokQrCodeStatusResult {
    pub status: String, // "waiting", "scanned", "confirmed", "expired"
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmConversation {
    pub conversation_id: String,
    pub conversation_short_id: String,
    pub conversation_type: i32,
    pub participants_count: i32,
    pub name: String,
    pub last_message: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmMessage {
    pub id: String,
    pub conversation_id: String,
    pub conversation_short_id: String,
    pub conversation_type: i32,
    pub sender_id: String,
    pub sec_sender: String,
    pub text: String,
    pub raw_content: String,
    pub create_time: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DmMessageListResponse {
    pub messages: Vec<DmMessage>,
    pub next_cursor: String,
    pub has_more: bool,
}
