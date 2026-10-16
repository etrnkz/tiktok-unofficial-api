import { TikTokClient } from '../client'
import { TikTokFeedResponse } from '../types'

export function getHashtagFeed(client: TikTokClient, hashtagName: string, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getHashtagFeed(hashtagName, cursor)
}
