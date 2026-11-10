/** ANNON AI OFFICE — public API contracts for eventual TypeScript/React migration. */
export type OrgId = string;
export type Priority = 'P0' | 'P1' | 'P2';
export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';
export type EvidenceStatus = 'sample' | 'reported' | 'verified' | 'approved';
export type MembershipRole = 'owner' | 'manager' | 'member' | 'viewer';
export type ApprovalAction = 'task.create' | 'task.complete';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface OrganizationSummary {
  id: OrgId;
  name: string;
  area: string;
  role?: MembershipRole;
  can_approve?: 0 | 1;
}
export interface TaskRecord {
  id: string;
  org_id: OrgId;
  project_id: string | null;
  project_name?: string | null;
  org_name?: string;
  title: string;
  description: string;
  priority: Priority;
  status: TaskStatus;
  due_on: string | null;
  source_status: EvidenceStatus;
  source_note: string;
  updated_at: string;
}
export interface DecisionRecord {
  id: string;
  org_id?: OrgId;
  org_name?: string;
  title: string;
  state: 'proposed' | 'pending' | 'approved' | 'rejected';
  due_on: string | null;
  source_note: string;
}
export interface BriefingResponse {
  asOf: string;
  scope: 'all' | OrgId;
  organizations: OrganizationSummary[];
  counts: { active: number; overdue: number; blocked: number; dueSoon: number; pendingDecisions: number };
  topPriorities: TaskRecord[];
  overdue: TaskRecord[];
  blocked: TaskRecord[];
  dueSoon: TaskRecord[];
  decisions: DecisionRecord[];
  notice: string;
}
export type ApprovalRequest =
  | { orgId: OrgId; actionType: 'task.create'; title: string; priority: Priority; dueOn?: string; description?: string }
  | { orgId: OrgId; actionType: 'task.complete'; taskId: string };
export interface AiAnswer { answer: string; mode: 'local' | 'openai'; sourceCount: number }
