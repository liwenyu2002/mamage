const net = require('node:net');
function normalizeIp(ip) { return String(ip || '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1'); }
function inAddresses(ip, ranges) {
  ip = normalizeIp(ip);
  if (!net.isIP(ip)) return false;
  const block = new net.BlockList();
  for (const range of ranges || []) {
    const [address, bits] = range.split('/'), kind = net.isIP(address);
    if (!kind) continue;
    try {
      if (bits == null) block.addAddress(address, kind === 4 ? 'ipv4' : 'ipv6');
      else block.addSubnet(address, Number(bits), kind === 4 ? 'ipv4' : 'ipv6');
    } catch { continue; }
  }
  return block.check(ip, net.isIP(ip) === 4 ? 'ipv4' : 'ipv6');
}
function pushSourceAllowed(req, cfg) {
  let ip = normalizeIp(req.socket?.remoteAddress);
  if (inAddresses(ip, cfg.trustedProxyAddresses)) {
    const forwarded = String(req.get('x-forwarded-for') || '').split(',').map(x => normalizeIp(x.trim()));
    if (forwarded.length > 10 || forwarded.some(x => !net.isIP(x))) return false;
    for (let i = forwarded.length - 1; i >= 0 && inAddresses(ip, cfg.trustedProxyAddresses); i--) ip = forwarded[i];
  }
  return inAddresses(ip, cfg.sourceAddresses);
}
module.exports = { pushSourceAllowed, inAddresses };
