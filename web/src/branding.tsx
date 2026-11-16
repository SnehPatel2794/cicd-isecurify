// Branding in the interface: the profile is read once at start-up (it is public, so the sign-in page is branded too) and applied as CSS variables.
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api'; import { DEFAULTS, brandVars, logoUrl, type Profile } from './brandingUi';

export const useBranding = (): Profile => { const q = useQuery({ queryKey: ['branding'], queryFn: () => api<Profile>('GET', '/branding'), staleTime: 30_000, retry: false }); const d: any = q.data; return d && typeof d.companyName === 'string' && typeof d.primaryColor === 'string' ? { ...DEFAULTS, ...d } : DEFAULTS; };
/** Applies the colours and the page title. Renders nothing. */
export function BrandingStyle() {
  const b = useBranding();
  useEffect(() => { const root = document.documentElement; for (const [k, v] of Object.entries(brandVars(b.primaryColor))) root.style.setProperty(k, v); document.title = b.companyName; }, [b.primaryColor, b.companyName]);
  return null;
}
/** The company mark: the logo when there is one, otherwise the name. */
export function BrandMark({ className = '' }: { className?: string }) {
  const b = useBranding();
  if (b.hasLogo) return <img src={logoUrl(b.version)} alt={b.companyName} className={`max-h-10 max-w-full object-contain ${className}`} />;
  // No uploaded logo: the shield that ships with the product, next to the name. (logo-shield-white.png is for dark backgrounds.)
  return <span className={`inline-flex items-center gap-2 ${className}`}><img src="/logo-shield.png" alt="" className="h-7 w-7 object-contain" /><span>{b.companyName}</span></span>;
}
