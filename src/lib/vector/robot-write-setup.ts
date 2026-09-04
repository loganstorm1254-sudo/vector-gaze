/**
 * One-time robot-origin write bootstrap for Vercel / remote hosts.
 *
 * Eng-console Civetweb does not answer CORS preflights for PUT, so a public
 * HTTPS page cannot write files directly. After the put-bridge is installed on
 * the robot, opening it with a #gaze= payload writes same-origin automatically.
 */

export class RobotWriteSetupError extends Error {
  readonly ip: string;
  readonly setupScript: string;
  readonly bookmarkletHref: string;
  readonly robotPageUrl: string;
  readonly bridgeWriteUrl: string;

  constructor(
    ip: string,
    setupScript: string,
    bookmarkletHref: string,
    bridgeWriteUrl: string,
  ) {
    super(
      `Chrome blocks file writes from this site to Vector’s eng console. Use the Vector Gaze Write bookmark once on his :8889 page, then retry.`,
    );
    this.name = "RobotWriteSetupError";
    this.ip = ip;
    this.setupScript = setupScript;
    this.bookmarkletHref = bookmarkletHref;
    this.robotPageUrl = `http://${ip}:8889/`;
    this.bridgeWriteUrl = bridgeWriteUrl;
  }
}

export function isRobotWriteSetupError(
  err: unknown,
): err is RobotWriteSetupError {
  return (
    err instanceof RobotWriteSetupError ||
    (typeof err === "object" &&
      err !== null &&
      (err as { name?: string }).name === "RobotWriteSetupError")
  );
}

/** Compact bridge HTML inlined into the first-time bookmarklet. */
const INLINE_BRIDGE_HTML = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Vector Gaze writer</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.45 ui-sans-serif,system-ui,sans-serif;color:#ecfdf5;background:#09090b}.card{max-width:28rem;padding:1.25rem 1.5rem;border:1px solid rgba(45,212,191,.25);border-radius:1rem;background:rgba(24,24,27,.92)}.ok{color:#5eead4}.err{color:#fecaca}</style></head><body><div class="card"><strong>Vector Gaze</strong><p id="status">Waiting…</p></div><script>
const statusEl=document.getElementById("status");const setStatus=(t,c)=>{statusEl.textContent=t;statusEl.className=c||""};
const decodeB64=b64=>{const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u};
const putBytes=async(path,bytes,type)=>{try{await fetch(path,{method:"DELETE"})}catch(_){}const r=await fetch(path,{method:"PUT",headers:{"Content-Type":type||"application/octet-stream"},body:bytes});if(!(r.ok||r.status===201))throw new Error("PUT "+path+" -> "+r.status)};
const fireConsole=async u=>{try{await fetch(u,{method:"GET",mode:"no-cors"})}catch(_){}try{await fetch(u,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:""})}catch(_){}};
const writeOverlay=async payload=>{const path=String(payload.path||"/resources/assets/faceOverlays/galaxy.jpg");const b64=String(payload.jpegBase64||"");if(!path.startsWith("/")||!b64)throw new Error("bad payload");const jpeg=decodeB64(b64);await putBytes(path,jpeg,"image/jpeg");try{await putBytes("/persistent/customFaceOverlay.jpg",jpeg,"image/jpeg")}catch(_){}if(payload.load){const op=Number.isFinite(Number(payload.opacity))?Number(payload.opacity):0.8;const fl=Number.isFinite(Number(payload.flavor))?Number(payload.flavor):7;await fireConsole("/consolevarset?key=kProcFace_CustomEyes&value=true");await fireConsole("/consolevarset?key=kProcFace_FlavorOfGay&value="+encodeURIComponent(String(fl)));await fireConsole("/consolevarset?key=kProcFace_CustomEyeOpacity&value="+encodeURIComponent(String(op)));await fireConsole("/consolefunccall?func=LOOK_LoadFaceOverlay&args=")} };
window.addEventListener("message",async e=>{const d=e.data;if(!d||d.type!=="vector-gaze-put")return;const reply=p=>{try{e.source&&e.source.postMessage(p,"*")}catch(_){}};try{await writeOverlay({path:d.path,jpegBase64:d.jpegBase64,load:false});reply({type:"vector-gaze-put-result",ok:true,status:200})}catch(err){reply({type:"vector-gaze-put-result",ok:false,error:String(err&&err.message||err)})}});
try{parent.postMessage({type:"vector-gaze-put-ready"},"*")}catch(_){}
(async()=>{const hash=location.hash||"";if(!hash.startsWith("#gaze=")){setStatus("Write helper ready on Vector.");return}try{setStatus("Writing overlay on Vector…");const payload=JSON.parse(decodeURIComponent(hash.slice(6)));await writeOverlay(Object.assign({},payload,{load:payload.load!==false}));setStatus("Done — overlay written. You can close this tab.","ok");try{window.opener&&window.opener.postMessage({type:"vector-gaze-write-done",ok:true},"*")}catch(_){}setTimeout(()=>{try{window.close()}catch(_){}},1200)}catch(err){const msg=String(err&&err.message||err);setStatus("Write failed: "+msg,"err");try{window.opener&&window.opener.postMessage({type:"vector-gaze-write-done",ok:false,error:msg},"*")}catch(_){}}})();
</script></body></html>`;

export type GazeWritePayload = {
  path: string;
  jpegBase64: string;
  opacity?: number;
  flavor?: number;
  load?: boolean;
};

export function buildBridgeWriteUrl(ip: string, payload: GazeWritePayload): string {
  const hash = encodeURIComponent(JSON.stringify(payload));
  return `http://${ip}:8889/persistent/gaze-put-bridge.html#gaze=${hash}`;
}

