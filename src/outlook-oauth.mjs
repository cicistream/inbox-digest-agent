/**
 * Outlook OAuth2：用 refresh_token 换 access_token；可选设备码流程获取 refresh_token
 * 用于 Microsoft Graph API 拉取邮件（无需 IMAP 应用密码）
 */
const TENANT = 'common';
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const DEVICE_CODE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/devicecode`;
const SCOPES = 'https://graph.microsoft.com/Mail.Read offline_access';

/**
 * 用 refresh_token 获取 access_token
 * @param {{ clientId: string, clientSecret?: string, refreshToken: string }}
 * @returns {Promise<string>} access_token
 */
export async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  if (clientSecret) body.append('client_secret', clientSecret);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OAuth2 token 失败: ${res.status} ${err}`);
  }
  const data = await res.json();
  if (!data.access_token) throw new Error('OAuth2 响应中无 access_token');
  return data.access_token;
}

/**
 * 设备码流程：在终端打印登录链接与码，轮询直到用户完成登录，返回 refresh_token
 * 用于首次配置，运行一次后把得到的 refresh_token 写入 .env
 * @param {{ clientId: string }}
 * @returns {Promise<{ refresh_token: string, access_token: string }>}
 */
export async function getRefreshTokenViaDeviceCode({ clientId }) {
  const codeRes = await fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: SCOPES }).toString(),
  });
  if (!codeRes.ok) throw new Error('获取 device code 失败: ' + (await codeRes.text()));
  const { device_code, user_code, verification_uri, interval, expires_in } = await codeRes.json();

  console.log('\n请在浏览器打开以下地址并输入代码完成登录：');
  console.log(verification_uri);
  console.log('代码:', user_code);
  console.log('（约', Math.ceil(expires_in / 60), '分钟内有效）\n');

  const pollBody = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: device_code,
  });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const pollMs = (interval || 5) * 1000;

  for (;;) {
    await wait(pollMs);
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: pollBody.toString(),
    });
    const data = await tokenRes.json();
    if (data.access_token && data.refresh_token) {
      return { access_token: data.access_token, refresh_token: data.refresh_token };
    }
    if (data.error === 'authorization_pending') continue;
    if (data.error === 'expired_token') throw new Error('设备码已过期，请重新运行');
    throw new Error(data.error_description || data.error || '设备码登录失败');
  }
}
