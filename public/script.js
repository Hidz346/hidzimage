/**
 * HidzImage - script.js
 * Upscaling dilakukan langsung dari browser ke HuggingFace Inference API.
 * Tidak ada backend/serverless → tidak ada timeout/JSON error.
 *
 * Model yang digunakan:
 *   2x → caidas/swin2SR-lightweight-x2-64
 *   4x → caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr
 *   8x → 4x model dulu, lalu canvas 2x tambahan
 */

document.addEventListener('DOMContentLoaded', () => {

    // ── MODELS ──────────────────────────────────────────────────────────────
    const HF_MODELS = {
        2: 'caidas/swin2SR-lightweight-x2-64',
        4: 'caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr',
        8: 'caidas/swin2SR-realworld-sr-x4-64-bsrgan-psnr' // 4x → canvas 2x
    };

    // ── STATE ────────────────────────────────────────────────────────────────
    let selectedFile    = null;
    let currentBlobUrl  = null; // Simpan agar bisa di-revoke (memory management)

    // ── DOM ELEMENTS ─────────────────────────────────────────────────────────
    const triggerButtons  = document.querySelectorAll('.trigger-upload-btn');
    const fileInput       = document.getElementById('fileInput');
    const uploadOverlay   = document.getElementById('uploadOverlay');
    const closeOverlayBtn = document.getElementById('closeOverlayBtn');

    const previewArea   = document.getElementById('previewArea');
    const imagePreview  = document.getElementById('imagePreview');
    const controlsArea  = document.getElementById('controlsArea');
    const submitBtn     = document.getElementById('submitBtn');

    const loading        = document.getElementById('loading');
    const loadingText    = document.getElementById('loadingText');
    const loadingSubtext = document.getElementById('loadingSubtext');

    const resultDiv   = document.getElementById('result');
    const resultImage = document.getElementById('resultImage');
    const downloadBtn = document.getElementById('downloadBtn');
    const resetBtn    = document.getElementById('resetBtn');

    const errorMsg = document.getElementById('errorMsg');

    const tokenToggleBtn = document.getElementById('tokenToggleBtn');
    const tokenContent   = document.getElementById('tokenContent');
    const hfTokenInput   = document.getElementById('hfTokenInput');
    const saveTokenBtn   = document.getElementById('saveTokenBtn');
    const clearTokenBtn  = document.getElementById('clearTokenBtn');
    const tokenStatus    = document.getElementById('tokenStatus');

    // ── HELPERS ──────────────────────────────────────────────────────────────
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function setLoading(mainText, subText = '') {
        if (loadingText)    loadingText.textContent    = mainText;
        if (loadingSubtext) loadingSubtext.textContent = subText;
    }

    function showError(msg) {
        loading.classList.add('hidden');
        controlsArea.style.display = 'block';
        submitBtn.disabled         = false;
        errorMsg.textContent       = msg;
        errorMsg.classList.remove('hidden');
    }

    function resetModalState() {
        previewArea.style.display  = 'none';
        controlsArea.style.display = 'none';
        loading.classList.add('hidden');
        resultDiv.classList.add('hidden');
        errorMsg.classList.add('hidden');
        errorMsg.textContent = '';
        submitBtn.disabled   = false;
        setLoading('Menghubungi AI...', 'Biasanya membutuhkan 20–60 detik');
    }

    // ── UPLOAD TRIGGER ───────────────────────────────────────────────────────
    triggerButtons.forEach(btn => {
        btn.addEventListener('click', e => {
            e.preventDefault();
            fileInput.value = '';
            fileInput.click();
        });
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) {
            handleFileSelect(fileInput.files[0]);
        }
    });

    function handleFileSelect(file) {
        if (!file.type.startsWith('image/')) {
            alert('Harap upload file gambar (JPG, PNG, WEBP).');
            return;
        }
        selectedFile = file;

        const reader = new FileReader();
        reader.onload = e => {
            resetModalState();
            imagePreview.src = e.target.result;
            previewArea.style.display  = 'block';
            controlsArea.style.display = 'block';
            uploadOverlay.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    // ── CLOSE MODAL ──────────────────────────────────────────────────────────
    closeOverlayBtn.addEventListener('click', () => {
        uploadOverlay.classList.add('hidden');
        fileInput.value = '';
        selectedFile    = null;
    });

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            uploadOverlay.classList.add('hidden');
            if (currentBlobUrl) { URL.revokeObjectURL(currentBlobUrl); currentBlobUrl = null; }
            setTimeout(() => fileInput.click(), 300);
        });
    }

    // ── DOWNLOAD BUTTON ──────────────────────────────────────────────────────
    downloadBtn.addEventListener('click', e => {
        e.preventDefault();
        if (!currentBlobUrl) return;
        const scale = document.getElementById('scale').value;
        const a = document.createElement('a');
        a.href     = currentBlobUrl;
        a.download = `hidz-upscaled-${scale}x.png`;
        a.click();
    });

    // ── UPSCALE SUBMIT ───────────────────────────────────────────────────────
    submitBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        const scale = parseInt(document.getElementById('scale').value) || 4;

        // Switch UI to loading state
        submitBtn.disabled         = true;
        controlsArea.style.display = 'none';
        errorMsg.classList.add('hidden');
        loading.classList.remove('hidden');
        setLoading('Menghubungi AI...', 'Biasanya membutuhkan 20–60 detik');

        try {
            const resultUrl = await upscaleImage(selectedFile, scale);

            // Simpan blob URL lama → revoke → ganti baru
            if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
            currentBlobUrl = resultUrl;

            resultImage.src = resultUrl;

            loading.classList.add('hidden');
            resultDiv.classList.remove('hidden');

        } catch (err) {
            showError(err.message);
        }
    });

    // ── CORE: UPSCALE VIA HF INFERENCE API ──────────────────────────────────
    async function upscaleImage(file, scale) {
        const hfToken  = localStorage.getItem('hidz_hf_token') || '';
        const modelId  = HF_MODELS[scale] || HF_MODELS[4];

        const headers = { 'Content-Type': file.type || 'image/jpeg' };
        if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

        // Fetch dengan auto-retry saat model sedang loading (503)
        let resultBlob = await fetchWithRetry(
            `https://api-inference.huggingface.co/models/${modelId}`,
            { method: 'POST', headers, body: file }
        );

        // Untuk 8x: terapkan 2x canvas tambahan di atas hasil 4x
        if (scale >= 8) {
            setLoading('Menerapkan upscale tambahan (8x)...', 'Sebentar lagi selesai');
            resultBlob = await canvasUpscale2x(resultBlob);
        }

        return URL.createObjectURL(resultBlob);
    }

    async function fetchWithRetry(url, options, maxRetries = 4) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            let response;
            try {
                response = await fetch(url, options);
            } catch (networkErr) {
                throw new Error(
                    'Gagal terhubung ke server AI. Periksa koneksi internet Anda.'
                );
            }

            // ✅ Sukses
            if (response.ok) {
                const contentType = response.headers.get('content-type') || '';
                if (contentType.startsWith('image/')) {
                    return response.blob();
                }
                // Kalau response bukan gambar, coba baca sebagai text untuk diagnosa
                const body = await response.text();
                throw new Error(`Respons tidak terduga dari server: ${body.slice(0, 200)}`);
            }

            // 503 → Model sedang loading/cold start, tunggu & retry
            if (response.status === 503) {
                let waitSec = 20;
                try {
                    const data = await response.json();
                    if (data.estimated_time) waitSec = Math.ceil(data.estimated_time) + 2;
                } catch (_) {}

                if (attempt < maxRetries - 1) {
                    setLoading(
                        `⏳ Model AI sedang loading...`,
                        `Tunggu ${waitSec} detik lalu otomatis coba lagi (${attempt + 1}/${maxRetries - 1})`
                    );
                    await sleep(Math.min(waitSec * 1000, 60_000));
                    setLoading('Mencoba lagi...', 'Mohon tunggu');
                    continue;
                }
                throw new Error(
                    'Model AI tidak merespons setelah beberapa percobaan. ' +
                    'Coba lagi dalam 1–2 menit, atau simpan HF Token di ⚙️ Settings bawah untuk akses prioritas.'
                );
            }

            // 429 → Rate limit
            if (response.status === 429) {
                throw new Error(
                    'Rate limit tercapai (terlalu banyak request). ' +
                    'Masukkan HF Token gratis di ⚙️ Settings di bawah untuk batas yang lebih tinggi.'
                );
            }

            // 401 → Token salah
            if (response.status === 401) {
                throw new Error(
                    'HF Token tidak valid atau expired. ' +
                    'Periksa kembali token Anda di ⚙️ Settings bawah.'
                );
            }

            // Error lainnya
            const errText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Gagal upscale (HTTP ${response.status}): ${errText.slice(0, 200)}`);
        }

        throw new Error('Gagal setelah beberapa percobaan. Coba lagi nanti.');
    }

    // Canvas 2x upscale (untuk mode 8x)
    function canvasUpscale2x(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas    = document.createElement('canvas');
                canvas.width    = img.width  * 2;
                canvas.height   = img.height * 2;
                const ctx       = canvas.getContext('2d');
                ctx.imageSmoothingEnabled  = true;
                ctx.imageSmoothingQuality  = 'high';
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(b => {
                    if (b) resolve(b);
                    else   reject(new Error('Gagal menghasilkan gambar 8x dari canvas.'));
                }, 'image/png');
                URL.revokeObjectURL(img.src);
            };
            img.onerror = () => reject(new Error('Gagal memuat gambar untuk upscale 8x.'));
            img.src = URL.createObjectURL(blob);
        });
    }

    // ── HF TOKEN PANEL ───────────────────────────────────────────────────────
    tokenToggleBtn.addEventListener('click', () => {
        tokenContent.classList.toggle('hidden');
    });

    // Load token yang sudah tersimpan
    const savedToken = localStorage.getItem('hidz_hf_token');
    if (savedToken) {
        hfTokenInput.value    = savedToken;
        tokenStatus.textContent = '✓ Token aktif';
        tokenStatus.style.color = '#10B981';
    }

    saveTokenBtn.addEventListener('click', () => {
        const val = hfTokenInput.value.trim();
        if (!val) {
            tokenStatus.textContent = '⚠ Token kosong.';
            tokenStatus.style.color = 'orange';
            return;
        }
        if (!val.startsWith('hf_')) {
            tokenStatus.textContent = '⚠ Token harus diawali "hf_".';
            tokenStatus.style.color = 'orange';
            return;
        }
        localStorage.setItem('hidz_hf_token', val);
        tokenStatus.textContent = '✓ Token tersimpan!';
        tokenStatus.style.color = '#10B981';
    });

    clearTokenBtn.addEventListener('click', () => {
        localStorage.removeItem('hidz_hf_token');
        hfTokenInput.value      = '';
        tokenStatus.textContent = '🗑 Token dihapus.';
        tokenStatus.style.color = '#EF4444';
    });

});
