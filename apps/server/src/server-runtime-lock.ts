import { randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { join } from "node:path";

const LOCK_FILENAME = "server-runtime.lock";
const MAX_OWNER_BYTES = 4_096;
const TOKEN_PATTERN = /^[0-9a-f]{32}$/u;

interface ServerRuntimeLockOwner {
  pid: number;
  token: string;
  createdAt: string;
}

export class ServerRuntimeLockError extends Error {
  readonly ownerPid: number | undefined;

  constructor(message: string, ownerPid?: number) {
    super(message);
    this.name = "ServerRuntimeLockError";
    this.ownerPid = ownerPid;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(lockPath: string): ServerRuntimeLockOwner {
  const status = lstatSync(lockPath);
  if (
    !status.isFile() ||
    status.isSymbolicLink() ||
    status.size < 2 ||
    status.size > MAX_OWNER_BYTES
  ) {
    throw new ServerRuntimeLockError(`SymType server lock owner record is invalid: ${lockPath}`);
  }

  let candidate: Partial<ServerRuntimeLockOwner>;
  try {
    candidate = JSON.parse(readFileSync(lockPath, "utf8")) as Partial<ServerRuntimeLockOwner>;
  } catch {
    throw new ServerRuntimeLockError(`SymType server lock owner record is invalid: ${lockPath}`);
  }
  if (
    !Number.isSafeInteger(candidate.pid) ||
    (candidate.pid ?? 0) <= 0 ||
    typeof candidate.token !== "string" ||
    !TOKEN_PATTERN.test(candidate.token) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) {
    throw new ServerRuntimeLockError(`SymType server lock owner record is invalid: ${lockPath}`);
  }
  return candidate as ServerRuntimeLockOwner;
}

function unlinkIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function restoreMovedLock(movedPath: string, lockPath: string): boolean {
  try {
    linkSync(movedPath, lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  unlinkSync(movedPath);
  return true;
}

function privateLockPath(
  dataDirectory: string,
  operation: "owner" | "stale" | "release",
  token: string
): string {
  return join(
    dataDirectory,
    `.${LOCK_FILENAME}.${operation}-${String(process.pid)}-${token}-${randomBytes(8).toString("hex")}`
  );
}

export class ServerRuntimeLock {
  readonly lockPath: string;
  private readonly dataDirectory: string;
  private readonly token: string;
  private released = false;

  private constructor(dataDirectory: string, lockPath: string, token: string) {
    this.dataDirectory = dataDirectory;
    this.lockPath = lockPath;
    this.token = token;
  }

  static acquire(dataDirectory: string): ServerRuntimeLock {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const lockPath = join(dataDirectory, LOCK_FILENAME);
    const token = randomBytes(16).toString("hex");
    const ownerPath = privateLockPath(dataDirectory, "owner", token);
    const owner: ServerRuntimeLockOwner = {
      pid: process.pid,
      token,
      createdAt: new Date().toISOString()
    };

    // The complete, flushed owner record exists before the hard link publishes it
    // at the canonical lock path. Contenders can therefore never observe an empty
    // or partially written lock.
    writeFileSync(ownerPath, `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
      flush: true
    });

    try {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          linkSync(ownerPath, lockPath);
          return new ServerRuntimeLock(dataDirectory, lockPath, token);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "EEXIST") throw error;
        }

        const observedOwner = readOwner(lockPath);
        if (processIsAlive(observedOwner.pid)) {
          throw new ServerRuntimeLockError(
            `Another SymType service already owns this data directory (PID ${String(observedOwner.pid)}).`,
            observedOwner.pid
          );
        }

        const stalePath = privateLockPath(dataDirectory, "stale", token);
        try {
          renameSync(lockPath, stalePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }

        let movedOwner: ServerRuntimeLockOwner;
        try {
          movedOwner = readOwner(stalePath);
        } catch (error) {
          const restored = restoreMovedLock(stalePath, lockPath);
          if (!restored) {
            throw new ServerRuntimeLockError(
              `SymType server lock became invalid during stale-owner recovery; preserved for diagnosis at ${stalePath}.`
            );
          }
          throw error;
        }

        if (
          movedOwner.token !== observedOwner.token ||
          movedOwner.pid !== observedOwner.pid ||
          movedOwner.createdAt !== observedOwner.createdAt
        ) {
          const restored = restoreMovedLock(stalePath, lockPath);
          if (!restored) {
            throw new ServerRuntimeLockError(
              `SymType server lock changed during stale-owner recovery; preserved for diagnosis at ${stalePath}.`
            );
          }
          throw new ServerRuntimeLockError(
            "SymType server lock changed during stale-owner recovery; no database was opened."
          );
        }

        unlinkSync(stalePath);
      }
    } finally {
      unlinkIfPresent(ownerPath);
    }

    throw new ServerRuntimeLockError(
      "SymType could not acquire the service lock after stale-owner recovery."
    );
  }

  release(): void {
    if (this.released) return;
    const releasePath = privateLockPath(this.dataDirectory, "release", this.token);
    try {
      renameSync(this.lockPath, releasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.released = true;
        return;
      }
      throw error;
    }

    let owner: ServerRuntimeLockOwner;
    try {
      owner = readOwner(releasePath);
    } catch (error) {
      const restored = restoreMovedLock(releasePath, this.lockPath);
      if (!restored) return;
      throw error;
    }

    if (owner.pid !== process.pid || owner.token !== this.token) {
      restoreMovedLock(releasePath, this.lockPath);
      return;
    }

    unlinkSync(releasePath);
    this.released = true;
  }
}
