interface Wire<T> {
    draft: T;
    revision: number;
    publishedAt: string | null;
    hasChanges: boolean;
}
export declare class EditableDocument<T> {
    readonly id: string;
    readonly path: string;
    readonly publishPath: string;
    draft: T;
    revision: number;
    publishedAt: string | null;
    unpublished: boolean;
    saved: string;
    loading: boolean;
    busy: boolean;
    error: string;
    message: string;
    status: string;
    history: string[];
    readonly dirty: boolean;
    constructor(id: string, path: string, publishPath?: string);
    apply(wire: Wire<T>): void;
    private request;
    load(): Promise<void>;
    remember(): void;
    edit(change: (draft: T) => void): void;
    undo(): void;
    private run;
    private saveNow;
    save(message?: string): Promise<void>;
    publish(message?: string): Promise<void>;
    upload(files: File[], path: string, fields?: Record<string, string>): Promise<void>;
    beforeUnload: (event: BeforeUnloadEvent) => void;
}
export {};
