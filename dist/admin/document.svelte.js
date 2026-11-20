/// <reference types="svelte" />
import { uploadImage } from "./uploadImage.js";
export class EditableDocument {
    id;
    path;
    publishPath;
    draft = $state(undefined);
    revision = $state(0);
    publishedAt = $state(null);
    unpublished = $state(false);
    saved = $state("");
    loading = $state(true);
    busy = $state(false);
    error = $state("");
    message = $state("");
    status = $state("");
    history = $state([]);
    // Autosave: "saving" while a change waits to be saved.
    saveState = $state("idle");
    timer;
    queue = Promise.resolve();
    dirty = $derived(this.revision > 0 && JSON.stringify(this.draft) !== this.saved);
    constructor(
    // The document id, e.g. "pictures".
    id, 
    // Its admin API route, e.g. "/api/admin/pictures".
    path, 
    // Where publish posts, e.g. "/api/admin/publish".
    publishPath = "/api/admin/publish") {
        this.id = id;
        this.path = path;
        this.publishPath = publishPath;
    }
    apply(wire) {
        this.draft = wire.draft;
        this.saved = JSON.stringify(wire.draft);
        this.revision = wire.revision;
        this.publishedAt = wire.publishedAt;
        this.unpublished = wire.hasChanges;
    }
    async request(path, method = "GET", body) {
        const response = await fetch(path, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
        const data = (await response.json().catch(() => ({
            error: "Your session may have expired. Sign in again, then retry.",
        })));
        if (!response.ok)
            throw new Error(data.error || "The request failed. Please try again.");
        return data;
    }
    async load() {
        this.loading = true;
        this.error = "";
        try {
            this.apply(await this.request(this.path));
        }
        catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        }
        finally {
            this.loading = false;
        }
    }
    // Call before every change, so it can be undone.
    remember() {
        this.history = [...this.history.slice(-49), JSON.stringify(this.draft)];
        this.message = "";
    }
    edit(change) {
        this.remember();
        change(this.draft);
    }
    undo() {
        const last = this.history.at(-1);
        if (!last)
            return;
        this.history = this.history.slice(0, -1);
        this.draft = JSON.parse(last);
        this.autosave(0);
    }
    // Applies a change and saves it shortly after (a run of quick changes,
    // like typing, is one save).
    change(edit, wait = 600) {
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
                }
                catch (e) {
                    this.error = e instanceof Error ? e.message : String(e);
                    this.saveState = "error";
                }
            });
        }, wait);
    }
    // Waits for a pending autosave.
    async flush() {
        if (this.saveState === "saving") {
            clearTimeout(this.timer);
            this.queue = this.queue.then(() => this.saveNow());
        }
        await this.queue;
    }
    async run(task) {
        if (this.busy)
            return;
        this.busy = true;
        this.error = "";
        this.message = "";
        try {
            await task();
        }
        catch (e) {
            this.error = e instanceof Error ? e.message : String(e);
        }
        finally {
            this.busy = false;
            this.status = "";
        }
    }
    async saveNow() {
        if (this.dirty && this.revision)
            this.apply(await this.request(this.path, "PUT", { revision: this.revision, draft: this.draft }));
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
            this.apply(await this.request(this.publishPath, "POST", { document: this.id, revision: this.revision }));
            this.history = [];
            this.message = message;
        });
    }
    // Uploads photos one by one to `path`; each one lands in the draft as soon
    // as it is stored, so a later failure never loses the earlier ones.
    upload(files, path, fields = {}, options = {}) {
        return this.run(async () => {
            let count = 0;
            try {
                await this.flush();
                for (const [index, file] of files.entries()) {
                    const label = files.length > 1 ? `Photo ${index + 1} of ${files.length}` : "Photo";
                    await this.saveNow();
                    this.remember();
                    this.apply(await uploadImage(path, file, this.revision, (s) => (this.status = `${label} · ${s}`), fields, options));
                    count++;
                }
                this.message = `${count === 1 ? "Photo" : `${count} photos`} added. Publish when you're happy.`;
            }
            catch (e) {
                throw new Error(`${count ? `${count} uploaded. ` : ""}${e instanceof Error ? e.message : String(e)}`);
            }
        });
    }
    beforeUnload = (event) => {
        if (this.dirty || this.busy || this.saveState === "saving") {
            event.preventDefault();
            event.returnValue = "";
        }
    };
}
