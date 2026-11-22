export declare const MIN_PASSWORD_LENGTH = 12;
export declare function hashPassword(password: string): Promise<string>;
export declare function verifyPassword({ hash, password, }: {
    hash: string;
    password: string;
}): Promise<boolean>;
