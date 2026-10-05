import { COMPANY_LINE } from '../company'

/** The company line every page of the website shows (B32.2), in the caption style and faint ink. */
export function CompanyLine({ className = '' }: { className?: string }) {
  return <p className={`text-caption text-faint ${className}`}>{COMPANY_LINE}</p>
}
