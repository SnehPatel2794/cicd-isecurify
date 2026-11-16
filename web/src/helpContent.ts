// Help text for the portal. Plain data so it can be searched and tested; every statement mirrors a rule the server enforces.
export type HelpItem = { q: string; a: string }; export type HelpSection = { id: string; title: string; items: HelpItem[] };
export const HELP: HelpSection[] = [
  { id: 'start', title: 'Getting started', items: [
    { q: 'What is an engagement?', a: 'An engagement is one compliance or audit project for an organization. You choose one or more frameworks and the portal creates the checklist, the statement of applicability and five phases. Controls shared by several frameworks appear once.' },
    { q: 'Who sees what?', a: 'Client admins see their whole organization. Client staff and vendors see only the work assigned to them. Auditors see the engagements they are assigned to. iSecurify staff see the organizations they are assigned to. Anything you cannot see shows as "not found".' },
    { q: 'How do I secure my account?', a: 'Turn on two-step sign-in under Security. Keep your recovery codes somewhere safe. Sessions can be reviewed and ended from the same page.' }] },
  { id: 'evidence', title: 'Evidence and checklist', items: [
    { q: 'How does a control become effective?', a: 'A control counts as effective when it is claimed as implemented, every open evidence request on it is accepted, accepted evidence has not expired and no unresolved high or critical finding blocks it.' },
    { q: 'Why was my evidence rejected?', a: 'The reviewer left a reason on the request. Upload a new version: older versions are kept and the request goes back to review. Nobody can review their own upload.' }] },
  { id: 'findings', title: 'Findings', items: [
    { q: 'What happens to a finding?', a: 'An auditor raises it, a client admin or iSecurify staff member gives it an owner and due date, the owner remediates it and marks it ready for retest, and the auditor closes it or sends it back.' },
    { q: 'Can I import scanner results?', a: 'Yes. Auditors and managing staff can upload a CSV from Nessus, ZAP, Burp or similar on an engagement. A preview shows what will be created; importing the same file again creates nothing new.' }] },
  { id: 'risks', title: 'Risk register', items: [
    { q: 'How are risks rated?', a: 'Likelihood and impact are each 1 to 5 and multiply to a score: 1-4 low, 5-9 medium, 10-16 high, 17-25 critical. The residual rating is what remains after treatment.' },
    { q: 'How is a risk accepted?', a: 'Someone other than the owner records a reason, the residual rating and a review date within one year. When the review date passes the risk is flagged until it is reviewed.' }] },
  { id: 'policies', title: 'Policies', items: [
    { q: 'How is a policy published?', a: 'One person drafts a version and submits it; a different client admin or managing staff member approves and publishes it. Published versions never change; a new version replaces the live one.' },
    { q: 'Why do I have to acknowledge it again?', a: 'Acknowledgements belong to a version. When a new version is published everyone it applies to confirms they have read that one.' }] },
  { id: 'incidents', title: 'Incidents', items: [
    { q: 'Who can report an incident?', a: 'Anyone in the organization. Report it as soon as you notice it, even if you are not sure how serious it is: client admins triage it and set the severity and owner.' },
    { q: 'What is needed to close an incident?', a: 'A root cause when it is resolved, then lessons learned and corrective actions to close it. If the authorities must be told, the time they were notified is required too. The owner cannot close their own incident.' }] },
  { id: 'vendors', title: 'Vendors', items: [
    { q: 'How is a vendor\'s risk tier worked out?', a: 'From how critical the vendor is to you and how sensitive the data it can reach is. The tier (low, medium, high, critical) sets how often it is reassessed: every 36, 24, 12 or 6 months.' },
    { q: 'How does an assessment work?', a: 'A manager requests it. The vendor contact (or a manager for them) answers 24 questions and submits; the answers are scored out of 100. A different person approves, sends it back or rejects it. Approval sets the next due date. A high or critical vendor needs an approved assessment before it goes live.' }] },
  { id: 'lists', title: 'Lists, exports and saved views', items: [
    { q: 'How do I download a list?', a: 'Use Export CSV or Export Excel above the list. The file contains what the current filters show. Text that starts with = + - or @ is saved with a leading quote so a spreadsheet never runs it as a formula.' },
    { q: 'What are saved views?', a: 'A saved view remembers a set of filters under a name so you can come back to it in one click. Views are private to you and apply to one organization. You can keep 20 per list.' },
    { q: 'How do I change many owners at once?', a: 'On the risk register and the incident list, tick the rows, choose an owner and apply. Each item is checked on its own, and the result says which ones were skipped and why.' }] },
];
/** Sections with at least one item that contains every word of the search (case-insensitive). An empty search returns everything. */
export function searchHelp(sections: HelpSection[], text: string): HelpSection[] {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return sections;
  return sections.map(s => ({ ...s, items: s.items.filter(i => { const hay = `${s.title} ${i.q} ${i.a}`.toLowerCase(); return words.every(w => hay.includes(w)); }) })).filter(s => s.items.length);
}
