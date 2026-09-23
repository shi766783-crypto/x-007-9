// 数据备份与恢复：导出全部家庭数据为 JSON 文件，或从备份文件恢复
// 恢复支持两种模式：
// - merge（合并）：按 ID 去汇总两边数据，同 ID 以备份文件为准，积分取较高值，周计划逐餐合并
// - overwrite（覆盖）：清空当前全部本地数据，还原为备份文件中的状态（高危操作）

import { readAll, write, clearAll } from '@/utils/storage'
import { WEEK_DAYS, MEALS } from '@/constants'
import { useUserStore } from '@/stores/user'
import { useInventoryStore } from '@/stores/inventory'
import { useMealPlanStore } from '@/stores/mealPlan'
import { useShoppingListStore } from '@/stores/shoppingList'
import { useDietRecordStore } from '@/stores/dietRecord'
import { useChallengeStore } from '@/stores/challenge'

export const BACKUP_APP = 'family-meal-manager'
export const BACKUP_VERSION = 1

// 纳入备份的数据模块：key -> 展示信息
// type: array 按 id 合并；object(plan) 按周/天/餐次逐层合并；profile 单独处理
export const BACKUP_MODULES = [
  { key: 'user', label: '家庭资料', type: 'profile' },
  { key: 'inventory', label: '食材库存', type: 'array' },
  { key: 'dishes', label: '菜谱', type: 'array' },
  { key: 'plan', label: '每周餐次计划', type: 'plan' },
  { key: 'shopping-list', label: '采购清单', type: 'array' },
  { key: 'shopping-history', label: '采购记录', type: 'array' },
  { key: 'diet-records', label: '饮食记录', type: 'array' },
  { key: 'challenges', label: '挑战记录', type: 'array' },
]

const DEFAULT_PROFILE = { name: '我的家庭', avatar: '👨‍👩‍👧', points: 0 }
const MODULE_TYPE = Object.fromEntries(BACKUP_MODULES.map((m) => [m.key, m.type]))

// ---- 数据规模描述（用于备份前对比） ----

// 周计划的规模：已安排菜品的餐次数
function planMealCount(plan) {
  if (!plan || typeof plan !== 'object') return 0
  let count = 0
  Object.values(plan).forEach((week) => {
    if (!week || typeof week !== 'object') return
    WEEK_DAYS.forEach((d) => {
      const day = week[d.key]
      if (!day) return
      MEALS.forEach((m) => {
        const k = { 早餐: 'breakfast', 午餐: 'lunch', 晚餐: 'dinner' }[m] || m
        if (Array.isArray(day[k]) && day[k].length) count++
      })
    })
  })
  return count
}

export function moduleCount(key, value) {
  if (value === null || value === undefined) return 0
  switch (key) {
    case 'user': {
      const isCustom =
        value.name !== DEFAULT_PROFILE.name ||
        value.avatar !== DEFAULT_PROFILE.avatar ||
        Number(value.points || 0) > 0
      return isCustom ? 1 : 0
    }
    case 'plan':
      return planMealCount(value)
    default:
      return Array.isArray(value) ? value.length : 0
  }
}

export function formatCount(key, n) {
  if (key === 'user') return n ? '已设置' : '默认'
  if (key === 'plan') return `${n} 个餐次`
  return `${n} 条`
}

// 判断一份数据中是否存在实际内容（决定恢复时是否需要提示覆盖风险）
export function hasContent(data) {
  if (!data || typeof data !== 'object') return false
  return BACKUP_MODULES.some((m) => moduleCount(m.key, data[m.key]) > 0)
}

// ---- 导出 ----

export function buildBackup() {
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: readAll(),
  }
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function backupFileName(iso) {
  const d = new Date(iso)
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `家庭饮食数据备份-${stamp}.json`
}

// 一键导出：生成备份并触发浏览器下载
export function exportBackupFile() {
  const backup = buildBackup()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName(backup.exportedAt)
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return backup
}

// ---- 备份文件解析与校验 ----

// 读取用户选择的文件并校验，返回 backup 对象；文件非法时抛出带中文提示的错误
export async function readBackupFile(file) {
  let backup
  try {
    backup = JSON.parse(await file.text())
  } catch {
    throw new Error('文件不是有效的 JSON，请确认选择的是本应用导出的备份文件。')
  }

  if (!backup || typeof backup !== 'object') {
    throw new Error('备份文件内容为空或格式不正确。')
  }
  if (backup.app !== BACKUP_APP) {
    throw new Error('文件不是"家庭饮食计划与食材管家"导出的备份文件。')
  }
  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('备份文件中缺少数据内容（data 字段）。')
  }

  // 逐模块校验类型，损坏的模块直接拒绝，避免污染本地数据
  BACKUP_MODULES.forEach(({ key, type }) => {
    const v = backup.data[key]
    if (v === undefined || v === null) return
    if (type === 'array' && !Array.isArray(v)) {
      throw new Error(`备份文件中的「${key}」数据已损坏（应为数组），无法恢复。`)
    }
    if ((type === 'plan' || type === 'profile') && (typeof v !== 'object' || Array.isArray(v))) {
      throw new Error(`备份文件中的「${key}」数据已损坏（应为对象），无法恢复。`)
    }
  })

  return backup
}

// ---- 合并算法 ----

