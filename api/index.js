const express = require('express');
const multer = require('multer');
const path = require('path');
const { Blob } = require('node:buffer');
const { Client, handle_file } = require('@gradio/client');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// --- Logika Upscale (Sumber baru: model open-source Real-ESRGAN di Hugging Face) ---
//
// Sumber sebelumnya (supawork.ai + bypass Cloudflare Turnstile dari nekolabs.web.id)
// sudah mati permanen -- layanan bypass-nya sendiri dihapus di pihak nekolabs
// ("The deployment could not be found on Vercel"), bukan masalah di kode ini.
//
// Diganti ke Space Hugging Face publik yang menjalankan model Real-ESRGAN, dipanggil
// lewat "@gradio/client" (library resmi Gradio/Hugging Face, BUKAN scrape tidak resmi).
// Tidak ada Cloudflare Turnstile sama sekali di jalur ini.

const HF_SPACE = 'Nick088/Real-ESRGAN_Pytorch';

// Skala yang didukung model ini (mengikuti penamaan bobot RealESRGAN_x2/x4/x8)
const MODEL_CHOICE = {
    2: 'RealESRGAN_x2',
    4: 'RealESRGAN_x4',
    8: 'RealESRGAN_x8'
};

// Helper diagnosa: kalau tahap konek berhasil tapi tahap prediksi gagal, sekalian
// ambil skema API asli (client.view_api()) dan tempel ke pesan error. Jadi kalau
// nama endpoint atau nilai parameter yang saya tebak kurang pas, pesan errornya
// akan langsung menunjukkan format yang benar dari Hugging Face -- bukan generic.
async function step(label, fn, client) {
    try {
        return await fn();
    } catch (error) {
        let schema = '';
        if (client) {
            try { schema = JSON.stringify(await client.view_api()).slice(0, 600); } catch (_) {}
        }
        throw new Error(`[${label}] ${error.message}${schema ? ' | Skema API asli: ' + schema : ''}`);
    }
}

async function imgupscale(imageBuffer, { scale = 4, mimetype = 'image/png' } = {}) {
    try {
        if (!Buffer.isBuffer(imageBuffer)) throw new Error('Image must be a buffer.');

        const scaleInt = parseInt(scale);
        const modelChoice = MODEL_CHOICE[scaleInt];
        if (!modelChoice) throw new Error(`Skala tidak didukung. Pilihan: ${Object.keys(MODEL_CHOICE).join(', ')}.`);

        const client = await step('Tahap 1/2 - Sambung ke model upscale (Hugging Face)', () => Client.connect(HF_SPACE));

        const imageBlob = new Blob([imageBuffer], { type: mimetype || 'image/png' });

        const result = await step('Tahap 2/2 - Proses upscale gambar (Hugging Face)', () => {
            return client.predict('/predict', [handle_file(imageBlob), modelChoice]);
        }, client);

        const output = result?.data?.[0];
        const url = (typeof output === 'string') ? output : (output?.url || output?.path);
        if (!url) throw new Error(`Tidak ada URL hasil pada response. Raw output: ${JSON.stringify(output).slice(0, 300)}`);

        return url;

    } catch (error) {
        console.error("Upscale Error:", error.message);
        throw new Error(error.message);
    }
}

// --- API Routes ---

app.post('/api/upscale', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No image file uploaded.' });
        
        const scale = req.body.scale || 4;
        const resultUrl = await imgupscale(req.file.buffer, { scale, mimetype: req.file.mimetype });
        
        res.json({ success: true, url: resultUrl });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fallback for local testing (Serve static files)
app.use(express.static(path.join(__dirname, '../public')));

module.exports = app;

