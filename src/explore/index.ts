import { TikTokClient } from '../client'
import { TikTokExploreResponse } from '../types'

export function getExplore(client: TikTokClient, categoryType = 120, cursor = ''): Promise<TikTokExploreResponse> {
  return client.getExplore(categoryType, cursor)
}
