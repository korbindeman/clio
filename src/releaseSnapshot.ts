import { readFileSync } from "node:fs";
import { join } from "node:path";
import config from "virtual:clio/config";
import { parseSnapshot, type Snapshot } from "./snapshot.ts";

let cached: Snapshot | undefined;

// Runs only during a static release build, in Node.
export function readSnapshotDocument(id: string) {
  const dir = process.env.RELEASE_SNAPSHOT;
  if (!dir)
    throw new Error("Set RELEASE_SNAPSHOT to the exported WIP content.");
  cached ??= parseSnapshot(
    JSON.parse(readFileSync(join(dir, "content.json"), "utf8")),
    config.documents,
  );
  return cached.documents[id];
}