// 数组按 ID 合并：备份记录在前，本地独有记录追加在后；
// 同 ID 以备份为准（不会产生重复记录）；无 ID 的条目按内容判重
function mergeArrays(backupArr, localArr) {
  const backup = Array.isArray(backupArr) ? backupArr : []
  const local = Array.isArray(localArr) ? localArr : []
  const result = []
  const seenIds = new Set()
  const seenRaw = new Set()

  const push = (item, preferRaw) => {
    if (item && typeof item === 'object' && item.id !== undefined && item.id !== null) {
      if (seenIds.has(item.id)) return
      seenIds.add(item.id)
    } else if (item !== undefined) {
      if (seenRaw.has(preferRaw)) return
      seenRaw.add(preferRaw)
    }
    result.push(item)
  }

  backup.forEach((item) => push(item, JSON.stringify(item ?? null)))
  local.forEach((item) => push(item, JSON.stringify(item ?? null)))
  return result
}

// 周计划逐周/逐天/逐餐合并，同一餐次内的菜品 ID 取并集去重
function mergePlans(backupPlan, localPlan) {
  const result = {}
  const sources = [localPlan, backupPlan] // 后面的（备份）优先级更高

  sources.forEach((plan) => {
    if (!plan || typeof plan !== 'object') return
    Object.entries(plan).forEach(([weekKey, week]) => {
      if (!week || typeof week !== 'object' || Array.isArray(week)) return
      if (!result[weekKey]) result[weekKey] = {}
      Object.entries(week).forEach(([dayKey, day]) => {
        if (!day || typeof day !== 'object' || Array.isArray(day)) return
        if (!result[weekKey][dayKey]) result[weekKey][dayKey] = {}
        Object.entries(day).forEach(([mealKey, dishIds]) => {
          if (!Array.isArray(dishIds)) return
          const cur = Array.isArray(result[weekKey][dayKey][mealKey])
            ? result[weekKey][dayKey][mealKey]
            : []
          const set = new Set(cur)
          dishIds.forEach((id) => set.add(id))
          result[weekKey][dayKey][mealKey] = [...set]
        })
      })
    })
  })

  return result
}

// 家庭资料合并：本地自定义过的名称/头像优先保留（避免换设备恢复后被旧名字覆盖），
// 积分取两边较高值，避免回档丢积分
function mergeProfile(backupProfile, localProfile) {
  const backup = { ...DEFAULT_PROFILE, ...(backupProfile || {}) }
  const local = { ...DEFAULT_PROFILE, ...(localProfile || {}) }
  const localCustomized =
    local.name !== DEFAULT_PROFILE.name || local.avatar !== DEFAULT_PROFILE.avatar
  return {
    name: localCustomized ? local.name : backup.name || DEFAULT_PROFILE.name,
    avatar: localCustomized ? local.avatar : backup.avatar || DEFAULT_PROFILE.avatar,
    points: Math.max(Number(local.points || 0), Number(backup.points || 0)),
  }
}

// 计算合并后每个模块的数据（不写存储），供预览使用
export function computeMerged(backupData, localData) {
  const merged = {}
  BACKUP_MODULES.forEach(({ key, type }) => {
    if (!(key in backupData)) return
    if (type === 'array') merged[key] = mergeArrays(backupData[key], localData[key])
    else if (type === 'plan') merged[key] = mergePlans(backupData[key], localData[key])
    else if (type === 'profile') merged[key] = mergeProfile(backupData[key], localData[key])
  })
  return merged
}

// ---- 写入与同步 ----

// 将恢复结果写入 localStorage，并同步已实例化的 Pinia store 状态
function applyData(data) {
  const failed = []
  Object.entries(data).forEach(([key, value]) => {
    try {
      write(key, value)
    } catch (e) {
      failed.push(key)
      console.warn('[backup] write failed:', key, e)
    }
  })
  if (failed.length) {
    throw new Error(
      `浏览器存储空间不足，以下数据写入失败：${failed.join('、')}。请清理磁盘空间后重试。`,
    )
  }

  useUserStore().$patch({ profile: data.user })
  useInventoryStore().$patch({ items: data.inventory })
  useMealPlanStore().$patch({ dishes: data.dishes, plan: data.plan })
  useShoppingListStore().$patch({ items: data['shopping-list'], history: data['shopping-history'] })
  useDietRecordStore().$patch({ records: data['diet-records'] })
  useChallengeStore().$patch({ completed: data.challenges })
}

/**
 * 执行恢复
 * @param {object} backup readBackupFile 返回的备份对象
 * @param {'merge'|'overwrite'} mode 合并或覆盖
 * @returns {{ mode: string, counts: object, merged: object }}
 */
export function restoreBackup(backup, mode) {
  const backupData = backup.data
  const localData = readAll()

  let nextData
  if (mode === 'overwrite') {
    // 覆盖：先清空命名空间，再写入备份中的全部数据（含备份携带的其他扩展键）
    nextData = { ...backupData }
    clearAll()
  } else {
    // 合并：备份模块按合并规则处理；备份中未包含的本地模块原样保留
    nextData = { ...localData, ...computeMerged(backupData, localData) }
  }

  applyData(nextData)

  const counts = {}
  BACKUP_MODULES.forEach(({ key }) => {
    counts[key] = moduleCount(key, nextData[key])
  })
  return { mode, counts, merged: nextData }
}

export const MODULE_LABELS = Object.fromEntries(
  BACKUP_MODULES.map((m) => [m.key, m.label]),
)

// 供界面对未知模块做兜底展示
export function isKnownModule(key) {
  return key in MODULE_TYPE
}
