// api/generate.js
const googleTTS = require('google-tts-api');
const axios = require('axios');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST.' });
  }

  // Menangkap SEMUA parameter dari Frontend (termasuk settingan slider baru)
  const { 
      text, voice_id, provider, user_api_key, 
      stability, similarity_boost, style, use_speaker_boost 
  } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Teks tidak boleh kosong.' });
  }

  try {
    // ==========================================
    // GOOGLE TTS
    // ==========================================
    if (provider === 'google') {
      const results = await googleTTS.getAllAudioBase64(text, {
        lang: voice_id,
        slow: false, // Fitur speed dikontrol dari frontend (playbackRate)
        host: 'https://translate.google.com',
        timeout: 10000,
        splitPunct: ',.?!'
      });
      const combinedBuffer = Buffer.concat(results.map(item => Buffer.from(item.base64, 'base64')));
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(combinedBuffer);
    }

    // ==========================================
    // ELEVENLABS PREMIUM
    // ==========================================
    else if (provider === 'elevenlabs') {
      let apiKeys = [];

      // Pakai key user jika ada, jika tidak pakai dari Vercel Environment Variables
      if (user_api_key && user_api_key.length > 10) {
        apiKeys = [user_api_key];
      } else {
        try {
          if (process.env.ELEVENLABS_KEYS) {
            apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS);
          }
        } catch (e) { console.error("ENV Error:", e); }
      }

      if (apiKeys.length === 0) {
        return res.status(401).json({ error: "API Key kosong." });
      }

      let lastError = null;

      // Loop Rotasi API Key
      for (let i = 0; i < apiKeys.length; i++) {
        const currentKey = apiKeys[i];
        
        try {
          const response = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
              text: text,
              model_id: "eleven_multilingual_v2",
              voice_settings: {
                // Parameter Advanced yang kita tangkap dari Slider UI
                stability: stability !== undefined ? stability : 0.50,
                similarity_boost: similarity_boost !== undefined ? similarity_boost : 0.75,
                style: style !== undefined ? style : 0.00,
                use_speaker_boost: use_speaker_boost !== undefined ? use_speaker_boost : true
              }
            },
            {
              headers: {
                'xi-api-key': currentKey,
                'Content-Type': 'application/json'
              },
              responseType: 'arraybuffer'
            }
          );

          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(response.data);

        } catch (error) {
          const status = error.response?.status;
          let errorMessage = error.message;

          if (error.response && error.response.data) {
             try {
                const errorStr = Buffer.from(error.response.data).toString('utf8');
                errorMessage = JSON.parse(errorStr).detail?.message || errorMessage;
             } catch(e) {}
          }
          
          lastError = errorMessage;

          // Jika ini inputan user manual, langsung tolak jika error
          if (apiKeys.length === 1 && user_api_key) {
             return res.status(status || 500).json({ error: errorMessage });
          }

          // Lanjut ke API Key berikutnya di server jika kena limit
          if (status === 401 || status === 429) continue; 
          else return res.status(status || 500).json({ error: errorMessage });
        }
      }

      return res.status(503).json({ error: "Semua kuota server habis.", details: lastError });
    }

  } catch (err) {
    return res.status(500).json({ error: "Server Error: " + err.message });
  }
};
