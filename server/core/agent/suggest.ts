import { createLogger } from "../../utils/logger.js";

const log = createLogger("agent-suggest");

export interface SuggestedAgent {
  name: string;
  role: string;
  systemPrompt: string;
  reason: string;
}

/**
 * Suggest domain-specialized agents based on project mission + tech stack.
 *
 * Rule-based (instant) — keyword matching for common domains.
 * Roles align with the org chart: cto, backend, frontend, ux, qa, reviewer, marketer, devops.
 */
export function suggestAgentsFromMission(
  mission: string,
  techStack?: { languages?: string[]; frameworks?: string[] },
): SuggestedAgent[] {
  const agents: SuggestedAgent[] = [];
  const m = mission.toLowerCase();

  // Always include backend + frontend as core implementation agents
  agents.push({
    name: "Backend Developer",
    role: "backend",
    systemPrompt: `You are a senior backend developer. Implement server-side features: APIs, database schemas, business logic, authentication. Analyze the existing codebase before writing. Run lint/type-check before finishing.`,
    reason: "Core backend implementation agent",
  });

  agents.push({
    name: "Frontend Developer",
    role: "frontend",
    systemPrompt: `You are a senior frontend developer. Implement UI components, pages, state management, and user interactions. Use React + TypeScript + TailwindCSS conventions. Focus on responsive design and accessibility.`,
    reason: "Core frontend implementation agent",
  });

  // Domain-specific agents based on mission keywords
  // Real Estate / PropTech
  if (m.includes("부동산") || m.includes("real estate") || m.includes("property") || m.includes("proptech")) {
    agents.push({
      name: "Real Estate Domain Expert",
      role: "custom",
      systemPrompt: `You are a real estate technology specialist. You understand property listings, mortgage calculations, zoning regulations, title searches, and MLS data formats. When implementing features, ensure compliance with real estate industry standards and regulations. Apply domain knowledge of property valuations, closing processes, and lease management.`,
      reason: "부동산 도메인 키워드 감지",
    });
  }

  // Finance / FinTech
  if (m.includes("금융") || m.includes("finance") || m.includes("payment") || m.includes("결제") || m.includes("fintech") || m.includes("banking")) {
    agents.push({
      name: "Finance Domain Expert",
      role: "custom",
      systemPrompt: `You are a financial technology specialist. You understand payment processing, regulatory compliance (PCI-DSS, KYC/AML), financial calculations, transaction security, and audit trails. Ensure all financial operations are idempotent, all amounts use proper decimal handling, and all sensitive data is encrypted.`,
      reason: "금융/결제 도메인 키워드 감지",
    });
  }

  // Legal / LegalTech
  if (m.includes("법률") || m.includes("legal") || m.includes("lawyer") || m.includes("contract") || m.includes("계약")) {
    agents.push({
      name: "Legal Domain Expert",
      role: "custom",
      systemPrompt: `You are a legal technology specialist. You understand document analysis, contract parsing, legal clause identification, compliance checking, and jurisdiction-specific regulations. Ensure all legal data processing maintains strict confidentiality and audit logging.`,
      reason: "법률 도메인 키워드 감지",
    });
  }

  // E-commerce
  if (m.includes("쇼핑") || m.includes("ecommerce") || m.includes("e-commerce") || m.includes("shop") || m.includes("store") || m.includes("상품")) {
    agents.push({
      name: "E-commerce Specialist",
      role: "custom",
      systemPrompt: `You are an e-commerce technology specialist. You understand product catalogs, inventory management, cart/checkout flows, payment integration, order fulfillment, and recommendation engines. Optimize for conversion rates and handle edge cases like stock depletion and concurrent orders.`,
      reason: "이커머스 도메인 키워드 감지",
    });
  }

  // Healthcare / HealthTech
  if (m.includes("의료") || m.includes("health") || m.includes("medical") || m.includes("hospital") || m.includes("진료")) {
    agents.push({
      name: "Healthcare Domain Expert",
      role: "custom",
      systemPrompt: `You are a healthcare technology specialist. You understand HIPAA compliance, EHR/EMR systems, medical data standards (HL7, FHIR), patient privacy, and clinical workflows. All implementations must prioritize data security and patient confidentiality.`,
      reason: "의료 도메인 키워드 감지",
    });
  }

  // Education / EdTech
  if (m.includes("교육") || m.includes("education") || m.includes("learning") || m.includes("course") || m.includes("학습")) {
    agents.push({
      name: "EdTech Specialist",
      role: "custom",
      systemPrompt: `You are an education technology specialist. You understand LMS platforms, course structures, assessment engines, progress tracking, gamification, and adaptive learning. Design for accessibility and diverse learning styles.`,
      reason: "교육 도메인 키워드 감지",
    });
  }

  // AI / ML
  if (m.includes("ai") || m.includes("machine learning") || m.includes("ml") || m.includes("인공지능") || m.includes("모델")) {
    agents.push({
      name: "AI/ML Engineer",
      role: "custom",
      systemPrompt: `You are an AI/ML engineer. You understand model training, inference optimization, prompt engineering, vector databases, embeddings, RAG pipelines, and API integration with LLM providers. Optimize for latency, cost, and accuracy.`,
      reason: "AI/ML 키워드 감지",
    });
  }

  // SaaS
  if (m.includes("saas") || m.includes("subscription") || m.includes("구독") || m.includes("multi-tenant")) {
    agents.push({
      name: "SaaS Architect",
      role: "custom",
      systemPrompt: `You are a SaaS architecture specialist. You understand multi-tenancy, subscription billing, usage metering, onboarding flows, feature flags, and tenant isolation. Design for scalability from day one with proper data partitioning.`,
      reason: "SaaS 키워드 감지",
    });
  }

  // Marketing / Content
  if (m.includes("마케팅") || m.includes("marketing") || m.includes("landing") || m.includes("랜딩") || m.includes("content")) {
    agents.push({
      name: "Growth Marketer",
      role: "marketer",
      systemPrompt: `You are a growth marketer. Write SEO-optimized content, design landing pages for conversion, and create growth strategies. Always consider target audience and core messaging.`,
      reason: "마케팅/콘텐츠 키워드 감지",
    });
  }

  // Frontend-heavy (from tech stack) → UX designer
  const frameworks = techStack?.frameworks ?? [];
  if (frameworks.some(f => ["React", "Vue", "Svelte", "Next.js"].includes(f))) {
    agents.push({
      name: "UX Designer",
      role: "ux",
      systemPrompt: `You are a UX designer who writes code. Create clean, accessible, and intuitive interfaces. Follow existing design system conventions. Focus on responsive layouts, consistent spacing, and user-friendly interactions.`,
      reason: "프론트엔드 프레임워크 감지",
    });
  }

  // Always include reviewer (Quality Gate)
  agents.push({
    name: "Code Reviewer",
    role: "reviewer",
    systemPrompt: `You are a code reviewer with an adversarial mindset. "Don't pass it — find the problem." Apply 5-dimension verification: Functionality, Data Flow, Design Alignment, Craft, Edge Cases. Classify issues as auto-resolve / soft-block / hard-block.`,
    reason: "Quality Gate 필수 에이전트",
  });

  log.info(`Suggested ${agents.length} agents for mission: "${mission.slice(0, 50)}"`, {
    agents: agents.map(a => a.name),
  });

  return agents;
}

