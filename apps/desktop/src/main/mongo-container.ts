/**
 * Local MongoDB via Docker — the storage half of the companion's
 * "keep my data on this machine" mode.
 *
 * Why a Docker container is fine HERE even though docker.ts was
 * deliberately deleted (see backend-process.ts's header): the API
 * container died because it needed the HOST's VPN routes and WSL2's
 * inner VM doesn't inherit them. Mongo has the opposite profile — it
 * serves, it never dials out, and it binds 127.0.0.1 only. The API
 * keeps running natively on the host; the container is just a managed
 * datastore listening on localhost. No VPN interaction at all.
 *
 * Lifecycle: create-if-missing (`docker run -d`) → `docker start` on
 * subsequent boots → TCP health poll. `stopMongo` stops the container
 * but NEVER removes the named volume — the user's local data survives
 * container recreation and image upgrades.
 *
 * Docker Desktop itself is detect-only for v1 (unlike node-install.ts /
 * cloudflared-install.ts which auto-install): the renderer deep-links
 * the download page when `docker version` says there's nothing to talk
 * to.
 */

import { spawn } from "node:child_process";
import net from "node:net";
import { pushLog } from "./log-buffer.js";

const CONTAINER_NAME = "devhub-mongo";
const VOLUME_NAME = "devhub-mongo-data";
const IMAGE = "mongo:7";
const HOST = "127.0.0.1";
const PORT = 27017;

const HEALTH_WAIT_MS = 30_000;
const HEALTH_POLL_MS = 1_000;
const DOCKER_CMD_TIMEOUT_MS = 120_000; // first `docker run` may pull mongo:7

export type DockerAvailability =
  | { available: true }
  | { available: false; reason: "not_installed" | "not_running"; message: string };

export interface MongoStatus {
  docker: DockerAvailability;
  containerExists: boolean;
  containerRunning: boolean;
  /** TCP-level reachability of 127.0.0.1:27017 — true also when the
   *  user runs their own native Mongo on the same port. */
  reachable: boolean;
}

function runDocker(
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string; enoent: boolean }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (r: {
      code: number | null;
      stdout: string;
      stderr: string;
      enoent: boolean;
    }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const proc = spawn("docker", args, {
      shell: false,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {
        /* already dead */
      }
      settle({ code: null, stdout, stderr: "timed out", enoent: false });
    }, DOCKER_CMD_TIMEOUT_MS);
    proc.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    proc.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      settle({
        code: null,
        stdout,
        stderr: err.message,
        enoent: (err as NodeJS.ErrnoException).code === "ENOENT",
      });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      settle({ code, stdout, stderr, enoent: false });
    });
  });
}

export async function dockerAvailable(): Promise<DockerAvailability> {
  const r = await runDocker(["version", "--format", "{{.Server.Version}}"]);
  if (r.enoent) {
    return {
      available: false,
      reason: "not_installed",
      message:
        "Docker isn't installed. Install Docker Desktop (docker.com/products/docker-desktop), then retry.",
    };
  }
  if (r.code !== 0 || !r.stdout.trim()) {
    return {
      available: false,
      reason: "not_running",
      message:
        "Docker is installed but the engine isn't responding — open Docker Desktop and wait for it to say \"running\", then retry.",
    };
  }
  return { available: true };
}

function tcpPing(timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    const done = (up: boolean) => {
      socket.destroy();
      resolve(up);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

async function inspectContainer(): Promise<{ exists: boolean; running: boolean }> {
  const r = await runDocker([
    "inspect",
    "--format",
    "{{.State.Running}}",
    CONTAINER_NAME,
  ]);
  if (r.code !== 0) return { exists: false, running: false };
  return { exists: true, running: r.stdout.trim() === "true" };
}

export async function mongoStatus(): Promise<MongoStatus> {
  const docker = await dockerAvailable();
  if (!docker.available) {
    return {
      docker,
      containerExists: false,
      containerRunning: false,
      reachable: await tcpPing(),
    };
  }
  const { exists, running } = await inspectContainer();
  return {
    docker,
    containerExists: exists,
    containerRunning: running,
    reachable: await tcpPing(),
  };
}

export async function startMongo(): Promise<{ ok: boolean; message: string }> {
  const docker = await dockerAvailable();
  if (!docker.available) {
    // A native Mongo already listening on the port is just as good —
    // local mode only cares that 127.0.0.1:27017 answers.
    if (await tcpPing()) {
      pushLog(
        "[companion] Docker unavailable but something already listens on 127.0.0.1:27017 — using it as the local MongoDB.",
      );
      return { ok: true, message: "Local MongoDB already reachable." };
    }
    return { ok: false, message: docker.message };
  }

  const { exists, running } = await inspectContainer();
  if (!running) {
    if (exists) {
      pushLog(`[companion] starting existing ${CONTAINER_NAME} container`);
      const r = await runDocker(["start", CONTAINER_NAME]);
      if (r.code !== 0) {
        return {
          ok: false,
          message: `docker start ${CONTAINER_NAME} failed: ${r.stderr.trim() || "unknown error"}`,
        };
      }
    } else {
      pushLog(
        `[companion] creating ${CONTAINER_NAME} (${IMAGE}, volume ${VOLUME_NAME}, bound to ${HOST}:${PORT}) — first run pulls the image, give it a minute`,
      );
      const r = await runDocker([
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-p",
        `${HOST}:${PORT}:27017`,
        "-v",
        `${VOLUME_NAME}:/data/db`,
        "--restart",
        "unless-stopped",
        IMAGE,
      ]);
      if (r.code !== 0) {
        return {
          ok: false,
          message: `docker run ${IMAGE} failed: ${r.stderr.trim() || "unknown error"}`,
        };
      }
    }
  }

  // Health: poll the TCP port until Mongo actually accepts connections.
  const deadline = Date.now() + HEALTH_WAIT_MS;
  while (Date.now() < deadline) {
    if (await tcpPing()) {
      pushLog(`[companion] local MongoDB is accepting connections on ${HOST}:${PORT}`);
      return { ok: true, message: "Local MongoDB running." };
    }
    await new Promise((r) => setTimeout(r, HEALTH_POLL_MS));
  }
  return {
    ok: false,
    message: `Local MongoDB container started but ${HOST}:${PORT} never became reachable within ${HEALTH_WAIT_MS / 1000}s — check "docker logs ${CONTAINER_NAME}".`,
  };
}

/** Stop the container. The data volume is deliberately kept. */
export async function stopMongo(): Promise<{ ok: boolean; message: string }> {
  const docker = await dockerAvailable();
  if (!docker.available) return { ok: true, message: "Docker unavailable — nothing to stop." };
  const { exists, running } = await inspectContainer();
  if (!exists || !running) return { ok: true, message: "Local MongoDB already stopped." };
  pushLog(`[companion] stopping ${CONTAINER_NAME} (data volume ${VOLUME_NAME} is kept)`);
  const r = await runDocker(["stop", CONTAINER_NAME]);
  if (r.code !== 0) {
    return {
      ok: false,
      message: `docker stop ${CONTAINER_NAME} failed: ${r.stderr.trim() || "unknown error"}`,
    };
  }
  return { ok: true, message: "Local MongoDB stopped." };
}
