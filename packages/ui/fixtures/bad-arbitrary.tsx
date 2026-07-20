// Lint fixture — DELIBERATELY BAD. Excluded from `pnpm lint` (config ignores);
// the no-arbitrary-value.test.ts lints it with --no-ignore and asserts it FAILS.
export function Bad() {
  return <div className="text-[#fff] bg-[#000] p-[13px]">nope</div>
}
