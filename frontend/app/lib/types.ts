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
  type: "construction" | "municipality" | "accounting";
  is_suspended: boolean;
  created_at: string;
  vertical_id: number | null;
  vertical_slug: string | null;
  active_users_count: number;
  active_projects_count: number;
}

export interface CompanyUserSummary {
  id: number;
  email: string;
  role: string;
  is_active: boolean;
}

export interface CompanyProjectSummary {
  id: number;
  name: string | null;
  municipality: string | null;
  is_client: boolean;
}

export interface CompanyDetail extends CompanySummary {
  users: CompanyUserSummary[];
  projects: CompanyProjectSummary[];
  messages_30d: number;
  gap_rate: number;
}

export interface MyCompanySummary {
  id: number;
  name: string;
  type: "construction" | "municipality" | "accounting";
  has_logo: boolean;
  vertical_slug: string;
  vertical_display_name: string;
  vertical_tagline: string | null;
  vertical_welcome_message: string | null;
  vertical_disclaimer_text: string | null;
  vertical_uses_regional_scoping: boolean;
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
  is_client?: boolean;
  client_notes?: string | null;
  customer_name?: string | null;
  customer_notes?: string | null;
  plot_address?: string | null;
  plot_municipality?: string | null;
  lat?: number | null;
  lon?: number | null;
  kaek?: string | null;
  plot_area_sqm?: number | null;
  gis_zone_name?: string | null;
  gis_zone_source?: string | null;
  archaeological_flag?: boolean;
  archaeological_notes?: string | null;
  location_resolved_at?: string | null;
}

export interface ServicesAvailable {
  geocoding: boolean;
  cadastral: boolean;
  gis_zone: boolean;
}

export interface ResolveLocationResponse {
  lat: number;
  lon: number;
  address: string | null;
  municipality: string | null;
  kaek: string | null;
  plot_area_sqm: number | null;
  parcel_geometry: Record<string, unknown> | null;
  gis_zone_name: string | null;
  archaeological_flag: boolean;
  archaeological_notes: string | null;
  services_available: ServicesAvailable;
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

export interface DocumentReplacementRef {
  id: number;
  title: string | null;
}

export type DocumentStatus =
  | "active"
  | "superseded"
  | "needs_review"
  | "manual_entry"
  | "reference_only"
  | "manual_entry_pending"
  | "removed";

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
  authority: string | null;
  content_type: string | null;
  extraction_status: string | null;
  status: string | null;
  replaced_by: DocumentReplacementRef | null;
  replaces: DocumentReplacementRef | null;
  vertical_id: number | null;
  vertical_slug: string | null;
  last_verified_at: string | null;
  needs_review: boolean;
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

export interface ChatCitation {
  document_id: number;
  title: string | null;
  authority: string | null;
  source_url: string | null;
  extraction_status: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

export interface ChatMessageResponse {
  answer: string;
  citations: ChatCitation[];
  gap: boolean;
  session_id: number | null;
}

export interface ChatHistoryItem {
  id: number;
  message: string;
  response: string;
  citations: ChatCitation[];
  gap: boolean | null;
  created_at: string;
}

export type FeedbackRating = "positive" | "negative";

export interface ChatHistoryResponse {
  items: ChatHistoryItem[];
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

export interface AdminStats {
  total_messages: number;
  gap_rate: number;
  active_documents: number;
  positive_feedback: number;
  negative_feedback: number;
}

export interface VerticalStatsEntry {
  slug: string;
  messages: number;
  gap_rate: number;
  active_documents: number;
  active_companies: number;
}

// GET /admin/stats now returns this shape - `total` carries the same fields
// AdminStats always had, `by_vertical` is new.
export interface AdminStatsByVertical {
  total: AdminStats;
  by_vertical: VerticalStatsEntry[];
}

export interface GapQueryEntry {
  id: number;
  message: string;
  company_name: string | null;
  created_at: string;
}

export interface VerticalSummary {
  id: number;
  slug: string;
  display_name: string;
  tagline: string | null;
  welcome_message: string | null;
  disclaimer_text: string | null;
  system_prompt_override: string | null;
  off_topic_hint: string | null;
  uses_regional_scoping: boolean;
  status: string;
}

export interface DataSourceSummary {
  id: number;
  name: string;
  base_url: string;
  source_type: string;
  crawl_frequency_type: "daily" | "weekly" | "monthly" | "custom";
  crawl_frequency_days: number;
  last_crawled_at: string | null;
  next_crawl_at: string | null;
  last_crawl_status: string | null;
  last_crawl_document_count: number | null;
  last_crawl_error: string | null;
  is_active: boolean;
  notes: string | null;
}

export interface DataSourcesByVertical {
  vertical_slug: string;
  vertical_display_name: string;
  sources: DataSourceSummary[];
}

export interface DataSourceSyncStatus {
  id: number;
  last_crawled_at: string | null;
  next_crawl_at: string | null;
  last_crawl_status: string | null;
  last_crawl_document_count: number | null;
  last_crawl_error: string | null;
}
