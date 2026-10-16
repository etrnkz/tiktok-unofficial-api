use crate::dm::DmRestClient;
use crate::types::*;
use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

const BASE_URL: &str = "https://www.tiktok.com";

#[derive(Debug, Clone)]
pub struct TikTokConfig {
    pub device_id: String,
    pub uid: String,
    pub cookies: HashMap<String, String>,
}

impl Default for TikTokConfig {
    fn default() -> Self {
        Self {
            device_id: "7647502364471903776".to_string(),
            uid: "".to_string(),
            cookies: HashMap::new(),
        }
    }
}

pub struct TikTokClient {
    config: TikTokConfig,
    http: reqwest::Client,
    dm: DmRestClient,
}

impl TikTokClient {
    pub fn new(config: TikTokConfig) -> Self {
        let http = reqwest::Client::builder()
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());

        let dm = DmRestClient::new(
            config.device_id.clone(),
            config.uid.clone(),
            config.cookies.clone(),
        );

        Self { config, http, dm }
    }

    /// Load client configuration directly from a session.json file (Node.js format)
    pub fn from_session_file<P: AsRef<Path>>(path: P) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let content = fs::read_to_string(path)?;
        let val: serde_json::Value = serde_json::from_str(&content)?;

        let mut cookies = HashMap::new();
        if let Some(c_obj) = val.get("cookies").and_then(|c| c.as_object()) {
            for (k, v) in c_obj {
                if let Some(s) = v.as_str() {
                    cookies.insert(k.clone(), s.to_string());
                }
            }
        } else if let Some(c_obj) = val.as_object() {
            for (k, v) in c_obj {
                if let Some(s) = v.as_str() {
                    cookies.insert(k.clone(), s.to_string());
                }
            }
        }

        let config = TikTokConfig {
            device_id: "7647502364471903776".to_string(),
            uid: cookies.get("uid").cloned().unwrap_or_default(),
            cookies,
        };

        Ok(Self::new(config))
    }

    fn cookie_header(&self) -> String {
        self.config
            .cookies
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn default_headers(&self) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"),
        );
        headers.insert(REFERER, HeaderValue::from_static("https://www.tiktok.com/"));
        if let Ok(c) = HeaderValue::from_str(&self.cookie_header()) {
            headers.insert(COOKIE, c);
        }
        headers
    }

    // ─── Direct Messaging ──────────────────────────────────────

    pub async fn get_conversations(&self) -> Result<Vec<DmConversation>, Box<dyn std::error::Error + Send + Sync>> {
        self.dm.get_conversations().await
    }

    pub async fn get_messages(
        &self,
        conversation_id: &str,
        conversation_short_id: Option<&str>,
        limit: i32,
        cursor: i64,
    ) -> Result<DmMessageListResponse, Box<dyn std::error::Error + Send + Sync>> {
        self.dm.get_messages(conversation_id, conversation_short_id, limit, cursor).await
    }

    pub async fn send_message(
        &self,
        conversation_id: &str,
        text: &str,
        conversation_short_id: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        self.dm.send_message(conversation_id, text, conversation_short_id).await
    }

    // ─── Video Views & Telemetry ───────────────────────────────

    pub async fn report_view(
        &self,
        video_id: &str,
        watch_time_seconds: u32,
    ) -> Result<TikTokActionResponse, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/api/item/view/", BASE_URL);
        let params = [
            ("item_id", video_id),
            ("play_delta", &format!("{}", watch_time_seconds * 1000)),
            ("action_time", &format!("{}", chrono::Utc::now().timestamp_millis())),
            ("signal", "1"),
        ];

        let resp = self
            .http
            .post(&url)
            .headers(self.default_headers())
            .form(&params)
            .send()
            .await?;

        let val: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
        let status_code = val.get("status_code").and_then(|s| s.as_i64()).unwrap_or(0) as i32;
        let status_msg = val.get("status_msg").and_then(|s| s.as_str()).unwrap_or("ok").to_string();

        Ok(TikTokActionResponse {
            success: status_code == 0,
            status_code,
            status_msg,
        })
    }

    // ─── Video Downloading ────────────────────────────────────

    pub async fn download_video_no_watermark(
        &self,
        video_id: &str,
    ) -> Result<DownloadResult, Box<dyn std::error::Error + Send + Sync>> {
        // Query clean CDN stream via TikWM API proxy
        let url = format!("https://www.tikwm.com/api/?url=https://www.tiktok.com/@tiktok/video/{}", video_id);
        let resp = self.http.get(&url).send().await?;
        let json: serde_json::Value = resp.json().await?;

        if let Some(play_url) = json.get("data").and_then(|d| d.get("play")).and_then(|p| p.as_str()) {
            return Ok(DownloadResult {
                url: play_url.to_string(),
                video_id: video_id.to_string(),
                is_no_watermark: true,
            });
        }

        Err(format!("Could not extract clean video URL for {}", video_id).into())
    }

    pub async fn download_video_bytes(
        &self,
        video_id: &str,
    ) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
        let dl = self.download_video_no_watermark(video_id).await?;
        let resp = self.http.get(&dl.url).send().await?;
        let bytes = resp.bytes().await?;
        Ok(bytes.to_vec())
    }

    // ─── QR Code Login ─────────────────────────────────────────

    pub async fn get_login_qr_code(&self) -> Result<TikTokQrCodeResult, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/passport/web/qr/get_code/?aid=1988&service=https://www.tiktok.com", BASE_URL);
        let resp = self.http.get(&url).headers(self.default_headers()).send().await?;
        let json: serde_json::Value = resp.json().await?;
        let data = json.get("data").cloned().unwrap_or(serde_json::json!({}));

        Ok(TikTokQrCodeResult {
            token: data.get("token").and_then(|t| t.as_str()).unwrap_or("").to_string(),
            qr_code_url: data.get("qrcode_index_url").or_else(|| data.get("scan_url")).and_then(|u| u.as_str()).unwrap_or("").to_string(),
            qr_code_data_url: data.get("qrcode").and_then(|q| q.as_str()).unwrap_or("").to_string(),
            expire_time: data.get("expire_time").and_then(|e| e.as_u64()),
        })
    }

    pub async fn check_login_qr_code(
        &mut self,
        token: &str,
    ) -> Result<TikTokQrCodeStatusResult, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}/passport/web/qr/check_status/?token={}&aid=1988&service=https://www.tiktok.com", BASE_URL, token);
        let resp = self.http.get(&url).headers(self.default_headers()).send().await?;
        let json: serde_json::Value = resp.json().await?;
        let data = json.get("data").cloned().unwrap_or(serde_json::json!({}));

        let raw_status = data.get("status").and_then(|s| s.as_str()).unwrap_or("waiting").to_lowercase();
        let session_id = data.get("session_key").or_else(|| data.get("sessionid")).and_then(|s| s.as_str()).map(String::from);

        if raw_status == "confirmed" || raw_status == "success" {
            if let Some(ref sid) = session_id {
                self.config.cookies.insert("sessionid".to_string(), sid.clone());
                self.config.cookies.insert("sessionid_ss".to_string(), sid.clone());
            }
        }

        Ok(TikTokQrCodeStatusResult {
            status: raw_status,
            session_id,
        })
    }
}
