// company.ts — who runs Talyvor, as the public register has it (B32.2).
//
// UK company law (SI 2015/17, regulations 24 and 25) asks every page of a company's website to show
// its registered name, where it is registered, its number and its registered office. Every page that
// shows them reads them from here, so the website cannot carry two versions of the company.

export const COMPANY_NAME = 'TALYVOR LTD'
export const COMPANY_NUMBER = '17299143'
export const REGISTERED_OFFICE = '71-75 Shelton Street, Covent Garden, London, United Kingdom, WC2H 9JQ'
export const COMPANY_CONTACT = 'nicolai@talyvor.com'

export const COMPANY_LINE = `${COMPANY_NAME} · Registered in England and Wales · Company number ${COMPANY_NUMBER} · Registered office: ${REGISTERED_OFFICE}`
