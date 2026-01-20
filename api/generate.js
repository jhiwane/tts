// api/generate.js
const axios = require('axios');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// --- FUNGSI RAHASIA: KONEKSI LANGSUNG KE EDGE TTS ---
async function generateEdgeAudio(text, voiceId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4');
    const requestId = uuidv4();
    let audioData = [];

    ws.on('open', () => {
      // 1. Kirim Konfigurasi Speech
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
      ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${JSON.stringify(configMsg)}`);

      // 2. Kirim SSML (Teks yang mau dibaca)
      // Format SSML standar Microsoft
      const ssml = `
        <speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>
          <voice name='${voiceId}'>
            <prosody pitch='+0Hz' rate='+0%'>${text}</prosody>
          </voice>
        </speak>
      `;
      ws.send(`X-Timestamp:${new Date().toString()}\r\nContent-Type:application/ssml+xml\r\nX-RequestId:${requestId}\r\nPath:ssml\r\n\r\n${ssml}`);
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // Cari header binary untuk memisahkan metadata dan audio murni
        const separator = "Path:audio\r\n";
        const textData = data.toString('latin1'); // Decode header
        
        if (textData.includes(separator)) {
            // Ambil data setelah header
            const headerIndex = textData.indexOf(separator) + separator.length;
            const audioPart = data.slice(headerIndex);
            audioData.push(audioPart);
        }
      }
    });

    ws.on('close', () => {
      // Gabungkan semua potongan audio jadi satu buffer
      if (audioData.length > 0) {
        resolve(Buffer.concat(audioData));
      } else {
        reject(new Error("Koneksi ditutup tanpa menghasilkan audio."));
      }
    });

    ws.on('error', (err) => {
      reject(err);
    });
  });
}

// --- HANDLER UTAMA VERCEL ---
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { text, voice_id, provider, user_api_key } = req.body;
  if (!text) return res.status(400).json({ error: 'Teks kosong.' });

  try {
    // ==========================================
    // OPSI A: EDGE TTS (GRATIS UNLIMITED)
    // ==========================================
    if (provider === 'edge') {
      console.log(`🎤 Edge TTS: ${voice_id}`);
      const audioBuffer = await generateEdgeAudio(text, voice_id);
      
      res.setHeader('Content-Type', 'audio/mpeg');
      return res.send(audioBuffer);
    }

    // ==========================================
    // OPSI B: ELEVENLABS (PREMIUM)
    // ==========================================
    else if (provider === 'elevenlabs') {
      console.log("🎤 ElevenLabs Premium");

      // Cek Key User vs Server
      let apiKeys = [];
      if (user_api_key && user_api_key.length > 10) {
        apiKeys = [user_api_key];
      } else {
        try { apiKeys = JSON.parse(process.env.ELEVENLABS_KEYS || '[]'); } catch (e) {}
      }

      if (apiKeys.length === 0) return res.status(401).json({ error: "API Key Kosong." });

      // Rotasi Key
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
          if (i === apiKeys.length - 1) throw err; // Lempar error jika ini kunci terakhir
          // Jika tidak, lanjut loop (continue)
        }
      }
    } else {
      return res.status(400).json({ error: "Provider tidak valid" });
    }

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({ error: "Gagal memproses: " + error.message });
  }
};
