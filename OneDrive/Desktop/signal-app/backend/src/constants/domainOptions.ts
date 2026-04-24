// CONTENT DECISION — REVIEW BEFORE MERGE.
// These domain lists will be seen by every new user during onboarding.
// 15–20 options per sector, plus the "General / Not sure" sentinel.
// Sensible defaults proposed by Claude Code; Omar to validate pre-merge.
//
// Phase 12c — Screen 2 "what field do you work in?" dropdown. Backend
// validation source of truth. Mirrored in
// `frontend/src/lib/onboarding/domainOptions.ts` for labels + the
// filtered-by-selected-sector display logic. Keep the two files in
// sync on value strings; frontend adds human-readable labels.
//
// The `general_not_sure` sentinel is always an explicit option,
// regardless of which sectors the user selected. It lives OUTSIDE the
// per-sector map so adding/removing a sector never changes whether
// "General / Not sure" is offered.

import { SECTORS, type Sector } from "./onboardingTopics";

export const GENERAL_DOMAIN = "general_not_sure" as const;

export const DOMAIN_OPTIONS_BY_SECTOR = {
  ai: [
    "foundation_model_research",
    "model_training_infra",
    "inference_infra",
    "ai_product_engineering",
    "ai_application_development",
    "ml_engineering",
    "ai_safety_alignment",
    "ai_policy_governance",
    "ai_developer_tools",
    "computer_vision",
    "nlp_conversational_ai",
    "robotics_embodied_ai",
    "ai_healthcare_biotech",
    "ai_enterprise_productivity",
    "ai_investing_vc",
    "ai_journalism_analyst",
    "data_engineering_ml",
    "generative_ai_applications",
  ],
  finance: [
    "equity_research",
    "equity_sales_trading",
    "fixed_income_credit",
    "macro_rates_strategy",
    "quantitative_research",
    "quantitative_trading",
    "risk_management",
    "investment_banking_ma",
    "private_equity",
    "venture_capital",
    "hedge_fund_fundamental",
    "hedge_fund_systematic",
    "wealth_management",
    "corporate_strategy",
    "financial_regulation_compliance",
    "financial_journalism_analyst",
    "crypto_digital_assets",
    "fintech_product_engineering",
  ],
  semiconductors: [
    "chip_design_architecture",
    "verification_validation",
    "physical_design_layout",
    "eda_design_automation",
    "foundry_operations",
    "advanced_packaging",
    "memory_dram_nand",
    "gpu_accelerator_engineering",
    "networking_silicon",
    "automotive_embedded",
    "analog_mixed_signal",
    "rf_wireless_silicon",
    "power_management_ic",
    "semiconductor_supply_chain",
    "semiconductor_equipment_oem",
    "export_controls_trade_policy",
    "semiconductor_investing_vc",
    "semiconductor_journalism_analyst",
  ],
} as const satisfies Record<Sector, readonly string[]>;

// Flat set of every accepted domain value. Used by Zod validators to
// prove membership without having to reconstruct the union on every
// request.
export const VALID_DOMAIN_VALUES: ReadonlySet<string> = new Set<string>([
  GENERAL_DOMAIN,
  ...SECTORS.flatMap((s) => DOMAIN_OPTIONS_BY_SECTOR[s]),
]);

export function isValidDomain(value: string): boolean {
  return VALID_DOMAIN_VALUES.has(value);
}

export type Domain = typeof GENERAL_DOMAIN | (typeof DOMAIN_OPTIONS_BY_SECTOR)[Sector][number];
