export const config = {
  api: {
    bodyParser: {
      // CORRECCIÓN: Ampliamos el límite de tamaño a 100MB para evitar bloqueos con canciones largas
      sizeLimit: '100mb', 
    },
  },
};

export default async function handler(req, res) {
  // CORRECCIÓN: Leer dinámicamente el origen del cliente para no romper Localhost ni Dominios Personalizados
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // Responder de inmediato al Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    return res.status(500).json({ error: "Falta configurar la variable REPLICATE_API_TOKEN en el servidor." });
  }

  // ==========================================
  // 🔀 FLUJO 1: CONSULTAR ESTADO (MÉTODO GET)
  // ==========================================
  if (req.method === 'GET') {
    try {
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: "Falta el ID de la predicción" });
      }

      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({ error: data.detail || "Error al consultar Replicate" });
      }

      return res.status(200).json(data);

    } catch (e) {
      console.error("Error en flujo GET:", e);
      return res.status(500).json({ error: "Error interno al consultar el estado", detail: e.message });
    }
  }

  // ==========================================
  // 🚀 FLUJO 2: CREAR PREDICCIÓN (MÉTODO POST)
  // ==========================================
  if (req.method === 'POST') {
    try {
      // CORRECCIÓN: Parseo seguro del cuerpo JSON para evitar fallas si req.body no es un objeto válido
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
      }
      
      const { fileUrl } = body || {};
      
      if (!fileUrl) {
        return res.status(400).json({ error: "Falta la URL del archivo de audio (fileUrl)" });
      }

      // El modelo lucataco/mvsep-mdx23-music-separation procesa audio y devuelve las pistas separadas
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          version: "510b9b91aec1bfa7d634e6c06ee80c18492fb0fc06aa1474533fbda90dd3dba4", 
          input: { audio: fileUrl }
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
         return res.status(response.status).json({ error: data.detail || "Error en la cuenta de Replicate" });
      }

      return res.status(200).json(data);
    } catch (e) {
      console.error("Error en flujo POST:", e);
      return res.status(500).json({ error: "Error interno en el servidor", detail: e.message });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}



TRANSCRIBE

export default async function handler(req, res) {
  // 💡 1. Configurar cabeceras CORS obligatorias al inicio
  res.setHeader('Access-Control-Allow-Origin', 'https://vercel.app');
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
    formData.append("timestamp_granularities[]", "segment");

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
    return res.status(200).json(data);

  } catch (error) {
    console.error("Error del servidor:", error);
    return res.status(500).json({
      error: "Error interno del servidor",
      detail: error.message
    });
  }
}
