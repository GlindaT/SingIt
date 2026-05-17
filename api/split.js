// api/splits.js
import Replicate from "replicate";

// Inicializa el cliente de Replicate con tu token guardado en las variables de entorno de Vercel
const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});

export default async function handler(req, res) {
  // 1. Configurar cabeceras CORS obligatorias
  res.setHeader('Access-Control-Allow-Origin', 'https://vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // 2. Responder con éxito inmediato al Preflight (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 3. Procesar la petición POST de separación de audio
  if (req.method === 'POST') {
    try {
      const { audioUrl } = req.body;

      if (!audioUrl) {
        return res.status(400).json({ error: "Falta la URL del archivo de audio (audioUrl)" });
      }

      console.log("🤖 Iniciando separación en Replicate para:", audioUrl);

      // 4. Ejecutar el modelo de Replicate (Ejemplo usando HTDemucs para separar voz/música)
      // Nota: Puedes cambiar el identificador del modelo si usas uno diferente en Replicate
      const output = await replicate.run(
        "zsxkib/htdemucs:94697cc6770db488f7292215c2ec448e9be2533b666a2e4e137f6a73562479e0",
        {
          input: {
            audio: audioUrl
          }
        }
      );

      console.log("✅ Separación completada con éxito");

      // 5. Devolver los enlaces de los archivos resultantes a tu frontend
      return res.status(200).json({ 
        success: true, 
        output: output // Replicate suele devolver un objeto con los links a 'vocals.mp3', 'drums.mp3', etc.
      });

    } catch (error) {
      console.error("❌ Error en la API de Replicate:", error);
      return res.status(500).json({ error: "Error interno procesando el audio: " + error.message });
    }
  }

  // Si intentan usar otro método HTTP no permitido
  return res.status(405).json({ error: "Método no permitido" });
}
