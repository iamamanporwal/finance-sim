import type { Model } from "@fin/model-schema";
import { instantiateTemplate, TEMPLATES, type TemplateInfo } from "@fin/templates";

export interface StarterExample {
  id: string;
  name: string;
  description: string;
  template: TemplateInfo;
  build(): Model;
}

/** Starting points offered on the home page and on an empty canvas: the template library. */
export const STARTER_EXAMPLES: StarterExample[] = TEMPLATES.map((t) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  template: t,
  build: () => instantiateTemplate(t.id, "example"),
}));

/** Copies an example's contents into an existing model, keeping its identity, name and onboarding answers. */
export function applyExample(target: Model, example: StarterExample): Model {
  const ex = example.build();
  return {
    ...ex,
    id: target.id,
    name: target.name === "Untitled model" ? ex.name : target.name,
    version: target.version,
    metadata: { ...ex.metadata, ...stripUndefined(target.metadata), templateId: ex.metadata.templateId, createdAt: target.metadata.createdAt },
  };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
