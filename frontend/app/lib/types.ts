export interface UserSummary {
  id: number;
  email: string;
  role: "admin" | "member";
  is_active: boolean;
  created_at: string;
}

export interface AuditLogEntry {
  id: number;
  actor_user_id: number | null;
  company_id: number | null;
  action: string;
  resource_type: string | null;
  resource_id: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface CompanySummary {
  id: number;
  name: string;
  type: "construction" | "municipality";
  is_suspended: boolean;
  created_at: string;
}

export interface RemovalRequestSummary {
  id: number;
  document_id: number;
  document_title: string | null;
  requested_by: number;
  status: "pending" | "approved" | "rejected";
  created_at: string;
}

export interface InviteSummary {
  id: number;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  token: string | null;
  created_at: string;
  expires_at: string;
}

export interface ProjectSummary {
  id: number;
  name: string | null;
  municipality: string | null;
  address: string | null;
  is_default: boolean;
}

export interface DocumentSummary {
  id: number;
  title: string | null;
  snippet: string | null;
  source: string | null;
  doc_type: string | null;
  municipality: string | null;
}
