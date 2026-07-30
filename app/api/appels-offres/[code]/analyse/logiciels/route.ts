import { NextResponse } from "next/server";
import {
  getSoftwareAnalysisDetailByCode,
  saveConfirmationByCode,
  saveGapByCode,
  saveMatchByCode,
  saveRequirementByCode,
  saveSourceByCode,
  transitionSoftwareAnalysisReviewByCode
} from "@/lib/appels-offres/software-analysis-repository.ts";
import {
  validateConfirmationMutationInput,
  validateGapMutationInput,
  validateMatchMutationInput,
  validateRequirementMutationInput,
  validateSoftwareAnalysisTransitionAction,
  validateSourceMutationInput
} from "@/lib/appels-offres/software-analysis-validation.ts";

export const runtime = "nodejs";

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Operation impossible.";
}

type MutationRequest =
  | {
      action: "save_requirement";
      input: Parameters<typeof validateRequirementMutationInput>[0];
    }
  | {
      action: "save_match";
      input: Parameters<typeof validateMatchMutationInput>[0];
    }
  | {
      action: "save_gap";
      input: Parameters<typeof validateGapMutationInput>[0];
    }
  | {
      action: "save_confirmation";
      input: Parameters<typeof validateConfirmationMutationInput>[0];
    }
  | {
      action: "save_source";
      input: Parameters<typeof validateSourceMutationInput>[0];
    }
  | {
      action: "transition_review";
      transition: string;
    };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const detail = await getSoftwareAnalysisDetailByCode(code);
    return NextResponse.json({ detail });
  } catch (error) {
    const message = asErrorMessage(error);
    const status = /introuvable/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    const body = (await request.json()) as MutationRequest;

    switch (body.action) {
      case "save_requirement":
        await saveRequirementByCode(code, validateRequirementMutationInput(body.input));
        break;
      case "save_match":
        await saveMatchByCode(code, validateMatchMutationInput(body.input));
        break;
      case "save_gap":
        await saveGapByCode(code, validateGapMutationInput(body.input));
        break;
      case "save_confirmation":
        await saveConfirmationByCode(code, validateConfirmationMutationInput(body.input));
        break;
      case "save_source":
        await saveSourceByCode(code, validateSourceMutationInput(body.input));
        break;
      case "transition_review":
        await transitionSoftwareAnalysisReviewByCode(
          code,
          validateSoftwareAnalysisTransitionAction(body.transition)
        );
        break;
      default:
        return NextResponse.json({ error: "Action d'analyse inconnue." }, { status: 400 });
    }

    const detail = await getSoftwareAnalysisDetailByCode(code);
    return NextResponse.json({ detail });
  } catch (error) {
    return NextResponse.json({ error: asErrorMessage(error) }, { status: 400 });
  }
}
