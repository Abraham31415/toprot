import { SECTION_KEYS, type QualitySnapshot, type SectionKey } from "./quality";

// Protocol completion tracking. "Complete" means the required fields of a section are filled
// in. It says nothing about whether the content is good; the quality checks cover consistency.

export interface SectionCompletion {
  key: SectionKey;
  filled: number;
  total: number;
  complete: boolean;
  /** Human-readable list of what is still missing in this section. */
  missing: string[];
}

export interface ProtocolCompletion {
  sections: SectionCompletion[];
  filled: number;
  total: number;
  /** Whole-number percentage of required items filled, 0 to 100. */
  percent: number;
  completeSections: number;
}

const has = (s: string | null | undefined) => !!s && s.trim().length > 0;

type Item = [label: string, done: boolean];

function itemsFor(key: SectionKey, s: QualitySnapshot): Item[] {
  switch (key) {
    case "identity":
      return [
        ["study title", has(s.study_title)],
        ["study design", has(s.study_design)],
      ];
    case "objectives":
      return [
        ["research question", has(s.research_question)],
        ["at least one objective", s.objectives.some((o) => has(o.description))],
      ];
    case "population":
      return [
        ["target population", has(s.target_population)],
        ["setting", has(s.setting)],
        ["at least one inclusion criterion", s.inclusion_criteria.some(has)],
      ];
    case "variables":
      return [["at least one variable", s.variables.some((v) => has(v.variable_name))]];
    case "statistics":
      return [
        ["statistical methods", has(s.statistical_methods)],
        ["primary analysis", has(s.primary_analysis)],
      ];
    case "sample_size":
      return [["a calculated sample size", s.calculated_sample_size !== null && s.calculated_sample_size !== undefined]];
    case "data_collection":
      return [
        ["data collection methods", has(s.data_collection_methods)],
        ["data sources", has(s.data_sources)],
        ["data management plan", has(s.data_management_plan)],
      ];
    case "ethics":
      return [
        ["ethical approval body", has(s.ethical_approval_body)],
        ["consent process", has(s.consent_process)],
      ];
  }
}

export function computeCompletion(snapshot: QualitySnapshot): ProtocolCompletion {
  const sections = SECTION_KEYS.map((key): SectionCompletion => {
    const items = itemsFor(key, snapshot);
    const filled = items.filter(([, done]) => done).length;
    return {
      key,
      filled,
      total: items.length,
      complete: filled === items.length,
      missing: items.filter(([, done]) => !done).map(([label]) => label),
    };
  });
  const filled = sections.reduce((n, s) => n + s.filled, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return {
    sections,
    filled,
    total,
    percent: total === 0 ? 0 : Math.round((filled / total) * 100),
    completeSections: sections.filter((s) => s.complete).length,
  };
}
