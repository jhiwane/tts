// api/generate.js
import axios from 'axios';

export default async function handler(req, res) {
  // Hanya izinkan method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { text, voice_id } = req.body;

  // 1. Ambil kunci dari Environment Variable Vercel
  // Format di Vercel nanti: ["key1", "key2", "key3"]
  let apiKeys = [];
  try {
    apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]');
  } catch (e) {
    return res.status(500).json({ error: "Konfigurasi API Key di server salah format." });
  }

  if (apiKeys.length === 0) {
    return res.status(500).json({ error: "Tidak ada API Key yang tersedia di server." });
  }

  // 2. Logika Rotasi Key
  let lastError = null;

  for (let i = 0; i < apiKeys.length; i++) {
    const currentKey = apiKeys[i];
    console.log(`Mencoba Key ke-${i + 1}...`);

    try {
      const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice_id || '21m00Tcm4TlvDq8ikWAM'}`, // Default suara Rachel
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
          responseType: 'arraybuffer' // Penting buat audio
        }
      );

      // Jika sukses, kirim audio balik ke frontend
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(response.data);

    } catch (error) {
      console.error(`Key ke-${i + 1} Gagal:`, error.response?.status);
      lastError = error;
      
      // Jika errornya 401 (Unauthorized) atau 429 (Quota Habis), lanjut ke key berikutnya
      // Jika error lain (misal 400 Bad Request), mungkin teksnya kosong, jangan lanjut loop
      if (error.response && (error.response.status === 401 || error.response.status === 429)) {
        continue; // Coba key berikutnya
      } else {
        break; // Stop loop, error bukan masalah kuota
      }
    }
  }

  // Jika loop selesai dan tidak ada yang berhasil
  return res.status(503).json({ 
    error: "Semua API Key habis kuota atau terjadi kesalahan.", 
    details: lastError?.message 
  });
}
