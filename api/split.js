// Usamos el formato que Vercel espera en esta configuración
module.exports = async function handler(req, res) {
  // 💡 1. Configurar cabeceras CORS obligatorias al principio de TODO
  res.setHeader('Access-Control-Allow-Origin', 'https://vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 💡 2. Responder con éxito inmediato a la petición de control previa del navegador (Preflight)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const token = process.env.REPLICATE_API_TOKEN;

  if (req.method === 'GET') {
    const { id } = req.query;
    try {
      const response = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ error: "Error conectando con Replicate" });
    }
  }

  if (req.method === 'POST') {
    // 💡 Puedes usar fileUrl o audioUrl según lo que envíe tu script.js (en tu código usabas fileUrl)
    const { fileUrl } = req.body;
    
    if (!fileUrl) {
      return res.status(400).json({ error: "Falta la URL del archivo de audio (fileUrl)" });
    }
    
    try {
      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          // Versión del modelo para separar pistas de audio
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
      return res.status(500).json({ error: "Error interno en el servidor" });
    }
  }

  return res.status(405).json({ error: 'Método no permitido' });
}
