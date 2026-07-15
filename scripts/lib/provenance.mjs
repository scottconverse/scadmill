import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const REQUIRED_ATTESTATION = "No prohibited source was consulted in producing this change.";

export async function validateProvenanceLedger(root) {
  const entriesDirectory = join(root, "provenance", "entries");
  let filenames;
  try {
    filenames = (await readdir(entriesDirectory)).filter((filename) => filename.endsWith(".json")).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return ["provenance/entries: ledger directory is missing"];
    }
    throw error;
  }

  if (filenames.length === 0) {
    return ["provenance/entries: ledger must contain at least one JSON entry"];
  }

  const errors = [];
  const ids = new Set();
  const ledgerEntries = new Map();
  for (const filename of filenames) {
    const displayPath = `provenance/entries/${filename}`;
    let entry;
    try {
      entry = JSON.parse(await readFile(join(entriesDirectory, filename), "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) {
        errors.push(`${displayPath}: invalid JSON`);
        continue;
      }
      throw error;
    }

    const entryErrors = validateProvenanceEntry(entry, filename);
    errors.push(...entryErrors.map((message) => `${displayPath}: ${message}`));
    if (isRecord(entry) && isNonEmptyString(entry.id)) {
      if (ids.has(entry.id)) {
        errors.push(`${displayPath}: duplicate id ${entry.id}`);
      }
      ids.add(entry.id);
      ledgerEntries.set(entry.id, entry);
    }
  }
  errors.push(...validateDecisionIdCorrections(ledgerEntries));
  return errors;
}

function validateDecisionIdCorrections(entries) {
  const occurrences = new Map();
  const corrections = [];

  for (const [entryId, entry] of entries) {
    for (const decision of Array.isArray(entry.decisions) ? entry.decisions : []) {
      if (!isRecord(decision) || !isNonEmptyString(decision.id)) {
        continue;
      }
      const existing = occurrences.get(decision.id) ?? [];
      existing.push(entryId);
      occurrences.set(decision.id, existing);
    }
    for (const correction of Array.isArray(entry.decisionIdCorrections)
      ? entry.decisionIdCorrections
      : []) {
      if (isCompleteDecisionIdCorrection(correction)) {
        corrections.push({ declarationHost: entryId, correction });
      }
    }
  }

  const errors = [];
  for (const [decisionId, decisionEntries] of occurrences) {
    if (decisionEntries.length < 2) {
      continue;
    }
    const matchingCorrections = corrections.filter(
      ({ correction }) => correction.duplicateId === decisionId,
    );
    const registeredCorrection =
      matchingCorrections.length === 1 ? matchingCorrections[0] : undefined;
    const correction = registeredCorrection?.correction;
    const referencedDuplicates = correction
      ? [correction.retainedEntry, correction.correctedEntry]
      : [];
    const duplicateEntriesMatch =
      correction !== undefined &&
      decisionEntries.length === 2 &&
      new Set(decisionEntries).size === 2 &&
      correction.retainedEntry !== correction.correctedEntry &&
      referencedDuplicates.every((entryId) => decisionEntries.includes(entryId)) &&
      decisionEntries.every((entryId) => referencedDuplicates.includes(entryId));
    const declarationMatches =
      correction !== undefined &&
      registeredCorrection.declarationHost === correction.declarationEntry;
    const authoritativeOccurrences = correction
      ? (occurrences.get(correction.authoritativeId) ?? [])
      : [];
    const authorityMatches =
      correction !== undefined &&
      correction.authoritativeId !== decisionId &&
      entries.has(correction.authorityEntry) &&
      authoritativeOccurrences.length === 1 &&
      authoritativeOccurrences[0] === correction.authorityEntry;

    if (!duplicateEntriesMatch || !declarationMatches || !authorityMatches) {
      const entryList =
        decisionEntries.length === 2
          ? `${decisionEntries[0]} and ${decisionEntries[1]}`
          : decisionEntries.join(", ");
      errors.push(
        `decision id ${decisionId} is duplicated by ${entryList} without a valid append-only correction`,
      );
    }
  }

  for (const { correction } of corrections) {
    if ((occurrences.get(correction.duplicateId) ?? []).length < 2) {
      errors.push(
        `decisionIdCorrections references non-duplicated decision id ${correction.duplicateId}`,
      );
    }
  }
  return errors;
}

