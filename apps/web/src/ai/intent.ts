/**
 * Requests that must be answered by executing tools (changes, what-ifs,
 * simulations, numbers about the model), not conversationally.
 */
const ACTION = /\b(increase|decrease|raise|lower|reduce|cut|double|doubles|halve|triple|add|remove|delete|connect|change|set|update|create|make|build|run|simulate|compare|model|hire|hiring|spend|invest)\b/i;
const QUESTION = /\b(what if|what happens|how much|how many|how long|when (will|do|does|is)|why|which|what('s| is| are) (my|the|our)|runway|break[- ]?even|mrr|arr|cash|churn|margin|revenue|customers|profit|burn)\b/i;
const SMALL_TALK = /^\s*(hi|hello|hey|thanks|thank you|ok|okay|cool|great|what can you do|help)\b[\s!.?]*$/i;

export function requiresTools(text: string): boolean {
  if (SMALL_TALK.test(text)) return false;
  return ACTION.test(text) || QUESTION.test(text) || /\d/.test(text);
}

export const TOOL_NUDGE =
  "You answered without calling any tool. This request must be carried out with the tools (for example what_if, compare_options, create_standard_scenarios, run_simulation, run_monte_carlo, explain_metric or update_assumption). Call the right tools now and answer only from their results.";
