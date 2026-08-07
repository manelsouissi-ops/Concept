export type GoNoGoStatus = "a_decider" | "go" | "no_go" | "reouvert";

export type GoNoGoDecisionValue = "go" | "no_go";

export type GoNoGoDecisionRecord = {
  id: number;
  appelOffresId: number;
  version: number;
  status: GoNoGoStatus;
  decision: GoNoGoDecisionValue | null;
  rationale: string | null;
  reserves: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InsertGoNoGoDecisionVersionInput = {
  status: GoNoGoStatus;
  decision: GoNoGoDecisionValue | null;
  rationale: string | null;
  reserves: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};
