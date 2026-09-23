// localStorage 统一封装：命名空间 + JSON 序列化 + 异常兜底

const NAMESPACE = 'fam-meal:'

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(NAMESPACE + key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(NAMESPACE + key, JSON.stringify(value))
  } catch (e) {
    // 存储配额满或序列化失败时静默降级
    console.warn('[storage] write failed:', key, e)
  }
}

export function remove(key) {
  localStorage.removeItem(NAMESPACE + key)
}

// 读取命名空间下的全部数据（键名不含命名空间前缀），用于数据备份
export function readAll() {
  const data = {}
  for (let i = 0; i < localStorage.length; i++) {
    const fullKey = localStorage.key(i)
    if (fullKey && fullKey.startsWith(NAMESPACE)) {
      const key = fullKey.slice(NAMESPACE.length)
      try {
        const raw = localStorage.getItem(fullKey)
        data[key] = raw === null ? null : JSON.parse(raw)
      } catch {
        data[key] = null
      }
    }
  }
  return data
}

export function clearAll() {
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(NAMESPACE)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}
