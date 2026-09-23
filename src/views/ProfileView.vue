<script setup>
import { ref, computed } from 'vue'
import { useUserStore } from '@/stores/user'
import { useInventoryStore } from '@/stores/inventory'
import { useMealPlanStore } from '@/stores/mealPlan'
import { useShoppingListStore } from '@/stores/shoppingList'
import { useAchievementsStore } from '@/stores/achievements'
import { useStatsStore } from '@/stores/stats'
import { CATEGORIES, CATEGORY_ICONS } from '@/constants'
import {
  exportBackup,
  parseBackup,
  applyRestore,
  collectData,
  summarize,
} from '@/utils/backup'
import BaseButton from '@/components/common/BaseButton.vue'
import BaseModal from '@/components/common/BaseModal.vue'

const user = useUserStore()
const inventory = useInventoryStore()
const mealPlan = useMealPlanStore()
const shopping = useShoppingListStore()
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

// ---------- 数据备份与恢复 ----------
const fileInput = ref(null)
const importModal = ref(false)
const importStep = ref('choose') // choose | overwrite | success | error
const importError = ref('')
const backupInfo = ref(null) // { exportedAt, summary }
const currentSummary = ref([])
let pendingData = null

const hasCurrentData = computed(() => currentSummary.value.some((s) => s.count > 0))

function onExport() {
  exportBackup()
}

function pickFile() {
  fileInput.value?.click()
}

async function onFileChange(e) {
  const file = e.target.files?.[0]
  e.target.value = '' // 允许再次选择同一文件
  if (!file) return
  try {
    const text = await file.text()
    const payload = parseBackup(text)
    pendingData = payload.data
    backupInfo.value = { exportedAt: payload.exportedAt, summary: summarize(payload.data) }
    currentSummary.value = summarize(collectData())
    importStep.value = 'choose'
  } catch (err) {
    importError.value = err.message || '备份文件读取失败'
    importStep.value = 'error'
  }
  importModal.value = true
}

function doRestore(mode) {
  try {
    applyRestore(pendingData, mode)
    importStep.value = 'success'
    // 各 store 在初始化时从 localStorage 读取，刷新后生效
    setTimeout(() => location.reload(), 1500)
  } catch (err) {
    importError.value = `恢复失败：${err.message || err}`
    importStep.value = 'error'
  }
}

function summaryText(summary) {
  const parts = summary.filter((s) => s.count > 0).map((s) => `${s.label} ${s.count}`)
  return parts.length ? parts.join('、') : '（空）'
}

function fmtDateTime(iso) {
  if (!iso) return '未知'
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div>
    <h2>👤 个人中心</h2>

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
      <div class="section-title">💾 数据备份</div>
      <p class="muted backup-tip">
        所有数据仅保存在本浏览器中，清除缓存或更换设备后会丢失，建议定期导出备份文件妥善保存。
      </p>
      <div class="backup-actions">
        <BaseButton size="sm" @click="onExport">📤 导出备份</BaseButton>
        <BaseButton size="sm" variant="ghost" @click="pickFile">📥 导入备份</BaseButton>
        <input
          ref="fileInput"
          type="file"
          accept=".json,application/json"
          hidden
          @change="onFileChange"
        />
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

    <BaseModal :show="importModal" title="📥 恢复备份" @close="importModal = false">
      <template v-if="importStep === 'choose' && backupInfo">
        <div class="backup-meta">
          <div class="stat-line"><span>导出时间</span><b>{{ fmtDateTime(backupInfo.exportedAt) }}</b></div>
          <div class="stat-line"><span>备份内容</span><b>{{ summaryText(backupInfo.summary) }}</b></div>
        </div>
        <template v-if="hasCurrentData">
          <div class="warn-box">
            ⚠️ 当前设备已有数据（{{ summaryText(currentSummary) }}），请选择恢复方式：
          </div>
          <div class="restore-options">
            <button class="opt" @click="doRestore('merge')">
              <b>合并恢复（推荐）</b>
              <span>保留现有全部数据，仅追加备份中新增的记录</span>
            </button>
            <button class="opt danger" @click="importStep = 'overwrite'">
              <b>覆盖恢复</b>
              <span>先清空当前全部数据，再替换为备份内容</span>
            </button>
          </div>
        </template>
        <p v-else class="muted">当前设备暂无数据，将直接恢复备份内容。</p>
      </template>

      <template v-else-if="importStep === 'overwrite'">
        <div class="warn-box strong">
          ⚠️ 覆盖后，当前设备的全部数据（{{ summaryText(currentSummary) }}）将被永久删除，且无法撤销。确定要继续吗？
        </div>
      </template>

      <div v-else-if="importStep === 'success'" class="ok-box">
        ✅ 恢复成功！页面即将刷新以加载数据…
      </div>

      <div v-else class="warn-box strong">❌ {{ importError }}</div>

      <template #footer>
        <template v-if="importStep === 'choose'">
          <BaseButton variant="ghost" size="sm" @click="importModal = false">取消</BaseButton>
          <BaseButton v-if="!hasCurrentData" size="sm" @click="doRestore('merge')">开始恢复</BaseButton>
        </template>
        <template v-else-if="importStep === 'overwrite'">
          <BaseButton variant="ghost" size="sm" @click="importStep = 'choose'">返回</BaseButton>
          <BaseButton variant="danger" size="sm" @click="doRestore('overwrite')">确认覆盖</BaseButton>
        </template>
        <BaseButton v-else-if="importStep === 'error'" variant="ghost" size="sm" @click="importModal = false">
          关闭
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<style scoped>
h2 {
  margin-bottom: 16px;
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
.backup-tip {
  font-size: 13px;
  margin: 0 0 12px;
}
.backup-actions {
  display: flex;
  gap: 10px;
}
.backup-meta {
  margin-bottom: 12px;
}
.warn-box {
  background: #fff8e1;
  border: 1px solid #ffe082;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
  color: #7a5c00;
  margin-bottom: 12px;
}
.warn-box.strong {
  background: #ffebee;
  border-color: #ef9a9a;
  color: #b71c1c;
}
.ok-box {
  background: #e8f5e9;
  border: 1px solid #a5d6a7;
  border-radius: 8px;
  padding: 12px;
  font-size: 14px;
  color: #1b5e20;
}
.restore-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.opt {
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: all 0.15s;
}
.opt:hover {
  border-color: var(--primary);
  background: var(--primary-light);
}
.opt b {
  font-size: 14px;
}
.opt span {
  font-size: 12px;
  color: var(--text-2);
}
.opt.danger:hover {
  border-color: var(--danger);
  background: #ffebee;
}
</style>
