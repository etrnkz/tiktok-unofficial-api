use crate::proto::*;
use crate::types::*;
use prost::Message;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, CONTENT_LENGTH, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use uuid::Uuid;

const DOMAIN: &str = "im-api-sg.tiktok.com";

pub struct DmRestClient {
    client: reqwest::Client,
    device_id: String,
    uid: String,
    cookies: HashMap<String, String>,
    logid_counter: Arc<AtomicU64>,
}

impl DmRestClient {
    pub fn new(device_id: String, uid: String, cookies: HashMap<String, String>) -> Self {
        Self {
            client: reqwest::Client::builder()
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
            device_id,
            uid,
            cookies,
            logid_counter: Arc::new(AtomicU64::new(10001)),
        }
    }

    fn next_logid(&self) -> u64 {
        self.logid_counter.fetch_add(1, Ordering::SeqCst)
    }

    fn cookie_header(&self) -> String {
        self.cookies
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn build_headers(&self, body_len: usize) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/x-protobuf"));
        headers.insert(ACCEPT, HeaderValue::from_static("application/x-protobuf"));
        headers.insert(CONTENT_LENGTH, HeaderValue::from(body_len));
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"),
        );
        headers.insert(ORIGIN, HeaderValue::from_static("https://www.tiktok.com"));
        headers.insert(REFERER, HeaderValue::from_static("https://www.tiktok.com/messages"));
        if let Ok(val) = HeaderValue::from_str(&self.cookie_header()) {
            headers.insert(COOKIE, val);
        }
        headers
    }

    pub async fn get_conversations(&self) -> Result<Vec<DmConversation>, Box<dyn std::error::Error + Send + Sync>> {
        let metadata = vec![0xda, 0x0c, 0x02, 0x08, 0x00];
        let params = vec![
            DmKeyValue { key: "aid".to_string(), value: "1988".to_string() },
            DmKeyValue { key: "app_name".to_string(), value: "tiktok_web".to_string() },
            DmKeyValue { key: "channel".to_string(), value: "web".to_string() },
            DmKeyValue { key: "device_platform".to_string(), value: "web_pc".to_string() },
            DmKeyValue { key: "device_id".to_string(), value: self.device_id.clone() },
            DmKeyValue { key: "user_is_login".to_string(), value: "true".to_string() },
        ];

        let msg = DmRestRequest {
            seqid: 203,
            logid: self.next_logid(),
            version: "1.7.0".to_string(),
            empty: "".to_string(),
            req_type: 3,
            unknown6: 0,
            call_trace: "3035f17:feat/call-trace-plugin".to_string(),
            metadata,
            device_id: self.device_id.clone(),
            device_platform: "web".to_string(),
            params,
            field18: 1,
            extra_params: Vec::new(),
        };

        let mut body = Vec::new();
        msg.encode(&mut body)?;

        let url = format!("https://{}/v2/message/get_by_user_init", DOMAIN);
        let resp = self
            .client
            .post(&url)
            .headers(self.build_headers(body.len()))
            .body(body)
            .send()
            .await?;

        let bytes = resp.bytes().await?;
        let res = DmRestResponse::decode(bytes)?;

        if res.status_code != 0 || res.payload.is_empty() {
            return Ok(Vec::new());
        }

        let wrapper = InitPayloadWrapper::decode(res.payload.as_slice())?;
        let init_body = match wrapper.init_body {
            Some(ib) => ib,
            None => return Ok(Vec::new()),
        };

        let mut conversations = Vec::new();
        for c in init_body.conversations {
            let last_msg = init_body
                .messages
                .iter()
                .filter(|m| m.conversation_id == c.conversation_id)
                .last()
                .map(|m| {
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&m.content) {
                        parsed.get("text").and_then(|t| t.as_str()).unwrap_or(&m.content).to_string()
                    } else {
                        m.content.clone()
                    }
                })
                .unwrap_or_default();

            let name = c
                .conversation_core_info
                .as_ref()
                .map(|core| core.name.clone())
                .unwrap_or_default();

            let updated_at = c
                .conversation_core_info
                .as_ref()
                .map(|core| core.info_version)
                .unwrap_or(0);

            conversations.push(DmConversation {
                conversation_id: c.conversation_id,
                conversation_short_id: c.conversation_short_id.to_string(),
                conversation_type: c.conversation_type,
                participants_count: c.participants_count,
                name,
                last_message: last_msg,
                updated_at,
            });
        }

        Ok(conversations)
    }

    pub async fn get_messages(
        &self,
        conversation_id: &str,
        conversation_short_id: Option<&str>,
        limit: i32,
        anchor_index: i64,
    ) -> Result<DmMessageListResponse, Box<dyn std::error::Error + Send + Sync>> {
        let short_id_num: i64 = match conversation_short_id {
            Some(s) => s.parse().unwrap_or(0),
            None => {
                let convs = self.get_conversations().await?;
                convs
                    .iter()
                    .find(|c| c.conversation_id == conversation_id)
                    .and_then(|c| c.conversation_short_id.parse().ok())
                    .unwrap_or(0)
            }
        };

        let body_msg = MessagesInConversationRequestBody {
            conversation_id: conversation_id.to_string(),
            conversation_type: 1,
            conversation_short_id: short_id_num,
            direction: 1,
            anchor_index,
            limit,
        };

        let req_msg = Request {
            cmd: 301,
            sequence_id: chrono::Utc::now().timestamp_millis(),
            sdk_version: "1.7.0".to_string(),
            token: "".to_string(),
            refer: 3,
            inbox_type: 0,
            build_number: "".to_string(),
            body: Some(RequestBody {
                send_message_body: None,
                messages_in_conversation_body: Some(body_msg),
            }),
            device_id: self.device_id.clone(),
            channel: "".to_string(),
            device_platform: "web_pc".to_string(),
        };

        let mut req_buf = Vec::new();
        req_msg.encode(&mut req_buf)?;

        let url = format!("https://{}/v1/message/get_by_conversation", DOMAIN);
        let resp = self
            .client
            .post(&url)
            .headers(self.build_headers(req_buf.len()))
            .body(req_buf)
            .send()
            .await?;

        let bytes = resp.bytes().await?;
        let decoded = Response::decode(bytes)?;

        let mut messages = Vec::new();
        let mut next_cursor = "0".to_string();
        let mut has_more = false;

        if let Some(body) = decoded.body {
            if let Some(msg_body) = body.messages_in_conversation_body {
                next_cursor = msg_body.next_cursor.to_string();
                has_more = msg_body.has_more;

                for m in msg_body.messages {
                    let text = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&m.content) {
                        parsed.get("text").and_then(|t| t.as_str()).unwrap_or(&m.content).to_string()
                    } else {
                        m.content.clone()
                    };

                    messages.push(DmMessage {
                        id: m.server_message_id.to_string(),
                        conversation_id: m.conversation_id,
                        conversation_short_id: m.conversation_short_id.to_string(),
                        conversation_type: m.conversation_type,
                        sender_id: m.sender.to_string(),
                        sec_sender: m.sec_sender,
                        text,
                        raw_content: m.content,
                        create_time: m.create_time,
                    });
                }
            }
        }

        Ok(DmMessageListResponse {
            messages,
            next_cursor,
            has_more,
        })
    }

    pub async fn send_message(
        &self,
        conversation_id: &str,
        text: &str,
        conversation_short_id: Option<&str>,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let short_id_num: i64 = match conversation_short_id {
            Some(s) => s.parse().unwrap_or(0),
            None => {
                let convs = self.get_conversations().await?;
                convs
                    .iter()
                    .find(|c| c.conversation_id == conversation_id)
                    .and_then(|c| c.conversation_short_id.parse().ok())
                    .unwrap_or(0)
            }
        };

        let client_msg_id = Uuid::new_v4().to_string();
        let content = serde_json::json!({
            "aweType": 700,
            "text": text
        }).to_string();

        let send_body = SendMessageRequestBody {
            conversation_id: conversation_id.to_string(),
            conversation_type: 1,
            conversation_short_id: short_id_num,
            content,
            ext: vec![
                DmKeyValue { key: "s:client_message_id".to_string(), value: client_msg_id.clone() },
                DmKeyValue { key: "a:entrance_type".to_string(), value: "1".to_string() },
                DmKeyValue { key: "s:mode".to_string(), value: "0".to_string() },
            ],
            message_type: 7, // 7 = text
            ticket: "".to_string(),
            client_message_id: client_msg_id,
            mentioned_users: Vec::new(),
        };

        let req_msg = Request {
            cmd: 100,
            sequence_id: chrono::Utc::now().timestamp_millis(),
            sdk_version: "1.7.0".to_string(),
            token: "".to_string(),
            refer: 3,
            inbox_type: 0,
            build_number: "".to_string(),
            body: Some(RequestBody {
                send_message_body: Some(send_body),
                messages_in_conversation_body: None,
            }),
            device_id: self.device_id.clone(),
            channel: "".to_string(),
            device_platform: "web_pc".to_string(),
        };

        let mut req_buf = Vec::new();
        req_msg.encode(&mut req_buf)?;

        let url = format!("https://{}/v1/message/send", DOMAIN);
        let resp = self
            .client
            .post(&url)
            .headers(self.build_headers(req_buf.len()))
            .body(req_buf)
            .send()
            .await?;

        let bytes = resp.bytes().await?;
        let decoded = Response::decode(bytes)?;

        if decoded.status_code == 0 || decoded.error_desc == "OK" {
            if let Some(body) = decoded.body {
                if let Some(send_resp) = body.send_message_body {
                    return Ok(send_resp.server_message_id.to_string());
                }
            }
            return Ok("".to_string());
        }

        Err(format!("TikTok send message failed: {}", decoded.error_desc).into())
    }
}
