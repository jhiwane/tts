// api/generate.js
// Menggunakan 'require' agar kompatibel penuh dengan Vercel & Node.js
const axios = require('axios');
const { MsEdgeTTS, OUTPUT_FORMAT } = require('ms-edge-tts');

module.exports = async (req, res) => {
  // 1. KEAMANAN & VALIDASI
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  const { text, voice_id, provider, user_api_key } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong.' });
  }

  try {
    // ============================================================
    // OPSI A: PROVIDER GRATIS (EDGE TTS - MICROSOFT)
    // ============================================================
    if (provider === 'edge') {
      console.log(`🎤 Mode: Edge TTS (Gratis Unlimited) - Voice: ${voice_id}`);
      
      const tts = new MsEdgeTTS();
      
      // Menggunakan format audio kualitas tinggi
      await tts.setMetadata(voice_id, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      
      // Generate Stream
      const filePath = await tts.toStream(text);
      
      // Kirim langsung ke frontend sebagai stream audio
      res.setHeader('Content-Type', 'audio/mpeg');
      return filePath.pipe(res);
    }

    // ============================================================
    // OPSI B: PROVIDER PREMIUM (ELEVENLABS)
    // ============================================================
    else if (provider === 'elevenlabs') {
      console.log("🎤 Mode: ElevenLabs Premium");

      // --- LOGIKA MENENTUKAN KUNCI API ---
      let apiKeys = [];

      // Skenario 1: User bawa kunci sendiri (Prioritas Utama)
      if (user_api_key && user_api_key.length > 10) {
        console.log("👉 Menggunakan API Key dari User.");
        apiKeys = [user_api_key];
      } 
      // Skenario 2: User tidak bawa kunci, gunakan cadangan Server (Multi-Key Rotation)
      else {
        console.log("👉 Menggunakan Multi-Key Rotation dari Server.");
        try {
          apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]');
        } catch (e) {
          console.error("Format ENV Error:", e);
        }
      }

      if (apiKeys.length === 0) {
        return res.status(401).json({ 
          error: "Tidak ada API Key tersedia. Masukkan Key Anda sendiri atau atur server keys." 
        });
      }

      // --- LOOPING / ROTASI KUNCI (ESTAFET SYSTEM) ---
      let lastError = null;

      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        const isUserKey = (apiKeys.length === 1 && user_api_key); // Cek apakah ini key user
        
        console.log(`🔄 Mencoba Request ElevenLabs... (Percobaan ${i + 1})`);

        try {
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
              text: text,
              model_id: "eleven_multilingual_v2", // Model terbaik Bahasa Indonesia
              voice_settings: {
                // SETTINGAN KHUSUS AGAR REALISTIS & MANUSIAWI
                stability: 0.40,       // Agak rendah (0.4) agar lebih emosional/tidak robot
                similarity_boost: 0.75,// Menjaga kemiripan karakter suara
                style: 0.50,           // (V2 Only) Menambah gaya bicara natural
                use_speaker_boost: true // Meningkatkan volume dan kejelasan
              }
            },
            {
              headers: {
                'xi-api-key': currentKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer' // PENTING: Terima sebagai file audio
            }
          );

          // JIKA SUKSES
          console.log("✅ Berhasil Generate via ElevenLabs!");
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(response.data);

        } catch (error) {
          // JIKA GAGAL
          const status = error.response?.status;
          const message = error.response?.data?.detail?.message || error.message;
          console.error(`❌ Gagal. Status: ${status}. Pesan: ${message}`);
          
          lastError = message;

          // Jika ini Key User sendiri, jangan rotasi, langsung error
          if (isUserKey) {
             return res.status(status || 500).json({ error: "API Key Anda bermasalah/habis kuota." });
          }

          // Jika Key Server Habis Kuota (429) atau Mati (401), lanjut loop ke key berikutnya
          if (status === 401 || status === 429) {
            continue; 
          } else {
            // Error lain (misal teks kepanjangan), stop loop
            return res.status(status || 500).json({ error: "ElevenLabs Error: " + message });
          }
        }
      }

      // Jika loop selesai tapi tidak ada yang berhasil
      return res.status(503).json({ 
        error: "Semua kuota Server habis. Silakan gunakan API Key Anda sendiri.",
        details: lastError
      });
    }
    
    // Jika Provider tidak dikenali
    else {
      return res.status(400).json({ error: "Provider suara tidak valid." });
    }

  } catch (globalError) {
    console.error("Critical Error:", globalError);
    return res.status(500).json({ error: "Internal Server Error: " + globalError.message });
  }
};
