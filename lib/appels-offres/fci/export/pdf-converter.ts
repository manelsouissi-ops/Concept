import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export class FciPdfConversionError extends Error {
  code: "PDF_CONVERTER_UNAVAILABLE" | "PDF_CONVERSION_FAILED";

  constructor(
    code: "PDF_CONVERTER_UNAVAILABLE" | "PDF_CONVERSION_FAILED",
    message: string
  ) {
    super(message);
    this.name = "FciPdfConversionError";
    this.code = code;
  }
}

export type DetectedPdfConverter =
  | { kind: "libreoffice"; executablePath: string }
  | { kind: "word"; executablePath: string };

type ProcessRunner = (
  command: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    cwd?: string;
  }
) => Promise<{ stdout: string; stderr: string }>;

async function runProcess(
  command: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    cwd?: string;
  }
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options?.cwd,
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
            reject(
              new FciPdfConversionError(
                "PDF_CONVERSION_FAILED",
                "La conversion PDF a depasse le delai autorise."
              )
            );
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
      reject(
        new FciPdfConversionError(
          "PDF_CONVERSION_FAILED",
          stderr.trim() || stdout.trim() || "La conversion PDF a echoue."
        )
      );
    });
  });
}

export async function detectPdfConverter() {
  const candidates: DetectedPdfConverter[] = [];

  if (process.platform === "win32") {
    const libreOfficePaths = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe"
    ];
    for (const candidate of libreOfficePaths) {
      try {
        await fs.access(candidate);
        candidates.push({ kind: "libreoffice", executablePath: candidate });
        break;
      } catch {
        // continue
      }
    }
  }

  return candidates[0] ?? null;
}

function buildPowerShellCommand(inputPath: string, outputPath: string) {
  const escapedInput = inputPath.replace(/'/g, "''");
  const escapedOutput = outputPath.replace(/'/g, "''");
  return [
    "$word = $null;",
    "$document = $null;",
    "try {",
    "  $word = New-Object -ComObject Word.Application;",
    "  $word.Visible = $false;",
    "  $word.DisplayAlerts = 0;",
    `  $document = $word.Documents.Open('${escapedInput}', $false, $true);`,
    `  $document.ExportAsFixedFormat('${escapedOutput}', 17);`,
    "} finally {",
    "  if ($document -ne $null) { $document.Close($false) | Out-Null; }",
    "  if ($word -ne $null) { $word.Quit() | Out-Null; }",
    "}"
  ].join(" ");
}

export async function convertDocxToPdf(
  inputPath: string,
  outputDirectory: string,
  options?: {
    converter?: DetectedPdfConverter | null;
    runner?: ProcessRunner;
  }
) {
  const converter =
    options && "converter" in options
      ? (options.converter ?? null)
      : await detectPdfConverter();
  if (!converter) {
    throw new FciPdfConversionError(
      "PDF_CONVERTER_UNAVAILABLE",
      "L’export PDF n’est pas disponible sur cet environnement. Le téléchargement Word reste disponible."
    );
  }

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(outputDirectory, `${baseName}.pdf`);
  const runner = options?.runner ?? runProcess;

  if (converter.kind === "libreoffice") {
    await runner(
      converter.executablePath,
      ["--headless", "--convert-to", "pdf", "--outdir", outputDirectory, inputPath],
      { timeoutMs: 60_000, cwd: outputDirectory }
    );
  } else {
    const powershell =
      process.platform === "win32"
        ? path.join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe"
          )
        : "powershell";

    try {
      await runner(
        powershell,
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildPowerShellCommand(inputPath, outputPath)],
        { timeoutMs: 60_000, cwd: outputDirectory }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /0x80070520|NoCOMClassIdentified|CLSID|ouverture de session/i.test(message)
      ) {
        throw new FciPdfConversionError(
          "PDF_CONVERTER_UNAVAILABLE",
          "Microsoft Word est detecte localement mais n'est pas exploitable pour une conversion PDF headless dans cette session. Installez LibreOffice pour activer l'export PDF."
        );
      }

      throw error;
    }
  }

  try {
    await fs.access(outputPath);
  } catch {
    throw new FciPdfConversionError(
      "PDF_CONVERSION_FAILED",
      "La conversion PDF n'a produit aucun fichier exploitable."
    );
  }

  return {
    outputPath,
    converterKind: converter.kind
  };
}
