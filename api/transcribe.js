export default async function handler(req, res) {
  // 💡 1. Configurar cabeceras CORS obligatorias al inicio
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/') || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 💡 2. Responder de inmediato con éxito a la verificación previa (Preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 💡 3. Validar el método permitido posterior
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const { audioBase64 } = req.body || {};

    if (!audioBase64) {
      return res.status(400).json({ error: "Falta el audio" });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Falta configurar OPENAI_API_KEY en el servidor" });
    }

    // Convertir base64 a binario
   const audioBuffer = Buffer.from(audioBase64, "base64");

    // Crear archivo compatible para enviar a OpenAI
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    // Dentro de tu api/transcribe.js, cuando preparas los datos para OpenAI:
    const formData = new FormData();
    formData.append("file", archivoAudioVoz); // Tu archivo de voz aislado
    formData.append("model", "whisper-1");

    // ¡IMPORTANTE! Añade estas dos líneas para activar la automatización:
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities[]", "word");

    // Al hacer el fetch a OpenAI:
    const openAiResponse = await fetch("https://openai.com", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });
    
    const data = await openAiResponse.json();

    // Ahora debes retornar al frontend tanto el texto como el array de palabras estructurado
    return res.status(200).json({
      text: data.text,
      words: data.words // <--- Esto le dará los milisegundos automáticos a tu frontend
      });
  
  } catch (error) {
    console.error("Error del servidor:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      detail: error.message
    });
  }
}
