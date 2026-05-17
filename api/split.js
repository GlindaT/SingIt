export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // 💡 Permite subir canciones de hasta 10MB
    },
  },
};

export default async function handler(req, res) {
  // 1. Configurar cabeceras CORS obligatorias
  res.setHeader('Access-Control-Allow-Origin', 'https://vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 2. Responder con éxito inmediato al Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  try {
    // 💡 Recibimos el archivo convertido en un string Base64 desde el frontend
    const { audioBase64, mimeType } = req.body || {};
    
    if (!audioBase64) {
      return res.status(400).json({ error: "Falta el archivo de audio en formato Base64" });
    }

    // 💡 Replicate permite pasar archivos pequeños directamente como Data URI convertidos en Base64
    const dataUri = `data:${mimeType || 'audio/mpeg'};base64,${audioBase64}`;

    // Llamada directa a la API de Replicate
    const response = await fetch("https://replicate.com", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "510b9b91aec1bfa7d634e6c06ee80c18492fb0fc06aa1474533fbda90dd3dba4", 
        input: { audio: dataUri } // Pasamos el Data URI codificado
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
       return res.status(response.status).json({ error: data.detail || "Error en la cuenta de Replicate" });
    }

    return res.status(200).json(data);
  } catch (e) {
    console.error("Error en servidor:", e);
    return res.status(500).json({ error: "Error interno en el servidor", detail: e.message });
  }
}
