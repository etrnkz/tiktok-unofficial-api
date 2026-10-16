import { TikTokClient } from '../client'
import { TikTokLiveStream } from '../types'

export function getLiveStreams(client: TikTokClient, cursor = ''): Promise<{ streams: TikTokLiveStream[]; cursor: number; hasMore: boolean }> {
  return client.getLiveStreams(cursor)
}
