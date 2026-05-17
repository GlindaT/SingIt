export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb', // Mantenemos el límite por seguridad en la API
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

  // 3. Validar el método de la petición
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const token = process.env.REPLICATE_API_TOKEN;

  try {
    // 💡 CAMBIO CLAVE: Ahora leemos 'fileUrl' enviado por script.js en lugar de Base64
    const { fileUrl } = req.body || {};
    
    // Validamos que la URL exista
    if (!fileUrl) {
      return res.status(400).json({ error: "Falta la URL del archivo de audio (fileUrl)" });
    }

    // Llamada directa a la API oficial de Replicate
    // 💡 Nota: Asegúrate de usar el endpoint correcto de predicciones: https://api.replicate.com/v1/predictions
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        version: "510b9b91aec1bfa7d634e6c06ee80c18492fb0fc06aa1474533fbda90dd3dba4", 
        input: { 
          // 💡 Enviamos la URL directa generada por tmpfiles.org
          audio: fileUrl 
        }
      })
    });
    
    const data = await response.json();
    
    if (!response.ok) {
       return res.status(response.status).json({ error: data.detail || "Error en la cuenta de Replicate" });
    }

    // Retornamos la respuesta de Replicate (que incluye el .id para el sondeo/polling)
    return res.status(200).json(data);
  } catch (e) {
    console.error("Error en servidor:", e);
    return res.status(500).json({ error: "Error interno en el servidor", detail: e.message });
  }
}
