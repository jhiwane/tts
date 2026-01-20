// api/generate.js
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// --- FUNGSI RAHASIA: KONEKSI EDGE TTS (ANTI-403) ---
async function generateEdgeAudio(text, voiceId) {
  return new Promise((resolve, reject) => {
    
    // 1. FORMAT WAKTU (Penting untuk penyamaran)
    const date = new Date().toString();
    
    // 2. KONEKSI WEBSOCKET DENGAN PENYAMARAN (HEADERS)
    // Kita menyamar sebagai Extension Edge Resmi agar tidak kena 403
    const ws = new WebSocket(
      'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
      {
        headers: {
          'Pragma': 'no-cache',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
          'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold', // ID Ekstensi Resmi Microsoft
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      }
    );

    const requestId = uuidv4();
    let audioData = [];

    ws.on('open', () => {
      // Kirim Konfigurasi (Audio Format High Quality)
      const configMsg = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
              outputFormat: "audio-24khz-48kbitrate-mono-mp3" 
            }
          }
        }
      };
      
      // Kirim Header Config
      ws.send(`X-Timestamp:${date}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(configMsg)}`);

      // Kirim Teks (SSML)
      const ssml = `
        <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='id-ID'>
          <voice name='${voiceId}'>
            <prosody pitch='+0Hz' rate='+0%'>${text}</prosody>
          </voice>
        </speak>
      `;
      
      // Kirim Header SSML
      ws.send(`X-Timestamp:${date}\r\nContent-Type:application/ssml+xml\r\nX-RequestId:${requestId}\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Pisahkan Header biner dari Audio biner
        const separator = "Path:audio\r\n";
        const content = data.toString('latin1'); // Decode kasar untuk cari header
        
        if (content.includes(separator)) {
            const headerIndex = content.indexOf(separator) + separator.length;
            // Ambil sisa data setelah header sebagai audio murni
            const audioPart = data.slice(headerIndex);
            audioData.push(audioPart);
        }
      }
    });

    ws.on('close', () => {
      if (audioData.length > 0) {
        resolve(Buffer.concat(audioData));
      } else {
        reject(new Error("Koneksi ditutup server tapi tidak ada audio yang diterima."));
      }
    });

    ws.on('error', (err) => {
      console.error("WebSocket Error:", err);
      reject(new Error(`Gagal koneksi ke Microsoft Edge: ${err.message}`));
    });
  });
}

// --- CONTROLLER UTAMA ---
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { text, voice_id, provider, user_api_key } = req.body;
  if (!text) return res.status(400).json({ error: 'Teks tidak boleh kosong.' });

  try {
    // === 1. MODE GRATIS (EDGE TTS - SUARA MBAK GOOGLE/TIKTOK) ===
    if (provider === 'edge') {
      console.log(`🎤 Generating Edge TTS: ${voice_id}`);
      
      const audioBuffer = await generateEdgeAudio(text, voice_id);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(audioBuffer);
    }

    // === 2. MODE PREMIUM (ELEVENLABS) ===
    else if (provider === 'elevenlabs') {
      console.log("🎤 Generating ElevenLabs...");

      // Cek Kunci API (User atau Server)
      let apiKeys = [];
      if (user_api_key && user_api_key.length > 10) {
        apiKeys = [user_api_key];
      } else {
        try { apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]'); } catch (e) {}
      }

      if (apiKeys.length === 0) return res.status(401).json({ error: "API Key Kosong. Masukkan Key Anda." });

      // Rotasi Kunci
      for (let i = 0; i < apiKeys.length; i++) {
        const key = apiKeys[i];
        try {
          const resp = await axios.post(
            `https://api.elevenlabs.io/v1/text-to-speech/${voice_id}`,
            {
              text: text,
              model_id: "eleven_multilingual_v2",
              voice_settings: { stability: 0.40, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true }
            },
            {
              headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
              responseType: 'arraybuffer'
            }
          );
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(resp.data);
        } catch (err) {
          if (i === apiKeys.length - 1) throw err; // Jika kunci terakhir gagal, lempar error
        }
      }
    } else {
      return res.status(400).json({ error: "Provider suara tidak valid." });
    }

  } catch (error) {
    console.error("SERVER ERROR:", error.message);
    return res.status(500).json({ error: error.message });
  }
};
