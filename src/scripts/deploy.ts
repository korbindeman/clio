// Deploys the WIP site (preview, from main) or production (from live): checks
// the branch and a clean checkout, applies the D1 migrations, builds, and
// deploys the Worker the build produced.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

export type Environment = "preview" | "production";
export interface DeployOptions {
  // The Worker names in wrangler.jsonc, e.g. { preview: "my-site-preview", production: "my-site" }.
  workers: Record<Environment, string>;
  branches?: Record<Environment, string>;
  // Extra build variables for one environment.
  buildEnv?: (environment: Environment) => Record<string, string>;
  // Checks the build before it ships. Throw to stop the deployment.
  verify?: (environment: Environment) => void | Promise<void>;
  environment?: string;
}

export async function deploy(options: DeployOptions) {
  const environment = options.environment ?? process.argv[2];
  if (environment !== "preview" && environment !== "production")
    throw new Error("Choose preview or production.");
  const branches = options.branches ?? { preview: "main", production: "live" };
  const expectedBranch = branches[environment];
  const checkoutBranch = execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
  const branch = checkoutBranch || process.env.WORKERS_CI_BRANCH;
  if (branch !== expectedBranch)
    throw new Error(
      `Deploy ${environment} from ${expectedBranch}, not ${branch || "detached HEAD"}.`,
    );
  if (
    execFileSync("git", ["status", "--porcelain", "--", ".", ":!.claude"], {
      encoding: "utf8",
    }).trim()
  )
    throw new Error("Commit the reviewed changes before deploying.");
  const flags = environment === "preview" ? ["--env", "preview"] : [];
  // CLI commands select their environment explicitly; never inherit a build override.
  const commandEnv = { ...process.env };
  delete commandEnv.CLOUDFLARE_ENV;
  const wrangler = (...command: string[]) =>
    execFileSync(
      process.execPath,
      ["node_modules/wrangler/bin/wrangler.js", ...command],
      { stdio: "inherit", env: commandEnv },
    );

  // Migrations are additive or drop what the new code no longer reads.
  wrangler("d1", "migrations", "apply", "CMS_DB", "--remote", ...flags);
  execFileSync("npm", ["run", "build"], {
    stdio: "inherit",
    env: {
      ...process.env,
      CLOUDFLARE_ENV: environment === "preview" ? "preview" : "",
      ...options.buildEnv?.(environment),
    },
  });
  await options.verify?.(environment);
  const output = JSON.parse(await readFile("dist/server/wrangler.json", "utf8"));
  if (output.name !== options.workers[environment])
    throw new Error("Build environment does not match deployment target.");
  wrangler("deploy", "--config", "dist/server/wrangler.json");
}
