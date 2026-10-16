import { TikTokClient } from '../client'
import { TikTokVideoItem, TikTokComment } from '../types'

export function getVideoDetail(client: TikTokClient, videoId: string): Promise<TikTokVideoItem | null> {
  return client.getVideoDetail(videoId)
}

export function getComments(client: TikTokClient, videoId: string, cursor = ''): Promise<{ comments: TikTokComment[]; cursor: number; hasMore: boolean }> {
  return client.getComments(videoId, cursor)
}

export function getCommentReplies(client: TikTokClient, commentId: string, videoId: string, cursor = ''): Promise<{ replies: TikTokComment[]; cursor: number; hasMore: boolean }> {
  return client.getCommentReplies(commentId, videoId, cursor)
}
