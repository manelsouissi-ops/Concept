import {
  resolvePythonExecution,
  type PythonExecution,
  type PythonProbe
} from "../../utils/python-interpreter.ts";

export type { PythonExecution };

export async function resolveGoNoGoPythonExecution(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  probe?: PythonProbe;
}) {
  return resolvePythonExecution({
    envVarName: "GO_NO_GO_PYTHON",
    configuredUnavailableMessage:
      "L'interpreteur Python configure pour l'export Go/No-Go est indisponible.",
    noInterpreterMessage:
      "Aucun interpreteur Python 3 compatible n'est disponible pour l'export Go/No-Go.",
    ...options
  });
}