/**
 * First-time installer: runs on Vector's :8889 origin (via bookmarklet).
 * Installs the put-bridge and writes + loads the overlay.
 */
export function buildRobotWriteSetupScript(
  jpegBase64: string,
  opacity = 0.8,
): string {
  const bridgeB64 = btoa(INLINE_BRIDGE_HTML);
  return `(async()=>{const J=${JSON.stringify(jpegBase64)};const B=${JSON.stringify(bridgeB64)};const dec=s=>{const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};const put=async(p,bytes,type)=>{try{await fetch(p,{method:"DELETE"})}catch(_){}const r=await fetch(p,{method:"PUT",headers:{"Content-Type":type},body:bytes});if(!(r.ok||r.status===201))throw new Error("PUT "+p+" -> "+r.status)};const jpeg=dec(J);const bridge=dec(B);await put("/persistent/gaze-put-bridge.html",bridge,"text/html");let staged=false;try{await put("/resources/assets/faceOverlays/galaxy.jpg",jpeg,"image/jpeg");staged=true}catch(e){console.warn("galaxy staging failed",e)}try{await put("/persistent/customFaceOverlay.jpg",jpeg,"image/jpeg")}catch(e){console.warn("persistent staging failed",e)}if(!staged)throw new Error("Could not write overlay JPG (resources may be read-only). Run npm run dev on the same Wi-Fi once.");const q=async(u)=>{try{await fetch(u,{method:"GET",mode:"no-cors"})}catch(_){};try{await fetch(u,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:""})}catch(_){}};await q("/consolevarset?key=kProcFace_CustomEyes&value=true");await q("/consolevarset?key=kProcFace_FlavorOfGay&value=7");await q("/consolevarset?key=kProcFace_CustomEyeOpacity&value=${opacity}");await q("/consolefunccall?func=LOOK_LoadFaceOverlay&args=");document.title="Vector Gaze: done";alert("Vector Gaze installed the write helper and loaded your overlay. Go back to the site — future images open a Vector tab that writes automatically.")})()`;
}

export function buildWriteBookmarkletHref(setupScript: string): string {
  // Prefer void(...) so the bookmark stays on the page without navigating to a result string.
  return `javascript:${encodeURIComponent(`void(${setupScript})`)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Open the robot-origin bridge with a hash payload so the tab itself writes.
 * Resolves true when the bridge posts vector-gaze-write-done ok (or times out false).
 */
export function openBridgeWriteTab(
  bridgeWriteUrl: string,
  timeoutMs = 20000,
): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(ok);
    };

    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; ok?: boolean } | null;
      if (!data || data.type !== "vector-gaze-write-done") return;
      finish(Boolean(data.ok));
    };

    const timer = window.setTimeout(() => finish(false), timeoutMs);
    window.addEventListener("message", onMessage);

    const popup = window.open(bridgeWriteUrl, "vector-gaze-robot-write");
    if (!popup) {
      finish(false);
    }
  });
}

export async function prepareRobotWriteSetup(
  ip: string,
  jpegBase64: string,
  opacity = 0.8,
): Promise<RobotWriteSetupError> {
  const setupScript = buildRobotWriteSetupScript(jpegBase64, opacity);
  const bookmarkletHref = buildWriteBookmarkletHref(setupScript);
  const bridgeWriteUrl = buildBridgeWriteUrl(ip, {
    path: "/resources/assets/faceOverlays/galaxy.jpg",
    jpegBase64,
    opacity,
    flavor: 7,
    load: true,
  });
  return new RobotWriteSetupError(
    ip,
    setupScript,
    bookmarkletHref,
    bridgeWriteUrl,
  );
}
