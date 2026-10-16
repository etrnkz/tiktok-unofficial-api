// Generated and manually verified Prost protobuf definitions matching dm.proto

use prost::Message;

#[derive(Clone, PartialEq, Message)]
pub struct DmKeyValue {
    #[prost(string, tag = "1")]
    pub key: String,
    #[prost(string, tag = "2")]
    pub value: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct DmRestRequest {
    #[prost(uint64, tag = "1")]
    pub seqid: u64,
    #[prost(uint64, tag = "2")]
    pub logid: u64,
    #[prost(string, tag = "3")]
    pub version: String,
    #[prost(string, tag = "4")]
    pub empty: String,
    #[prost(uint32, tag = "5")]
    pub req_type: u32,
    #[prost(uint32, tag = "6")]
    pub unknown6: u32,
    #[prost(string, tag = "7")]
    pub call_trace: String,
    #[prost(bytes = "vec", tag = "8")]
    pub metadata: Vec<u8>,
    #[prost(string, tag = "9")]
    pub device_id: String,
    #[prost(string, tag = "11")]
    pub device_platform: String,
    #[prost(message, repeated, tag = "15")]
    pub params: Vec<DmKeyValue>,
    #[prost(uint32, tag = "18")]
    pub field18: u32,
    #[prost(message, repeated, tag = "21")]
    pub extra_params: Vec<DmKeyValue>,
}

#[derive(Clone, PartialEq, Message)]
pub struct DmRestResponse {
    #[prost(uint64, tag = "1")]
    pub seqid: u64,
    #[prost(uint64, tag = "2")]
    pub logid: u64,
    #[prost(uint32, tag = "3")]
    pub status_code: u32,
    #[prost(string, tag = "4")]
    pub status_str: String,
    #[prost(uint32, tag = "5")]
    pub unknown5: u32,
    #[prost(bytes = "vec", tag = "6")]
    pub payload: Vec<u8>,
    #[prost(string, tag = "7")]
    pub log_id_str: String,
    #[prost(uint64, tag = "10")]
    pub timestamp1: u64,
    #[prost(uint64, tag = "11")]
    pub timestamp2: u64,
    #[prost(string, tag = "14")]
    pub server_region: String,
    #[prost(uint64, tag = "15")]
    pub unknown15: u64,
}

#[derive(Clone, PartialEq, Message)]
pub struct InitPayloadWrapper {
    #[prost(message, optional, tag = "203")]
    pub init_body: Option<GetMessagesByUserInitBody>,
}

#[derive(Clone, PartialEq, Message)]
pub struct GetMessagesByUserInitBody {
    #[prost(message, repeated, tag = "1")]
    pub messages: Vec<MessageBody>,
    #[prost(message, repeated, tag = "2")]
    pub conversations: Vec<ConversationInfoV2>,
    #[prost(int64, tag = "3")]
    pub cursor: i64,
    #[prost(int32, tag = "4")]
    pub has_more: i32,
}

#[derive(Clone, PartialEq, Message)]
pub struct Request {
    #[prost(int32, tag = "1")]
    pub cmd: i32,
    #[prost(int64, tag = "2")]
    pub sequence_id: i64,
    #[prost(string, tag = "3")]
    pub sdk_version: String,
    #[prost(string, tag = "4")]
    pub token: String,
    #[prost(int32, tag = "5")]
    pub refer: i32,
    #[prost(int32, tag = "6")]
    pub inbox_type: i32,
    #[prost(string, tag = "7")]
    pub build_number: String,
    #[prost(message, optional, tag = "8")]
    pub body: Option<RequestBody>,
    #[prost(string, tag = "9")]
    pub device_id: String,
    #[prost(string, tag = "10")]
    pub channel: String,
    #[prost(string, tag = "11")]
    pub device_platform: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct RequestBody {
    #[prost(message, optional, tag = "100")]
    pub send_message_body: Option<SendMessageRequestBody>,
    #[prost(message, optional, tag = "301")]
    pub messages_in_conversation_body: Option<MessagesInConversationRequestBody>,
}

#[derive(Clone, PartialEq, Message)]
pub struct Response {
    #[prost(int32, tag = "1")]
    pub cmd: i32,
    #[prost(int64, tag = "2")]
    pub sequence_id: i64,
    #[prost(int32, tag = "3")]
    pub status_code: i32,
    #[prost(string, tag = "4")]
    pub error_desc: String,
    #[prost(int32, tag = "5")]
    pub inbox_type: i32,
    #[prost(message, optional, tag = "6")]
    pub body: Option<ResponseBody>,
    #[prost(string, tag = "7")]
    pub log_id: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ResponseBody {
    #[prost(message, optional, tag = "100")]
    pub send_message_body: Option<SendMessageResponseBody>,
    #[prost(message, optional, tag = "301")]
    pub messages_in_conversation_body: Option<MessagesInConversationResponseBody>,
}

#[derive(Clone, PartialEq, Message)]
pub struct SendMessageRequestBody {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int32, tag = "2")]
    pub conversation_type: i32,
    #[prost(int64, tag = "3")]
    pub conversation_short_id: i64,
    #[prost(string, tag = "4")]
    pub content: String,
    #[prost(message, repeated, tag = "5")]
    pub ext: Vec<DmKeyValue>,
    #[prost(int32, tag = "6")]
    pub message_type: i32,
    #[prost(string, tag = "7")]
    pub ticket: String,
    #[prost(string, tag = "8")]
    pub client_message_id: String,
    #[prost(int64, repeated, tag = "9")]
    pub mentioned_users: Vec<i64>,
}

#[derive(Clone, PartialEq, Message)]
pub struct SendMessageResponseBody {
    #[prost(int64, tag = "1")]
    pub server_message_id: i64,
    #[prost(string, tag = "2")]
    pub extra_info: String,
    #[prost(int32, tag = "3")]
    pub status: i32,
    #[prost(string, tag = "4")]
    pub client_message_id: String,
    #[prost(int64, tag = "5")]
    pub check_code: i64,
    #[prost(string, tag = "6")]
    pub check_message: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct MessagesInConversationRequestBody {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int32, tag = "2")]
    pub conversation_type: i32,
    #[prost(int64, tag = "3")]
    pub conversation_short_id: i64,
    #[prost(int32, tag = "4")]
    pub direction: i32,
    #[prost(int64, tag = "5")]
    pub anchor_index: i64,
    #[prost(int32, tag = "6")]
    pub limit: i32,
}

