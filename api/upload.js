'use strict';

const crypto = require('crypto');

/**
 * HidzImage upload proxy
 *
 * PHOTO:
 *   gobox -> existing Hidz uploader endpoint (photo-only)
 *   uguu  -> Uguu
 *
 * VIDEO:
 *   handled directly by the browser (File.io / Uguu)
 *
 * The browser still talks to /api/upload for photo providers so provider-specific
 * API formats and CORS never leak into the UI.
 */

const API_BASE = (process.env.UPLOAD_API_BASE || 'https://api-hidz.html-5.me/docs/api/uploader').replace(/\/+$/, '');

const PROVIDERS = {
  gobox:   { url: `${API_BASE}/gobox.php`,  media: 'both', field: 'file', kind: 'generic-json' },
  uguu:    { url: 'https://uguu.se/upload',                           media: 'both',  field: 'files[]', kind: 'uguu' },
};

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 25000;   // di bawah maxDuration di vercel.json
const MAX_HOPS = 3;

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

function normalizeLink(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (isUrl(trimmed)) return trimmed;
  if (/^\/?file\/[A-Za-z0-9._-]+$/i.test(trimmed)) {
    return 'https://www.gobox.my.id/' + trimmed.replace(/^\/+/, '');
  }
  if (/^\/[^\s"'<>]+$/.test(trimmed)) {
    return 'https://www.gobox.my.id' + trimmed;
  }
  return null;
}

function findLink(node, depth = 0) {
  const direct = normalizeLink(node);
  if (direct) return direct;
  if (!node || typeof node !== 'object' || depth > 8) return null;

  for (const key of [
    'url', 'Url', 'link', 'Link', 'Result_url', 'result_url',
    'downloadUrl', 'download_url', 'fileUrl', 'file_url'
  ]) {
    const normalized = normalizeLink(node[key]);
    if (normalized) return normalized;
  }

  for (const value of Object.values(node)) {
    const found = findLink(value, depth + 1);
    if (found) return found;
  }

  return null;
}

function findTextLink(text) {
  if (!text || typeof text !== 'string') return null;
  const absolute = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (absolute && isUrl(absolute[0])) return absolute[0].replace(/[),.;]+$/, '');
  const relative = text.match(/(?:^|["'\s])(\/file\/[A-Za-z0-9._-]+)(?:["'\s]|$)/i);
  if (relative) return 'https://www.gobox.my.id' + relative[1];
  return null;
}

function findError(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return null;

  for (const key of ['error', 'Error', 'message', 'Message', 'description', 'Result_url', 'result_url']) {
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

function parseJson(text) {
  try { return JSON.parse(text); }
  catch (_) { return null; }
}

function buildForm(provider, buffer, type, fileName) {
  const form = new FormData();

  if (provider.kind === 'uguu') {
    form.append('files[]', new Blob([buffer], { type }), fileName);
  } else {
    form.append('file', new Blob([buffer], { type }), fileName);
  }

  return form;
}

const isHtml = text => /^\s*<(?:!doctype|html|head|body|script)/i.test(text || '');

/** API kadang membalas HTTP 200 padahal isinya gagal (Status:false / Code:400). */
function reportedFailure(data) {
  if (!data || typeof data !== 'object') return false;
  const flag = data.Status ?? data.status ?? data.success;
  const code = Number(data.Code ?? data.code);
  return flag === false || code >= 400;
}

/**
 * Hosting gratis tertentu menjawab request tanpa cookie dengan halaman JS
 * (AES, cookie __test). Browser menjawabnya otomatis, server tidak, jadi
 * dijawab di sini lalu request diulang.
 */
function solveChallenge(html) {
  if (!/slowAES|aes\.js/i.test(html)) return null;
  const parts = [...html.matchAll(/toNumbers\("([0-9a-f]{32})"\)/gi)].map(m => Buffer.from(m[1], 'hex'));
  if (parts.length < 3) return null;

  try {
    const [key, iv, data] = parts;
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    return '__test=' + Buffer.concat([decipher.update(data), decipher.final()]).toString('hex');
  } catch (_) {
    return null;
  }
}

/**
 * POST ke server upload. Redirect diikuti manual supaya tetap POST
 * (fetch biasa mengubahnya jadi GET dan file hilang -> NO_FILE).
 */
async function postUpstream(provider, buffer, type, fileName, signal) {
  let url = provider.url;
  let cookie = '';

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const headers = { Accept: 'application/json' };
    if (cookie) headers.Cookie = cookie;

    const reply = await fetch(url, {
      method: 'POST',
      body: buildForm(provider, buffer, type, fileName),
      headers,
      redirect: 'manual',
      signal,
    });
    const text = await reply.text();

    const location = reply.headers.get('location');
    if (reply.status >= 300 && reply.status < 400 && location) {
      url = new URL(location, url).toString();
      continue;
    }

    const challenge = cookie ? null : solveChallenge(text);
    if (challenge) {
      cookie = challenge;
      const retry = new URL(provider.url);
      retry.searchParams.set('i', '1');
      url = retry.toString();
      continue;
    }

    return { ok: reply.ok, status: reply.status, text };
  }

  throw new Error('Terlalu banyak redirect.');
}

function mediaAllowed(provider, type) {
  if (provider.media === 'both') return true;
  return provider.media === 'image'
    ? type.startsWith('image/')
    : type.startsWith('video/');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Metode tidak diizinkan.');
  }

  const providerName = String(req.headers['x-provider'] || '').toLowerCase();
  const provider = PROVIDERS[providerName];

  if (!provider) {
    return fail(res, 400, 'Layanan upload tidak dikenal.');
  }

  const type = String(req.headers['x-file-type'] || '').toLowerCase();
  if (!/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) {
    return fail(res, 400, 'Hanya file foto atau video yang bisa diupload.');
  }

  if (!mediaAllowed(provider, type)) {
    return fail(
      res,
      400,
      providerName === 'gobox'
        ? 'GOBOX gagal menerima file ini dari server upload.'
        : 'Layanan ini tidak mendukung tipe file tersebut.'
    );
  }

  const buffer = await readBody(req);

  if (!buffer.length) {
    return fail(res, 400, 'File kosong.');
  }

  if (buffer.length > MAX_BYTES) {
    return fail(res, 413, 'Ukuran file terlalu besar. Maksimal 4 MB per upload.');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let upstream;

  try {
    upstream = await postUpstream(
      provider,
      buffer,
      type,
      safeName(req.headers['x-file-name']),
      ctrl.signal
    );
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return fail(
      res,
      502,
      timedOut
        ? 'Server upload terlalu lama merespons.'
        : `Server ${providerName.toUpperCase()} tidak dapat dihubungi.`,
    );
  } finally {
    clearTimeout(timer);
  }

  const responseText = upstream.text;
  const data = parseJson(responseText);

  if (!upstream.ok || reportedFailure(data)) {
    console.error(`[upload] ${providerName} gagal (HTTP ${upstream.status}):`, responseText.slice(0, 300));
    return fail(
      res,
      502,
      findError(data) ||
        (isHtml(responseText) ? '' : responseText.trim().slice(0, 240)) ||
        `Server upload mengembalikan HTTP ${upstream.status}.`,
      { provider: providerName, upstreamStatus: upstream.status }
    );
  }

  const plain = isHtml(responseText) ? '' : responseText;
  const link = findLink(data) || findTextLink(plain);

  if (!link) {
    console.error(`[upload] ${providerName}: link tidak ditemukan:`, responseText.slice(0, 300));
    return fail(
      res,
      502,
      findError(data) || 'Upload selesai tetapi URL hasil tidak ditemukan.',
      { provider: providerName }
    );
  }

  return res.status(200).json({
    url: link,
    provider: providerName,
  });
};
