// Only accept a proxy-supplied visitor IP when the proxy authenticates it.
import {BlockList, isIP} from 'node:net';
import {timingSafeEqual} from 'node:crypto';

const reserved = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) reserved.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32]]) reserved.addSubnet(net, bits, 'ipv6');

export function normalizeIp(value) {
  let text = String(value || '').trim();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(text);
  if (mapped) text = mapped[1];
  return isIP(text) ? text.toLowerCase() : null;
}
export const isGlobal = address => {
  const kind = isIP(address);
  return kind > 0 && !reserved.check(address, kind === 4 ? 'ipv4' : 'ipv6');
};

export function clientIp(req, proxyToken = process.env.STATISTICS_PROXY_TOKEN) {
  const supplied = String(req.headers['x-statistics-proxy-token'] || '');
  if (proxyToken && supplied.length === proxyToken.length && timingSafeEqual(Buffer.from(proxyToken), Buffer.from(supplied))) {
    return normalizeIp(req.headers['x-statistics-client-ip']);
  }
  // Ignore arbitrary forwarded/Cloudflare headers on direct requests.
  const address = normalizeIp(req.socket.remoteAddress);
  return address && isGlobal(address) ? address : null;
}
