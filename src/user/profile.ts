import { TikTokClient } from '../client'
import { TikTokUserProfile, TikTokFeedResponse } from '../types'

export function getUserProfile(client: TikTokClient, username: string): Promise<TikTokUserProfile> {
  return client.getUserProfile(username)
}

export function getUserVideos(client: TikTokClient, username: string, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getUserVideos(username, cursor)
}
