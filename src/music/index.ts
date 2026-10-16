import { TikTokClient } from '../client'
import { TikTokFeedResponse } from '../types'

export function getMusicFeed(client: TikTokClient, musicId: string, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getMusicFeed(musicId, cursor)
}
