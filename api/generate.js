// api/generate.js
// Kita pakai 'require' biar lebih aman di server Node.js
const axios = require('axios');

module.exports = async (req, res) => {
  // Hanya izinkan method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, voice_id } = req.body;

  // 1. Ambil kunci dari Environment Variable
  let apiKeys = [];
  try {
    apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]');
  } catch (e) {
    // Jika format salah, kita pakai array kosong dulu biar gak crash
    console.error("Format ENV Error:", e);
    return res.status(500).json({ error: "Format API Key di server salah (Bukan JSON Array)." });
  }

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: "Tidak ada API Key yang ditemukan di Settings Vercel." });
  }

  // 2. Loop Rotasi Key
  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];
    console.log(`Mencoba Key ke-${i + 1}...`);

    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || '21m00Tcm4TlvDq8ikWAM'}`,
        {
          text: text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        },
        {
          headers: {
            'xi-api-key': currentKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      // Sukses! Kirim audio
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(response.data);

    } catch (error) {
      console.log(`Key ke-${i + 1} Gagal. Status: ${error.response?.status}`);
      // Jika 401 (Unauthorized) atau 429 (Habis Kuota), lanjut ke key berikutnya
      if (error.response && (error.response.status === 401 || error.response.status === 429)) {
        continue;
      } else {
        // Jika error lain (misal teks kosong), stop
        return res.status(500).json({ error: "Gagal generate suara: " + (error.response?.statusText || error.message) });
      }
    }
  }

  return res.status(503).json({ error: "Semua API Key habis kuota!" });
};
