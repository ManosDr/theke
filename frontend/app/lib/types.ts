export interface UserSummary {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: "admin" | "member";
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
  messages_30d: number;
}

// Platform-wide (super admin) equivalent of UserSummary/InviteSummary - see
// GET /admin/users and /admin/invites. role widens to include super_admin -
// unlike a company-scoped list, this one spans every account on the
// platform, including super admins themselves (company_id null for those).
export interface AdminUserSummary extends Omit<UserSummary, "role"> {
  role: "super_admin" | "admin" | "member";
  company_id: number | null;
  company_name: string;
}

export interface ActivityEventEntry {
  type: "chat_message" | "document_uploaded" | "project_created" | "customer_added" | "user_joined";
  created_at: string;
  description: string;
  actor_name: string | null;
}

export interface CompanyOverviewResponse {
  users_total: number;
  users_active_30d: number;
  messages_30d: number;
  gap_rate: number;
  customers_total: number;
  projects_total: number;
  private_documents_count: number;
  public_documents_count: number;
  activity: ActivityEventEntry[];
  positive_feedback: number;
  negative_feedback: number;
  messages_last_14d: string[];
}

export interface CompanyDocumentSummary {
  id: number;
  title: string | null;
  project_id: number | null;
  project_name: string | null;
  doc_type: string | null;
  extraction_status: string | null;
  created_at: string;
}

export interface CompanyDocumentReviewEntry {
  id: number;
  title: string | null;
  created_at: string;
  reference_url: string | null;
  auto_reason: string | null;
  manual_note: string | null;
}

export interface ProjectDocumentSummary {
  id: number;
  title: string;
  extraction_status: string;
  created_at: string;
  chunk_count: number;
  doc_scope: "project" | "customer" | "company";
}

export interface ProjectDocumentUploadResult {
  filename: string;
  document_id: number | null;
  extraction_status: string;
  chunk_count: number;
  error: string | null;
}

export interface KbSourceStatusEntry {
  source_name: string;
  document_count: number;
  last_crawled_at: string | null;
  next_crawl_at: string | null;
  health: "healthy" | "overdue" | "failed" | "never_synced" | "inactive";
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
  first_name: string | null;
  last_name: string | null;
  role: string;
  is_active: boolean;
}

export interface AdminResetPasswordResponse {
  new_password: string;
}

export interface EmailStatusResponse {
  email_enabled: boolean;
}

export interface CompanyProjectSummary {
  id: number;
  name: string | null;
  municipality: string | null;
  is_client: boolean;
}

export interface TokenUsageByUser {
  user_id: number;
  name: string;
  total_tokens_30d: number;
  estimated_cost_eur_30d: number;
  message_count: number;
}

export interface TokenUsageSummary {
  prompt_tokens_30d: number;
  completion_tokens_30d: number;
  total_tokens_30d: number;
  estimated_cost_eur_30d: number;
  avg_tokens_per_message: number;
  by_user: TokenUsageByUser[];
}

export interface CompanyDetail extends CompanySummary {
  users: CompanyUserSummary[];
  projects: CompanyProjectSummary[];
  messages_30d: number;
  gap_rate: number;
  token_usage: TokenUsageSummary;
}

export interface MyCompanySummary {
  id: number;
  name: string;
  type: "construction" | "municipality" | "accounting";
  has_logo: boolean;
  logo_url: string | null;
  vertical_slug: string;
  vertical_display_name: string;
  vertical_tagline: string | null;
  vertical_welcome_message: string | null;
  vertical_disclaimer_text: string | null;
  vertical_disclaimer_text_en: string | null;
  vertical_uses_regional_scoping: boolean;
  legal_name: string | null;
  afm: string | null;
  billing_address: string | null;
  dpa_accepted_at: string | null;
  dpa_version: string | null;
  current_user_has_messages: boolean;
  company_has_messages: boolean;
}

export interface CompanyBillingDetails {
  legal_name?: string;
  afm?: string;
  billing_address?: string;
}

export interface CompanyCreateWithAdminRequest {
  company_name: string;
  company_type: "construction" | "accounting" | "municipality";
  admin_first_name: string;
  admin_last_name: string;
  admin_email: string;
  admin_phone?: string;
  is_test_account?: boolean;
  trial_days?: number;
}

