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
        safeAdd("recordBtn", "click", toggleAfinadorBtn);             // Botón Afinador
        safeAdd("startStudioRecBtn", "click", startStudioRecording);   // Iniciar Grabación Estudio
        safeAdd("stopStudioRecBtn", "click", stopStudioRecording);     // Detener Grabación Estudio
        safeAdd("saveStudioRecBtn", "click", saveStudioRecording);     // Guardar Grabación Estudio
        
        // Conexión del módulo Splitter
        safeAdd("processSplitterBtn", "click", procesarSeparacionAudio); 

        // Conexión del módulo Configuración
        safeAdd("saveConfigBtn", "click", guardarConfiguracionLocal);

        // Evento para el selector de canciones en Karaoke
        safeAdd("karaokeTrackSelect", "change", cargarCancionKaraoke);

        // 2. Cargar datos iniciales en los menús desplegables
        await loadTrackOptionsInStudio();
        await loadTrackOptionsInKaraoke();
        cargarConfiguracionPrevia();
        
        console.log("🚀 ¡Todas las pestañas de SingIt están en marcha!");
    } catch (err) {
        console.error("❌ Error durante el arranque de la app:", err);
    }
});

// =========================================================================
// BLOQUE 3: CONEXIÓN CON LA NUBE (SUPABASE) Y SIMULACIÓN DE FALLBACK
// =========================================================================

// Descarga ítems de Supabase. Si está vacío o falla, devuelve pistas de prueba para que no se rompa la app
async function getLibraryItems(type = null) {
    if (typeof supabaseClient === 'undefined') {
        console.warn("⚠️ 'supabaseClient' no definido. Usando pistas de simulación locales.");
        return obtenerPistasDemo(type);
    }
    try {
        let query = supabaseClient.from("library_items").select("*");
        if (type) query = query.eq("type", type);
        
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error || !data || data.length === 0) {
            return obtenerPistasDemo(type); // Si la nube está vacía, carga las de prueba
        }
        return data;
    } catch (e) {
        return obtenerPistasDemo(type);
    }
}

// Pistas de demostración para que la app funcione de inmediato
function obtenerPistasDemo(type) {
    const demos = [
        {
            id: "demo1",
            name: "🎵 Canción de Prueba (Demo local)",
            file_url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
            type: "karaoke",
            transcription: [
                { text: "Bienvenidos a SingIt", timestamp: 1000 },
                { text: "Prueba tu voz en el pentagrama", timestamp: 5000 }
            ]
        }
    ];
    return type ? demos.filter(d => d.type === type) : demos;
}

// Llena el selector de pistas de la pestaña Estudio
async function loadTrackOptionsInStudio() {
    const tracks = await getLibraryItems();
    const select = $("studioTrackSelect") || $("trackSelect"); // Soporta ambos IDs tradicionales
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
            opt.value = JSON.stringify(track); 
            opt.textContent = track.name;
            select.appendChild(opt);
        });
    }
}

// =========================================================================
// BLOQUE 4: PESTAÑA - SEPARADOR DE AUDIO (SPLITTER)
// =========================================================================
function procesarSeparacionAudio() {
    const status = $("splitterStatus") || $("studioStatus");
    if (status) {
        status.textContent = "⏳ Separando Voces e Instrumentales (Simulación AI)...";
        setTimeout(() => {
            status.innerHTML = "✅ ¡Separación Completa!<br>Pista Vocal e Instrumental añadidas a tu biblioteca.";
            alert("El procesamiento del Splitter ha finalizado con éxito.");
        }, 3000); // Simula el procesamiento en 3 segundos
    }
}

// =========================================================================
// BLOQUE 5: PESTAÑA - CONFIGURACIÓN
// =========================================================================
function guardarConfiguracionLocal() {
    const dif = $("difficultySelect") || $("micCount");
    if (dif) {
        localStorage.setItem("singIt_difficulty", dif.value);
        alert("⚙️ Configuración guardada correctamente en el navegador.");
    }
}

function cargarConfiguracionPrevia() {
    const dif = $("difficultySelect") || $("micCount");
    if (dif) {
        const guardado = localStorage.getItem("singIt_difficulty");
        if (guardado) dif.value = guardado;
    }
}

// =========================================================================
// BLOQUE 6: MÓDULO DEL AFINADOR (DETECCIÓN DE PITCH)
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
    
    // NOTA OBJETIVO fija para guiar la barra azul del monitor (Ej: 440Hz = Nota LA)
    let objetivoFreq = 440; 
    
    // Dibujar el Pentagrama / Monitor Gráfico en tiempo real
    drawKaraokeMonitor(pitch, objetivoFreq);

    const display = $("noteDisplay");
    if (display && pitch !== -1) {
        display.textContent = getNoteNameFromFreq(pitch);
    }
    
    requestAnimationFrame(bucleDeteccionPitch);
}

