// CONTENT DECISION — REVIEW BEFORE MERGE.
// These domain lists will be seen by every new user during onboarding.
// 15–20 options per sector, plus the "General / Not sure" sentinel.
// Sensible defaults proposed by Claude Code; Omar to validate pre-merge.
//
// Phase 12c — Screen 2 "what field do you work in?" dropdown.
// Canonical value strings live in
// `backend/src/constants/domainOptions.ts` and are enforced by the
// Zod validator on /onboarding/complete. This file mirrors the values
// and adds display labels. When you edit one, edit the other; a drift
// manifests as the UI offering an option the server then rejects with
// INVALID_INPUT.
//
// Display contract: when a user has multiple sectors selected on
// Screen 1, Screen 2 shows the union of those sectors' options
// deduplicated, with "General / Not sure" always pinned at the
// bottom of the list.
//
// The value strings are stable identifiers — once shipped, they
// persist in user_profiles.domain and are referenced by the Haiku
// prompt. Changing a value is a data migration; changing only a
// label is cosmetic.
//
// If Omar overrides any of these before merge, update both this
// file and backend/src/constants/domainOptions.ts in the same PR.

export const GENERAL_DOMAIN_OPTION = {
  value: "general_not_sure",
  label: "General / Not sure",
} as const;

export interface DomainOption {
  value: string;
  label: string;
}

export const DOMAIN_OPTIONS_BY_SECTOR: Readonly<Record<string, readonly DomainOption[]>> = {
  ai: [
    { value: "foundation_model_research", label: "Foundation model research" },
    { value: "model_training_infra", label: "Model training infrastructure" },
    { value: "inference_infra", label: "Inference infrastructure" },
    { value: "ai_product_engineering", label: "AI product engineering" },
    { value: "ai_application_development", label: "AI application development" },
    { value: "ml_engineering", label: "ML engineering" },
    { value: "ai_safety_alignment", label: "AI safety & alignment" },
    { value: "ai_policy_governance", label: "AI policy & governance" },
    { value: "ai_developer_tools", label: "AI developer tools" },
    { value: "computer_vision", label: "Computer vision" },
    { value: "nlp_conversational_ai", label: "NLP / conversational AI" },
    { value: "robotics_embodied_ai", label: "Robotics & embodied AI" },
    { value: "ai_healthcare_biotech", label: "AI for healthcare / biotech" },
    { value: "ai_enterprise_productivity", label: "AI for enterprise / productivity" },
    { value: "ai_investing_vc", label: "AI investing / VC" },
    { value: "ai_journalism_analyst", label: "AI journalism / analyst" },
    { value: "data_engineering_ml", label: "Data engineering for ML" },
    { value: "generative_ai_applications", label: "Generative AI applications" },
  ],
  finance: [
    { value: "equity_research", label: "Equity research" },
    { value: "equity_sales_trading", label: "Equity sales & trading" },
    { value: "fixed_income_credit", label: "Fixed income / credit" },
    { value: "macro_rates_strategy", label: "Macro / rates strategy" },
    { value: "quantitative_research", label: "Quantitative research" },
    { value: "quantitative_trading", label: "Quantitative trading" },
    { value: "risk_management", label: "Risk management" },
    { value: "investment_banking_ma", label: "Investment banking / M&A" },
    { value: "private_equity", label: "Private equity" },
    { value: "venture_capital", label: "Venture capital" },
    { value: "hedge_fund_fundamental", label: "Hedge fund (fundamental / long-short)" },
    { value: "hedge_fund_systematic", label: "Hedge fund (systematic)" },
    { value: "wealth_management", label: "Wealth / asset management" },
    { value: "corporate_strategy", label: "Corporate strategy / development" },
    { value: "financial_regulation_compliance", label: "Regulation / compliance" },
    { value: "financial_journalism_analyst", label: "Financial journalism / analyst" },
    { value: "crypto_digital_assets", label: "Crypto / digital assets" },
    { value: "fintech_product_engineering", label: "Fintech product / engineering" },
  ],
  semiconductors: [
    { value: "chip_design_architecture", label: "Chip design / architecture" },
    { value: "verification_validation", label: "Verification & validation" },
    { value: "physical_design_layout", label: "Physical design / layout" },
    { value: "eda_design_automation", label: "EDA / design automation" },
    { value: "foundry_operations", label: "Foundry operations" },
    { value: "advanced_packaging", label: "Advanced packaging" },
    { value: "memory_dram_nand", label: "Memory (DRAM / HBM / NAND)" },
    { value: "gpu_accelerator_engineering", label: "GPU / accelerator engineering" },
    { value: "networking_silicon", label: "Networking silicon" },
    { value: "automotive_embedded", label: "Automotive / embedded silicon" },
    { value: "analog_mixed_signal", label: "Analog / mixed-signal" },
    { value: "rf_wireless_silicon", label: "RF / wireless silicon" },
    { value: "power_management_ic", label: "Power management IC" },
    { value: "semiconductor_supply_chain", label: "Supply chain / sourcing" },
    { value: "semiconductor_equipment_oem", label: "Semiconductor equipment / OEM" },
    { value: "export_controls_trade_policy", label: "Export controls / trade policy" },
    { value: "semiconductor_investing_vc", label: "Semiconductor investing / VC" },
    { value: "semiconductor_journalism_analyst", label: "Semiconductor journalism / analyst" },
  ],
};

/**
 * Returns the displayable options for Screen 2 given the currently-
 * selected sectors on Screen 1. Union-dedupes by value, preserves
 * sector-order appearance, and pins "General / Not sure" to the end.
 *
 * If no sectors are selected (shouldn't happen — Screen 1 requires
 * ≥ 1 — but defensive default), only the sentinel is returned so the
 * user is never stuck without any option.
 */
export function getDomainOptionsForSectors(
  selectedSectors: readonly string[],
): readonly DomainOption[] {
  const seen = new Set<string>();
  const union: DomainOption[] = [];
  for (const sector of selectedSectors) {
    const opts = DOMAIN_OPTIONS_BY_SECTOR[sector] ?? [];
    for (const opt of opts) {
      if (seen.has(opt.value)) continue;
      seen.add(opt.value);
      union.push(opt);
    }
  }
  union.push(GENERAL_DOMAIN_OPTION);
  return union;
}
