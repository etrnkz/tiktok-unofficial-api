export interface AppContext {
  language: string
  region: string
  appId: number
  appType: string
  wid: string
  webIdCreatedTime: string
  odinId: string
  nonce: string
  botType: string
  requestId: string
  clusterRegion: string
  csrfToken: string
  encryptedWebid: string
  host: string
}

export interface TicketGuardKeys {
  tsSign: string
  privateKeyPem: string
  encryptTicket: string
}

export interface TikTokClientConfig {
  deviceId?: string
  odinId?: string
  region?: string
  language?: string
  proxy?: string
  msToken?: string
  xBogus?: string
  xGnarly?: string
  cookieJar?: Record<string, string>
  timeout?: number
  ticketGuardKeys?: TicketGuardKeys
  useTicketGuard?: boolean
}

export interface TikTokUser {
  id: string
  uniqueId: string
  nickname: string
  avatarLarger: string
  avatarMedium: string
  avatarThumb: string
  signature: string
  verified: boolean
  secUid: string
  secret: boolean
  ftc: boolean
  relation: number
  openFavorite: boolean
  bioLink?: { link: string; risk: number }
  isUnderAge18?: boolean
}

export interface TikTokVideo {
  id: string
  height: number
  width: number
  duration: number
  ratio: string
  cover: string
  originCover: string
  dynamicCover: string
  playAddr: string
  downloadAddr: string
  shareCover: string[]
  reflowCover: string
  bitrate: number
  encodedType: string
  format: string
  videoQuality: string
  definition: string
}

export interface TikTokMusic {
  id: string
  title: string
  author: string
  album: string
  coverLarge: string
  coverMedium: string
  coverThumb: string
  playUrl: string
  duration: number
  original: boolean
}

export interface TikTokStats {
  diggCount: number
  shareCount: number
  commentCount: number
  playCount: number
  collectCount: number
}

export interface TikTokHashtag {
  id: string
  name: string
  title: string
  cover: string
  coverMedium: string
  coverThumb: string
  stats: { videoCount: number; viewCount: number }
}

export interface TikTokVideoItem {
  id: string
  desc: string
  createTime: number
  scheduleTime: number
  video: TikTokVideo
  author: TikTokUser
  music: TikTokMusic
  challenges: TikTokHashtag[]
  stats: TikTokStats
  duetEnabled: boolean
  stitchEnabled: boolean
  shareEnabled: boolean
  isAd: boolean
  isTop: boolean
  diversificationLabels?: string[]
  suggestWords?: string[]
  contents?: { description: string }[]
}

export interface TikTokComment {
  id: string
  text: string
  diggCount: number
  replyCount: number
  createTime: number
  user: TikTokUser
  isPinned: boolean
  replies?: TikTokComment[]
}

export interface TikTokFeedResponse {
  items: TikTokVideoItem[]
  cursor: number
  hasMore: boolean
  preloadSize?: number
}

export interface TikTokUserProfile {
  user: TikTokUser
  stats: {
    followingCount: number
    followerCount: number
    heartCount: number
    videoCount: number
    diggCount: number
    favoriteCount: number
  }
  isUnderAge18?: boolean
}

export interface TikTokSearchResponse {
  items: TikTokVideoItem[]
  cursor: number
  hasMore: boolean
  extra?: {
    logId: string
    now: number
    fatalItemIds: string[]
    searchId: string
  }
}

export interface TikTokLiveStream {
  id: string
  title: string
  status: number
  streamUrl: string
  coverUrl: string
  user: TikTokUser
  stats: {
    viewerCount: number
    likeCount: number
  }
  roomId: string
}

export interface TikTokExploreResponse {
  items: TikTokVideoItem[]
  cursor: number
  hasMore: boolean
}

export interface TikTokLoginResult {
  success: boolean
  error?: string
  sessionId?: string
  csrfToken?: string
  user?: TikTokUser
}

export interface TikTokNotification {
  id: string
  type: number
  text: string
  createTime: number
  fromUser?: TikTokUser
  video?: TikTokVideoItem
  extra?: Record<string, any>
}

export interface TikTokUploadResult {
  success: boolean
  videoId?: string
  imageUri?: string
  error?: string
}

export interface TikTokUploadConfig {
  title?: string
  desc?: string
  scheduleTime?: number
  privacyLevel?: 0 | 1 | 2
  allowDuet?: boolean
  allowStitch?: boolean
  allowComment?: boolean
  hashtags?: string[]
  mentions?: Array<string | { username: string; userId?: string; secUid?: string }>
  musicId?: string
  duration?: number
}

export interface TikTokConversation {
  id: string
  type: number // 1 = private, 2 = group
  name: string
  avatar: string
  lastMessage: TikTokMessage | null
  unreadCount: number
  users: TikTokUser[]
  isMuted: boolean
  isVerified: boolean
  createTime: number
}

export interface TikTokMessage {
  id: string
  conversationId: string
  content: string
  type: number // 1 = text, 2 = image, 3 = system, etc.
  fromUser: TikTokUser | null
  createTime: number
  status: number
}

export interface TikTokConversationListResponse {
  conversations: TikTokConversation[]
  cursor: number
  hasMore: boolean
}

export interface TikTokMessageListResponse {
  messages: TikTokMessage[]
  cursor: number
  hasMore: boolean
}

export interface TikTokMessageResult {
  success: boolean
  messageId?: string
  conversationId?: string
  error?: string
}

export interface TikTokActionResponse {
  success: boolean
  statusCode?: number
  statusMsg?: string
  commentId?: string
  extra?: Record<string, any>
}

export interface DownloadResult {
  url: string
  metadata: TikTokVideoItem | null
}

export interface TikTokQrCodeResult {
  token: string
  qrCodeUrl?: string
  qrCodeDataUrl?: string
  expireTime?: number
}

export interface TikTokQrCodeStatusResult {
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'error'
  sessionId?: string
  cookies?: Record<string, string>
  user?: TikTokUser
  error?: string
}

export interface TikTokVerificationCodeResult {
  success: boolean
  captcha?: boolean
  error?: string
}

export interface TikTokRegisterResult {
  success: boolean
  sessionId?: string
  user?: TikTokUser
  error?: string
}

export interface LoginConfig {
  googleOAuthEnabled: boolean
  [key: string]: any
}
