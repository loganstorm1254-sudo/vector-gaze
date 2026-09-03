import { Client } from "ssh2";
import { VECTOR_UNLOCK_ROOT_KEY } from "@/lib/vector/keys/unlock-root";

const REMOTE_PATH = "/data/data/customFaceOverlay.jpg";
const PERSISTENT_PATH =
  "/data/data/com.anki.victor/persistent/customFaceOverlay.jpg";

/**
 * Write customFaceOverlay.jpg over SSH using the well-known unlocked-Vector root key.
 * Also keeps a copy under persistent/ and symlinks so later HTTP PUTs can replace it.
 */
export function uploadOverlayViaUnlockSsh(
  ip: string,
  jpeg: Buffer,
): Promise<{ ok: boolean; path?: string; error?: string }> {
  return new Promise((resolve) => {
    const conn = new Client();
    let settled = false;
    const done = (result: { ok: boolean; path?: string; error?: string }) => {
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
    }, 12000);

    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          done({ ok: false, error: err?.message || "SFTP unavailable" });
          return;
        }

        // Ensure persistent dir exists, write both paths, then symlink.
        conn.exec(
          "mkdir -p /data/data/com.anki.victor/persistent && " +
            `rm -f '${REMOTE_PATH}' '${PERSISTENT_PATH}' && ` +
            "true",
          (execErr) => {
            if (execErr) {
              clearTimeout(timer);
              done({ ok: false, error: execErr.message });
              return;
            }

            sftp.writeFile(PERSISTENT_PATH, jpeg, (writeErr) => {
              if (writeErr) {
                clearTimeout(timer);
                done({ ok: false, error: writeErr.message });
                return;
              }

              conn.exec(
                `ln -sfn '${PERSISTENT_PATH}' '${REMOTE_PATH}' && ` +
                  `test -f '${REMOTE_PATH}' && test -f '${PERSISTENT_PATH}'`,
                (linkErr, stream) => {
                  if (linkErr) {
                    // Fall back to a second direct write to the Custom path.
                    sftp.writeFile(REMOTE_PATH, jpeg, (directErr) => {
                      clearTimeout(timer);
                      if (directErr) {
                        done({ ok: false, error: directErr.message });
                      } else {
                        done({ ok: true, path: REMOTE_PATH });
                      }
                    });
                    return;
                  }

                  let stderr = "";
                  stream.on("data", () => undefined);
                  stream.stderr.on("data", (d: Buffer) => {
                    stderr += d.toString();
                  });
                  stream.on("close", (code: number) => {
                    if (code === 0) {
                      clearTimeout(timer);
                      done({ ok: true, path: REMOTE_PATH });
                      return;
                    }
                    sftp.writeFile(REMOTE_PATH, jpeg, (directErr) => {
                      clearTimeout(timer);
                      if (directErr) {
                        done({
                          ok: false,
                          error: stderr || directErr.message,
                        });
                      } else {
                        done({ ok: true, path: REMOTE_PATH });
                      }
                    });
                  });
                },
              );
            });
          },
        );
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
