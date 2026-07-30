import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const KEY_NAME = "GEMINI_API_KEY";
const rawKey = process.env[KEY_NAME];
const apiKey = typeof rawKey === "string" ? rawKey.trim() : "";
const preferredModelName = "models/gemini-3.6-flash";
const modelsEndpoint = "https://generativelanguage.googleapis.com/v1beta/models";
const openAiCompatibleEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

function maskSecret(value) {
  if (!value) {
    return "(missing)";
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}...${value.slice(-2)}`;
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function summarizeGoogleError(errorBody) {
  const error = errorBody?.error;
  if (!error || typeof error !== "object") {
    return null;
  }

  return {
    code: error.code ?? null,
    status: error.status ?? null,
    message: error.message ?? null,
    details: Array.isArray(error.details) ? error.details : []
  };
}

function classifyGoogleFailure(status, errorBody) {
  const summary = summarizeGoogleError(errorBody);
  const message = (summary?.message ?? "").toLowerCase();
  const errorStatus = (summary?.status ?? "").toUpperCase();

  if (!apiKey) {
    return "missing_key";
  }

  if (status === 400 && message.includes("api key not valid")) {
    return "invalid_key";
  }

  if (status === 401) {
    return "invalid_key";
  }

  if (status === 403 && message.includes("api has not been used")) {
    return "api_disabled";
  }

  if (status === 403 && message.includes("denied access")) {
    return "project_denied";
  }

  if (status === 403 && (message.includes("quota") || errorStatus === "RESOURCE_EXHAUSTED")) {
    return "quota_exceeded";
  }

  if (status === 404 || message.includes("not found") || message.includes("not supported")) {
    return "model_unavailable";
  }

  if (errorStatus === "RESOURCE_EXHAUSTED" || status === 429) {
    return "quota_exceeded";
  }

  return "unknown_failure";
}

function isGenerateContentCapable(model) {
  return Array.isArray(model?.supportedGenerationMethods)
    && model.supportedGenerationMethods.includes("generateContent");
}

function isStableFlashModel(model) {
  const name = String(model?.name ?? "");
  return (
    isGenerateContentCapable(model)
    && /flash/i.test(name)
    && !/(preview|exp|experimental)/i.test(name)
  );
}

function pickModel(models) {
  const preferred = models.find((model) => model.name === preferredModelName);
  if (preferred) {
    return preferred;
  }

  return models.find(isStableFlashModel) ?? null;
}

async function requestJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    body
  };
}

async function listModels() {
  const response = await requestJson(modelsEndpoint, {
    method: "GET",
    headers: {
      "x-goog-api-key": apiKey
    }
  });

  printSection("Models List");
  console.log(`Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    console.log(JSON.stringify(response.body, null, 2));
    return {
      ...response,
      classification: classifyGoogleFailure(response.status, response.body),
      generateContentModels: []
    };
  }

  const models = Array.isArray(response.body?.models) ? response.body.models : [];
  const generateContentModels = models.filter(isGenerateContentCapable);
  console.log("Models supporting generateContent:");
  for (const model of generateContentModels) {
    console.log(`- ${model.name}`);
  }

  return {
    ...response,
    classification: "success",
    generateContentModels
  };
}

async function generateContent(modelName) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent`;
  const response = await requestJson(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: "Reply only with OK"
            }
          ]
        }
      ]
    })
  });

  printSection(`Generate Content (${modelName})`);
  console.log(`Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    console.log(JSON.stringify(response.body, null, 2));
    return {
      ...response,
      classification: classifyGoogleFailure(response.status, response.body),
      modelName
    };
  }

  const text =
    response.body?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("").trim()
    ?? "";
  console.log(JSON.stringify({
    model: modelName,
    text
  }, null, 2));

  return {
    ...response,
    classification: "success",
    modelName
  };
}

