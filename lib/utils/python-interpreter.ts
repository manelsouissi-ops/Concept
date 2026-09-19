import { spawn } from "node:child_process";

export type PythonExecution = {
  command: string;
  argsPrefix: string[];
};

export type PythonProbe = (command: string, args: string[]) => Promise<boolean>;

const PYTHON_3_PROBE_ARGS = [
  "-c",
  "import sys; raise SystemExit(0 if sys.version_info >= (3, 0) else 1)"
];

async function defaultPythonProbe(command: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "ignore"]
    });

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function readConfiguredPython(env: NodeJS.ProcessEnv, envVarName: string) {
  const configured = env[envVarName]?.trim();
  return configured ? configured : null;
}

function buildPythonCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  envVarName: string
): Array<PythonExecution & { configured: boolean }> {
  const configured = readConfiguredPython(env, envVarName);
  if (configured) {
    return [{ command: configured, argsPrefix: [], configured: true }];
  }

  if (platform === "win32") {
    return [
      { command: "python", argsPrefix: [], configured: false },
      { command: "py", argsPrefix: ["-3"], configured: false }
    ];
  }

  return [
    { command: "python3", argsPrefix: [], configured: false },
    { command: "python", argsPrefix: [], configured: false }
  ];
}

/**
 * Resolve a working Python 3 interpreter across platforms, without ever
 * hardcoding a developer-specific path: an explicit env var override is
 * tried first (and only that - no silent fallback once one is configured),
 * then platform-appropriate conventional names are probed in order. Throws
 * a clear, distinguishable error if no interpreter is available.
 */
export async function resolvePythonExecution(options: {
  envVarName: string;
  configuredUnavailableMessage: string;
  noInterpreterMessage: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  probe?: PythonProbe;
}): Promise<PythonExecution> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const probe = options.probe ?? defaultPythonProbe;
  const candidates = buildPythonCandidates(platform, env, options.envVarName);

  for (const candidate of candidates) {
    const probeArgs = [...candidate.argsPrefix, ...PYTHON_3_PROBE_ARGS];
    if (await probe(candidate.command, probeArgs)) {
      return {
        command: candidate.command,
        argsPrefix: candidate.argsPrefix
      };
    }
  }

  if (candidates.some((candidate) => candidate.configured)) {
    throw new Error(options.configuredUnavailableMessage);
  }

  throw new Error(options.noInterpreterMessage);
}
