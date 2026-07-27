import type { NonDeletedExcalidrawElement } from "@excalidraw/element/types";

export type SceneCandidate = {
  candidateId: string;
  elements: NonDeletedExcalidrawElement[];
};

/**
 * Collapses the scene into the units a human would point at: a group reads as
 * one shape, so rendering its members as separate thumbnails would produce
 * candidates that match no reference crop.
 */
export const resolveSceneCandidates = (
  elements: readonly NonDeletedExcalidrawElement[],
): SceneCandidate[] => {
  const candidates: SceneCandidate[] = [];
  const candidatesByGroupId = new Map<string, SceneCandidate>();

  for (const element of elements) {
    if (element.isDeleted) {
      continue;
    }

    // groupIds run deepest -> shallowest, so the last entry is the group the
    // canvas selects when the element is clicked.
    const outermostGroupId = element.groupIds[element.groupIds.length - 1];

    if (!outermostGroupId) {
      candidates.push({ candidateId: element.id, elements: [element] });
      continue;
    }

    const existing = candidatesByGroupId.get(outermostGroupId);

    if (existing) {
      existing.elements.push(element);
      continue;
    }

    const candidate: SceneCandidate = {
      candidateId: outermostGroupId,
      elements: [element],
    };
    candidatesByGroupId.set(outermostGroupId, candidate);
    candidates.push(candidate);
  }

  return candidates;
};

export const findSceneCandidate = (
  elements: readonly NonDeletedExcalidrawElement[],
  candidateId: string,
): SceneCandidate | null =>
  resolveSceneCandidates(elements).find(
    (candidate) => candidate.candidateId === candidateId,
  ) ?? null;
