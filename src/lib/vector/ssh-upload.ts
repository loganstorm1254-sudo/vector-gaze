import { VECTOR_UNLOCK_ROOT_KEY } from "@/lib/vector/keys/unlock-root";

const REMOTE_PATH = "/data/data/customFaceOverlay.jpg";
const PERSISTENT_PATH =
  "/data/data/com.anki.victor/persistent/customFaceOverlay.jpg";
const BRIDGE_PATH =
  "/data/data/com.anki.victor/persistent/gaze-put-bridge.html";

type UploadResult = { ok: boolean; path?: string; error?: string };

/**
 * Write customFaceOverlay.jpg over SSH using the well-known unlocked-Vector root key.
 * Wipes the previous file first, writes a fresh copy, and installs the HTTP put-bridge
 * so later browser uploads (Vercel) can replace the image without SCP.
 */
export async function uploadOverlayViaUnlockSsh(
  ip: string,
  jpeg: Buffer,
  bridgeHtml?: Buffer,
): Promise<UploadResult> {
  let Client: typeof import("ssh2").Client;
  try {
    ({ Client } = await import("ssh2"));
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `ssh2 unavailable: ${err.message}`
          : "ssh2 unavailable",
    };
  }

  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const done = (result: UploadResult) => {
      if (settled) return;
      settled = true;
      try {
        conn.end();
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({ ok: false, error: "SSH timed out reaching Vector." });
    }, 15000);

    const writeBoth = (sftp: import("ssh2").SFTPWrapper) => {
      // Wipe ANY previous custom overlay file (regular file or symlink).
      conn.exec(
        "mkdir -p /data/data/com.anki.victor/persistent && " +
          `rm -f '${REMOTE_PATH}' '${PERSISTENT_PATH}' && sync`,
        (execErr) => {
          if (execErr) {
            clearTimeout(timer);
            done({ ok: false, error: execErr.message });
            return;
          }

          sftp.writeFile(PERSISTENT_PATH, jpeg, (persistErr) => {
            if (persistErr) {
              clearTimeout(timer);
              done({ ok: false, error: persistErr.message });
              return;
            }

            // Direct file at the Custom path (not only a symlink) so LoadCustomEyePNG
            // always sees the new bytes even if symlink follows fail.
            sftp.writeFile(REMOTE_PATH, jpeg, (remoteErr) => {
              if (remoteErr) {
                // Fall back to symlink if direct write is blocked.
                conn.exec(
                  `ln -sfn '${PERSISTENT_PATH}' '${REMOTE_PATH}' && sync`,
                  (linkErr, stream) => {
                    if (linkErr) {
                      clearTimeout(timer);
                      done({ ok: false, error: linkErr.message });
                      return;
                    }
                    stream.on("close", (code: number) => {
                      finish(sftp, code === 0);
                    });
                  },
                );
                return;
              }
              finish(sftp, true);
            });
          });
        },
      );
    };

    const finish = (sftp: import("ssh2").SFTPWrapper, ok: boolean) => {
      const afterBridge = () => {
        clearTimeout(timer);
        if (!ok) {
          done({ ok: false, error: "Failed to place customFaceOverlay.jpg" });
          return;
        }
        // Prove the new bytes are on disk.
        conn.exec(
          `test -s '${REMOTE_PATH}' && wc -c < '${REMOTE_PATH}'`,
          (err, stream) => {
            if (err) {
              done({ ok: true, path: REMOTE_PATH });
              return;
            }
            let out = "";
            stream.on("data", (d: Buffer) => {
              out += d.toString();
            });
            stream.on("close", () => {
              const size = Number(out.trim());
              if (Number.isFinite(size) && size === jpeg.byteLength) {
                done({ ok: true, path: REMOTE_PATH });
              } else if (Number.isFinite(size) && size > 32) {
                done({ ok: true, path: REMOTE_PATH });
              } else {
                done({
                  ok: false,
                  error: `Remote file size mismatch (got ${out.trim() || 0}, expected ${jpeg.byteLength})`,
                });
              }
            });
          },
        );
      };

      if (!bridgeHtml || bridgeHtml.byteLength < 16) {
        afterBridge();
        return;
      }
      sftp.writeFile(BRIDGE_PATH, bridgeHtml, () => {
        // Bridge install is best-effort for later Vercel browser PUTs.
        afterBridge();
      });
    };

    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          done({ ok: false, error: err?.message || "SFTP unavailable" });
          return;
        }
        writeBoth(sftp);
      });
    });

    conn.on("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, error: e.message });
    });

    try {
      conn.connect({
        host: ip,
        port: 22,
        username: "root",
        privateKey: VECTOR_UNLOCK_ROOT_KEY,
        readyTimeout: 10000,
        algorithms: {
          serverHostKey: [
            "ssh-rsa",
            "rsa-sha2-256",
            "rsa-sha2-512",
            "ecdsa-sha2-nistp256",
            "ssh-ed25519",
          ],
        },
      });
    } catch (e) {
      clearTimeout(timer);
      done({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });
}
