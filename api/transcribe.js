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
    const formData = new FormData();
    formData.append("file", audioBlob, "chunk.wav");
    formData.append("model", "whisper-1");
    formData.append("language", "es");
    formData.append("response_format", "verbose_json");
    
    // CORRECCIÓN AQUÍ: Mandar el parámetro limpio sin los corchetes en la llave para Node.js
    formData.append("timestamp_granularities", "word"); 

    const openAIResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: formData
    });

    const responseText = await openAIResponse.text();

    if (!openAIResponse.ok) {
      console.error("Error de OpenAI:", responseText);
      return res.status(openAIResponse.status).json({
        error: "Error al transcribir en OpenAI",
        detail: responseText
      });
    }

    const data = JSON.parse(responseText);
    
    // Retornamos una respuesta estructurada ideal para tu frontend
    return res.status(200).json({
      text: data.text,      // El texto corrido para tu textarea de edición
      words: data.words    // El array con los tiempos por palabra para la automatización
    });

  } catch (error) {
    console.error("Error del servidor:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      detail: error.message
    });
  }
}