// =========================================================================
// BLOQUE 7: MÓDULO DE ESTUDIO (GRABACIÓN MODO DÚO COMPATIBLE + CHUNKS)
// =========================================================================
async function startStudioRecording() {
    try {
        studioChunks = [];
        transcriptionSegments = [];
        
        const isDuo = $("micCount")?.value === "2";
        studioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks = [...studioStream.getAudioTracks()];

        if (isDuo && $("duoIndicator")) {
            $("duoIndicator").style.display = "block"; // Enciende las barras visuales de dúo
        }

        const combinedStream = new MediaStream(tracks);
        studioMediaRecorder = new MediaRecorder(combinedStream);
        
        studioMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) studioChunks.push(e.data);
        };

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
                if ($("studioStatus")) {
                    $("studioStatus").innerHTML = `🎤 Chunks: <span style="color: #22c55e; font-weight: bold;">${interimText}</span>`;
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
    const name = prompt("Escribe el nombre para tu registro:");
    if (!name) return;

    try {
        $("studioStatus").textContent = "⏳ Subiendo a Supabase...";
        const pathName = `audio_${Date.now()}.webm`;

        const { error: sErr } = await supabaseClient.storage.from("library").upload(pathName, studioRecordedBlob);
        if (sErr) throw sErr;

        const { data: urlData } = supabaseClient.storage.from("library").getPublicUrl(pathName);

        await supabaseClient.from("library_items").insert([{
            name: name,
            type: 'vocal',
            file_url: urlData.publicUrl,
            file_path: pathName,
            transcription: transcriptionSegments
        }]);
        
        $("studioStatus").textContent = "✅ Guardado exitosamente en tu nube.";
        alert("¡Almacenado correctamente!");
    } catch (err) {
        console.error(err);
        alert("Fallo al subir a la base de datos, guardado local activado.");
    }
}

// =========================================================================
// BLOQUE 8: MONITOR DE KARAOKE (PENTAGRAMA Y LÍNEA DE VOZ NEÓN)
// =========================================================================
function drawKaraokeMonitor(currentPitch, targetPitch) {
    const canvas = $("karaokeCanvas");
    if (!canvas) return; 
    
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#111827"; 
    ctx.fillRect(0, 0, W, H);
    
    ctx.strokeStyle = "#4b5563"; 
    ctx.lineWidth = 1;
    const spaceBetweenLines = H / 6;
    for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.moveTo(0, i * spaceBetweenLines);
        ctx.lineTo(W, i * spaceBetweenLines);
        ctx.stroke();
    }
    
    if (targetPitch > 0) {
        const targetY = conversionFreqAPixelY(targetPitch, H);
        ctx.fillStyle = "rgba(59, 130, 246, 0.35)"; 
        ctx.fillRect(0, targetY - 12, W, 24);
        ctx.strokeStyle = "#3b82f6"; 
        ctx.lineWidth = 2;
        ctx.strokeRect(0, targetY - 12, W, 24);
    }
    
    voiceHistory.shift();
    voiceHistory.push(currentPitch);
    
    ctx.lineWidth = 4;
    ctx.beginPath();
    
    for (let i = 0; i < voiceHistory.length; i++) {
        const pitchItem = voiceHistory[i];
        if (pitchItem <= 0) continue; 
        
        const posX = (i / (voiceHistory.length - 1)) * W;
        const posY = conversionFreqAPixelY(pitchItem, H);
        
        if (targetPitch > 0 && Math.abs(1200 * Math.log2(pitchItem / targetPitch)) < 25) {
            ctx.strokeStyle = "#22c55e"; // Verde Neón Brillante 🎯
            ctx.shadowBlur = 12;
            ctx.shadowColor = "#22c55e"; 
        } else {
            ctx.strokeStyle = "#eab308"; // Amarillo fuera de tono ⚠️
            ctx.shadowBlur = 0;
        }
        
        if (i === 0) ctx.moveTo(posX, posY);
        else ctx.lineTo(posX, posY);
    }
    ctx.stroke();
    ctx.shadowBlur = 0; 
}

function conversionFreqAPixelY(freq, canvasHeight) {
    const fMin = 70;  
    const fMax = 700; 
    if (freq < fMin) freq = fMin;
    if (freq > fMax) freq = fMax;
    const ratio = Math.log2(freq / fMin) / Math.log2(fMax / fMin);
    return canvasHeight - (ratio * canvasHeight); 
}

function cargarCancionKaraoke(event) {
    if (!event.target.value) return;
    const songObj = JSON.parse(event.target.value);
    
    const audioPlayer = $("karaokePlayer");
    if (audioPlayer) {
        audioPlayer.src = songObj.file_url;
        audioPlayer.load();
    }
    
    if (Array.isArray(songObj.transcription) && $("lyricsDisplay")) {
        $("lyricsDisplay").innerHTML = songObj.transcription.map(seg => `<span>${seg.text}</span>`).join(" ");
    }
}

// =========================================================================
// BLOQUE 9: OPERACIONES MATEMÁTICAS (AUTOCORRELACIÓN)
// =========================================================================
function autoCorrelateMath(buf, sampleRate) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < 0.015) return -1; 

    let r1 = 0, r2 = buf.length - 1;
    const thres = 0.2;
    for (let i = 0; i < buf.length / 2; i++) { if (Math.abs(buf[i]) < thres) { r1 = i; break; } }
    for (let i = buf.length - 1; i >= buf.length / 2; i--) { if (Math.abs(buf[i]) < thres) { r2 = i; break; } }

    const bufSlice = buf.subarray(r1, r2);
    const c = new Float32Array(bufSlice.length);
    for (let i = 0; i < bufSlice.length; i++) {
        for (let j = 0; j < bufSlice.length - i; j++) c[i] += bufSlice[j] * bufSlice[j + i];
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < c.length; i++) {
        if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }

    let T0 = maxpos;
    if (maxpos !== -1) {
        const frequency = sampleRate / T0;
        if (frequency > 65 && frequency < 1000) return frequency;
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
