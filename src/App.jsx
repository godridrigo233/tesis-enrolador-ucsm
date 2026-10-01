import { useEffect, useRef, useState } from 'react';
// Instalación: npm install @vladmandic/face-api
import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models'; // carpeta public/models (loadFromUri recibe la CARPETA, no el .json)
const DECIMALS = 6;

// WebGL (rápido en iOS/Android) con respaldo a CPU
async function initBackend() {
  const ok = await faceapi.tf.setBackend('webgl');
  if (!ok) await faceapi.tf.setBackend('cpu');
  await faceapi.tf.ready();
}

function mensajeErrorCamara(e) {
  if (!navigator.mediaDevices?.getUserMedia)
    return 'La cámara requiere HTTPS. Abre la URL de Vercel en Safari o Chrome (no en el navegador interno de WhatsApp/Instagram).';
  switch (e?.name) {
    case 'NotAllowedError': return 'Permiso de cámara denegado. Actívalo en los ajustes del navegador y recarga.';
    case 'NotFoundError': return 'No se encontró ninguna cámara.';
    case 'NotReadableError': return 'La cámara está siendo usada por otra aplicación.';
    default: return 'No se pudo iniciar la cámara.';
  }
}

// Respaldo de copiado para navegadores móviles estrictos. Devuelve true/false.
function copiarRespaldo(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, text.length); // necesario en iOS
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

export default function App() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [modelsReady, setModelsReady] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [facing, setFacing] = useState('user'); // facingMode: "user"
  const [busy, setBusy] = useState(false);
  const [vector, setVector] = useState(null);
  const [notice, setNotice] = useState('');
  const [modelError, setModelError] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [copiedCount, setCopiedCount] = useState(0);

  // 1. Backend + modelos
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initBackend();
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
          faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
          faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
        ]);
        if (!cancelled) setModelsReady(true);
      } catch (e) {
        console.error(e);
        if (!cancelled)
          setModelError('No se pudieron cargar los modelos. Verifica los archivos .json y .bin en public/models.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Cámara (se reinicia al girar)
  useEffect(() => {
    let cancelled = false;
    setCameraReady(false);
    setCameraError('');
    (async () => {
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!cancelled) setCameraReady(true);
      } catch (e) {
        if (!cancelled) setCameraError(mensajeErrorCamara(e));
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [facing]);

  // 3. Capturar: se analiza el <video> directamente. No se genera ninguna imagen.
  const capturar = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setNotice('La cámara aún no está lista. Espera un segundo e intenta de nuevo.');
      return;
    }
    setBusy(true);
    setCopied(false);
    setCopyFailed(false);
    setNotice('');
    try {
      const det = await faceapi
        .detectSingleFace(video, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.6 }))
        .withFaceLandmarks()
        .withFaceDescriptor();

      if (!det) {
        setVector(null);
        setNotice('No se detectó un rostro. Acércate, mira de frente y mejora la luz.');
        return;
      }
      setVector(JSON.stringify(Array.from(det.descriptor, (v) => Number(v.toFixed(DECIMALS)))));
    } catch (e) {
      console.error(e);
      setNotice('Error al procesar el rostro. Intenta de nuevo.');
    } finally {
      setBusy(false);
    }
  };

  // 4. Copiar (el primer await es writeText, dentro del gesto del usuario)
  const copiar = async () => {
    if (!vector) return;
    let ok = false;
    try {
      await navigator.clipboard.writeText(vector);
      ok = true;
    } catch {
      ok = copiarRespaldo(vector);
    }
    if (ok) {
      setCopiedCount((n) => (copied ? n : n + 1));
      setCopied(true);
      setCopyFailed(false);
    } else {
      setCopyFailed(true);
    }
  };

  const nuevo = () => {
    setVector(null);
    setCopied(false);
    setCopyFailed(false);
    setNotice('');
  };

  const error = modelError || cameraError;
  const cargando = !modelsReady || !cameraReady;
  const estado = error
    ? error
    : !modelsReady
    ? 'Cargando modelos de reconocimiento…'
    : !cameraReady
    ? 'Iniciando cámara…'
    : busy
    ? 'Escaneando rostro…'
    : 'Listo. Encuadra un rostro y captura.';

  return (
    <main className="app">
      <style>{css}</style>

      <header>
        <h1>Enrolador biométrico</h1>
        <p>Tesis UCSM · Se guarda solo el vector, nunca la foto.</p>
      </header>

      <div className="stage">
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }}
        />
        <div className="guide" aria-hidden="true" />
        <button className="flip" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}>
          Girar cámara
        </button>
      </div>

      <p className={`status ${error ? 'bad' : ''}`} role="status">
        {estado}
      </p>
      {notice && <p className="status warn">{notice}</p>}

      <button className="primary" onClick={capturar} disabled={cargando || busy || !!modelError}>
        {busy ? 'Escaneando…' : 'Capturar Rostro'}
      </button>

      {vector && (
        <section className="result">
          <p className="ok">Vector de 128 dimensiones generado.</p>
          <code>{vector.slice(0, 64)}…</code>
          <button className={copied ? 'done' : 'primary'} onClick={copiar}>
            {copied ? 'Copiado. Pégalo en Excel' : 'Copiar Vector'}
          </button>
          {copyFailed && (
            <>
              <p className="status bad">
                No se pudo copiar automáticamente. Mantén presionado el texto, selecciona todo y copia.
              </p>
              <textarea readOnly value={vector} rows={4} onFocus={(e) => e.target.select()} />
            </>
          )}
          <button className="ghost" onClick={nuevo}>
            Siguiente voluntario
          </button>
        </section>
      )}

      <footer>Vectores copiados en esta sesión: {copiedCount}</footer>
    </main>
  );
}

