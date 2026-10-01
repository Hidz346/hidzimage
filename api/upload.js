'use strict';

/**
 * Proxy upload untuk tab "Upload ke Link".
 * Browser mengirim file ke sini (satu origin, tanpa masalah CORS), lalu fungsi ini
 * meneruskannya ke API layanan yang dipilih dari sisi server dan mengembalikan { url }.
 * Alamat API tidak pernah dikirim ke browser.
 */

const API_BASE = (process.env.UPLOAD_API_BASE || 'https://api-hidz.html-5.me/docs/api/uploader').replace(/\/+$/, '');

const PROVIDERS = new Map([
  ['gobox',    `${API_BASE}/gobox.php`],
  ['uguu',     `${API_BASE}/uguu.php`],
  ['uploadee', `${API_BASE}/uploadee.php`],
]);

const TIMEOUT_MS = 25000;
const MAX_BYTES  = 4.4 * 1024 * 1024;   // batas body fungsi Vercel ± 4,5 MB

const isUrl = v => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());

function fail(res, status, error) {
  return res.status(status).json({ error });
}

async function readBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function safeName(raw) {
  let name = 'file';
  try { name = decodeURIComponent(raw || '') || name; } catch (e) { /* pakai default */ }
  return name.replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 120);
}

/** Cari link hasil upload di respons API: kunci yang umum dulu, lalu telusuri seluruh JSON. */
function findLink(node, depth = 0) {
  if (isUrl(node)) return node.trim();
  if (!node || typeof node !== 'object' || depth > 4) return null;

  for (const key of ['Result_url', 'result_url', 'Url_result', 'url', 'Url', 'link', 'Link']) {
    if (isUrl(node[key])) return node[key].trim();
  }
  for (const value of Object.values(node)) {
    const found = findLink(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Respons dianggap gagal kalau penanda statusnya false, atau kode status numeriknya 400 ke atas. */
function reportedFailure(data) {
  if (!data) return false;
  if (['Status', 'status', 'success', 'Success', 'ok'].some(k => data[k] === false)) return true;
  return typeof data.status === 'number' && data.status >= 400;
}

function failureReason(data) {
  const reason = ['message', 'Message', 'error', 'Error', 'description']
    .map(k => data && data[k])
    .find(v => typeof v === 'string' && v.trim() && !isUrl(v));
  return reason ? reason.trim().slice(0, 160) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return fail(res, 405, 'Metode tidak diizinkan.');
  }

  const target = PROVIDERS.get(String(req.headers['x-provider'] || ''));
  if (!target) return fail(res, 400, 'Layanan upload tidak dikenal.');

  const type = String(req.headers['x-file-type'] || '');
  if (!/^(image|video)\/[a-z0-9.+-]+$/i.test(type)) {
    return fail(res, 400, 'Hanya file foto atau video yang bisa diupload.');
  }

  const buffer = await readBody(req);
  if (!buffer.length) return fail(res, 400, 'File kosong.');
  if (buffer.length > MAX_BYTES) return fail(res, 413, 'Ukuran file terlalu besar.');

  const form = new FormData();
  form.append('file', new Blob([buffer], { type }), safeName(req.headers['x-file-name']));

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let text;
  try {
    const upstream = await fetch(target, { method: 'POST', body: form, signal: ctrl.signal });
    text = await upstream.text();
  } catch (err) {
    const timedOut = err && err.name === 'AbortError';
    return fail(res, 502, timedOut
      ? 'Server upload terlalu lama merespons. Coba lagi atau pilih layanan lain.'
      : 'Server upload sedang bermasalah. Coba lagi atau pilih layanan lain.');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* mungkin teks biasa berisi link */ }

  const failed = reportedFailure(data);
  if (!failed) {
    const link = findLink(data) || (isUrl(text) ? text.trim() : null);
    if (link) return res.status(200).json({ url: link });
  }
  const reason = failed ? failureReason(data) : null;
  return fail(res, 502, reason || 'Upload gagal. Coba lagi atau pilih layanan lain.');
};
