export declare function serialiseD1(db: D1Database): D1Database;
export declare function withSerialisedAdmin<T>(op: () => Promise<T>): Promise<T>;
export declare function serialiseBindings<T extends {
    CMS_DB: D1Database;
    AUTH_DB?: D1Database;
    WIP_DB?: D1Database;
}>(env: T): T;
