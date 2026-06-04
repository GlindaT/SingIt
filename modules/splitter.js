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