#[derive(Clone, PartialEq, Message)]
pub struct MessagesInConversationResponseBody {
    #[prost(message, repeated, tag = "1")]
    pub messages: Vec<MessageBody>,
    #[prost(int64, tag = "2")]
    pub next_cursor: i64,
    #[prost(bool, tag = "3")]
    pub has_more: bool,
}

#[derive(Clone, PartialEq, Message)]
pub struct MessageBody {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int32, tag = "2")]
    pub conversation_type: i32,
    #[prost(int64, tag = "3")]
    pub server_message_id: i64,
    #[prost(int64, tag = "4")]
    pub index_in_conversation: i64,
    #[prost(int64, tag = "5")]
    pub conversation_short_id: i64,
    #[prost(int32, tag = "6")]
    pub message_type: i32,
    #[prost(int64, tag = "7")]
    pub sender: i64,
    #[prost(string, tag = "8")]
    pub content: String,
    #[prost(int64, tag = "10")]
    pub create_time: i64,
    #[prost(int64, tag = "11")]
    pub version: i64,
    #[prost(int32, tag = "12")]
    pub status: i32,
    #[prost(int64, tag = "13")]
    pub order_in_conversation: i64,
    #[prost(string, tag = "14")]
    pub sec_sender: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ConversationInfoV2 {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int64, tag = "2")]
    pub conversation_short_id: i64,
    #[prost(int32, tag = "3")]
    pub conversation_type: i32,
    #[prost(string, tag = "4")]
    pub ticket: String,
    #[prost(int32, tag = "7")]
    pub participants_count: i32,
    #[prost(bool, tag = "8")]
    pub is_participant: bool,
    #[prost(int32, tag = "9")]
    pub inbox_type: i32,
    #[prost(message, optional, tag = "50")]
    pub conversation_core_info: Option<ConversationCoreInfo>,
    #[prost(message, optional, tag = "51")]
    pub conversation_setting_info: Option<ConversationSettingInfo>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ConversationCoreInfo {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int64, tag = "2")]
    pub conversation_short_id: i64,
    #[prost(int32, tag = "3")]
    pub conversation_type: i32,
    #[prost(int64, tag = "4")]
    pub info_version: i64,
    #[prost(string, tag = "5")]
    pub name: String,
    #[prost(string, tag = "6")]
    pub desc: String,
    #[prost(string, tag = "7")]
    pub icon: String,
    #[prost(int32, tag = "8")]
    pub inbox_type: i32,
    #[prost(string, tag = "9")]
    pub notice: String,
    #[prost(int64, tag = "12")]
    pub owner: i64,
    #[prost(string, tag = "13")]
    pub sec_owner: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct ConversationSettingInfo {
    #[prost(string, tag = "1")]
    pub conversation_id: String,
    #[prost(int64, tag = "2")]
    pub conversation_short_id: i64,
    #[prost(int32, tag = "3")]
    pub conversation_type: i32,
    #[prost(int64, tag = "4")]
    pub min_index: i64,
    #[prost(int64, tag = "5")]
    pub read_index: i64,
    #[prost(int32, tag = "6")]
    pub mute: i32,
}
