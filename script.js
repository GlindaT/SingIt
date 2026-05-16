// =========================================================================
// BLOQUE 1: CONFIGURACIÓN GLOBAL Y ESTADO DE LA APP
// =========================================================================
const state = {
    isRecording: false,
    instrumentalUrl: null,
    letraLrc: "",
    db: null
};

// Variables para el procesamiento y detección de notas (Afinador)
let audioContext = null;
let analyser = null;
let stream = null;
const pitchBuffer = new Float32Array(2048);
let pitchHistory = [];

// Variables para el Estudio y Grabación de voz
let studioMediaRecorder = null;
let studioStream = null;
let studioChunks = [];
let studioRecordedBlob = null;

// Variables para el reconocimiento de voz (Texto a Chunks)
let recognition = null;
let transcriptionSegments = [];
let baseTranscriptionSegments = [];

// Variables para el sistema de Sincronización por Taps (TapSync)
let tapSyncMode = false;
let tapSyncLines = [];
let tapSyncTimestamps = [];
let tapSyncCurrentIndex = 0;

// Historial para dibujar la línea de voz en el Monitor de Karaoke
let voiceHistory = new Array(100).fill(-1);

// Funciones útiles de acceso rápido y seguro al HTML
function $(id) { 
    return document.getElementById(id); 
}

function safeAdd(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
}

// =========================================================================
// BLOQUE 2: ARRANQUE E INICIALIZACIÓN (DOMContentLoaded)
// =========================================================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("⚙️ Inicializando componentes de SingIt...");
        
        // 1. Conexión segura de los botones del HTML con sus funciones
        safeAdd("recordBtn", "click", toggleAfinadorBtn);       // Botón Afinador
        safeAdd("startStudioRecBtn", "click", startStudioRecording); // Iniciar Grabación Estudio
        safeAdd("stopStudioRecBtn", "click", stopStudioRecording);   // Detener Grabación Estudio
        safeAdd("saveStudioRecBtn", "click", saveStudioRecording);   // Guardar Grabación Estudio
        
        // Evento para el selector de canciones en Karaoke
        safeAdd("karaokeTrackSelect", "change", cargarCancionKaraoke);

        // 2. Cargar datos iniciales desde Supabase a tus menús desplegables
        await loadTrackOptionsInStudio();
        await loadTrackOptionsInKaraoke();
        
        console.log("🚀 ¡SingIt está en marcha y listo para usar!");
    } catch (err) {
        console.error("❌ Error durante el arranque de la app:", err);
    }
});

// =========================================================================
// BLOQUE 3: CONEXIÓN CON LA NUBE (SUPABASE)
// =========================================================================

// Descarga todos los ítems guardados en la tabla de tu base de datos
async function getLibraryItems(type = null) {
    if (typeof supabaseClient === 'undefined') {
        console.error("❌ Error de comunicación: 'supabaseClient' no está definido en tu proyecto.");
        return [];
    }
    let query = supabaseClient.from("library_items").select("*");
    if (type) {
        query = query.eq("type", type);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
        console.error("❌ Error al leer datos de Supabase:", error);
        return [];
    }
    return data || [];
}

// Llena el selector de pistas de la pestaña Estudio
async function loadTrackOptionsInStudio() {
    const tracks = await getLibraryItems();
    const select = $("studioTrackSelect");
    if (select) {
        select.innerHTML = '<option value="">-- Selecciona una pista base --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = track.file_url;
            opt.textContent = track.name;
            select.appendChild(opt);
        });
    }
}

// Llena el selector de canciones en la pestaña Karaoke
async function loadTrackOptionsInKaraoke() {
    const tracks = await getLibraryItems();
    const select = $("karaokeTrackSelect");
    if (select) {
        select.innerHTML = '<option value="">-- Elige una canción para cantar --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = JSON.stringify(track); // Guardamos todo el objeto convertido a texto
            opt.textContent = track.name;
            select.appendChild(opt);
        });
    }
}

// =========================================================================
// BLOQUE 4: MÓDULO DEL AFINADOR (DETECCIÓN DE PITCH)
// =========================================================================
async function toggleAfinadorBtn() {
    const btn = $("recordBtn");
    if (!state.isRecording) {
        state.isRecording = true;
        if (btn) {
            btn.textContent = "🛑 Detener Afinador";
            btn.style.background = "#ef4444";
        }
        await startAfinadorProcesamiento();
    } else {
        state.isRecording = false;
        if (btn) {
            btn.textContent = "🎤 Iniciar Afinador";
            btn.style.background = "";
        }
        stopAfinadorProcesamiento();
    }
}

async function startAfinadorProcesamiento() {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const micSource = audioContext.createMediaStreamSource(stream);
    
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    micSource.connect(analyser);
    
    bucleDeteccionPitch();
}

function stopAfinadorProcesamiento() {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (audioContext) audioContext.close();
    const display = $("noteDisplay");
    if (display) display.textContent = "--";
}

