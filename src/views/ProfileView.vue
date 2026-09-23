<script setup>
import { ref, computed } from 'vue'
import { useUserStore } from '@/stores/user'
import { useInventoryStore } from '@/stores/inventory'
import { useMealPlanStore } from '@/stores/mealPlan'
import { useShoppingListStore } from '@/stores/shoppingList'
import { useDietRecordStore } from '@/stores/dietRecord'
import { useChallengeStore } from '@/stores/challenge'
import { useAchievementsStore } from '@/stores/achievements'
import { useStatsStore } from '@/stores/stats'
import { CATEGORIES, CATEGORY_ICONS } from '@/constants'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseModal from '@/components/common/BaseModal.vue'
import {
  BACKUP_MODULES,
  exportBackupFile,
  readBackupFile,
  restoreBackup,
  computeMerged,
  moduleCount,
  formatCount,
  hasContent,
} from '@/utils/backup'

const user = useUserStore()
const inventory = useInventoryStore()
const mealPlan = useMealPlanStore()
const shopping = useShoppingListStore()
const diet = useDietRecordStore()
const challenge = useChallengeStore()
const achievements = useAchievementsStore()
const stats = useStatsStore()

const editing = ref(false)
const nameInput = ref(user.name)
const avatarInput = ref(user.avatar)

const avatarOptions = ['👨‍👩‍👧', '👩‍🍳', '🧑‍🍳', '👨‍🍳', '🏡', '👪', '💑', '🐱']

function saveProfile() {
  user.setName(nameInput.value.trim() || '我的家庭')
  user.setAvatar(avatarInput.value)
  editing.value = false
}

