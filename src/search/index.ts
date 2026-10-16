import { TikTokClient } from '../client'
import { TikTokSearchResponse } from '../types'

export function searchVideos(client: TikTokClient, keyword: string, cursor = ''): Promise<TikTokSearchResponse> {
  return client.searchVideos(keyword, cursor)
}

export function searchUsers(client: TikTokClient, keyword: string, cursor = ''): Promise<{ users: any[]; cursor: number; hasMore: boolean }> {
  return client.searchUsers(keyword, cursor)
}

export function searchHashtags(client: TikTokClient, keyword: string, cursor = ''): Promise<{ hashtags: any[]; cursor: number; hasMore: boolean }> {
  return client.searchHashtags(keyword, cursor)
}
