export type PeriodType = "daily" | "weekly" | "monthly";
export type Scope = "public" | "all";

export interface RouteState {
  scope: Scope;
  isOverview: boolean;
  period: PeriodType;
  key: string;
  repository: string | null;
  cursor: string | null;
}

export interface Repository {
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
}

export interface Commit {
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

export interface ChangeRecord {
  id: string;
  repository: {
    name: string;
    fullName: string;
    url: string;
    visibility: Repository["visibility"];
  };
  periodType: PeriodType;
  periodKey: string;
  commitCount: number;
  firstCommittedAt: string;
  lastCommittedAt: string;
  summary: {
    text: string | null;
    status: "pending" | "generating" | "ready" | "failed";
    model: string | null;
    generatedAt: string | null;
  };
  commitLogUrl: string;
  commits: Commit[];
}

export interface PeriodResponse {
  scope: Scope;
  repository: {
    requestedName: string;
    canonicalName: string;
  } | null;
  period: {
    type: PeriodType;
    key: string;
    start: string;
    endExclusive: string;
    previousKey: string;
    nextKey: string;
  };
  stats: {
    repository_count: number;
    commit_count: number;
  };
  sync: {
    lastSyncedAt: string | null;
    status: "idle" | "running" | "succeeded" | "failed";
    startedAt: string | null;
    completedAt: string | null;
  };
  records: ChangeRecord[];
  nextCursor: string | null;
}

export interface SessionResponse {
  authenticated: boolean;
  user: { id: string; login: string } | null;
}

export interface BootstrapData {
  path: string;
  periodData: PeriodResponse | null;
  overviewData: Record<PeriodType, PeriodResponse> | null;
  repositories: Repository[];
  session: SessionResponse | null;
  error: string | null;
}

declare global {
  interface Window {
    __CHANGES_BOOTSTRAP__?: BootstrapData;
  }
}
