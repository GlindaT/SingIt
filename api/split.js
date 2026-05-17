export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  // 1. Configurar cabeceras CORS obligatorias
  res.setHeader('Access-Control-Allow-Origin', 'https://vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET'); // 💡 Agregamos GET aquí
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 2. Responder con éxito inmediato al Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.REPLICATE_API_TOKEN;

  // ==========================================
  // 🔀 FLUJO 1: CONSULTAR ESTADO (MÉTODO GET)
  // ==========================================
  if (req.method === 'GET') {
    try {
      // Obtenemos el ID de la predicción desde la URL (/api/split?id=...)
      const { id } = req.query;

      if (!id) {
        return res.status(400).json({ error: "Falta el ID de la predicción" });
      }

      // Consultamos directamente el estado de esa predicción en Replicate
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

      // Devolvemos el estado al frontend (succeeded, processing, failed, etc.)
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
      const { fileUrl } = req.body || {};
      
      if (!fileUrl) {
        return res.status(400).json({ error: "Falta la URL del archivo de audio (fileUrl)" });
      }

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

  // Si envían un método no soportado (ej. PUT, DELETE)
  return res.status(405).json({ error: 'Método no permitido' });
}
