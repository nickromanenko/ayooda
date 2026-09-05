import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = join(import.meta.dirname, '..')
const appSelect = readFileSync(join(root, 'components/ui/AppSelect.tsx'), 'utf8')
const appSelectStyles = readFileSync(join(root, 'components/ui/AppSelect.module.css'), 'utf8')
const appSwitch = readFileSync(join(root, 'components/ui/AppSwitch.tsx'), 'utf8')
const appCheckbox = readFileSync(join(root, 'components/ui/AppCheckbox.tsx'), 'utf8')
const appTabs = readFileSync(join(root, 'components/ui/AppTabs.tsx'), 'utf8')
const appSearch = readFileSync(join(root, 'components/ui/AppSearchField.tsx'), 'utf8')
const interactions = readFileSync(join(root, 'components/ui/AppInteractionProvider.tsx'), 'utf8')
const globals = readFileSync(join(root, 'app/globals.css'), 'utf8')

function tsxFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? tsxFiles(path) : path.endsWith('.tsx') ? [path] : []
  })
}

test('HeroUI 3 styles load after Tailwind and dropdowns use the shared accessible select', () => {
  assert.match(globals, /@import "tailwindcss";\s*@import "@heroui\/styles";/)
  assert.match(appSelect, /Select\.Trigger/)
  assert.match(appSelect, /Select\.Popover/)
  assert.match(appSelect, /<ListBox/)
  assert.match(appSelect, /isRequired=\{required\}/)
  assert.match(appSelect, /EMPTY_VALUE/)
})

test('dashboard code no longer ships browser-native selects', () => {
  const nativeSelects = tsxFiles(root)
    .filter((path) => !path.endsWith('AppSelect.tsx'))
    .filter((path) => /<select\b/.test(readFileSync(path, 'utf8')))

  assert.deepEqual(nativeSelects, [])
})

test('select motion is explicit, reduced-motion aware, and never transitions all properties', () => {
  assert.doesNotMatch(appSelectStyles, /transition:\s*all/)
  assert.match(appSelectStyles, /transition-property: background-color, border-color, box-shadow, scale/)
  assert.match(appSelectStyles, /@media \(prefers-reduced-motion: reduce\)/)
})

test('shared HeroUI controls preserve compound semantics', () => {
  assert.match(appSwitch, /Switch\.Content/)
  assert.match(appSwitch, /Switch\.Control/)
  assert.match(appCheckbox, /Checkbox\.Indicator/)
  assert.match(appTabs, /Tabs\.ListContainer/)
  assert.match(appTabs, /Tabs\.Panel/)
  assert.match(appSearch, /SearchField\.ClearButton/)
  assert.match(interactions, /AlertDialog\.Backdrop/)
  assert.match(interactions, /Toast\.Provider/)
})

test('dashboard settings use shared boolean controls', () => {
  const dashboardFiles = [
    ...tsxFiles(join(root, 'app/dashboard')),
    ...tsxFiles(join(root, 'components/dashboard')),
  ]
  const nativeCheckboxes = dashboardFiles
    .filter((path) => !path.endsWith('AppCheckbox.tsx') && !path.endsWith('AppSwitch.tsx'))
    .filter((path) => /type=["']checkbox["']/.test(readFileSync(path, 'utf8')))

  assert.deepEqual(nativeCheckboxes, [])
})

test('destructive actions use the shared alert dialog', () => {
  const nativeConfirms = tsxFiles(root)
    .filter((path) => !path.endsWith('WidgetAppearance.tsx') && !path.endsWith('settings/page.tsx'))
    .filter((path) => /window\.confirm\(/.test(readFileSync(path, 'utf8')))

  assert.deepEqual(nativeConfirms, [])
})
