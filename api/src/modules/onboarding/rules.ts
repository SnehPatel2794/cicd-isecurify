// Getting-started steps. PURE: what a person should do next in an organization, from their role and a few counts.
export type Who = { via: 'member' | 'staff'; role: string; manage: boolean };
export type Facts = { members: number; engagements: number; livePolicies: number; risks: number; pendingAcks: number };
export type Step = { id: string; title: string; description: string; done: boolean; href: string };
export type Kind = 'manager' | 'auditor' | 'participant' | 'viewer';
export const kindOf = (w: Who): Kind => (w.via === 'member' && w.role === 'client_admin') || (w.via === 'staff' && w.manage) ? 'manager' : w.via === 'member' && w.role === 'tp_auditor' ? 'auditor' : w.via === 'member' ? 'participant' : 'viewer';
export function stepsFor(w: Who, f: Facts, tid: string): Step[] {
  const o = `/org/${tid}`;
  switch (kindOf(w)) {
    case 'manager': return [
      { id: 'invite', title: 'Invite your team', description: 'Add the people who will answer evidence requests and own findings, and the auditors who will review them.', done: f.members >= 2, href: o },
      { id: 'engagement', title: 'Start your first engagement', description: 'Choose a framework and the engagement is created with its checklist, phases and statement of applicability.', done: f.engagements >= 1, href: `${o}/engagements` },
      { id: 'policy', title: 'Publish your first policy', description: 'Write it, have a second person approve it, and the people it applies to acknowledge it.', done: f.livePolicies >= 1, href: `${o}/policies` },
      { id: 'risk', title: 'Log your first risk', description: 'Rate it, give it an owner and decide how it will be treated.', done: f.risks >= 1, href: `${o}/risks` }];
    case 'auditor': return [{ id: 'engagement', title: 'Open an engagement', description: 'Your assigned engagements list the controls to assess, the evidence to review and where to raise findings.', done: f.engagements >= 1, href: `${o}/engagements` }];
    case 'participant': return [{ id: 'policies', title: 'Read and acknowledge your policies', description: f.pendingAcks ? `${f.pendingAcks} polic${f.pendingAcks === 1 ? 'y is' : 'ies are'} waiting for you.` : 'You have acknowledged every policy meant for you.', done: f.pendingAcks === 0, href: `${o}/policies` }];
    default: return [];
  }
}
export const progress = (steps: Step[]) => ({ completed: steps.filter(s => s.done).length, total: steps.length });