export function validateProvenanceChanges(changeLines) {
  const errors = [];
  let additions = 0;
  for (const line of changeLines) {
    const [status, ...paths] = line.split("\t");
    const entryPaths = paths.filter((path) => /^provenance\/entries\/[^/]+\.json$/u.test(path));
    if (entryPaths.length === 0) {
      continue;
    }
    if (status === "A") {
      additions += entryPaths.length;
      continue;
    }
    errors.push(
      `${entryPaths.join(" -> ")}: historical ledger entries are immutable (git status ${status})`,
    );
  }
  if (additions === 0) {
    errors.push("pull request must add at least one provenance/entries/*.json ledger entry");
  }
  return errors;
}

const TOP_LEVEL_FIELDS = new Set([
  "schemaVersion",
  "id",
  "createdAt",
  "summary",
  "author",
  "specSections",
  "filesTouched",
  "externalInputs",
  "providedInputs",
  "decisions",
  "decisionIdCorrections",
  "testEvidence",
  "nearMisses",
  "questions",
  "attestation",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isDecisionId(value) {
  return typeof value === "string" && /^D-\d{4,}$/u.test(value);
}

function isCompleteDecisionIdCorrection(value) {
  return (
    isRecord(value) &&
    isNonEmptyString(value.duplicateId) &&
    isNonEmptyString(value.declarationEntry) &&
    isNonEmptyString(value.retainedEntry) &&
    isNonEmptyString(value.correctedEntry) &&
    isNonEmptyString(value.authoritativeId) &&
    isNonEmptyString(value.authorityEntry)
  );
}

function requireArray(entry, field, errors, { nonEmpty = false } = {}) {
  const value = entry[field];
  if (!Array.isArray(value) || (nonEmpty && value.length === 0)) {
    errors.push(`${field} must be ${nonEmpty ? "a non-empty" : "an"} array`);
    return [];
  }
  return value;
}

function rejectUnknownFields(value, allowedFields, path, errors) {
  for (const field of Object.keys(value).sort()) {
    if (!allowedFields.has(field)) {
      errors.push(`${path} has unknown field: ${field}`);
    }
  }
}

function isSafeRepoPath(value) {
  return (
    isNonEmptyString(value) &&
    !value.includes("\\") &&
    !value.startsWith("/") &&
    !value.split("/").includes("..")
  );
}

function validateObservation(observation, path, errors) {
  if (!isRecord(observation)) {
    errors.push(`${path} must be an object`);
    return;
  }
  rejectUnknownFields(observation, new Set(["command", "observedAt", "outcome"]), path, errors);
  if (!isNonEmptyString(observation.command)) {
    errors.push(`${path}.command must be a non-empty string`);
  }
  if (!isNonEmptyString(observation.observedAt) || Number.isNaN(Date.parse(observation.observedAt))) {
    errors.push(`${path}.observedAt must be an ISO-8601 timestamp`);
  }
  if (!isNonEmptyString(observation.outcome)) {
    errors.push(`${path}.outcome must be a non-empty string`);
  }
}

export function validateProvenanceEntry(entry, filename) {
  if (!isRecord(entry)) {
    return ["entry must be a JSON object"];
  }

  const errors = [];
  if (isNonEmptyString(entry.id) && filename !== `${entry.id}.json`) {
    errors.push(`filename must be ${entry.id}.json`);
  }
  if (entry.attestation !== REQUIRED_ATTESTATION) {
    errors.push("attestation must exactly match the required clean-room statement");
  }
  for (const field of Object.keys(entry).sort()) {
    if (!TOP_LEVEL_FIELDS.has(field)) {
      errors.push(`unknown top-level field: ${field}`);
    }
  }

  if (entry.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (!isNonEmptyString(entry.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry.id)) {
    errors.push("id must be a lowercase kebab-case string");
  }
  if (!isNonEmptyString(entry.createdAt) || Number.isNaN(Date.parse(entry.createdAt))) {
    errors.push("createdAt must be an ISO-8601 timestamp");
  }
  if (!isNonEmptyString(entry.summary)) {
    errors.push("summary must be a non-empty string");
  }

  if (!isRecord(entry.author)) {
    errors.push("author must be an object");
  } else {
    for (const field of ["kind", "name", "model", "role"]) {
      if (!isNonEmptyString(entry.author[field])) {
        errors.push(`author.${field} must be a non-empty string`);
      }
    }
    rejectUnknownFields(entry.author, new Set(["kind", "name", "model", "role"]), "author", errors);
  }

  const specSections = requireArray(entry, "specSections", errors, { nonEmpty: true });
  specSections.forEach((section, index) => {
    if (!isNonEmptyString(section)) {
      errors.push(`specSections[${index}] must be a non-empty string`);
    }
  });

  const filesTouched = requireArray(entry, "filesTouched", errors, { nonEmpty: true });
  filesTouched.forEach((file, index) => {
    if (!isRecord(file) || !isNonEmptyString(file.path) || !isNonEmptyString(file.status)) {
      errors.push(`filesTouched[${index}] must contain path and status strings`);
    } else {
      rejectUnknownFields(file, new Set(["path", "status"]), `filesTouched[${index}]`, errors);
      if (!isSafeRepoPath(file.path)) {
        errors.push(`filesTouched[${index}].path must be a safe repo-relative POSIX path`);
      }
      if (!["added", "modified", "deleted", "renamed"].includes(file.status)) {
        errors.push(`filesTouched[${index}].status must be added, modified, deleted, or renamed`);
      }
    }
  });

  const externalInputs = requireArray(entry, "externalInputs", errors);
  externalInputs.forEach((input, index) => {
    if (isRecord(input)) {
      rejectUnknownFields(
        input,
        new Set(["url", "accessedOn", "purpose"]),
        `externalInputs[${index}]`,
        errors,
      );
    }
    if (!isRecord(input) || !isNonEmptyString(input.url) || !input.url.startsWith("https://")) {
      errors.push(`externalInputs[${index}].url must be an https URL`);
    }
    if (!isRecord(input) || !/^\d{4}-\d{2}-\d{2}$/u.test(input.accessedOn ?? "")) {
      errors.push(`externalInputs[${index}].accessedOn must be YYYY-MM-DD`);
    }
    if (!isRecord(input) || !isNonEmptyString(input.purpose)) {
      errors.push(`externalInputs[${index}].purpose must be a non-empty string`);
    }
  });

  const providedInputs = requireArray(entry, "providedInputs", errors);
  providedInputs.forEach((input, index) => {
    if (isRecord(input)) {
      rejectUnknownFields(
        input,
        new Set(["label", "destination", "sha256"]),
        `providedInputs[${index}]`,
        errors,
      );
    }
    if (!isRecord(input) || !isNonEmptyString(input.label) || !isNonEmptyString(input.destination)) {
      errors.push(`providedInputs[${index}] must contain label and destination strings`);
    }
    if (isRecord(input) && isNonEmptyString(input.destination) && !isSafeRepoPath(input.destination)) {
      errors.push(`providedInputs[${index}].destination must be a safe repo-relative POSIX path`);
    }
    if (!isRecord(input) || !/^[A-Fa-f0-9]{64}$/u.test(input.sha256 ?? "")) {
      errors.push(`providedInputs[${index}].sha256 must be 64 hexadecimal characters`);
    }
  });

  const decisions = requireArray(entry, "decisions", errors);
  decisions.forEach((decision, index) => {
    if (
      !isRecord(decision) ||
      !isNonEmptyString(decision.id) ||
      !isNonEmptyString(decision.topic) ||
      !isNonEmptyString(decision.decision) ||
      !isNonEmptyString(decision.rationale) ||
      !Array.isArray(decision.specBasis)
    ) {
      errors.push(`decisions[${index}] is incomplete`);
      return;
    }
    rejectUnknownFields(
      decision,
      new Set(["id", "topic", "decision", "rationale", "specBasis"]),
      `decisions[${index}]`,
      errors,
    );
    if (!isDecisionId(decision.id)) {
      errors.push(`decisions[${index}].id must be a decision id`);
    }
    decision.specBasis.forEach((basis, basisIndex) => {
      if (!isNonEmptyString(basis)) {
        errors.push(`decisions[${index}].specBasis[${basisIndex}] must be a non-empty string`);
      }
    });
    if (decision.specBasis.length === 0) {
      errors.push(`decisions[${index}].specBasis must be a non-empty array`);
    }
  });

  if (entry.decisionIdCorrections !== undefined) {
    if (!Array.isArray(entry.decisionIdCorrections) || entry.decisionIdCorrections.length === 0) {
      errors.push("decisionIdCorrections must be a non-empty array when present");
    } else {
      entry.decisionIdCorrections.forEach((correction, index) => {
        if (!isRecord(correction)) {
          errors.push(`decisionIdCorrections[${index}] must be an object`);
          return;
        }
        rejectUnknownFields(
          correction,
          new Set([
            "duplicateId",
            "declarationEntry",
            "retainedEntry",
            "correctedEntry",
            "authoritativeId",
            "authorityEntry",
          ]),
          `decisionIdCorrections[${index}]`,
          errors,
        );
        if (!isCompleteDecisionIdCorrection(correction)) {
          errors.push(`decisionIdCorrections[${index}] is incomplete`);
          return;
        }
        for (const field of ["duplicateId", "authoritativeId"]) {
          if (!isDecisionId(correction[field])) {
            errors.push(`decisionIdCorrections[${index}].${field} must be a decision id`);
          }
        }
        for (const field of [
          "declarationEntry",
          "retainedEntry",
          "correctedEntry",
          "authorityEntry",
        ]) {
          if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(correction[field])) {
            errors.push(`decisionIdCorrections[${index}].${field} must be a ledger entry id`);
          }
        }
      });
    }
  }

  const testEvidence = requireArray(entry, "testEvidence", errors);
  testEvidence.forEach((evidence, index) => {
    if (!isRecord(evidence) || !isRecord(evidence.red) || !isRecord(evidence.green)) {
      errors.push(`testEvidence[${index}] must contain red and green observations`);
      return;
    }
    rejectUnknownFields(
      evidence,
      new Set(["criterion", "test", "red", "green"]),
      `testEvidence[${index}]`,
      errors,
    );
    for (const field of ["criterion", "test"]) {
      if (!isNonEmptyString(evidence[field])) {
        errors.push(`testEvidence[${index}].${field} must be a non-empty string`);
      }
    }
    validateObservation(evidence.red, `testEvidence[${index}].red`, errors);
    validateObservation(evidence.green, `testEvidence[${index}].green`, errors);
  });

  const nearMisses = requireArray(entry, "nearMisses", errors);
  nearMisses.forEach((nearMiss, index) => {
    if (
      !isRecord(nearMiss) ||
      !isNonEmptyString(nearMiss.url) ||
      !isNonEmptyString(nearMiss.sought) ||
      !isNonEmptyString(nearMiss.confirmation)
    ) {
      errors.push(`nearMisses[${index}] must contain url, sought, and confirmation strings`);
      return;
    }
    rejectUnknownFields(
      nearMiss,
      new Set(["url", "sought", "confirmation"]),
      `nearMisses[${index}]`,
      errors,
    );
  });

  const questions = requireArray(entry, "questions", errors);
  questions.forEach((question, index) => {
    if (!isNonEmptyString(question)) {
      errors.push(`questions[${index}] must be a non-empty string`);
    }
  });
  return errors;
}
