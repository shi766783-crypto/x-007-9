// 备份/恢复核心逻辑冒烟测试（不依赖浏览器 DOM）
// 用法：node scripts/test-backup.mjs
import assert from 'node:assert'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

// localStorage 内存垫片
const store = new Map()
globalThis.localStorage = {
  get length() {
    return store.size
  },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
}

// Pinia 垫片：backup.js 只在恢复时调用各 store 的 $patch
const patches = []
globalThis.__patches = patches
function makeStore(id) {
  return {
    $patch: (partial) => patches.push({ id, partial }),
  }
}
const piniaMap = {
  user: makeStore('user'),
  inventory: makeStore('inventory'),
  mealPlan: makeStore('mealPlan'),
  shoppingList: makeStore('shoppingList'),
  dietRecord: makeStore('dietRecord'),
  challenge: makeStore('challenge'),
}
const pinia = {
  install() {},
  _s: new Map(),
}
globalThis.__piniaShim = pinia

// 用 esbuild 把 @ 别名解析并打包成临时文件
const entry = `
import { readAll, write, clearAll } from '@/utils/storage'
import {
  buildBackup, readBackupFile, restoreBackup, computeMerged,
  moduleCount, hasContent, BACKUP_MODULES, BACKUP_APP,
} from '@/utils/backup'
import { useUserStore } from '@/stores/user'
import { useInventoryStore } from '@/stores/inventory'
import { useMealPlanStore } from '@/stores/mealPlan'
import { useShoppingListStore } from '@/stores/shoppingList'
import { useDietRecordStore } from '@/stores/dietRecord'
import { useChallengeStore } from '@/stores/challenge'
export {
  readAll, write, clearAll, buildBackup, readBackupFile, restoreBackup,
  computeMerged, moduleCount, hasContent, BACKUP_MODULES, BACKUP_APP,
  useUserStore, useInventoryStore, useMealPlanStore,
  useShoppingListStore, useDietRecordStore, useChallengeStore,
}
`

const result = await build({
  stdin: { contents: entry, resolveDir: root, loader: 'js' },
  bundle: true,
  write: false,
  format: 'esm',
  alias: { '@': path.join(root, 'src') },
  external: ['pinia'],
})

// 拦截 pinia 的 defineStore：返回工厂函数，工厂函数从全局映射取垫片
const piniaShim = `
export function createPinia() { return globalThis.__piniaShim }
export function defineStore(id, options) {
  const useStore = () => {
    const map = {
      user: 'user', inventory: 'inventory', mealPlan: 'mealPlan',
      shoppingList: 'shoppingList', dietRecord: 'dietRecord', challenge: 'challenge',
    }
    const stores = {
      user: null, inventory: null, mealPlan: null,
      shoppingList: null, dietRecord: null, challenge: null,
    }
    if (!useStore._cache) {
      useStore._cache = new Map()
    }
    if (!useStore._cache.has(id)) {
      const stateInit = options.state ? options.state() : {}
      useStore._cache.set(id, {
        ...stateInit,
        $patch: (p) => globalThis.__patches.push({ id, partial: p }),
      })
    }
    return useStore._cache.get(id)
  }
  return useStore
}
`
const piniaShimResult = await build({
  stdin: { contents: piniaShim, resolveDir: root, loader: 'js' },
  bundle: false,
  write: false,
  format: 'esm',
})

const bundled = result.outputFiles[0].text
const piniaShimCode = piniaShimResult.outputFiles[0].text

const blobURL = 'data:text/javascript;base64,' + Buffer.from(bundled).toString('base64')
const shimURL = 'data:text/javascript;base64,' + Buffer.from(piniaShimCode).toString('base64')

