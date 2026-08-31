import { z } from "zod";

export const periodTypes = ["daily", "weekly", "monthly"] as const;
export type PeriodType = (typeof periodTypes)[number];

export const scopes = ["public", "all"] as const;
export type Scope = (typeof scopes)[number];

export interface PeriodBounds {
  type: PeriodType;
  key: string;
  start: string;
  endExclusive: string;
  endInclusive: string;
}

export interface RepositoryRow {
  id: string;
  owner_login: string;
  name: string;
  full_name: string;
  visibility: "public" | "private" | "internal";
  html_url: string;
  default_branch: string;
  is_archived: number;
  is_fork: number;
  github_updated_at: string | null;
  last_synced_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface CommitRow {
  repository_id: string;
  oid: string;
  message_headline: string;
  message_body: string | null;
  committed_at: string;
  author_github_user_id: string | null;
  author_login: string | null;
  html_url: string;
  is_merge: number;
}

export interface SessionRow {
  github_user_id: string;
  github_login: string;
  expires_at: string;
}

export interface ChangeRecordRow {
  id: string;
  scope: Scope;
  period_type: PeriodType;
  period_key: string;
  period_start: string;
  period_end: string;
  repository_id: string;
  commit_count: number;
  first_committed_at: string;
  last_committed_at: string;
  source_fingerprint: string;
  summary_text: string | null;
  summary_status: "pending" | "generating" | "ready" | "failed";
  summary_model: string | null;
  prompt_version: string | null;
  generated_at: string | null;
  summary_error: string | null;
  repository_name: string;
  repository_full_name: string;
  repository_url: string;
  repository_visibility: RepositoryRow["visibility"];
  default_branch: string;
}

export const queueMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("sync-owner"),
    requestedAt: z.iso.datetime(),
  }),
  z.object({
    type: z.literal("sync-repository"),
    repositoryId: z.string().min(1),
    requestedAt: z.iso.datetime(),
    since: z.iso.datetime().optional(),
    page: z.number().int().positive().optional(),
  }),
  z.object({
    type: z.literal("generate-summary"),
    changeRecordId: z.string().min(1),
    requestedAt: z.iso.datetime(),
  }),
]);

export type QueueMessage = z.infer<typeof queueMessageSchema>;
