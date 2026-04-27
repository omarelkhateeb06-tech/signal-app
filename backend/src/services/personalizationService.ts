const ROLE_PHRASE: Record<string, string> = {
  engineer: "As an engineer, this affects your implementation decisions",
  researcher: "As a researcher, this shifts your research priorities",
  manager: "As a manager, this reshapes how you plan your team's roadmap",
  vc: "As an investor, this signals new investment opportunities",
  analyst: "As an analyst, this changes the numbers you need to watch",
  founder: "As a founder, this reshapes the strategic landscape you operate in",
  executive: "As an executive, this affects decisions at the leadership level",
  student: "As a student, this highlights the skills worth investing in",
  other: "This matters to you because the landscape is shifting",
};

const DEFAULT_ROLE_KEY = "other";

export interface PersonalizeInput {
  whyItMatters: string;
  whyItMattersTemplate: string | null;
  role: string | null | undefined;
}

export function rolePhraseFor(role: string | null | undefined): string {
  const key = (role ?? DEFAULT_ROLE_KEY).toLowerCase();
  return ROLE_PHRASE[key] ?? ROLE_PHRASE[DEFAULT_ROLE_KEY];
}

export function personalizeStory(input: PersonalizeInput): string {
  const phrase = rolePhraseFor(input.role);
  const template = input.whyItMattersTemplate;
  if (template && template.includes("{role_phrase}")) {
    return template.replace(/\{role_phrase\}/g, phrase);
  }
  return `${phrase}. ${input.whyItMatters}`;
}