function fmt(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function fmtDateTime(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 数据备份 / 恢复 ----------

const exporting = ref(false)
const fileInput = ref(null)
const notice = ref(null) // { type: 'success' | 'error', text }

const showRestoreModal = ref(false)
const selectedBackup = ref(null)
const selectedFileName = ref('')
const restoreMode = ref('') // '' | 'merge' | 'overwrite'
const overwriteConfirmed = ref(false)
const restoring = ref(false)
const modalError = ref('')

// 本机现有数据（直接读各 store，恢复后可响应式刷新）
const localSnapshot = computed(() => ({
  user: user.profile,
  inventory: inventory.items,
  dishes: mealPlan.dishes,
  plan: mealPlan.plan,
  'shopping-list': shopping.items,
  'shopping-history': shopping.history,
  'diet-records': diet.records,
  challenges: challenge.completed,
}))

const localHasData = computed(() => hasContent(localSnapshot.value))

// 合并结果预览（选择“合并”时展示恢复后规模）
const mergedPreview = computed(() => {
  if (!selectedBackup.value || restoreMode.value !== 'merge') return null
  return computeMerged(selectedBackup.value.data, localSnapshot.value)
})

const compareRows = computed(() => {
  if (!selectedBackup.value) return []
  const backupData = selectedBackup.value.data
  return BACKUP_MODULES.map((m) => {
    const localN = moduleCount(m.key, localSnapshot.value[m.key])
    const included = m.key in backupData
    const backupN = included ? moduleCount(m.key, backupData[m.key]) : 0
    let resultN
    if (restoreMode.value === 'overwrite') resultN = backupN
    else if (mergedPreview.value && m.key in mergedPreview.value)
      resultN = moduleCount(m.key, mergedPreview.value[m.key])
    else resultN = localN
    return {
      key: m.key,
      label: m.label,
      localText: formatCount(m.key, localN),
      backupText: included ? formatCount(m.key, backupN) : '未包含',
      resultText: restoreMode.value ? formatCount(m.key, resultN) : '—',
    }
  })
})

const canConfirmRestore = computed(() => {
  if (restoring.value || !selectedBackup.value) return false
  if (localHasData.value && !restoreMode.value) return false
  if (restoreMode.value === 'overwrite' && !overwriteConfirmed.value) return false
  return true
})

const confirmText = computed(() => {
  if (!localHasData.value) return '开始导入'
  if (restoreMode.value === 'overwrite') return '确认覆盖并恢复'
  return '合并并恢复'
})

function handleExport() {
  exporting.value = true
  notice.value = null
  try {
    const backup = exportBackupFile()
    notice.value = {
      type: 'success',
      text: `备份文件已导出（${fmtDateTime(backup.exportedAt)}），请妥善保存，换设备时可在新设备上导入恢复。`,
    }
  } catch (e) {
    notice.value = { type: 'error', text: `导出失败：${e.message}` }
  } finally {
    exporting.value = false
  }
}

function triggerPickFile() {
  notice.value = null
  fileInput.value?.click()
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  try {
    const backup = await readBackupFile(file)
    selectedBackup.value = backup
    selectedFileName.value = file.name
    // 本机已有数据时必须显式选择合并或覆盖；无数据时直接走导入
    restoreMode.value = localHasData.value ? '' : 'merge'
    overwriteConfirmed.value = false
    modalError.value = ''
    showRestoreModal.value = true
  } catch (err) {
    notice.value = { type: 'error', text: err.message }
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

function closeRestoreModal() {
  if (restoring.value) return
  showRestoreModal.value = false
  selectedBackup.value = null
  restoreMode.value = ''
  overwriteConfirmed.value = false
  modalError.value = ''
}

function chooseMode(mode) {
  restoreMode.value = mode
  modalError.value = ''
  if (mode !== 'overwrite') overwriteConfirmed.value = false
}

function confirmRestore() {
  if (!canConfirmRestore.value) return
  restoring.value = true
  modalError.value = ''
  try {
    const res = restoreBackup(selectedBackup.value, restoreMode.value || 'merge')
    const modeText = !localHasData.value
      ? '导入'
      : restoreMode.value === 'overwrite'
        ? '覆盖恢复'
        : '合并恢复'
    notice.value = {
      type: 'success',
      text: `✅ ${modeText}成功！现有食材库存 ${res.counts.inventory} 条、菜谱 ${res.counts.dishes} 个、饮食记录 ${res.counts['diet-records']} 条、采购记录 ${res.counts['shopping-history']} 条，积分 ⭐ ${user.points}。`,
    }
    showRestoreModal.value = false
    selectedBackup.value = null
    restoreMode.value = ''
    overwriteConfirmed.value = false
  } catch (err) {
    modalError.value = err.message
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <div>
    <h2>👤 个人中心</h2>

    <div v-if="notice" class="notice" :class="notice.type">
      <span>{{ notice.text }}</span>
      <button class="notice-close" @click="notice = null">✕</button>
    </div>

    <div class="card profile-card">
      <div class="avatar-big">{{ user.avatar }}</div>
      <template v-if="!editing">
        <div class="p-info">
          <div class="p-name">{{ user.name }}</div>
          <div class="muted">积分 ⭐ {{ user.points }} · 已解锁 {{ achievements.progress.unlocked }} 个成就</div>
        </div>
        <BaseButton variant="ghost" size="sm" @click="editing = true">编辑资料</BaseButton>
      </template>
      <template v-else>
        <div class="edit-form">
          <input v-model="nameInput" type="text" placeholder="家庭名称" />
          <div class="avatars">
            <button
              v-for="a in avatarOptions"
              :key="a"
              class="avatar-opt"
              :class="{ on: avatarInput === a }"
              @click="avatarInput = a"
            >
              {{ a }}
            </button>
          </div>
          <div class="edit-actions">
            <BaseButton variant="ghost" size="sm" @click="editing = false">取消</BaseButton>
            <BaseButton size="sm" @click="saveProfile">保存</BaseButton>
          </div>
        </div>
      </template>
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="section-title">🥬 我的食材库存</div>
        <div class="stat-line"><span>食材种类</span><b>{{ inventory.items.length }}</b></div>
        <div class="stat-line"><span>库存总量</span><b>{{ inventory.totalQuantity }}</b></div>
        <div class="cat-list">
          <div v-for="c in CATEGORIES" :key="c" class="cat">
            <span>{{ CATEGORY_ICONS[c] }} {{ c }}</span>
            <b>{{ inventory.byCategory[c] || 0 }}</b>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">📅 食谱计划</div>
        <div class="stat-line"><span>菜谱总数</span><b>{{ mealPlan.totalDishes }}</b></div>
        <div class="stat-line"><span>本周已安排餐次</span><b>{{ mealPlan.plannedMeals }} / 21</b></div>
        <div class="stat-line"><span>采购完成轮次</span><b>{{ shopping.purchaseRounds }}</b></div>
        <div class="stat-line"><span>累计采购花费</span><b>¥{{ shopping.totalSpend.toFixed(1) }}</b></div>
      </div>

      <div class="card">
        <div class="section-title">🗑️ 浪费统计</div>
        <div class="stat-line"><span>过期食材</span><b>{{ inventory.expiredItems.length }}</b></div>
        <div class="stat-line"><span>临期食材</span><b>{{ inventory.nearExpiryItems.length }}</b></div>
        <div class="stat-line"><span>浪费率</span><b>{{ (stats.wasteRate * 100).toFixed(1) }}%</b></div>
        <div class="stat-line"><span>成就徽章</span><b>{{ achievements.progress.unlocked }} / {{ achievements.progress.total }}</b></div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">🧾 采购记录</div>
      <div v-if="!shopping.history.length" class="muted">暂无采购记录</div>
      <div v-else class="history">
        <div v-for="h in shopping.history" :key="h.id" class="hist-row">
          <span class="muted">{{ fmt(h.date) }}</span>
          <span class="items">{{ h.items.map((i) => `${i.name}×${i.quantity}${i.unit}`).join('、') }}</span>
          <span class="total">¥{{ (h.total || 0).toFixed(1) }}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-title">💾 数据备份</div>
      <p class="muted backup-tip">
        所有家庭数据仅保存在本设备的浏览器中，更换设备、清理浏览器缓存都会导致数据丢失。
        建议定期导出备份文件并妥善保存，换设备后通过导入即可恢复全部数据。
      </p>
      <div class="backup-actions">
        <BaseButton :disabled="exporting" @click="handleExport">
          {{ exporting ? '正在导出…' : '⬇️ 一键导出全部数据' }}
        </BaseButton>
        <BaseButton variant="ghost" @click="triggerPickFile">⬆️ 从备份文件恢复</BaseButton>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="onFileChange"
        />
      </div>
    </div>

    <BaseModal
      :show="showRestoreModal"
      :title="localHasData ? '恢复家庭数据' : '导入家庭数据'"
      width="640px"
      @close="closeRestoreModal"
    >
      <div v-if="selectedBackup" class="restore-flow">
        <div class="backup-meta">
          <div>📄 {{ selectedFileName }}</div>
          <div class="muted">备份时间：{{ fmtDateTime(selectedBackup.exportedAt) }}</div>
        </div>

        <table class="cmp-table">
          <thead>
            <tr>
              <th>数据模块</th>
              <th class="num">本机现有</th>
              <th class="num">备份文件</th>
              <th class="num">恢复后</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in compareRows" :key="row.key">
              <td>{{ row.label }}</td>
              <td class="num">{{ row.localText }}</td>
              <td class="num">{{ row.backupText }}</td>
              <td class="num result">{{ row.resultText }}</td>
            </tr>
          </tbody>
        </table>

        <template v-if="localHasData">
          <p class="mode-hint">⚠️ 本机已有数据，请选择恢复方式：</p>
          <div class="mode-cards">
            <button
              type="button"
              class="mode-card"
              :class="{ on: restoreMode === 'merge' }"
              @click="chooseMode('merge')"
            >
              <div class="mode-title">🔀 合并保留（推荐）</div>
              <div class="mode-desc">
                保留本机现有数据，再把备份中的数据合并进来；重复记录以备份内容为准，
                周计划按餐次合并，积分取两边较高值，不会清空任何记录。
              </div>
            </button>
            <button
              type="button"
              class="mode-card danger"
              :class="{ on: restoreMode === 'overwrite' }"
              @click="chooseMode('overwrite')"
            >
              <div class="mode-title">♻️ 覆盖替换</div>
              <div class="mode-desc">
                先清空本机全部家庭数据，再还原为备份文件中的状态。
                <b>本机独有的记录将被永久删除，且无法撤销。</b>
              </div>
            </button>
          </div>

          <label v-if="restoreMode === 'overwrite'" class="confirm-check">
            <input v-model="overwriteConfirmed" type="checkbox" />
            <span>我已知晓：覆盖会永久删除本机现有数据，此操作无法撤销</span>
          </label>
        </template>
        <p v-else class="muted import-hint">
          本机暂无家庭数据，将直接导入备份文件中的全部内容。
        </p>

        <p v-if="modalError" class="error-text">{{ modalError }}</p>
      </div>
      <template #footer>
        <BaseButton variant="ghost" :disabled="restoring" @click="closeRestoreModal">取消</BaseButton>
        <BaseButton
          :variant="restoreMode === 'overwrite' ? 'danger' : 'primary'"
          :disabled="!canConfirmRestore"
          @click="confirmRestore"
        >
          {{ restoring ? '正在恢复…' : confirmText }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
h2 {
  margin-bottom: 16px;
}
.notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius);
  margin-bottom: 16px;
  font-size: 13px;
}
.notice.success {
  background: var(--primary-light);
  color: var(--primary-dark);
  border: 1px solid #a5d6a7;
}
.notice.error {
  background: var(--danger-light);
  color: #c62828;
  border: 1px solid #ef9a9a;
}
.notice-close {
  border: none;
  background: none;
  cursor: pointer;
  font-size: 13px;
  color: inherit;
  opacity: 0.7;
  flex-shrink: 0;
}
.profile-card {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 16px;
}
.avatar-big {
  font-size: 56px;
}
.p-info {
  flex: 1;
}
.p-name {
  font-size: 20px;
  font-weight: 700;
}
.edit-form {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.edit-form input {
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
}
.avatars {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.avatar-opt {
  font-size: 24px;
  border: 2px solid transparent;
  background: var(--surface-2);
  border-radius: 10px;
  padding: 6px;
  cursor: pointer;
}
.avatar-opt.on {
  border-color: var(--primary);
  background: var(--primary-light);
}
.edit-actions {
  display: flex;
  gap: 8px;
}
.stat-line {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.stat-line:last-of-type {
  border-bottom: none;
}
.cat-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cat {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: var(--text-2);
}
.cat b {
  color: var(--text);
}
.history {
  display: flex;
  flex-direction: column;
}
.hist-row {
  display: flex;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
}
.hist-row:last-child {
  border-bottom: none;
}
.hist-row .items {
  flex: 1;
  color: var(--text-2);
}
.total {
  font-weight: 600;
  color: var(--primary-dark);
}

/* 数据备份 */
.backup-tip {
  margin: 0 0 14px;
  line-height: 1.7;
}
.backup-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.error-text {
  margin: 10px 0 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--danger-light);
  color: #c62828;
  font-size: 13px;
}

/* 恢复向导 */
.backup-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: 8px;
  margin-bottom: 14px;
  font-size: 13px;
  word-break: break-all;
}
.cmp-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.cmp-table th,
.cmp-table td {
  padding: 9px 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
}
.cmp-table th {
  color: var(--text-2);
  font-weight: 500;
  background: var(--surface-2);
}
.cmp-table .num {
  text-align: right;
  white-space: nowrap;
}
.cmp-table td.result {
  color: var(--primary-dark);
}
.mode-hint {
  margin: 16px 0 10px;
  font-weight: 600;
}
.mode-cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mode-card {
  text-align: left;
  border: 2px solid var(--border);
  background: var(--surface);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.mode-card:hover {
  border-color: #bdbdbd;
}
.mode-card.on {
  border-color: var(--primary);
  background: var(--primary-light);
}
.mode-card.danger.on {
  border-color: var(--danger);
  background: var(--danger-light);
}
.mode-title {
  font-weight: 600;
  margin-bottom: 4px;
}
.mode-desc {
  font-size: 13px;
  color: var(--text-2);
  line-height: 1.6;
}
.confirm-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 12px;
  background: var(--danger-light);
  border-radius: 8px;
  font-size: 13px;
  color: #c62828;
  cursor: pointer;
}
.confirm-check input {
  margin-top: 3px;
}
.import-hint {
  margin-top: 14px;
}
</style>
