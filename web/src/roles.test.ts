import { rolesFor, platformRolesFor } from './roles';
test('client admins are offered only staff and vendor roles', () => { expect(rolesFor('client_admin')).toEqual(['client_staff', 'third_party_vendor']); expect(rolesFor('isecurify_staff')).toHaveLength(4); });
test('admins cannot be offered admin roles', () => { expect(platformRolesFor('admin')).toEqual(['isecurify_team']); expect(platformRolesFor('super_admin')).toContain('super_admin'); expect(platformRolesFor('isecurify_team')).toEqual([]); });
