export const CLIENT_ROLES = ['client_admin', 'client_staff', 'third_party_vendor', 'tp_auditor'] as const;
export const ROLE_LABEL: Record<string, string> = { client_admin: 'Client admin', client_staff: 'Client staff', third_party_vendor: 'Third-party vendor', tp_auditor: 'TP auditor', isecurify_staff: 'iSecurify team', super_admin: 'Super Admin', admin: 'Admin', isecurify_team: 'iSecurify team', none: 'Customer' };
/** UI hint only: the server enforces the same rules. A client admin may only handle staff and vendors. */
export const rolesFor = (viewerOrgRole: string): readonly string[] => viewerOrgRole === 'client_admin' ? ['client_staff', 'third_party_vendor'] : CLIENT_ROLES;
export const platformRolesFor = (viewer: string): string[] => viewer === 'super_admin' ? ['isecurify_team', 'admin', 'super_admin'] : viewer === 'admin' ? ['isecurify_team'] : [];
