import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { buildFciExportFileName } from "./filenames.ts";
import { buildFciDocxMapping } from "./mapping.ts";
import { getFciTemplatePath } from "./templates.ts";
import type {
  FciDocxExportInstruction,
  FciExportSource,
  FciGeneratedArtifact
} from "./types.ts";

type ProcessResult = {
  stdout: string;
  stderr: string;
};

function runProcess(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  }
) {
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: options?.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let completed = false;

    const timeoutId =
      options?.timeoutMs != null
        ? setTimeout(() => {
            if (completed) {
              return;
            }
            completed = true;
            child.kill();
            reject(new Error(`Le processus ${command} a depasse le delai autorise.`));
          }, options.timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });
    child.on("close", (code) => {
      if (completed) {
        return;
      }
      completed = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr.trim() || stdout.trim() || `Le processus ${command} a echoue (${code}).`));
    });
  });
}

function getPythonDocxExporterScriptPath() {
  return path.join(
    process.cwd(),
    "lib",
    "appels-offres",
    "fci",
    "export",
    "python_docx_exporter.py"
  );
}

export function buildDocxExportInstruction(
  source: FciExportSource,
  outputPath: string
): FciDocxExportInstruction {
  const mapping = buildFciDocxMapping(source);
  return {
    templatePath: getFciTemplatePath(source.moduleCode),
    outputPath,
    draftIndicator: source.state === "draft" ? "BROUILLON" : null,
    headerSuffix: source.state === "draft" ? "BROUILLON" : null,
    singleValueRows: mapping.singleValueRows,
    repeatableTables: mapping.repeatableTables
  };
}

export async function runDocxExportInstruction(
  instruction: FciDocxExportInstruction,
  tempDir: string
) {
  const instructionPath = path.join(tempDir, `instruction-${randomUUID()}.json`);
  await fs.writeFile(instructionPath, JSON.stringify(instruction, null, 2), "utf8");
  await runProcess("python", [getPythonDocxExporterScriptPath(), instructionPath], {
    timeoutMs: 30_000,
    env: {
      ...process.env,
      PYTHONIOENCODING: "utf-8"
    }
  });
}

export async function generateFciDocxArtifact(source: FciExportSource): Promise<{
  artifact: FciGeneratedArtifact;
  tempDir: string;
  docxPath: string;
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concept-fci-export-"));
  const outputPath = path.join(tempDir, buildFciExportFileName(source, "docx"));
  const instruction = buildDocxExportInstruction(source, outputPath);
  await runDocxExportInstruction(instruction, tempDir);

  const buffer = await fs.readFile(outputPath);
  return {
    artifact: {
      buffer,
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: path.basename(outputPath),
      converter: "docx-template"
    },
    tempDir,
    docxPath: outputPath
  };
}

export async function cleanupExportTempDir(tempDir: string | null | undefined) {
  if (!tempDir) {
    return;
  }

  await fs.rm(tempDir, { recursive: true, force: true });
}
