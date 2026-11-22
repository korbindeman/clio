/// <reference types="svelte" />
import { uploadImage } from "./uploadImage.ts";

// One content document in an admin page: load, edit with undo, save the
// draft, publish, and upload photos into it. The server half is
// documentRoutes / publishRoute (documentApi.ts).

interface Wire<T> {
  draft: T;
  revision: number;
  publishedAt: string | null;
  hasChanges: boolean;
}

export class EditableDocument<T> {
  draft = $state<T>(undefined as T);
  revision = $state(0);
  publishedAt = $state<string | null>(null);
  unpublished = $state(false);
  saved = $state("");
  loading = $state(true);
  busy = $state(false);
  error = $state("");
  message = $state("");
  status = $state("");
  history = $state<string[]>([]);
  // Autosave: "saving" while a change waits to be saved.
  saveState = $state<"idle" | "saving" | "saved" | "error">("idle");
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Promise<void> = Promise.resolve();

  readonly dirty = $derived(
    this.revision > 0 && JSON.stringify(this.draft) !== this.saved,
  );

  constructor(
    // The document id, e.g. "pictures".
    readonly id: string,
    // Its admin API route, e.g. "/api/admin/pictures".
    readonly path: string,
    // Where publish posts, e.g. "/api/admin/publish".
    readonly publishPath = "/api/admin/publish",
  ) {}

  apply(wire: Wire<T>) {
    this.draft = wire.draft;
    this.saved = JSON.stringify(wire.draft);
    this.revision = wire.revision;
    this.publishedAt = wire.publishedAt;
    this.unpublished = wire.hasChanges;
  }

  private async request(path: string, method = "GET", body?: unknown) {
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await response.json().catch(() => ({
      error: "Your session may have expired. Sign in again, then retry.",
    }))) as { error?: string };
    if (!response.ok) throw new Error(data.error || "The request failed. Please try again.");
    return data as Wire<T>;
  }

  async load() {
    this.loading = true;
    this.error = "";
    try {
      this.apply(await this.request(this.path));
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  // Call before every change, so it can be undone.
  remember() {
    this.history = [...this.history.slice(-49), JSON.stringify(this.draft)];
    this.message = "";
  }
  edit(change: (draft: T) => void) {
    this.remember();
    change(this.draft);
  }
  undo() {
    const last = this.history.at(-1);
    if (!last) return;
    this.history = this.history.slice(0, -1);
    this.draft = JSON.parse(last);
    this.autosave(0);
  }
  // Applies a change and saves it shortly after (a run of quick changes,
  // like typing, is one save).
  change(edit: (draft: T) => void, wait = 600) {
    this.edit(edit);
    this.autosave(wait);
  }
  autosave(wait = 600) {
    this.saveState = "saving";
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.queue = this.queue.then(async () => {
        try {
          this.error = "";
          await this.saveNow();
          this.saveState = "saved";
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e);
          this.saveState = "error";
        }
      });
    }, wait);
  }
  // Saves a pending change now and waits for it. Throws if that save fails,
  // but the queue itself never rejects, so later autosaves still run.
  async flush() {
    if (this.saveState !== "saving") return this.queue;
    clearTimeout(this.timer);
    const save = this.queue.then(() => this.saveNow());
    this.queue = save.then(
      () => {
        this.error = "";
        this.saveState = "saved";
      },
      (e) => {
        this.error = e instanceof Error ? e.message : String(e);
        this.saveState = "error";
      },
    );
    await save;
  }

  private async run(task: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true;
    this.error = "";
    this.message = "";
    try {
      await task();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
      this.status = "";
    }
  }
  private async saveNow() {
    if (!this.dirty || !this.revision) return;
    const sent = JSON.stringify(this.draft);
    const wire = await this.request(this.path, "PUT", { revision: this.revision, draft: this.draft });
    if (JSON.stringify(this.draft) === sent) return this.apply(wire);
    // Changed while it was saving (an undo, more typing): keep the newer
    // draft, so it is still dirty and the next save sends it.
    this.saved = JSON.stringify(wire.draft);
    this.revision = wire.revision;
    this.publishedAt = wire.publishedAt;
    this.unpublished = wire.hasChanges;
  }
  save(message = "Saved. The live site has not changed yet.") {
    return this.run(async () => {
      await this.saveNow();
      this.message = message;
    });
  }
  publish(message = "Published. It's live.") {
    return this.run(async () => {
      await this.flush();
      await this.saveNow();
      this.apply(
        await this.request(this.publishPath, "POST", { document: this.id, revision: this.revision }),
      );
      this.history = [];
      this.message = message;
    });
  }

  // Uploads photos one by one to `path`; each one lands in the draft as soon
  // as it is stored, so a later failure never loses the earlier ones.
  upload(
    files: File[],
    path: string,
    fields: Record<string, string> = {},
    options: { alpha?: boolean } = {},
  ) {
    return this.run(async () => {
      let count = 0;
      try {
        await this.flush();
        for (const [index, file] of files.entries()) {
          const label = files.length > 1 ? ` ${index + 1} of ${files.length}` : "";
          await this.saveNow();
          this.remember();
          this.apply(
            await uploadImage<Wire<T>>(
              path,
              file,
              this.revision,
              // "Preparing photo…", "Uploading photo 2 of 3: 40%"
              (s) => {
                const percent = /(\d+%)/.exec(s)?.[1];
                this.status = percent
                  ? `Uploading photo${label}: ${percent}`
                  : `${s.replace(/…$/, "")} photo${label}…`;
              },
              fields,
              options,
            ),
          );
          count++;
        }
        this.message = `${count === 1 ? "Photo" : `${count} photos`} added. Publish when you're happy.`;
      } catch (e) {
        throw new Error(
          `${count ? `${count} uploaded. ` : ""}${e instanceof Error ? e.message : String(e)}`,
        );
      }
    });
  }

  beforeUnload = (event: BeforeUnloadEvent) => {
    if (this.dirty || this.busy || this.saveState === "saving") {
      event.preventDefault();
      event.returnValue = "";
    }
  };
}
