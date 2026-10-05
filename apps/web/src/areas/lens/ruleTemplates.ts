import type { AgentRules } from './agentBankApi'

// ruleTemplates.ts — B28.305: rules a new agent can start from, one click on Agent Wallets. Each template
// names every rule Lens holds, so applying one replaces the agent's rules whole and Lens reads back exactly
// the template: no list or cap left over from before (an empty list and an empty map clear, a zero is no
// limit), and the time zone named rather than left for Lens to fill in.

export interface RuleTemplate {
  id: 'support-bot' | 'researcher' | 'coder'
  name: string
  /** One sentence on the agent it suits and what its rules do. */
  summary: string
  rules: AgentRules
}

const M = 1_000_000

const OPEN: Omit<AgentRules, 'max_per_request_ulxc' | 'daily_limit_ulxc' | 'monthly_limit_ulxc' | 'approval_above_ulxc'> = {
  hourly_limit_ulxc: 0,
  weekly_limit_ulxc: 0,
  model_daily_limits_ulxc: {},
  allowed_models: [],
  allowed_providers: [],
  allowed_listings: [],
  active_from: '',
  active_until: '',
  timezone: 'UTC',
  pause_on_unusual_spend: false,
}

export const RULE_TEMPLATES: readonly RuleTemplate[] = [
  {
    id: 'support-bot',
    name: 'Support bot',
    summary: 'Answers customers all day in many small requests: a tight cap on each, an hourly cap that stops a loop, and a pause on unusual spend.',
    rules: {
      ...OPEN,
      max_per_request_ulxc: M / 2,
      hourly_limit_ulxc: 20 * M,
      daily_limit_ulxc: 200 * M,
      monthly_limit_ulxc: 4000 * M,
      approval_above_ulxc: 5 * M,
      pause_on_unusual_spend: true,
    },
  },
  {
    id: 'researcher',
    name: 'Researcher',
    summary: 'Reads and writes long documents in bursts: room for large requests, a weekly budget, and a person asked above 20 LXC.',
    rules: {
      ...OPEN,
      max_per_request_ulxc: 10 * M,
      daily_limit_ulxc: 300 * M,
      weekly_limit_ulxc: 1000 * M,
      monthly_limit_ulxc: 3000 * M,
      approval_above_ulxc: 20 * M,
    },
  },
  {
    id: 'coder',
    name: 'Coder',
    summary: 'Works in long sessions on capable models: an hourly cap for a runaway loop, a daily budget, and a pause on unusual spend.',
    rules: {
      ...OPEN,
      max_per_request_ulxc: 5 * M,
      hourly_limit_ulxc: 50 * M,
      daily_limit_ulxc: 400 * M,
      monthly_limit_ulxc: 6000 * M,
      approval_above_ulxc: 10 * M,
      pause_on_unusual_spend: true,
    },
  },
]
