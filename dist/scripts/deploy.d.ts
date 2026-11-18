export type Environment = "preview" | "production";
export interface DeployOptions {
    workers: Record<Environment, string>;
    branches?: Record<Environment, string>;
    buildEnv?: (environment: Environment) => Record<string, string>;
    verify?: (environment: Environment) => void | Promise<void>;
    environment?: string;
}
export declare function deploy(options: DeployOptions): Promise<void>;
