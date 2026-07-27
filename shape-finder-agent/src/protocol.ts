/**
 * Wire protocol for the Shape Finder localhost bridge.
 *
 * The browser owns the live Excalidraw scene, the Node service owns the Cursor
 * SDK agent, so every custom-tool call the agent makes has to round-trip back
 * over this socket. Kept dependency-free so both sides can import it verbatim.
 */

export const SHAPE_FINDER_PROTOCOL_VERSION = 1;

/** Matches the agent's bind address exactly so the client cannot end up on a
 * `localhost` alias (e.g. `::1`) that nothing is listening on. */
export const DEFAULT_SHAPE_FINDER_AGENT_URL = "ws://127.0.0.1:3010";

export const SHAPE_FINDER_TOOLS = {
  getElementThumbnails: "get_element_thumbnails",
  focusElement: "focus_element",
} as const;

export type ShapeFinderToolName =
  typeof SHAPE_FINDER_TOOLS[keyof typeof SHAPE_FINDER_TOOLS];

export type ReferenceImage = {
  /** base64 payload without the `data:` URL prefix */
  data: string;
  mimeType: string;
  fileName?: string;
};

export type ThumbnailCandidate = {
  candidateId: string;
  /** base64 PNG payload without the `data:` URL prefix */
  data: string;
  mimeType: string;
  width: number;
  height: number;
  /** element ids the candidate is composed of (>1 for grouped composites) */
  elementIds: string[];
};

export type GetElementThumbnailsResult = {
  candidates: ThumbnailCandidate[];
};

export type FocusElementResult = {
  candidateId: string;
  elementIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

/**
 * Steps rendered in the sidebar's live-run timeline. The agent maps raw SDK
 * stream events onto these so the browser never has to depend on `@cursor/sdk`.
 */
export type RunStepId =
  | "reference"
  | "thumbnails"
  | "compare"
  | "focus"
  | "summary";

export type RunStepStatus = "running" | "completed" | "error";

export type RunEvent =
  | { kind: "step"; step: RunStepId; status: RunStepStatus; detail?: string }
  | { kind: "assistant-text"; text: string };

/** Terminal outcome of a find run, parsed from the agent's final message. */
export type FindOutcome =
  | { kind: "match"; candidateId: string }
  | { kind: "no-match" }
  | { kind: "ambiguous"; candidateIds: string[] };

/**
 * `startup` failures mean the run never executed (auth, config, network) and
 * are actionable by the operator; `run` failures mean the agent executed and
 * failed mid-flight.
 */
export type RunFailurePhase = "startup" | "run";

export type BrowserToAgentMessage =
  | { type: "find"; requestId: string; image: ReferenceImage }
  | { type: "cancel"; requestId: string }
  | {
      type: "tool-result";
      callId: string;
      ok: true;
      value: GetElementThumbnailsResult | FocusElementResult;
    }
  | { type: "tool-result"; callId: string; ok: false; error: string };

export type AgentToBrowserMessage =
  | { type: "ready"; protocolVersion: number; model?: string }
  | {
      type: "tool-call";
      callId: string;
      tool: ShapeFinderToolName;
      args: Record<string, unknown>;
    }
  | { type: "run-event"; requestId: string; event: RunEvent }
  | { type: "run-finished"; requestId: string; outcome: FindOutcome }
  | {
      type: "run-failed";
      requestId: string;
      phase: RunFailurePhase;
      message: string;
    };

const MATCH_PREFIX = "MATCH";
const NO_MATCH_TOKEN = "NO_MATCH";
const AMBIGUOUS_PREFIX = "AMBIGUOUS";

/**
 * Parses the single-line verdict the agent is prompted to end with. Returning
 * `null` lets callers treat an unparseable reply as a run failure rather than
 * silently reporting "no match".
 */
export const parseFindOutcome = (text: string): FindOutcome | null => {
  const line = text
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reverse()
    .find(
      (entry) =>
        entry.startsWith(MATCH_PREFIX) ||
        entry.startsWith(NO_MATCH_TOKEN) ||
        entry.startsWith(AMBIGUOUS_PREFIX),
    );

  if (!line) {
    return null;
  }

  if (line.startsWith(NO_MATCH_TOKEN)) {
    return { kind: "no-match" };
  }

  if (line.startsWith(AMBIGUOUS_PREFIX)) {
    const candidateIds = line
      .slice(AMBIGUOUS_PREFIX.length)
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    return { kind: "ambiguous", candidateIds };
  }

  const candidateId = line.slice(MATCH_PREFIX.length).trim().split(/\s+/)[0];
  return candidateId ? { kind: "match", candidateId } : null;
};
