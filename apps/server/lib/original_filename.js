function normalizeOriginalFilename(value, { multipart = false } = {}) {
  if (typeof value !== 'string' || !value) return null;
  let name = value;
  if (multipart && [...name].every(char => char.charCodeAt(0) <= 255)) {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    if (!decoded.includes('\ufffd')) name = decoded;
  }
  name = name.replace(/\\/g, '/').split('/').pop().replace(/[\u0000-\u001f\u007f]/g, '').normalize('NFC').trim();
  if (!name || name === '.' || name === '..') return null;
  return [...name].slice(0, 512).join('');
}

module.exports = { normalizeOriginalFilename };
