// api/generate.js

// Menggunakan 'require' agar kompatibel penuh dengan Node.js di Vercel
const axios = require('axios');

module.exports = async (req, res) => {
  // 1. KEAMANAN: Hanya izinkan method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // Ambil data yang dikirim dari Frontend
  const { text, voice_id } = req.body;

  // Validasi input sederhana
  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong.' });
  }

  // 2. AMBIL KUNCI DARI ENVIRONMENT VARIABLES
  let apiKeys = [];
  try {
    // Membaca array kunci dari Settings Vercel
    apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]');
  } catch (e) {
    console.error("Format ENV Salah:", e);
    return res.status(500).json({ error: "Format API Key di server salah. Harus JSON Array." });
  }

  // Cek apakah kunci tersedia
  if (apiKeys.length === 0) {
    return res.status(500).json({ error: "Tidak ada API Key yang ditemukan di Settings Vercel." });
  }

  // 3. LOGIKA ESTAFET (ROTASI KUNCI)
  // Kita akan mencoba kunci satu per satu sampai berhasil
  let lastError = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];
    console.log(`🔄 Mencoba Key ke-${i + 1} (ID: ...${currentKey.slice(-4)})`);

    try {
      // --- REQUEST KE ELEVENLABS ---
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || 'pNInz6obpgDQGcFmaJgB'}`, // Default ke Adam jika ID kosong
        {
          text: text,
          model_id: "eleven_multilingual_v2", // Model terbaik untuk Bahasa Indonesia
          voice_settings: {
            stability: 0.40,       // Agak rendah (0.4) agar lebih ekspresif/beremosi
            similarity_boost: 0.75,// Menjaga kemiripan suara
            style: 0.50,           // Menambah gaya bicara (v2 only)
            use_speaker_boost: true // Meningkatkan kejernihan volume
          }
        },
        {
          headers: {
            'xi-api-key': currentKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer' // PENTING: Menerima data sebagai file audio (biner)
        }
      );

      // --- JIKA SUKSES ---
      console.log(`✅ Berhasil dengan Key ke-${i + 1}!`);
      
      // Kirim audio balik ke Frontend
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(response.data);

    } catch (error) {
      // --- JIKA GAGAL ---
      const status = error.response?.status;
      const message = error.response?.data?.detail?.message || error.message;

      console.error(`❌ Key ke-${i + 1} Gagal. Status: ${status}. Pesan: ${message}`);
      lastError = message;

      // Cek apakah errornya karena KUOTA HABIS (429) atau KUNCI MATI (401)
      if (status === 401 || status === 429) {
        console.log("⚠️ Ganti ke kunci berikutnya...");
        continue; // Lanjut loop ke kunci berikutnya (i++)
      } else {
        // Jika errornya BUKAN masalah kuota (misal Teks kepanjangan, Server Down), berhenti mencoba.
        return res.status(status || 500).json({ 
          error: "Terjadi kesalahan pada ElevenLabs.", 
          details: message 
        });
      }
    }
  }

  // 4. JIKA SEMUA KUNCI SUDAH DICOBA DAN GAGAL
  return res.status(503).json({ 
    error: "Semua Kuota API Key Habis! Silakan tambah akun baru.",
    last_error: lastError
  });
};
