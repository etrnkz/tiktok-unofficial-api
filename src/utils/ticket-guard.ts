import * as crypto from 'crypto'
import { TicketGuardKeys } from '../types'

export interface TicketGuardData {
  clientData: string
  publicKeyB64: string
  timestamp: number
}

export function extractRawPublicKey(publicKeyPem: string): string {
  const key = crypto.createPublicKey(publicKeyPem)
  const jwk = key.export({ format: 'jwk' })
  const x = Buffer.from(jwk.x!, 'base64url')
  const y = Buffer.from(jwk.y!, 'base64url')
  return Buffer.concat([Buffer.from([0x04]), x, y]).toString('base64')
}

function derSigToRaw(derSig: Buffer): Buffer {
  const tag = derSig[0]
  if (tag !== 0x30) return derSig
  let offset = 2
  const rLen = derSig[offset + 1]
  offset += 2
  let r = derSig.slice(offset, offset + rLen)
  offset += rLen
  const sLen = derSig[offset + 1]
  offset += 2
  let s = derSig.slice(offset, offset + sLen)
  if (r.length < 32) r = Buffer.concat([Buffer.alloc(32 - r.length), r])
  if (r.length > 32) r = r.slice(r.length - 32)
  if (s.length < 32) s = Buffer.concat([Buffer.alloc(32 - s.length), s])
  if (s.length > 32) s = s.slice(s.length - 32)
  return Buffer.concat([r, s])
}

export function generateTicketGuardClientData(
  fullPath: string,
  keys: TicketGuardKeys,
  timestamp: number,
): TicketGuardData {
  const contentToSign = keys.tsSign + fullPath + timestamp
  const sign = crypto.createSign('sha256')
  sign.update(contentToSign)
  const derSig = sign.sign(keys.privateKeyPem)
  const rawSig = derSigToRaw(derSig)
  const reqSign = rawSig.toString('base64')

  const publicKeyB64 = extractRawPublicKey(
    crypto.createPublicKey(keys.privateKeyPem).export({ type: 'spki', format: 'pem' }) as string,
  )

  const payload = {
    ts_sign: keys.tsSign,
    req_content: 'ticket,path,timestamp',
    req_sign: reqSign,
    timestamp,
  }

  const clientData = Buffer.from(JSON.stringify(payload)).toString('base64')

  return { clientData, publicKeyB64, timestamp }
}

export function makeTicketGuardHeaders(
  fullPath: string,
  keys: TicketGuardKeys,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000)
  const data = generateTicketGuardClientData(fullPath, keys, timestamp)

  return {
    'tt-ticket-guard-client-data': data.clientData,
    'tt-ticket-guard-version': '2',
    'tt-ticket-guard-web-version': '1',
    'tt-ticket-guard-iteration-version': '0',
    'tt-ticket-guard-public-key': data.publicKeyB64,
  }
}
