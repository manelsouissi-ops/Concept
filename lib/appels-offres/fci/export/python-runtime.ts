import {
  resolvePythonExecution,
  type PythonExecution,
  type PythonProbe
} from "../../../utils/python-interpreter.ts";

export type { PythonExecution };

export async function resolveFciDocxPythonExecution(options?: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  probe?: PythonProbe;
}) {
  return resolvePythonExecution({
    envVarName: "PYTHON_BIN",
    configuredUnavailableMessage:
      "L'interpreteur Python configure (PYTHON_BIN) pour l'export DOCX FCI est indisponible.",
    noInterpreterMessage:
      "Aucun interpreteur Python 3 compatible n'est disponible pour l'export DOCX FCI.",
    ...options
  });
}