export interface TeamPreset {
  id: string;
  name: string;
  description: string;
  agents: Array<{ name: string; role: string; parentRole?: string }>;
}

export function getTeamPresets(): TeamPreset[] {
  return [
    {
      id: "minimal",
      name: "Minimal",
      description: "Backend + Frontend + Reviewer",
      agents: [
        { name: "Backend Developer", role: "backend" },
        { name: "Frontend Developer", role: "frontend" },
        { name: "Code Reviewer", role: "reviewer" },
      ],
    },
    {
      id: "fullstack",
      name: "Full Stack Team",
      description: "CTO → Backend + Frontend + QA",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Backend Developer", role: "backend", parentRole: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
      ],
    },
    {
      id: "product",
      name: "Product Team",
      description: "CTO → Frontend + UX + QA",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "UX Designer", role: "ux", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
      ],
    },
    {
      id: "startup",
      name: "Startup Team",
      description: "CTO → Backend + Frontend + UX + QA + Reviewer",
      agents: [
        { name: "CTO", role: "cto" },
        { name: "Backend Developer", role: "backend", parentRole: "cto" },
        { name: "Frontend Developer", role: "frontend", parentRole: "cto" },
        { name: "UX Designer", role: "ux", parentRole: "cto" },
        { name: "QA Engineer", role: "qa", parentRole: "cto" },
        { name: "Code Reviewer", role: "reviewer", parentRole: "cto" },
      ],
    },
  ];
}
