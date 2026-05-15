// ==========================================
// BLOQUE 1: VARIABLES GLOBALES Y ESTADO
// ==========================================
const state = {
    isRecording: false,
    transcriptionSegments: [],
    studioChunks: [],
    studioRecordedBlob: null
};

// Variables para flujos de audio y reconocimiento de voz
let studioStream = null;
let studioMediaRecorder = null;
let recognition = null;

// Funciones de ayuda (Selectors y Eventos seguros)
function $(id) { return document.getElementById(id); }

function safeAdd(id, event, handler) {
    const el = $(id);
    if (el) el.addEventListener(event, handler);
}

// ==========================================
// BLOQUE 2: ARRANQUE AL CARGAR LA PÁGINA
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    // 1. Conectar botones de Grabación
    safeAdd("startStudioRecBtn", "click", startStudioRecording);
    safeAdd("stopStudioRecBtn", "click", stopStudioRecording);
    safeAdd("saveStudioRecBtn", "click", saveStudioRecording);
    safeAdd("redoStudioRecBtn", "click", () => {
        if(confirm("¿Borrar grabación actual y repetir?")) location.reload();
    });

    // 2. Conectar botones de Sincronización (TapSync)
    safeAdd("applyTapSyncBtn", "click", () => alert("Tiempos aplicados"));
    safeAdd("redoTapSyncBtn", "click", () => location.reload());

    console.log("🚀 App SingIt lista y conectada al HTML");

    // AGREGAR ESTO AL FINAL DEL BLOQUE 2:
    await loadTrackOptionsInStudio();
    await loadTrackOptionsInKaraoke();
    renderLibrary();
});


// ==========================================
// BLOQUE 3: MÓDULO DE GRABACIÓN DE VOZ
// ==========================================
async function startStudioRecording() {
    try {
        state.studioChunks = [];
        state.transcriptionSegments = [];
        
        // 1. Pedir permiso para el micrófono
        studioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        
        // 2. Configurar el grabador de Audio
        studioMediaRecorder = new MediaRecorder(studioStream);
        studioMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) state.studioChunks.push(e.data);
        };

        // 3. Configurar el motor de Voz a Texto (Transcripción)
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = 'es-ES';
            recognition.continuous = true;
            recognition.interimResults = true;

            recognition.onresult = (event) => {
                let textoIntermedio = '';
                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    const transcript = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        state.transcriptionSegments.push({
                            text: transcript,
                            time: Date.now()
                        });
                    } else {
                        textoIntermedio += transcript;
                    }
                }
                // Actualizar el estado en el HTML que me pasaste
                if ($("studioStatus")) {
                    $("studioStatus").innerHTML = `🎤 <span style="color: #22c55e;">${textoIntermedio}</span>`;
                }
            };
            recognition.start();
        }

        // 4. Iniciar todo
        studioMediaRecorder.start();
        $("startStudioRecBtn").disabled = true;
        $("stopStudioRecBtn").disabled = false;
        $("studioStatus").textContent = "🎙️ Grabando voz y transcribiendo...";

    } catch (err) {
        console.error("Error al grabar:", err);
        alert("No se pudo acceder al micrófono.");
    }
}

function stopStudioRecording() {
    if (studioMediaRecorder) studioMediaRecorder.stop();
    if (recognition) recognition.stop();
    if (studioStream) studioStream.getTracks().forEach(t => t.stop());

    studioMediaRecorder.onstop = () => {
        state.studioRecordedBlob = new Blob(state.studioChunks, { type: 'audio/webm' });
        // Poner el audio en el reproductor que tienes en el HTML
        if ($("voicePlayer")) {
            $("voicePlayer").src = URL.createObjectURL(state.studioRecordedBlob);
        }
        $("studioStatus").textContent = "✅ Grabación finalizada. Escúchala abajo.";
    };

    $("startStudioRecBtn").disabled = false;
    $("stopStudioRecBtn").disabled = true;
}

// ==========================================
// BLOQUE 4: GUARDADO EN SUPABASE
// ==========================================
async function saveStudioRecording() {
    if (!state.studioRecordedBlob) return alert("Primero debes grabar algo.");

    const nombre = prompt("Dale un nombre a tu grabación:", "Mi voz");
    if (!nombre) return;

    try {
        $("studioStatus").textContent = "⏳ Subiendo a la nube...";
        const fileName = `voice_${Date.now()}.webm`;

        // 1. Subir el archivo de audio al Storage
        const { data: storageData, error: sErr } = await supabaseClient.storage
            .from("library")
            .upload(fileName, state.studioRecordedBlob);

        if (sErr) throw sErr;

        // 2. Obtener URL pública
        const { data: urlData } = supabaseClient.storage.from("library").getPublicUrl(fileName);

        // 3. Guardar en la tabla de la base de datos (con transcripción)
        const { error: dbErr } = await supabaseClient.from("library_items").insert([{
            name: nombre,
            type: 'vocal',
            file_url: urlData.publicUrl,
            file_path: fileName,
            transcription: state.transcriptionSegments // El texto que se generó
        }]);

        if (dbErr) throw dbErr;

        alert("¡Grabación guardada con éxito!");
        $("studioStatus").textContent = "✅ Guardado en biblioteca.";

    } catch (err) {
        console.error("Error al guardar:", err);
        alert("Hubo un error al subir a Supabase.");
    }
}

// ==========================================
// BLOQUE 5: CARGA DE DATOS PARA SELECCIÓN
// ==========================================

// 1. Cargar pistas en el Estudio
async function loadTrackOptionsInStudio() {
    const tracks = await getLibraryItems(); // Trae todo de Supabase
    const select = $("studioTrackSelect"); // Asegúrate de que este ID exista en tu HTML
    
    if (select) {
        select.innerHTML = '<option value="">-- Selecciona una pista --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = track.file_url;
            opt.textContent = track.name;
            select.appendChild(opt);
        });
        console.log("✅ Pistas cargadas en Estudio");
    }
}

// 2. Cargar pistas en el Karaoke
async function loadTrackOptionsInKaraoke() {
    const tracks = await getLibraryItems();
    const select = $("karaokeTrackSelect");
    
    if (select) {
        select.innerHTML = '<option value="">-- Selecciona canción para cantar --</option>';
        tracks.forEach(track => {
            const opt = document.createElement("option");
            // Guardamos todo el objeto como texto para recuperar la letra luego
            opt.value = JSON.stringify(track); 
            opt.textContent = track.name;
            select.appendChild(opt);
        });
        console.log("✅ Pistas cargadas en Karaoke");
    }
}
