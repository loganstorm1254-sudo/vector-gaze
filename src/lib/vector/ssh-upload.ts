import { VECTOR_UNLOCK_ROOT_KEY } from "@/lib/vector/keys/unlock-root";

const REMOTE_PATH = "/data/data/customFaceOverlay.jpg";
const PERSISTENT_PATH =
  "/data/data/com.anki.victor/persistent/customFaceOverlay.jpg";

type UploadResult = { ok: boolean; path?: string; error?: string };

/**
 * Write customFaceOverlay.jpg over SSH using the well-known unlocked-Vector root key.
 * Also keeps a copy under persistent/ and symlinks so later HTTP PUTs can replace it.
 *
 * ssh2 is loaded dynamically so Next/Turbopack does not try to bundle its native crypto.
 */
export async function uploadOverlayViaUnlockSsh(
  ip: string,
  jpeg: Buffer,
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
    }, 12000);

    conn.on("ready", () => {
      conn.sftp((err, sftp) => {
        if (err || !sftp) {
          clearTimeout(timer);
          done({ ok: false, error: err?.message || "SFTP unavailable" });
          return;
        }

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