// 把 import 'pinia' 替换为垫片
const patched = bundled.replace(/from\s*["']pinia["']/g, `from '${shimURL}'`)
const finalURL = 'data:text/javascript;base64,' + Buffer.from(patched).toString('base64')

const mod = await import(finalURL)

const NS = 'fam-meal:'
function setLS(key, value) {
  store.set(NS + key, JSON.stringify(value))
}

function reset(data = {}) {
  store.clear()
  patches.length = 0
  Object.entries(data).forEach(([k, v]) => setLS(k, v))
}

// ---------- 用例 1：导出包含全部模块 ----------
reset({
  user: { name: '张家', avatar: '👩‍🍳', points: 30 },
  inventory: [{ id: 'ing-1', name: '白菜' }],
  dishes: [{ id: 'dish-1', name: '炒青菜' }],
  plan: {},
  'shopping-list': [],
  'shopping-history': [{ id: 'p-1', total: 12 }],
  'diet-records': [{ id: 'rec-1', date: '2026-09-20', meal: '早餐', dishes: [] }],
  challenges: [],
})
const backup = mod.buildBackup()
assert.equal(backup.app, mod.BACKUP_APP)
assert.equal(backup.version, 1)
assert.ok(backup.exportedAt)
assert.equal(backup.data.inventory.length, 1)
assert.equal(backup.data.user.points, 30)
console.log('✅ 用例1 通过：导出包含全部 8 个模块及元信息')

// ---------- 用例 2：合并模式 - ID 去重、同 ID 备份为准、本地独有保留 ----------
reset({
  user: { name: '李家', avatar: '🐱', points: 50 },
  inventory: [
    { id: 'ing-local', name: '本地土豆', quantity: 2 },
    { id: 'ing-shared', name: '旧名字', quantity: 1 },
  ],
  dishes: [],
  plan: {
    '2026-W39': {
      monday: { breakfast: ['dish-local'], lunch: [], dinner: [] },
    },
  },
})
const backupMerge = {
  app: mod.BACKUP_APP,
  version: 1,
  exportedAt: new Date().toISOString(),
  data: {
    user: { name: '旧设备名', avatar: '👨‍🍳', points: 80 },
    inventory: [
      { id: 'ing-shared', name: '备份新名字', quantity: 5 },
      { id: 'ing-backup', name: '备份番茄' },
    ],
    dishes: [{ id: 'dish-b', name: '番茄炒蛋' }],
    plan: {
      '2026-W39': {
        monday: { breakfast: ['dish-b'], lunch: [], dinner: [] },
      },
      '2026-W40': {
        tuesday: { breakfast: [], lunch: ['dish-b'], dinner: [] },
      },
    },
    'shopping-list': [],
    'shopping-history': [],
    'diet-records': [],
    challenges: [{ id: 'ch-1', ingredientName: '胡萝卜' }],
  },
}

const merged = mod.computeMerged(backupMerge.data, mod.readAll())
// inventory: 备份两条在前（含更新后的 shared），本地独有的 ing-local 追加在后
assert.equal(merged.inventory.length, 3)
assert.equal(merged.inventory[0].id, 'ing-shared')
assert.equal(merged.inventory[0].name, '备份新名字')
assert.equal(merged.inventory[2].id, 'ing-local')
// 周计划按餐次取并集
assert.deepEqual(merged.plan['2026-W39'].monday.breakfast.sort(), ['dish-b', 'dish-local'].sort())
assert.deepEqual(merged.plan['2026-W40'].tuesday.lunch, ['dish-b'])
// 积分取较高值；本地自定义过资料则保留本地名称头像
assert.equal(merged.user.points, 80)
assert.equal(merged.user.name, '李家')
assert.equal(merged.user.avatar, '🐱')
console.log('✅ 用例2 通过：合并去重/备份优先/周计划并集/积分取高/资料保留')

// 本地是默认资料时，合并应采用备份中的资料
const defaultLocal = mod.computeMerged(
  { user: { name: '备份家', avatar: '🏡', points: 10 } },
  { user: { name: '我的家庭', avatar: '👨‍👩‍👧', points: 0 } },
)
assert.equal(defaultLocal.user.name, '备份家')
assert.equal(defaultLocal.user.avatar, '🏡')
console.log('✅ 用例2b 通过：默认资料合并时采用备份资料')

// ---------- 用例 3：执行合并恢复后 localStorage 与 store 均被更新 ----------
const resMerge = mod.restoreBackup(backupMerge, 'merge')
const lsInventory = JSON.parse(store.get(NS + 'inventory'))
assert.equal(lsInventory.length, 3)
assert.equal(JSON.parse(store.get(NS + 'user')).points, 80)
assert.equal(resMerge.counts.inventory, 3)
assert.equal(resMerge.counts.challenges, 1)
assert.equal(resMerge.counts.dishes, 1)
assert.equal(resMerge.counts.plan, 2, '计划餐次数应为 2（周一早合并后仍算 1 个餐次 + 周二午 1 个）')
// store 被同步
const invPatch = patches.find((p) => p.id === 'inventory')
assert.ok(invPatch, 'inventory store 应收到 $patch')
assert.equal(invPatch.partial.items.length, 3)
const mealPatch = patches.find((p) => p.id === 'mealPlan')
assert.ok(mealPatch.partial.plan && mealPatch.partial.dishes)
console.log('✅ 用例3 通过：恢复写入 localStorage 并同步 Pinia store')

// ---------- 用例 4：覆盖模式清空本地独有数据，完全还原备份 ----------
// 当前本地已有 ing-local、dish-local、'2026-W39' 等
mod.restoreBackup(backupMerge, 'overwrite')
const lsAfter = mod.readAll()
assert.deepEqual(
  lsAfter.inventory.map((i) => i.id).sort(),
  ['ing-backup', 'ing-shared'],
)
assert.deepEqual(lsAfter.plan['2026-W39'].monday.breakfast, ['dish-b'])
assert.equal(lsAfter.plan['2026-W39'].monday.breakfast.includes('dish-local'), false)
assert.equal(lsAfter.user.name, '旧设备名', '覆盖后资料应与备份完全一致')
assert.equal(lsAfter.user.points, 80)
assert.equal(store.has(NS + 'challenges'), true)
console.log('✅ 用例4 通过：覆盖恢复清空本地独有数据并完全还原备份')

// ---------- 用例 5：备份文件校验 ----------
async function expectError(obj, msgPart) {
  const file = { text: async () => JSON.stringify(obj) }
  await assert.rejects(() => mod.readBackupFile(file), (err) => err.message.includes(msgPart))
}
await expectError({ hello: 1 }, '不是')
await expectError({ app: mod.BACKUP_APP, version: 1 }, '缺少数据')
await expectError(
  { app: mod.BACKUP_APP, version: 1, data: { inventory: 'oops' } },
  '已损坏',
)
const badJsonFile = { text: async () => '{not json' }
await assert.rejects(() => mod.readBackupFile(badJsonFile), /JSON/)
// 合法文件可以解析
const goodFile = { text: async () => JSON.stringify(backupMerge) }
const parsed = await mod.readBackupFile(goodFile)
assert.equal(parsed.app, mod.BACKUP_APP)
console.log('✅ 用例5 通过：非法备份文件被明确拒绝并给出中文原因')

// ---------- 用例 6：hasContent / moduleCount 空数据判定 ----------
reset({
  user: { name: '我的家庭', avatar: '👨‍👩‍👧', points: 0 },
  inventory: [],
  dishes: [],
  plan: {},
  'shopping-list': [],
  'shopping-history': [],
  'diet-records': [],
  challenges: [],
})
assert.equal(mod.hasContent(mod.readAll()), false)
setLS('inventory', [{ id: 'x' }])
assert.equal(mod.hasContent(mod.readAll()), true)
assert.equal(mod.moduleCount('plan', { w: { monday: { breakfast: [], lunch: ['d'], dinner: [] } } }), 1)
console.log('✅ 用例6 通过：空数据判定准确（默认资料不算已有数据）')

console.log('\n🎉 全部备份/恢复测试通过')