async function generateContentOpenAiCompatible(modelName) {
  const response = await requestJson(openAiCompatibleEndpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: modelName.replace(/^models\//, ""),
      messages: [
        {
          role: "user",
          content: "Reply only with OK"
        }
      ]
    })
  });

  printSection(`OpenAI-Compatible Chat Completions (${modelName})`);
  console.log(`Status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    console.log(JSON.stringify(response.body, null, 2));
    console.log(`Diagnostic classification: ${classifyGoogleFailure(response.status, response.body)}`);

    return {
      ...response,
      classification: classifyGoogleFailure(response.status, response.body),
      modelName
    };
  }

  const text =
    response.body?.choices?.[0]?.message?.content?.trim()
    ?? "";
  console.log(JSON.stringify({
    model: modelName.replace(/^models\//, ""),
    text
  }, null, 2));
  console.log("Diagnostic classification: success");

  return {
    ...response,
    classification: "success",
    modelName
  };
}

function printComparisonTable(nativeResult, openAiResult) {
  printSection("Comparison Table");

  const rows = [
    ["Native API", String(nativeResult.status), nativeResult.classification],
    ["OpenAI-compatible API", String(openAiResult.status), openAiResult.classification]
  ];

  const headers = ["Endpoint", "Status", "Classification"];
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length))
  );

  const formatRow = (row) => row.map((cell, index) => cell.padEnd(widths[index], " ")).join(" | ");
  const divider = widths.map((width) => "-".repeat(width)).join("-|-");

  console.log(formatRow(headers));
  console.log(divider);
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

async function main() {
  printSection("Environment");
  console.log(`${KEY_NAME} found: ${apiKey ? "yes" : "no"}`);
  console.log(`Length: ${apiKey.length}`);
  console.log(`Masked value: ${maskSecret(apiKey)}`);

  if (!apiKey) {
    console.error(`Missing ${KEY_NAME} in .env.local.`);
    process.exitCode = 1;
    return;
  }

  const modelsResult = await listModels();
  const preferredModel = modelsResult.generateContentModels.find((model) => model.name === preferredModelName);
  const selectedModel = preferredModel?.name ?? preferredModelName;
  console.log(`Selected model for test: ${selectedModel}`);

  if (!preferredModel) {
    printSection("Preferred Model Verification");
    console.log(JSON.stringify({
      preferredModel: preferredModelName,
      foundInModelsList: false,
      supportsGenerateContent: false,
      diagnosticClassification: "model_unavailable"
    }, null, 2));
    console.error("Result: the preferred model is not currently listed as generateContent-capable for this key/project.");
    process.exitCode = 1;
    return;
  }

  printSection("Preferred Model Verification");
  console.log(JSON.stringify({
    preferredModel: preferredModelName,
    foundInModelsList: true,
    supportsGenerateContent: true
  }, null, 2));

  let generationResult = await generateContent(selectedModel);

  if (
    modelsResult.ok
    && generationResult.classification === "model_unavailable"
    && selectedModel !== preferredModelName
  ) {
    const fallback = pickModel(modelsResult.generateContentModels);
    if (fallback && fallback.name !== selectedModel) {
      generationResult = await generateContent(fallback.name);
    }
  }

  const openAiCompatibleResult = await generateContentOpenAiCompatible(
    generationResult.modelName ?? selectedModel
  );

  printSection("Diagnostic Summary");
  const summary = {
    modelsListStatus: modelsResult.status,
    modelsListClassification: modelsResult.classification,
    generateContentStatus: generationResult.status,
    generateContentClassification: generationResult.classification,
    openAiCompatibleStatus: openAiCompatibleResult.status,
    openAiCompatibleClassification: openAiCompatibleResult.classification,
    testedModel: generationResult.modelName ?? selectedModel
  };
  console.log(JSON.stringify(summary, null, 2));
  printComparisonTable(generationResult, openAiCompatibleResult);

  if (
    generationResult.status === 403
    && openAiCompatibleResult.status === 403
    && generationResult.classification === "project_denied"
    && openAiCompatibleResult.classification === "project_denied"
  ) {
    console.error("Conclusion: both endpoints return 403 PERMISSION_DENIED project denied access. The restriction is project/account level, not endpoint-specific.");
  }

  if (modelsResult.ok && generationResult.ok && openAiCompatibleResult.ok) {
    console.log("Result: Gemini direct API access is working. Any remaining issue is upstream of this script.");
    process.exitCode = 0;
    return;
  }

  switch (generationResult.classification || openAiCompatibleResult.classification || modelsResult.classification) {
    case "missing_key":
    case "invalid_key":
      console.error("Result: authentication failed before n8n is involved.");
      break;
    case "api_disabled":
      console.error("Result: the Gemini API is not enabled or not usable for this project.");
      break;
    case "project_denied":
      console.error("Result: Google reached the project successfully but denied project access.");
      break;
    case "model_unavailable":
      console.error("Result: the requested model is unavailable for this key/project.");
      break;
    case "quota_exceeded":
      console.error("Result: quota or resource limits blocked the request.");
      break;
    default:
      console.error("Result: direct Gemini access failed before n8n is involved.");
      break;
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error("\n=== Diagnostic Failure ===");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
