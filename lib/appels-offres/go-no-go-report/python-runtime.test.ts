import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoNoGoPythonExecution } from "./python-runtime.ts";

function makeEnv(values: Record<string, string> = {}) {
  return values as NodeJS.ProcessEnv;
}

test("Windows resolver prefers the configured override", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "win32",
    env: makeEnv({ GO_NO_GO_PYTHON: "custom-python" }),
    probe: async (command) => command === "custom-python" || command === "python"
  });

  assert.deepEqual(execution, {
    command: "custom-python",
    argsPrefix: []
  });
});

test("Windows resolver uses python when available", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "win32",
    env: makeEnv(),
    probe: async (command) => command === "python"
  });

  assert.deepEqual(execution, {
    command: "python",
    argsPrefix: []
  });
});

test("Windows resolver falls back to py -3", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "win32",
    env: makeEnv(),
    probe: async (command, args) => command === "py" && args[0] === "-3"
  });

  assert.deepEqual(execution, {
    command: "py",
    argsPrefix: ["-3"]
  });
});

test("Linux resolver prefers the configured override", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "linux",
    env: makeEnv({ GO_NO_GO_PYTHON: "custom-python" }),
    probe: async (command) => command === "custom-python" || command === "python3"
  });

  assert.deepEqual(execution, {
    command: "custom-python",
    argsPrefix: []
  });
});

test("Linux resolver uses python3 when available", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "linux",
    env: makeEnv(),
    probe: async (command) => command === "python3"
  });

  assert.deepEqual(execution, {
    command: "python3",
    argsPrefix: []
  });
});

test("Linux resolver falls back to python", async () => {
  const execution = await resolveGoNoGoPythonExecution({
    platform: "linux",
    env: makeEnv(),
    probe: async (command) => command === "python"
  });

  assert.deepEqual(execution, {
    command: "python",
    argsPrefix: []
  });
});
