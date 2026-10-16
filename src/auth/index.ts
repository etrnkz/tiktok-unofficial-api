import { TikTokClient } from '../client'
import { AppContext } from '../types'

export interface LoginConfig {
  googleOAuthEnabled: boolean
  [key: string]: any
}

export async function getLoginConfig(client: TikTokClient): Promise<LoginConfig> {
  return client.getLoginConfig() as Promise<LoginConfig>
}

export async function fetchInitialData(client: TikTokClient): Promise<Record<string, any>> {
  return client.fetchInitialData()
}

export function getAppContext(client: TikTokClient): AppContext | null {
  return client.appContext
}

export async function getLoginQrCode(client: TikTokClient) {
  return client.getLoginQrCode()
}

export async function checkLoginQrCode(client: TikTokClient, token: string) {
  return client.checkLoginQrCode(token)
}

export async function sendVerificationCode(client: TikTokClient, target: string, type: 'email' | 'mobile' = 'email') {
  return client.sendVerificationCode(target, type)
}

export async function loginWithCode(client: TikTokClient, target: string, code: string, type: 'email' | 'mobile' = 'email') {
  return client.loginWithCode(target, code, type)
}

export async function signupWithCode(client: TikTokClient, email: string, code: string, password?: string) {
  return client.signupWithCode(email, code, password)
}
