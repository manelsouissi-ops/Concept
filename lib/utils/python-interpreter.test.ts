import test from "node:test";
import assert from "node:assert/strict";
import { resolvePythonExecution } from "./python-interpreter.ts";

function makeEnv(values: Record<string, string> = {}) {
  return values as NodeJS.ProcessEnv;
}

const baseOptions = {
  envVarName: "MY_TOOL_PYTHON",
  configuredUnavailableMessage: "configured interpreter unavailable",
  noInterpreterMessage: "no interpreter available"
};

test("prefers the configured override on Linux and never falls back once one is set", async () => {
  const execution = await resolvePythonExecution({
    ...baseOptions,
    platform: "linux",
    env: makeEnv({ MY_TOOL_PYTHON: "custom-python" }),
    probe: async (command) => command === "custom-python" || command === "python3"
  });

  assert.deepEqual(execution, { command: "custom-python", argsPrefix: [] });
});

test("falls back to python3 then python on Linux/macOS when nothing is configured", async () => {
  const python3Execution = await resolvePythonExecution({
    ...baseOptions,
    platform: "linux",
    env: makeEnv(),
    probe: async (command) => command === "python3"
  });
  assert.deepEqual(python3Execution, { command: "python3", argsPrefix: [] });

  const pythonExecution = await resolvePythonExecution({
    ...baseOptions,
    platform: "linux",
    env: makeEnv(),
    probe: async (command) => command === "python"
  });
  assert.deepEqual(pythonExecution, { command: "python", argsPrefix: [] });
});

test("falls back to python then py -3 on Windows", async () => {
  const execution = await resolvePythonExecution({
    ...baseOptions,
    platform: "win32",
    env: makeEnv(),
    probe: async (command, args) => command === "py" && args[0] === "-3"
  });

  assert.deepEqual(execution, { command: "py", argsPrefix: ["-3"] });
});

test("throws a distinguishable error when the configured interpreter is unavailable, without trying other candidates", async () => {
  const probedCommands: string[] = [];

  await assert.rejects(
    resolvePythonExecution({
      ...baseOptions,
      platform: "linux",
      env: makeEnv({ MY_TOOL_PYTHON: "does-not-exist" }),
      probe: async (command) => {
        probedCommands.push(command);
        return false;
      }
    }),
    /configured interpreter unavailable/
  );

  // A configured override must never silently fall back to python3/python -
  // that would defeat the point of letting an operator pin an interpreter.
  assert.deepEqual(probedCommands, ["does-not-exist"]);
});

test("throws a clear, distinguishable error when no interpreter is available at all", async () => {
  await assert.rejects(
    resolvePythonExecution({
      ...baseOptions,
      platform: "linux",
      env: makeEnv(),
      probe: async () => false
    }),
    /no interpreter available/
  );
});

test("never hardcodes a developer-specific path: only the env-var override or conventional names are ever probed", async () => {
  const probedCommands: string[] = [];

  await assert.rejects(
    resolvePythonExecution({
      ...baseOptions,
      platform: "linux",
      env: makeEnv(),
      probe: async (command) => {
        probedCommands.push(command);
        return false;
      }
    })
  );

  for (const command of probedCommands) {
    assert.ok(
      command === "python3" || command === "python",
      `unexpected interpreter candidate: ${command}`
    );
  }
});
