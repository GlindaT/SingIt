export default async function handler(req, res) {
  const origin = req.headers.origin || req.headers.referer?.split('/').slice(0, 3).join('/') || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  try {
    const { audioBase64 } = req.body || {};
    if (!audioBase64) return res.status(400).json({ error: "Falta el audio" });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Falta configurar OPENAI_API_KEY" });

    const audioBuffer = Buffer.from(audioBase64, "base64");
    const audioBlob = new Blob([audioBuffer], { type: "audio/wav" });
    
    const formData = new FormData();
    formData.append("file", audioBlob, "chunk.wav");
    formData.append("model", "whisper-1");
    formData.append("language", "es");
    formData.append("response_format", "verbose_json");
    formData.append("timestamp_granularities", "word"); // Sintaxis limpia para servidores Vercel

    const openAIResponse = await fetch("https://openai.com", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData
    });

    const responseText = await openAIResponse.text();
    if (!openAIResponse.ok) {
      return res.status(openAIResponse.status).json({ error: "Error en OpenAI", detail: responseText });
    }

    const data = JSON.parse(responseText);
    return res.status(200).json({
      text: data.text,
      words: data.words || []
    });

  } catch (error) {
    return res.status(500).json({ error: "Error interno", detail: error.message });
  }
}
