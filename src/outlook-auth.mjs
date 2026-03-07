/**
 * 首次配置 Outlook OAuth2：设备码流程，获取 refresh_token 后写入 .env
 * 运行：pnpm run outlook:auth
 */
import './load-env.mjs';
import { getRefreshTokenViaDeviceCode } from './outlook-oauth.mjs';

const clientId = (process.env.OUTLOOK_CLIENT_ID || '').trim();
if (!clientId) {
  console.error('请先在 .env 中设置 OUTLOOK_CLIENT_ID（Azure 应用注册的应用程序(客户端) ID）');
  process.exit(1);
}

const { refresh_token } = await getRefreshTokenViaDeviceCode({ clientId });
console.log('\n成功。请将下面一行追加到 .env 中：\n');
console.log('OUTLOOK_REFRESH_TOKEN=' + refresh_token);
console.log('');
