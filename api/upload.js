'use strict';

/*
 * HidzImage — upload proxy.
 * The browser sends the binary to this same-origin endpoint; the endpoint
 * forwards it to Uguu using the documented multipart field: files[].
 *
 * The old Gobox / Upload.ee provider keys are accepted as aliases so older
 * clients do not break, but the active backend is Uguu.
 */

const UPSTREAM_URL = 'https://uguu.se/upload';
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 30000;

const isUrl = value =>
  typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function safeName(raw) {
  let name = 'file';
  try {
    name = decodeURIComponent(String(raw || '')) || name;
  } catch (_) {}
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120) || 'file';
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (req.body instanceof Uint8Array) return Buffer.from(req.body);
  if (typeof req.body === 'string') return Buffer.from(req.body, 'binary');

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function findLink(node, depth = 0) {
  if (isUrl(node)) return node.trim();
  if (!node || typeof node !== 'object' || depth > 5) return null;

  for (const key of ['url', 'Url', 'link', 'Link', 'Result_url', 'result_url', 'downloadUrl']) {
    if (isUrl(node[key])) return node[key].trim();
  }

  for (const value of Object.values(node)) {
    const found = findLink(value, depth + 1);
    if (found) return found;
  }

  return null;
}

function findError(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;

  for (const key of ['error', 'Error', 'message', 'Message', 'description']) {
    const value = node[key];
    if (typeof value === 'string' && value.trim() && !isUrl(value)) {
      return value.trim().slice(0, 240);
    }
  }

  for (const value of Object.values(node)) {
    const found = findError(value, depth + 1);
    if (found) return found;
  }

  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Metode tidak diizinkan.');
  }

  const type = String(req.headers['x-file-type'] || '');
  if (!/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) {
    return fail(res, 400, 'Hanya file foto atau video yang bisa diupload.');
  }

  const buffer = await readBody(req);

  if (!buffer.length) {
    return fail(res, 400, 'File kosong.');
  }

  if (buffer.length > MAX_BYTES) {
    return fail(res, 413, 'Ukuran file terlalu besar. Maksimal 4 MB per upload.');
  }

  const form = new FormData();
  form.append(
    'files[]',
    new Blob([buffer], { type }),
    safeName(req.headers['x-file-name'])
  );

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let upstream;
  let responseText = '';

  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    responseText = await upstream.text();
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return fail(
      res,
      502,
      timedOut
        ? 'Server upload terlalu lama merespons.'
        : 'Server upload Uguu tidak dapat dihubungi.',
    );
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = JSON.parse(responseText);
  } catch (_) {}

  if (!upstream.ok) {
    return fail(
      res,
      502,
      findError(data) || `Server upload mengembalikan HTTP ${upstream.status}.`,
      { upstreamStatus: upstream.status }
    );
  }

  const link = findLink(data) || (isUrl(responseText) ? responseText.trim() : null);

  if (!link) {
    return fail(
      res,
      502,
      findError(data) || 'Upload selesai tetapi URL hasil tidak ditemukan.',
    );
  }

  return res.status(200).json({
    url: link,
    provider: 'uguu',
  });
};