function bucleDeteccionPitch() {
    if (!state.isRecording || !analyser) return;

    analyser.getFloatTimeDomainData(pitchBuffer);
    const pitch = autoCorrelateMath(pitchBuffer, audioContext.sampleRate);
    
    // NOTA OBJETIVO: Por defecto usamos un LA (440Hz), cambiará dinámicamente con la letra
    let objetivoFreq = 440; 
    
    // Mandar datos en tiempo real al Pentagrama / Monitor Gráfico
    drawKaraokeMonitor(pitch, objetivoFreq);

    const display = $("noteDisplay");
    if (display && pitch !== -1) {
        display.textContent = getNoteNameFromFreq(pitch);
    }
    
    requestAnimationFrame(bucleDeteccionPitch);
}

// =========================================================================
// BLOQUE 5: MÓDULO DE ESTUDIO (GRABACIÓN + CHUNKS DE VOZ A TEXTO)
// =========================================================================
async function startStudioRecording() {
    try {
        studioChunks = [];
        transcriptionSegments = [];
        
        studioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        studioMediaRecorder = new MediaRecorder(studioStream);
        
        studioMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) studioChunks.push(e.data);
        };

        // Activamos el motor de dictado por Inteligencia Artificial integrada
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let interimText = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        transcriptionSegments.push({
                            text: event.results[i][0].transcript,
                            timestamp: Date.now()
                        });
                    } else {
                        interimText += event.results[i][0].transcript;
                    }
                }
                // Proyección en tiempo real en la pantalla
                if ($("studioStatus")) {
                    $("studioStatus").innerHTML = `🎤 Escribiendo Chunks: <span style="color: #22c55e; font-weight: bold;">${interimText}</span>`;
                }
            };
            recognition.start();
        }

        studioMediaRecorder.start();
        $("startStudioRecBtn").disabled = true;
        $("stopStudioRecBtn").disabled = false;

    } catch (err) {
        console.error("Error al iniciar grabación en estudio:", err);
    }
}

function stopStudioRecording() {
    if (studioMediaRecorder) studioMediaRecorder.stop();
    if (recognition) recognition.stop();
    if (studioStream) studioStream.getTracks().forEach(t => t.stop());

    if (studioMediaRecorder) {
        studioMediaRecorder.onstop = () => {
            studioRecordedBlob = new Blob(studioChunks, { type: 'audio/webm' });
            if ($("voicePlayer")) {
                $("voicePlayer").src = URL.createObjectURL(studioRecordedBlob);
            }
            $("studioStatus").textContent = "✅ Grabación y bloques de transcripción listos.";
        };
    }

    $("startStudioRecBtn").disabled = false;
    $("stopStudioRecBtn").disabled = true;
}

async function saveStudioRecording() {
    if (!studioRecordedBlob) return alert("No has grabado nada todavía.");
    const name = prompt("Escribe el nombre para tu canción/registro:");
    if (!name) return;

    try {
        $("studioStatus").textContent = "⏳ Subiendo archivo y letra sincronizada...";
        const pathName = `audio_${Date.now()}.webm`;

        // 1. Guardar archivo binario en Storage de Supabase
        const { error: sErr } = await supabaseClient.storage.from("library").upload(pathName, studioRecordedBlob);
        if (sErr) throw sErr;

        // 2. Obtener enlace de reproducción pública
        const { data: urlData } = supabaseClient.storage.from("library").getPublicUrl(pathName);

        // 3. Crear registro completo con chunks de texto
        const { error: dbErr } = await supabaseClient.from("library_items").insert([{
            name: name,
            type: 'vocal',
            file_url: urlData.publicUrl,
            file_path: pathName,
            transcription: transcriptionSegments
        }]);

        if (dbErr) throw dbErr;
        
        $("studioStatus").textContent = "✅ Guardado exitosamente en tu nube.";
        alert("¡Canción almacenada correctamente!");
    } catch (err) {
        console.error(err);
        alert("Fallo al guardar en la base de datos.");
    }
}