const css = `
  :root { --ink:#14213d; --bg:#f6f7fb; --accent:#1d4ed8; --ok:#15803d; --warn:#b45309; --bad:#b91c1c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .app { max-width: 480px; margin: 0 auto; padding: 16px; display:flex; flex-direction:column; gap:12px; }
  header h1 { margin:0; font-size:1.35rem; }
  header p { margin:2px 0 0; font-size:.85rem; opacity:.75; }
  .stage { position:relative; aspect-ratio:3/4; background:#000; border-radius:14px; overflow:hidden; }
  .stage video { width:100%; height:100%; object-fit:cover; }
  .guide { position:absolute; inset:12% 18%; border:3px dashed rgba(255,255,255,.8); border-radius:50%; pointer-events:none; }
  .flip { position:absolute; right:10px; bottom:10px; padding:8px 12px; border:0; border-radius:8px;
          background:rgba(255,255,255,.9); color:var(--ink); font-size:.85rem; }
  .status { margin:0; font-size:.95rem; min-height:1.3em; }
  .status.warn { color:var(--warn); font-weight:600; }
  .status.bad { color:var(--bad); font-weight:600; }
  button { font:inherit; border-radius:12px; border:0; cursor:pointer; }
  button.primary, button.done { padding:16px; font-weight:700; font-size:1.05rem; color:#fff; width:100%; }
  button.primary { background:var(--accent); }
  button.done { background:var(--ok); }
  button.ghost { padding:12px; background:transparent; border:2px solid var(--ink); color:var(--ink); width:100%; }
  button:disabled { opacity:.45; cursor:not-allowed; }
  button:focus-visible { outline:3px solid #f59e0b; outline-offset:2px; }
  textarea { width:100%; font-size:16px; border-radius:8px; border:1px solid #999; padding:8px; }
  .result { display:flex; flex-direction:column; gap:10px; background:#fff; padding:14px; border-radius:14px;
            border:2px solid var(--ok); }
  .result .ok { margin:0; color:var(--ok); font-weight:700; }
  .result code { font-size:.75rem; word-break:break-all; opacity:.7; }
  footer { font-size:.8rem; opacity:.65; text-align:center; padding-bottom:12px; }
`;