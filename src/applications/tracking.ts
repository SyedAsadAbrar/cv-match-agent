import { randomUUID } from "node:crypto";
import {
  applicationSchema,
  type Application,
  type ApplicationStatus,
} from "../domain/schemas";

const transitions: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ["preparing", "applied", "withdrawn"],
  preparing: ["saved", "applied", "withdrawn"],
  applied: [
    "recruiter-contact",
    "interview",
    "assessment",
    "offer",
    "rejected",
    "withdrawn",
  ],
  "recruiter-contact": [
    "interview",
    "assessment",
    "offer",
    "rejected",
    "withdrawn",
  ],
  interview: ["assessment", "offer", "rejected", "withdrawn"],
  assessment: ["interview", "offer", "rejected", "withdrawn"],
  offer: ["withdrawn"],
  rejected: [],
  withdrawn: [],
};

export function transitionApplication(
  existing: Application | undefined,
  jobId: string,
  status: ApplicationStatus,
  applicationUrl?: string,
): Application {
  const now = new Date().toISOString();
  if (
    existing &&
    existing.status !== status &&
    !transitions[existing.status].includes(status)
  ) {
    throw new Error(
      `Cannot transition an application from ${existing.status} to ${status}.`,
    );
  }
  return applicationSchema.parse({
    ...(existing ?? {
      id: randomUUID(),
      jobId,
      notes: "",
      recruiterDetails: "",
      nextAction: "",
      interviewDates: [],
    }),
    status,
    applicationUrl: applicationUrl ?? existing?.applicationUrl,
    appliedAt:
      status === "applied" ? (existing?.appliedAt ?? now) : existing?.appliedAt,
    updatedAt: now,
  });
}

export type ApplicationUpdate = Partial<
  Pick<
    Application,
    | "status"
    | "applicationUrl"
    | "cvVersion"
    | "notes"
    | "recruiterDetails"
    | "nextAction"
    | "followUpAt"
    | "interviewDates"
  >
>;

export function updateApplication(
  existing: Application | undefined,
  jobId: string,
  update: ApplicationUpdate,
  fallbackApplicationUrl?: string,
): Application {
  const status = update.status ?? existing?.status ?? "saved";
  const transitioned = transitionApplication(
    existing,
    jobId,
    status,
    update.applicationUrl ?? fallbackApplicationUrl,
  );
  return applicationSchema.parse({
    ...transitioned,
    ...update,
    applicationUrl:
      update.applicationUrl ??
      transitioned.applicationUrl ??
      fallbackApplicationUrl,
    updatedAt: new Date().toISOString(),
  });
}

export function isApplicationTransitionAllowed(
  from: ApplicationStatus,
  to: ApplicationStatus,
): boolean {
  return from === to || transitions[from].includes(to);
}
