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
    // OPSI A: PROVIDER GRATIS (GOOGLE TTS)
    // ============================================================
    if (provider === 'google') {
      console.log(`🎤 Mode: Google TTS (${voice_id})`);

      const results = await googleTTS.getAllAudioBase64(text, {
        lang: voice_id,
        slow: false,
        host: 'https://translate.google.com',
        timeout: 10000,
        splitPunct: ',.?!'
      });

      const combinedBuffer = Buffer.concat(
        results.map(item => Buffer.from(item.base64, 'base64'))
      );

      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(combinedBuffer);
    }

    // ============================================================
    // OPSI B: PROVIDER PREMIUM (ELEVENLABS)
    // ============================================================
    else if (provider === 'elevenlabs') {
      console.log("🎤 Mode: ElevenLabs Premium");

      // PERBAIKAN 1: Teks API Key WAJIB menggunakan tanda kutip ("")
      let apiKeys = ["sk_4864bd6f9c07410dbe4892fee904f32b6385408576fbd131"];

      if (user_api_key && user_api_key.length > 10) {
        console.log("👉 Menggunakan API Key User.");
        apiKeys = [user_api_key];
      } else {
        console.log("👉 Menggunakan Server Keys.");
        try {
          if(process.env.ELEVENLABS_KEYS) {
            const envKeys = JSON.parse(process.env.ELEVENLABS_KEYS);
            if(envKeys.length > 0) apiKeys = envKeys;
          }
        } catch (e) {
          console.error("Format ENV Error:", e);
        }
      }

      if (apiKeys.length === 0) {
        return res.status(401).json({ error: "Tidak ada API Key tersedia." });
      }

      let lastError = null;

      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        const isUserKey = (apiKeys.length === 1 && user_api_key);

        try {
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
              text: text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                stability: 0.40,
                similarity_boost: 0.75,
                style: 0.50,
                use_speaker_boost: true
              }
            },
            {
              headers: {
                'xi-api-key': currentKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer' // Meminta format binary mp3
            }
          );

          console.log(`✅ Sukses dengan Key indeks ke-${i}`);
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(response.data);

        } catch (error) {
          const status = error.response?.status;
          let errorMessage = error.message;

          // PERBAIKAN 2: Decode pesan error karena responseType = 'arraybuffer'
          if (error.response && error.response.data) {
             try {
                const errorStr = Buffer.from(error.response.data).toString('utf8');
                const errorJson = JSON.parse(errorStr);
                errorMessage = errorJson.detail?.message || errorJson.detail || errorMessage;
             } catch(e) {}
          }
          
          lastError = errorMessage;
          console.log(`❌ Key ke-${i} Gagal (${status}): ${errorMessage}`);

          if (isUserKey) {
             return res.status(status || 500).json({ error: "Gagal: " + errorMessage });
          }

          if (status === 401 || status === 429) {
            continue; 
          } else {
            return res.status(status || 500).json({ error: "ElevenLabs Error: " + errorMessage });
          }
        }
      }

      return res.status(503).json({ 
        error: "Semua kuota server habis.",
        details: lastError
      });
    }
    
    else {
      return res.status(400).json({ error: "Provider tidak valid." });
    }

  } catch (globalError) {
    console.error("Critical Error:", globalError);
    return res.status(500).json({ error: "Server Error: " + globalError.message });
  }
};
