import { TikTokClient } from '../client'
import { TikTokFeedResponse } from '../types'

export function getFeed(client: TikTokClient, count = 12, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getFeed(count, cursor)
}

export function getTrendingFeed(client: TikTokClient, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getTrendingFeed(cursor)
}

export function getFollowingFeed(client: TikTokClient, cursor = ''): Promise<TikTokFeedResponse> {
  return client.getFollowingFeed(cursor)
}
