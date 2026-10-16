import { TikTokClient } from '../client'
import { TikTokVideoItem } from '../types'

export interface DownloadResult {
  url: string
  metadata: TikTokVideoItem | null
}

export function getDownloadUrl(client: TikTokClient, videoId: string): Promise<DownloadResult> {
  return client.downloadVideo(videoId)
}

export function getNoWatermarkDownloadUrl(client: TikTokClient, videoId: string): Promise<DownloadResult> {
  return client.downloadVideoNoWatermark(videoId)
}
