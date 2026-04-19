import type { EmailFrequency } from "@/types/auth";

export interface SectorOption {
  value: string;
  label: string;
  description: string;
}

export interface RoleOption {
  value: string;
  label: string;
}

export interface GoalOption {
  value: string;
  label: string;
}

export const SECTORS: readonly SectorOption[] = [
  {
    value: "ai",
    label: "AI",
    description: "Model releases, research, infra, safety, and the economics of compute.",
  },
  {
    value: "finance",
    label: "Finance",
    description: "Markets, rates, credit, private equity, venture, and policy shifts.",
  },
  {
    value: "semiconductors",
    label: "Semiconductors",
    description: "Foundries, design, packaging, export controls, and supply chains.",
  },
] as const;

export const ROLES: readonly RoleOption[] = [
  { value: "engineer", label: "Engineer" },
  { value: "researcher", label: "Researcher" },
  { value: "manager", label: "Manager" },
  { value: "vc", label: "VC" },
  { value: "analyst", label: "Analyst" },
  { value: "founder", label: "Founder" },
  { value: "executive", label: "Executive" },
  { value: "student", label: "Student" },
  { value: "other", label: "Other" },
] as const;

export const GOALS: readonly GoalOption[] = [
  { value: "stay_informed", label: "Stay informed" },
  { value: "deep_learning", label: "Deep learning" },
  { value: "find_opportunities", label: "Find opportunities" },
  { value: "network", label: "Network" },
  { value: "career_growth", label: "Career growth" },
] as const;

export const EMAIL_FREQUENCIES: readonly { value: EmailFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "never", label: "Never" },
] as const;