export interface CompanyCreateWithAdminResponse {
  company_id: number;
  company_name: string;
  admin_user_id: number;
  admin_first_name: string;
  admin_last_name: string;
  admin_email: string;
  generated_password: string;
}

export interface MeSummary {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  preferred_locale: string | null;
  preferred_theme: string | null;
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

export interface AdminInviteSummary extends InviteSummary {
  company_id: number;
  company_name: string;
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
  customer_id?: number | null;
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
  archaeological_site_name?: string | null;
  archaeological_distance_m?: number | null;
  plot_in_plan?: boolean | null;
  location_resolved_at?: string | null;
}

export interface CustomerSummary {
  id: number;
  name: string;
  afm: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  project_count: number;
  last_project_at: string | null;
}

// Super admin's full-source-visibility screen (GET /admin/companies-documents,
// /admin/companies/{id}/customers-documents) - see SuperAdminSourcesView.
export interface CompanyDocumentsSummary {
  company_id: number;
  company_name: string;
  company_type: string;
  vertical_slug: string | null;
  document_count: number;
  storage_bytes: number;
  customer_count: number;
}

export interface CustomerDocumentsSummary {
  id: number;
  name: string;
  afm: string | null;
  phone: string | null;
  email: string | null;
  document_count: number;
}

export interface CustomerProjectSummary {
  id: number;
  name: string | null;
  region_id: string | null;
  region_name_el: string | null;
  created_at: string;
  is_client: boolean;
  document_count: number;
}

export interface CustomerDetailResponse {
  id: number;
  name: string;
  afm: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
  projects: CustomerProjectSummary[];
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
  archaeological_site_name: string | null;
  archaeological_distance_m: number | null;
  ktimatologio_link: string | null;
  services_available: ServicesAvailable;
}

export interface GeocodeResult {
  display_name: string | null;
  type: string | null;
  lat: number;
  lon: number;
}

export interface ParcelGeometry {
  type: "Polygon";
  coordinates: [number, number][][];
}

export interface ParcelLookupResponse {
  kaek: string;
  available: boolean;
  found: boolean;
  area_sqm: number | null;
  perimeter_m: number | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  geometry: ParcelGeometry | null;
  ktimatologio_link: string | null;
  error: string | null;
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
  auto_needs_review_reason: string | null;
  vertical_slug: string;
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
  auto_needs_review_reason: string | null;
  still_accurate: boolean | null;
  full_content: string | null;
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

export interface ChatRateLimitStatus {
  used: number;
  limit: number;
  remaining: number;
  resets_in_seconds: number;
}

export interface UserUsageSummary {
  messages_30d: number;
}

export type SubscriptionStatusValue = "trial" | "active" | "expired" | "cancelled" | "suspended";

export interface SubscriptionStatusResponse {
  plan_name: string;
  plan_slug: string;
  is_beta: boolean;
  status: SubscriptionStatusValue;
  trial_ends_at: string | null;
  trial_started_at: string;
  current_period_end: string | null;
  messages_used: number;
  messages_limit: number;
  users_count: number;
  user_limit: number;
  is_test_account: boolean;
}

export interface PlanSummary {
  id: number;
  vertical_id: number | null;
  vertical_slug: string | null;
  name: string;
  slug: string;
  billing_cycle: string;
  price_eur: number;
  annual_total_eur: number | null;
  user_limit: number;
  message_pool: number;
  storage_limit_bytes: number | null;
  project_limit: number | null;
  client_limit: number | null;
  max_file_size_bytes: number;
  promo_price_eur: number | null;
  promo_starts_at: string | null;
  promo_ends_at: string | null;
  is_beta: boolean;
  is_active: boolean;
  subscriber_count: number;
}

export interface PlanPublicEntry {
  id: number;
  slug: string;
  name: string;
  price_eur: number;
  annual_total_eur: number | null;
  annual_monthly_equiv_eur: number | null;
  is_promo: boolean;
  user_limit: number;
  message_pool: number;
  project_limit: number | null;
  client_limit: number | null;
  storage_limit_bytes: number | null;
  max_file_size_bytes: number;
  is_current: boolean;
}

export interface PlansPublicResponse {
  vertical_slug: string;
  tiers: PlanPublicEntry[];
  subscription_status: SubscriptionStatusValue | null;
  trial_ends_at: string | null;
}

export interface PlanRequestCreate {
  requested_tier_id: number;
}

export interface PlanRequestResponse {
  direction: "upgrade" | "downgrade";
  requested_tier_name: string;
}

export interface SubscriptionEntry {
  company_id: number;
  company_name: string;
  vertical_slug: string | null;
  plan_id: number;
  plan_name: string;
  plan_price_eur: number;
  is_beta: boolean;
  status: SubscriptionStatusValue;
  billing_cycle: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
  messages_used: number;
  messages_limit: number;
  users_count: number;
  user_limit: number;
  notes: string | null;
  legal_name: string | null;
  afm: string | null;
  billing_address: string | null;
}

export interface SubscriptionListResponse {
  items: SubscriptionEntry[];
}

export interface InvoiceEntry {
  id: number;
  invoice_number: string;
  company_id: number;
  company_name: string;
  plan_id: number;
  plan_name: string;
  billing_cycle: string;
  amount_net_eur: number;
  vat_rate: number;
  amount_vat_eur: number;
  amount_total_eur: number;
  issued_at: string;
  period_start: string;
  period_end: string;
}

export interface InvoiceCreateRequest {
  company_id: number;
  plan_id: number;
  billing_cycle: string;
  period_start: string;
  period_end: string;
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
  platform_tokens_30d: number;
  platform_cost_eur_30d: number;
  real_active_companies: number;
}

export interface VerticalStatsEntry {
  slug: string;
  messages: number;
  gap_rate: number;
  active_documents: number;
  active_companies: number;
  positive_feedback: number;
  negative_feedback: number;
  platform_tokens_30d: number;
  platform_cost_eur_30d: number;
  suspended_companies: number;
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

export type InfraHealthLevel = "watch" | "warning" | "critical";

export interface InfraHealthCheckEntry {
  total_chunks: number;
  index_size_mb: number;
  threshold_level: InfraHealthLevel;
  created_at: string;
}

export interface InfraHealthResponse {
  latest: InfraHealthCheckEntry | null;
  history: InfraHealthCheckEntry[];
  trend: "up" | "down" | "flat" | null;
}

export interface VerticalSummary {
  id: number;
  slug: string;
  display_name: string;
  tagline: string | null;
  welcome_message: string | null;
  disclaimer_text: string | null;
  disclaimer_text_en: string | null;
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

export interface FeedbackEntry {
  id: number;
  rating: "positive" | "negative";
  feedback_text: string | null;
  status: "pending" | "solved" | "rejected";
  created_at: string;
  question: string;
  answer_excerpt: string;
  user_name: string;
  company_name: string | null;
  vertical: string | null;
}

export interface FeedbackListResponse {
  items: FeedbackEntry[];
}

export interface UserFeedbackEntry {
  id: number;
  category: "bug" | "suggestion" | "content_gap";
  message: string | null;
  page_url: string | null;
  created_at: string;
  user_name: string;
  company_name: string | null;
}

export interface UserFeedbackListResponse {
  items: UserFeedbackEntry[];
}

export interface DataSourceSyncStatus {
  id: number;
  last_crawled_at: string | null;
  next_crawl_at: string | null;
  last_crawl_status: string | null;
  last_crawl_document_count: number | null;
  last_crawl_error: string | null;
}

export interface RegionAdminSummary {
  region_id: string;
  region_name_el: string;
  ydom_authority_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: string;
}

export interface UtilityProviderAdminSummary {
  provider_id: string;
  provider_name: string;
  provider_type: string;
  coverage_region_ids: string[];
  contact_phone: string | null;
  contact_email: string | null;
}

export interface DocumentValidationResult {
  status: string;
  reason: string | null;
  still_accurate: boolean | null;
  changes_detected: string | null;
  suggested_content: string | null;
  confidence: string | null;
  reasoning: string | null;
  source_fetched_at: string | null;
  source_url: string | null;
  validation_id: number | null;
}

export interface RevalidateAllResponse {
  queued: number;
  estimated_minutes: number;
}

export interface RevalidationStatusResponse {
  pending: number;
  validated: number;
  failed: number;
  accurate: number;
  changed: number;
  last_updated: string | null;
}

export type LegalDocSlug = "terms" | "privacy" | "dpa";

export interface LegalStatusResponse {
  terms: boolean;
  privacy: boolean;
  dpa: boolean;
}

export interface LegalDocResponse {
  slug: LegalDocSlug;
  title: string;
  is_draft: boolean;
  content: string | null;
}
