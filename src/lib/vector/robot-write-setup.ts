/**
 * One-time robot-origin write bootstrap for Vercel / remote hosts.
 *
 * Eng-console Civetweb does not answer CORS preflights for PUT, so a public
 * HTTPS page cannot write files directly. Pasting a short script into the
 * robot's own :8889 page runs same-origin PUT (installs the put-bridge + image).
 */

export const ROBOT_WRITE_SETUP_MARKER = "vector-gaze-needs-robot-write-setup";

export class RobotWriteSetupError extends Error {
  readonly ip: string;
  readonly setupScript: string;
  readonly robotPageUrl: string;

  constructor(ip: string, setupScript: string) {
    super(
      `Chrome blocks file writes from this site to Vector’s eng console (CORS). One-time setup: open ${ip}:8889, paste the copied command into the page Console (F12), press Enter, then retry.`,
    );
    this.name = "RobotWriteSetupError";
    this.ip = ip;
    this.setupScript = setupScript;
    this.robotPageUrl = `http://${ip}:8889/`;
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

/** Compact bridge HTML inlined into the setup script (no extra network hop). */
const INLINE_BRIDGE_HTML = `<!doctype html><html><head><meta charset="utf-8"/><title>Vector Gaze put bridge</title></head><body><script>
window.addEventListener("message",async e=>{const d=e.data;if(!d||d.type!=="vector-gaze-put")return;const reply=p=>{try{e.source&&e.source.postMessage(p,"*")}catch(_){}};try{const path=String(d.path||"");const b64=String(d.jpegBase64||"");if(!path.startsWith("/")||!b64){reply({type:"vector-gaze-put-result",ok:false});return}const bin=atob(b64);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);try{await fetch(path,{method:"DELETE"})}catch(_){}const r=await fetch(path,{method:"PUT",headers:{"Content-Type":"image/jpeg"},body:u});reply({type:"vector-gaze-put-result",ok:r.ok||r.status===201,status:r.status})}catch(err){reply({type:"vector-gaze-put-result",ok:false,error:String(err&&err.message||err)})}});
try{parent.postMessage({type:"vector-gaze-put-ready"},"*")}catch(_){}
</script></body></html>`;

/**
 * Build a same-origin console script for http://ROBOT:8889/
 * Writes the JPEG, installs the put-bridge, enables Galaxy staging flavor, loads it.
 */
export function buildRobotWriteSetupScript(
  jpegBase64: string,
  opacity = 0.8,
): string {
  const bridgeB64 = btoa(INLINE_BRIDGE_HTML);
  // Keep this as one pasteable Expression Statement for DevTools.
  return `(async()=>{const J="${jpegBase64}";const B="${bridgeB64}";const dec=s=>{const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u};const put=async(p,bytes,type)=>{try{await fetch(p,{method:"DELETE"})}catch(_){}const r=await fetch(p,{method:"PUT",headers:{"Content-Type":type},body:bytes});if(!(r.ok||r.status===201))throw new Error("PUT "+p+" -> "+r.status)};const jpeg=dec(J);const bridge=dec(B);await put("/persistent/gaze-put-bridge.html",bridge,"text/html");let staged=false;try{await put("/resources/assets/faceOverlays/galaxy.jpg",jpeg,"image/jpeg");staged=true}catch(e){console.warn("galaxy staging failed",e)}try{await put("/persistent/customFaceOverlay.jpg",jpeg,"image/jpeg")}catch(e){console.warn("persistent staging failed",e)}if(!staged)throw new Error("Could not write overlay JPG (resources may be read-only). Run npm run dev on the same Wi-Fi once to SSH-install the Custom path.");const q=async(u)=>{try{await fetch(u,{method:"GET",mode:"no-cors"})}catch(_){};try{await fetch(u,{method:"POST",mode:"no-cors",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:""})}catch(_){}};await q("/consolevarset?key=kProcFace_CustomEyes&value=true");await q("/consolevarset?key=kProcFace_FlavorOfGay&value=7");await q("/consolevarset?key=kProcFace_CustomEyeOpacity&value=${opacity}");await q("/consolefunccall?func=LOOK_LoadFaceOverlay");document.title="Vector Gaze: overlay written — return to the site";alert("Vector Gaze wrote the overlay and installed the write helper. Go back to the site — future custom images are automatic.")})()`;
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

/** Open Vector eng-console and copy the setup script. */
export async function beginRobotWriteSetup(
  ip: string,
  setupScript: string,
): Promise<{ copied: boolean; robotPageUrl: string }> {
  const robotPageUrl = `http://${ip}:8889/`;
  const copied = await copyText(setupScript);
  try {
    window.open(robotPageUrl, "vector-gaze-robot-setup", "noopener,noreferrer");
  } catch {
    // popup blocked — UI still has the URL
  }
  return { copied, robotPageUrl };
}
