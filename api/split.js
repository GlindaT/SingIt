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
