import { spawn } from "node:child_process";

export type PythonExecution = {
  command: string;
  argsPrefix: string[];
};

type PythonProbe = (command: string, args: string[]) => Promise<boolean>;

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

function readConfiguredGoNoGoPython(env: NodeJS.ProcessEnv) {
  const configured = env.GO_NO_GO_PYTHON?.trim();
  return configured ? configured : null;
}

function buildPythonCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): Array<PythonExecution & { configured: boolean }> {
  const configured = readConfiguredGoNoGoPython(env);
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

export async function resolveGoNoGoPythonExecution(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  probe?: PythonProbe;
}) {
  const platform = options?.platform ?? process.platform;
  const env = options?.env ?? process.env;
  const probe = options?.probe ?? defaultPythonProbe;
  const candidates = buildPythonCandidates(platform, env);

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
    throw new Error(
      "L'interpreteur Python configure pour l'export Go/No-Go est indisponible."
    );
  }

  throw new Error(
    "Aucun interpreteur Python 3 compatible n'est disponible pour l'export Go/No-Go."
  );
}
