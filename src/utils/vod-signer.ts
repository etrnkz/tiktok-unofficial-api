import * as crypto from 'crypto'

export interface VodCredentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  region: string
}

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf-8').digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf-8').digest()
}

function formatDate(date: Date): string {
  return date.toISOString().replace(/[:\-]/g, '').slice(0, 8)
}

function formatDateTime(date: Date): string {
  return date.toISOString().replace(/[:\-]/g, '').slice(0, 15) + 'Z'
}

function buildCanonicalQueryString(params: Record<string, string>): string {
  return Object.keys(params).sort().map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&')
}

export function signVodRequest(
  method: string,
  path: string,
  query: Record<string, string>,
  auth: VodCredentials,
  body = '',
  extraHeaders: Record<string, string> = {},
): { headers: Record<string, string>; signedHeaders: string } {
  const now = new Date()
  const shortDate = formatDate(now)
  const requestDate = formatDateTime(now)
  const service = 'vod'
  const region = auth.region || 'ap-singapore-1'
  const algorithm = 'AWS4-HMAC-SHA256'
  const payloadHash = sha256(body)

  const allHeaders: Record<string, string> = {
    'x-amz-date': requestDate,
    'x-amz-security-token': auth.sessionToken,
    'accept': '*/*',
    ...extraHeaders,
  }
  if (method === 'POST' && body && !allHeaders['x-amz-content-sha256']) {
    allHeaders['x-amz-content-sha256'] = payloadHash
  }

  const signedHeaderNames = method === 'POST' && body
    ? ['x-amz-content-sha256', 'x-amz-date', 'x-amz-security-token']
    : ['x-amz-date', 'x-amz-security-token']

  const canonicalHeaders = signedHeaderNames
    .sort()
    .map(k => k.toLowerCase() + ':' + allHeaders[k].trim() + '\n')
    .join('')
  const signedHeaders = signedHeaderNames.sort().join(';')

  const canonicalUri = path
  const canonicalQueryString = buildCanonicalQueryString(query)
  const canonicalRequest = [
    method, canonicalUri, canonicalQueryString,
    canonicalHeaders, signedHeaders, payloadHash,
  ].join('\n')

  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`
  const stringToSign = [
    algorithm, requestDate, credentialScope, sha256(canonicalRequest),
  ].join('\n')

  const kSecret = Buffer.from('AWS4' + auth.secretAccessKey, 'utf-8')
  const kDate = hmacSha256(kSecret, shortDate)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')
  const signature = hmacSha256(kSigning, stringToSign).toString('hex')

  allHeaders['authorization'] = `${algorithm} Credential=${auth.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { headers: allHeaders, signedHeaders }
}
