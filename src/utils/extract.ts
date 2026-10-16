/**
 * Extract video detail from TikTok video page by fetching the HTML
 * and parsing __UNIVERSAL_DATA_FOR_REHYDRATION__.
 */
export async function extractVideoDetail(videoId: string, options?: { username?: string; cookieJar?: Record<string, string> }): Promise<any | null> {
  const fetch = require('node-fetch')

  const cookieStr = options?.cookieJar
    ? Object.entries(options.cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
    : ''

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  }
  if (cookieStr) headers['Cookie'] = cookieStr

  const urls: string[] = []
  if (options?.username) {
    urls.push(`https://www.tiktok.com/@${options.username}/video/${videoId}`)
  }
  urls.push(`https://www.tiktok.com/video/${videoId}`)

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers })
      const html = await res.text()
      const match = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)
      if (match) {
        const data = JSON.parse(match[1])
        const scope = data['__DEFAULT_SCOPE__']
        const videoDetail = scope?.['webapp.video-detail']
        if (videoDetail?.itemInfo?.itemStruct) {
          return videoDetail.itemInfo.itemStruct
        }
      }
    } catch { }
  }

  return null
}
