// @ts-check
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

/**
 * local/no-arbitrary-value — the lock on the design system.
 *
 * Tailwind arbitrary values (`text-[#fff]`, `bg-[#000]`, `p-[13px]`, `w-[2px]`, …)
 * are how a component silently bypasses the tokens. This rule FAILS on any class
 * token containing a `[...]` arbitrary value/variant, scoped to `className`/`class`
 * attributes and `cn`/`clsx`/`classNames`/`twMerge`/`cva` calls (so ordinary code
 * that happens to contain brackets is untouched). A design system nobody can bypass
 * is the only kind that holds — see README §"The lock".
 */
/**
 * Return the first class TOKEN that carries an arbitrary VALUE, or null.
 * An arbitrary value is a `[...]` group NOT immediately followed by `:` — i.e. a
 * value bypass like `text-[#fff]`, `p-[13px]`, `[mask-type:luminance]`. A `[...]`
 * that IS followed by `:` is an arbitrary VARIANT (e.g. `data-[state=checked]:bg-accent`,
 * `[&>svg]:text-ink`): a state selector carrying a NAMED value — allowed, and needed
 * to style Radix. So variants pass; only literal values are banned.
 * @param {string} value
 * @returns {string | null}
 */
function firstArbitraryValue(value) {
  for (const token of value.split(/\s+/)) {
    if (!token) continue
    const re = /\[[^\]]*\]/g
    let m
    while ((m = re.exec(token))) {
      if (token[m.index + m[0].length] !== ':') return token
    }
  }
  return null
}
/** @type {import('eslint').Rule.RuleModule} */
const noArbitraryValue = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Tailwind arbitrary values; use a design token from the preset.' },
    schema: [],
    messages: {
      arbitrary:
        'Arbitrary Tailwind value "{{ text }}" is not allowed — use a named token from the preset (colors/spacing/radius/fontSize). See README §The lock.',
    },
  },
  create(context) {
    /** @param {any} node @param {unknown} value */
    function check(node, value) {
      if (typeof value !== 'string') return
      const bad = firstArbitraryValue(value)
      if (bad) context.report({ node, messageId: 'arbitrary', data: { text: bad } })
    }
    /** @param {any} e */
    function walk(e) {
      if (!e || typeof e !== 'object') return
      switch (e.type) {
        case 'Literal':
          return check(e, e.value)
        case 'TemplateLiteral':
          return e.quasis.forEach((/** @type {any} */ q) => check(q, q.value.cooked))
        case 'ConditionalExpression':
          walk(e.consequent)
          walk(e.alternate)
          return
        case 'LogicalExpression':
          walk(e.left)
          walk(e.right)
          return
        case 'ArrayExpression':
          return e.elements.forEach(walk)
        case 'ObjectExpression':
          return e.properties.forEach((/** @type {any} */ p) => {
            if (p.key) check(p.key, p.key.value ?? p.key.name)
          })
      }
    }
    const CLASS_CALLEES = new Set(['cn', 'clsx', 'classNames', 'twMerge', 'cva', 'ctl'])
    return {
      JSXAttribute(node) {
        const name = node.name && node.name.name
        if (name !== 'className' && name !== 'class') return
        const v = node.value
        if (!v) return
        if (v.type === 'Literal') check(v, v.value)
        else if (v.type === 'JSXExpressionContainer') walk(v.expression)
      },
      CallExpression(node) {
        const callee = node.callee
        const fn = callee.type === 'Identifier' ? callee.name : null
        if (fn && CLASS_CALLEES.has(fn)) node.arguments.forEach(walk)
      },
    }
  },
}

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'packages/ui/fixtures/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      local: { rules: { 'no-arbitrary-value': noArbitraryValue } },
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'local/no-arbitrary-value': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // config/build files: node globals, no React rules
  {
    files: ['**/*.config.{ts,js}', '**/vite.config.ts', '**/vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
)