// =========================================================================
// BLOQUE 6: MONITOR DE KARAOKE (PENTAGRAMA, LÍNEA VERDE BRILLANTE Y BARRA AZUL)
// =========================================================================
function drawKaraokeMonitor(currentPitch, targetPitch) {
    const canvas = $("karaokeCanvas");
    if (!canvas) return; // Si no hay lienzo en pantalla, frenar dibujo para evitar lentitud
    
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    
    // 1. Fondo del lienzo
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111827"; 
    ctx.fillRect(0, 0, W, H);
    
    // 2. Dibujo de las 5 líneas del PENTAGRAMA musical
    ctx.strokeStyle = "#4b5563"; 
    ctx.lineWidth = 1;
    const spaceBetweenLines = H / 6;
    for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * spaceBetweenLines);
        ctx.lineTo(W, i * spaceBetweenLines);
        ctx.stroke();
    }
    
    // 3. Dibujo de la BARRA GUÍA AZUL (Nota Objetivo de la canción)
    if (targetPitch > 0) {
        const targetY = conversionFreqAPixelY(targetPitch, H);
        
        ctx.fillStyle = "rgba(59, 130, 246, 0.35)"; // Azul translúcido
        ctx.fillRect(0, targetY - 12, W, 24);
        
        ctx.strokeStyle = "#3b82f6"; // Línea guía azul fija
        ctx.lineWidth = 2;
        ctx.strokeRect(0, targetY - 12, W, 24);
    }
    
    // 4. Cola de rastro de tu voz (Desplazamiento horizontal continuo)
    voiceHistory.shift();
    voiceHistory.push(currentPitch);
    
    ctx.lineWidth = 4;
    ctx.beginPath();
    
    for (let i = 0; i < voiceHistory.length; i++) {
        const pitchItem = voiceHistory[i];
        if (pitchItem <= 0) continue; 
        
        const posX = (i / (voiceHistory.length - 1)) * W;
        const posY = conversionFreqAPixelY(pitchItem, H);
        
        // --- LOGICA DE PRECISIÓN: VERDE EN NOTA / AMARILLO FUERA DE NOTA ---
        if (targetPitch > 0 && Math.abs(1200 * Math.log2(pitchItem / targetPitch)) < 25) {
            ctx.strokeStyle = "#22c55e"; // ¡Acertaste! Verde Neón 🎯
            ctx.shadowBlur = 12;
            ctx.shadowColor = "#22c55e"; 
        } else {
            ctx.strokeStyle = "#eab308"; // Desafinado: Amarillo ⚠️
            ctx.shadowBlur = 0;
        }
        
        if (i === 0) ctx.moveTo(posX, posY);
        else ctx.lineTo(posX, posY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; // Apagar efectos neón tras procesar la línea de voz
}

function conversionFreqAPixelY(freq, canvasHeight) {
    const fMin = 70;  // Límite voz grave grave
    const fMax = 700; // Límite voz aguda cantante
    if (freq < fMin) freq = fMin;
    if (freq > fMax) freq = fMax;
    const ratio = Math.log2(freq / fMin) / Math.log2(fMax / fMin);
    return canvasHeight - (ratio * canvasHeight); 
}

// =========================================================================
// BLOQUE 7: CARGAR CANCIÓN DESDE KARAOKE Y SINCRONIZACIÓN POR TAPS
// =========================================================================
function cargarCancionKaraoke(event) {
    if (!event.target.value) return;
    const songObj = JSON.parse(event.target.value);
    
    const audioPlayer = $("karaokePlayer");
    if (audioPlayer) {
        audioPlayer.src = songObj.file_url;
        audioPlayer.load();
    }
    
    // Si la canción cuenta con letra en formato chunk, la inyectamos para cantar
    if (Array.isArray(songObj.transcription)) {
        transcriptionSegments = songObj.transcription;
        baseTranscriptionSegments = [...songObj.transcription];
        
        // Si hay un contenedor de letra en tu HTML, la mostramos en crudo
        if ($("lyricsDisplay")) {
            $("lyricsDisplay").innerHTML = transcriptionSegments.map(seg => `<span>${seg.text}</span>`).join(" ");
        }
    }
    
    if ($("studioStatus")) {
        $("studioStatus").textContent = `🎵 "${songObj.name}" montada en el reproductor.`;
    }
}

// =========================================================================
// BLOQUE 8: LÓGICA MATEMÁTICA INTERNA (AUTOCORRELACIÓN Y AJUSTES DE AUDIO)
// =========================================================================
function autoCorrelateMath(buf, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) {
        rms += buf[i] * buf[i];
    }
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.015) return -1; // Descartar ruidos de fondo suaves

    let r1 = 0, r2 = buf.length - 1;
    const thres = 0.2;
    for (let i = 0; i < buf.length / 2; i++) {
        if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = buf.length - 1; i >= buf.length / 2; i--) {
        if (Math.abs(buf[i]) < thres) { r2 = i; break; }
    }

    const bufSlice = buf.subarray(r1, r2);
    const c = new Float32Array(bufSlice.length);
    for (let i = 0; i < bufSlice.length; i++) {
        for (let j = 0; j < bufSlice.length - i; j++) {
            c[i] += bufSlice[j] * bufSlice[j + i];
        }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < c.length; i++) {
        if (c[i] > maxval) {
            maxval = c[i];
            maxpos = i;
        }
    }

    let T0 = maxpos;
    if (maxpos !== -1) {
        const frequency = sampleRate / T0;
        if (frequency > 65 && frequency < 1000) {
            return frequency;
        }
    }
    return -1;
}

function getNoteNameFromFreq(freq) {
    const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const formulaVal = Math.round(12 * Math.log2(freq / 440));
    const normalizedIndex = (formulaVal + 57) % 12;
    const octave = Math.floor((formulaVal + 57) / 12);
    return noteStrings[normalizedIndex] + octave;
}
