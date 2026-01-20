// api/generate.js
const googleTTS = require('google-tts-api');
const axios = require('axios');

module.exports = async (req, res) => {
  // 1. KEAMANAN: Hanya izinkan Method POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  const { text, voice_id, provider, user_api_key } = req.body;

  // Validasi Input
  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong.' });
  }

  try {
    // ============================================================
    // OPSI A: PROVIDER GRATIS (GOOGLE TTS - STABIL & UNLIMITED)
    // ============================================================
    if (provider === 'google') {
      console.log(`🎤 Mode: Google TTS (${voice_id})`);

      // Google TTS punya limit 200 karakter per request.
      // Library ini otomatis memecah teks panjang menjadi potongan kalimat
      // lalu mengambil audio per potongan agar intonasi (titik/koma) tetap natural.
      const results = await googleTTS.getAllAudioBase64(text, {
        lang: voice_id,       // Kode bahasa (id, en, jw, su)
        slow: false,          // False = Kecepatan normal bicara manusia
        host: 'https://translate.google.com',
        timeout: 10000,       // Waktu tunggu maksimal 10 detik
        splitPunct: ',.?!'    // Memecah berdasarkan tanda baca agar napasnya pas
      });

      // Menggabungkan semua potongan audio (Base64) menjadi satu file utuh
      const combinedBuffer = Buffer.concat(
        results.map(item => Buffer.from(item.base64, 'base64'))
      );

      // Kirim hasil audio MP3
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(combinedBuffer);
    }

    // ============================================================
    // OPSI B: PROVIDER PREMIUM (ELEVENLABS - REALISTIS)
    // ============================================================
    else if (provider === 'elevenlabs') {
      console.log("🎤 Mode: ElevenLabs Premium");

      // --- LOGIKA MENENTUKAN KUNCI API ---
      let apiKeys = [];

      // Prioritas 1: Gunakan API Key milik User sendiri (jika diisi)
      if (user_api_key && user_api_key.length > 10) {
        console.log("👉 Menggunakan API Key User.");
        apiKeys = [user_api_key];
      } 
      // Prioritas 2: Gunakan API Key Server (Multi-Key Rotation)
      else {
        console.log("👉 Menggunakan Server Keys (Rotation).");
        try {
          apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]');
        } catch (e) {
          console.error("Format ENV Error:", e);
        }
      }

      if (apiKeys.length === 0) {
        return res.status(401).json({ 
          error: "Tidak ada API Key tersedia. Mohon masukkan API Key ElevenLabs Anda." 
        });
      }

      // --- LOOP ROTASI KUNCI (ESTAFET SYSTEM) ---
      let lastError = null;

      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        const isUserKey = (apiKeys.length === 1 && user_api_key); // Penanda kunci user

        try {
          // Request ke ElevenLabs API
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
              text: text,
              model_id: "eleven_multilingual_v2", // Model terbaik Bahasa Indonesia
              voice_settings: {
                // SETTINGAN KHUSUS AGAR REALISTIS & BERNYAWA
                stability: 0.40,       // 0.40 = Lebih ekspresif/emosional (tidak kaku)
                similarity_boost: 0.75,// 0.75 = Menjaga karakter suara asli
                style: 0.50,           // 0.50 = Gaya bicara natural (Model V2)
                use_speaker_boost: true // Meningkatkan volume dan kejelasan
              }
            },
            {
              headers: {
                'xi-api-key': currentKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer' // PENTING: Menerima binary audio
            }
          );

          // SUKSES
          console.log(`✅ Sukses dengan Key indeks ke-${i}`);
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(response.data);

        } catch (error) {
          // GAGAL
          const status = error.response?.status;
          const message = error.response?.data?.detail?.message || error.message;
          lastError = message;
          
          console.log(`❌ Key ke-${i} Gagal (${status}): ${message}`);

          // Jika ini Key User sendiri, langsung stop & error
          if (isUserKey) {
             return res.status(status || 500).json({ error: "API Key Anda bermasalah/habis kuota." });
          }

          // Jika Key Server Habis Kuota (429) atau Mati (401), lanjut ke kunci berikutnya
          if (status === 401 || status === 429) {
            continue; 
          } else {
            // Error lain (misal teks kepanjangan), stop loop
            return res.status(status || 500).json({ error: "ElevenLabs Error: " + message });
          }
        }
      }

      // Jika semua kunci habis
      return res.status(503).json({ 
        error: "Semua kuota server habis. Silakan gunakan API Key Anda sendiri.",
        details: lastError
      });
    }
    
    // Provider Tidak Dikenal
    else {
      return res.status(400).json({ error: "Provider suara tidak valid." });
    }

  } catch (globalError) {
    console.error("Critical Error:", globalError);
    return res.status(500).json({ error: "Server Error: " + globalError.message });
  }
};
