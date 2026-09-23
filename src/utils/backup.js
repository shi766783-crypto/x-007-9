// 数据备份与恢复：一键导出全部本地数据为 JSON 文件，
// 恢复时支持「合并」（追加新增记录）与「覆盖」（清空后替换）两种方式
import { read, write } from './storage'

const APP_ID = 'fam-meal'
const BACKUP_VERSION = 1

// 参与备份的模块：key 为 localStorage 命名空间（fam-meal:）之后的部分
const MODULES = [
  { key: 'user', label: '家庭资料', type: 'object', fallback: { name: '我的家庭', avatar: '👨‍👩‍👧', points: 0 } },
  { key: 'dishes', label: '菜谱', type: 'list', fallback: [] },
  { key: 'plan', label: '膳食计划', type: 'plan', fallback: {} },
  { key: 'diet-records', label: '饮食记录', type: 'list', fallback: [] },
  { key: 'inventory', label: '食材库存', type: 'list', fallback: [] },
  { key: 'shopping-list', label: '购物清单', type: 'list', fallback: [] },
  { key: 'shopping-history', label: '采购记录', type: 'list', fallback: [] },
  { key: 'challenges', label: '挑战记录', type: 'list', fallback: [] },
]

// 从 localStorage 收集全部数据（设置类数据未写入过时为 null，便于判断设备是否为空）
export function collectData() {
  const data = {}
  MODULES.forEach((m) => {
    data[m.key] = read(m.key, m.type === 'object' ? null : m.fallback)
  })
  return data
}

// 各模块条目数，用于备份摘要展示与判断本地是否已有数据
export function summarize(data) {
  return MODULES.map((m) => {
    const v = data[m.key]
    let count = 0
    if (m.type === 'list') count = Array.isArray(v) ? v.length : 0
    else if (m.type === 'plan') count = countPlannedMeals(v)
    else count = v && v.name ? 1 : 0
    return { key: m.key, label: m.label, count }
  })
}

export function hasAnyData(data) {
  return summarize(data).some((s) => s.count > 0)
}

function countPlannedMeals(plan) {
  if (!plan || typeof plan !== 'object') return 0
  let n = 0
  Object.values(plan).forEach((week) => {
    Object.values(week || {}).forEach((day) => {
      ;['breakfast', 'lunch', 'dinner'].forEach((k) => {
        if (Array.isArray(day?.[k])) n += day[k].length
      })
    })
  })
  return n
}

// 导出全部数据并触发浏览器下载
export function exportBackup() {
  const data = collectData()
  // 保证备份中始终带有有效的家庭资料
  if (!data.user) data.user = MODULES.find((m) => m.key === 'user').fallback
  const payload = {
    app: APP_ID,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  a.href = url
  a.download = `家庭餐桌备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 解析并校验备份文件内容，不合法时抛出带用户提示的 Error
export function parseBackup(text) {
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('文件不是有效的 JSON，请选择本应用导出的备份文件')
  }
  if (!payload || payload.app !== APP_ID || !payload.data || typeof payload.data !== 'object') {
    throw new Error('文件格式不正确，不是本应用的备份文件')
  }
  return payload
}

// 将备份数据写入 localStorage
// mode = 'overwrite'：清空现有数据，整体替换为备份内容
// mode = 'merge'：保留现有数据，仅追加备份中新增的记录（按 id 去重）
export function applyRestore(data, mode) {
  MODULES.forEach((m) => {
    const incoming = data[m.key]

    if (mode === 'overwrite') {
      write(m.key, incoming === undefined || incoming === null ? m.fallback : incoming)
      return
    }

    // 合并模式
    if (m.type === 'list') {
      if (!Array.isArray(incoming) || !incoming.length) return
      const existing = read(m.key, [])
      const ids = new Set(existing.map((it) => it && it.id))
      const added = incoming.filter((it) => it && it.id && !ids.has(it.id))
      if (added.length) write(m.key, [...existing, ...added])
    } else if (m.type === 'plan') {
      write(m.key, mergePlan(read(m.key, {}), incoming))
    }
    // 家庭资料等设置类数据：合并模式下保留当前设备的，不覆盖
  })
}

// 合并膳食计划：按 周 -> 日 -> 餐次 逐层合并，菜品 id 去重
function mergePlan(current, incoming) {
  if (!incoming || typeof incoming !== 'object') return current
  const merged = { ...current }
  Object.entries(incoming).forEach(([weekKey, week]) => {
    const targetWeek = (merged[weekKey] = merged[weekKey] || {})
    Object.entries(week || {}).forEach(([dayKey, day]) => {
      const targetDay = (targetWeek[dayKey] = targetWeek[dayKey] || {})
      ;['breakfast', 'lunch', 'dinner'].forEach((k) => {
        const inc = Array.isArray(day?.[k]) ? day[k] : []
        const cur = Array.isArray(targetDay[k]) ? targetDay[k] : []
        targetDay[k] = [...new Set([...cur, ...inc])]
      })
    })
  })
  return merged
}
