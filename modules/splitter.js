import { $ } from '../script.js';
import { saveToLibrary } from './biblioteca.js'; // Conexión modular segura para guardar voz y pista
import { exportStereoWav } from './karaoke.js';    // Reutilización matemática del exportador para no duplicar código

/**
 * Muestra el resultado de la API directamente en el contenedor del Splitter
 */
export function showResult(url) {
  let container = document.getElementById("splitResult");

  if (!container) {
    container = document.createElement("div");
    container.id = "splitResult";
    container.style.marginTop = "20px";
    
    const splitterSection = document.getElementById("splitter");
    if (splitterSection) {
      splitterSection.appendChild(container);
    }
  }

  if (container) {
    container.innerHTML = `
      <p>✅ API respondió correctamente</p>
      <audio controls src="${url}"></audio>
      <br><br>
      <a href="${url}" download="resultado.mp3">
        <button>Descargar</button>
      </a>
    `;
  }
}

/**
 * Gestiona el casillero temporal de subida, despierta al modelo MDX23 en Replicate 
 * y reconstruye la pista estéreo instrumental balanceada sin fugas de memoria RAM.
 */
export async function splitAudio() {
  const fileInput = $("splitterFile");
  const file = fileInput?.files[0];

  if (!file) {
    alert("⚠️ Selecciona una canción primero.");
    return;
  }

  const btn = $("splitBtn");
  const statusBox = $("splitterStatusBox");
  const statusText = $("splitterStatusText");
  const detailText = $("splitterDetailText");

  if (btn) btn.disabled = true;
  if (statusBox) statusBox.style.display = "block";
  if (statusText) statusText.textContent = "1/4 📦 Subiendo canción...";
  if (detailText) detailText.textContent = "Enviando al casillero temporal seguro...";

  let audioCtxParaDecodificar = null; 

  try {
    const formData = new FormData();
    formData.append("file", file);

    const tmpResponse = await fetch("https://tmpfiles.org/api/v1/upload", {
      method: "POST",
      body: formData
    });

    const tmpData = await tmpResponse.json();
    if (!tmpData.data || !tmpData.data.url) {
      throw new Error("Error al subir al casillero temporal.");
    }

    const directUrl = tmpData.data.url.replace("tmpfiles.org/", "tmpfiles.org/dl/");

    if (statusText) statusText.textContent = "2/4 🚀 Iniciando Inteligencia Artificial...";
    if (detailText) detailText.textContent = "Despertando al modelo de alta calidad MDX23...";

    const startResponse = await fetch("/api/split", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl: directUrl })
    });

    const prediction = await startResponse.json();
    if (!startResponse.ok) {
      throw new Error(prediction.error || "Error al conectar con Replicate");
    }

    if (statusText) statusText.textContent = "3/4 ⏳ IA separando pistas...";

    const interval = setInterval(async () => {
      try {
        const checkResponse = await fetch(`/api/split?id=${prediction.id}`);
        const statusData = await checkResponse.json();

        if (statusData.status === "succeeded") {
          clearInterval(interval);

          if (statusText) statusText.textContent = "4/4 🎧 Armando la pista final...";
          if (detailText) detailText.textContent = "Mezclando bajo, batería y melodía en una sola pista instrumental...";

          const urls = statusData.output;
          let vocalUrl = null;
          let instUrls = [];

          if (Array.isArray(urls)) {
            urls.forEach(u => u.toLowerCase().includes("vocal") ? (vocalUrl = u) : instUrls.push(u));
            if (!vocalUrl) {
              vocalUrl = urls[0];
              instUrls = urls.slice(1);
            }
          } else {
            for (const [key, value] of Object.entries(urls)) {
              if (key.toLowerCase().includes("vocal")) vocalUrl = value;
              else instUrls.push(value);
            }
          }

          const resVoz = await fetch(vocalUrl);
          const blobVoz = await resVoz.blob();

          audioCtxParaDecodificar = new (window.AudioContext || window.webkitAudioContext)();
          const buffers = [];

          for (const url of instUrls) {
            const res = await fetch(url);
            const arrayBuffer = await res.arrayBuffer();
            const decodedBuffer = await audioCtxParaDecodificar.decodeAudioData(arrayBuffer);
            buffers.push(decodedBuffer);
          }

          const maxLength = Math.max(...buffers.map(b => b.length));
          const sampleRateDestino = buffers[0].sampleRate;

          const offlineCtx = new OfflineAudioContext(2, maxLength, sampleRateDestino);

          buffers.forEach(buffer => {
            const source = offlineCtx.createBufferSource();
            source.buffer = buffer;

            // CORRECCIÓN PROTECTORA ESTÉREO EXPLÍCITA
            if (buffer.numberOfChannels === 1) {
              const mergerMono = offlineCtx.createChannelMerger(2);
              source.connect(mergerMono, 0, 0);
              source.connect(mergerMono, 0, 1);
              mergerMono.connect(offlineCtx.destination);
            } else {
              source.connect(offlineCtx.destination);
            }

            source.start(0);
          });

          const renderedBuffer = await offlineCtx.startRendering();
          
          // REUTILIZACIÓN DE FUNCIÓN: Invocamos de forma cruzada el empaquetador del módulo Karaoke
          const blobPista = exportStereoWav(renderedBuffer);

          if (audioCtxParaDecodificar) {
            await audioCtxParaDecodificar.close();
            audioCtxParaDecodificar = null;
          }

          // Guardado asíncrono y cruzado en IndexedDB
          await saveToLibrary(blobVoz, { name: `Voz - ${file.name}`, type: "voz" });
          await saveToLibrary(blobPista, { name: `Pista - ${file.name}`, type: "pista" });

          if (statusText) statusText.textContent = "🎉 ¡Separación perfecta!";
          if (detailText) detailText.textContent = "Voz pura y Pista Instrumental guardadas en Biblioteca.";
          if (btn) {
            btn.disabled = false;
            btn.textContent = "✨ Separar Otra Canción";
          }
          
        } else if (statusData.status === "failed" || statusData.status === "canceled") {
          clearInterval(interval);
          throw new Error("La IA falló al procesar el audio.");
        } else {
          if (detailText) detailText.textContent = `Estado de la IA: ${statusData.status}... por favor espera.`;
        }
      } catch (pollError) {
        clearInterval(interval);
        console.error(pollError);
        if (statusText) statusText.textContent = "❌ Error detectado";
        if (detailText) detailText.textContent = pollError.message || "Revisa la consola.";
        if (btn) {
          btn.disabled = false;
          btn.textContent = "✨ Separar Audio con IA";
        }
        
        if (audioCtxParaDecodificar) {
          audioCtxParaDecodificar.close().catch(() => {});
          audioCtxParaDecodificar = null;
        }
      }
    }, 4000);
  } catch (err) {
    console.error(err);
    if (statusText) statusText.textContent = "❌ Error detectado";
    if (detailText) detailText.textContent = err.message || "Revisa la consola.";
    if (btn) {
      btn.disabled = false;
      btn.textContent = "✨ Separar Audio con IA";
    }
    
    if (audioCtxParaDecodificar) {
      audioCtxParaDecodificar.close().catch(() => {});
      audioCtxParaDecodificar = null;
    }
  }
}
