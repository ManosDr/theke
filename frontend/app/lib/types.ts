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

export interface MyCompanySummary {
  id: number;
  name: string;
  type: "construction" | "municipality";
  has_logo: boolean;
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
  region_id: string | null;
  address: string | null;
  is_default: boolean;
}

export interface RegionSummary {
  region_id: string;
  region_name_el: string;
  region_name_en: string;
  level: string;
  status: string;
  has_coefficient_data: boolean | null;
  has_zone_level_coefficient_text: boolean | null;
}

export interface StaleDocumentSummary {
  id: number;
  title: string | null;
  source: string | null;
  source_group: string | null;
  region_id: string | null;
  last_verified_at: string | null;
}

export interface DocumentSummary {
  id: number;
  title: string | null;
  snippet: string | null;
  source: string | null;
  doc_type: string | null;
  municipality: string | null;
  region_id: string | null;
  date: string | null;
  identifier: string | null;
  series: string | null;
  issue_number: string | null;
  source_name: string | null;
  source_group: string | null;
}

export interface DocumentDetail extends DocumentSummary {
  content: string | null;
}

export interface SourceGroupSummary {
  group: string;
  count: number;
}

export interface BrowseResponse {
  total: number;
  items: DocumentSummary[];
}

export interface NotificationSummary {
  id: number;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

export interface NotificationListResponse {
  items: NotificationSummary[];
  unread_count: number;
}
