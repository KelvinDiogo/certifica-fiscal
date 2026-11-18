export type Role = "admin" | "operator" | "viewer";
export type Organization = { id: string; name: string; role: Role };
export type Company = {
  id: string;
  name: string;
  cnpj: string;
  state: string;
  city: string;
};
export type Certificate = {
  id: string;
  company_id: string;
  type: string;
  result: string;
  issued_at: string;
  expires_at: string;
  reference: string;
  notes: string;
  created_at: string;
  document_path: string | null;
};
export type Job = {
  id: string;
  company_id: string;
  type: string;
  status: string;
  message: string;
  created_at: string;
};
export type AuditEvent = {
  id: string;
  action: string;
  subject: string;
  created_at: string;
};
export type DashboardData = {
  companies: Company[];
  certificates: Certificate[];
  jobs: Job[];
  events: AuditEvent[];
  role: Role;
  today: string;
};
