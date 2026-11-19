'use strict';

/* 家庭点餐：纯前端单页应用，数据保存在本机浏览器 localStorage */

const STORAGE_KEY = 'family-order-app-v1';
const MAX_IMAGE_EDGE = 800; // 图片压缩后最长边，控制存储体积
const IMAGE_QUALITY = 0.75;
const DEFAULT_CATEGORIES = ['肉类', '时蔬', '海鲜', '凉菜', '主食', '汤羹', '甜品', '饮品'];

let state = { dishes: [], categories: [], picked: [] };
let currentView = 'menu';
let currentCategory = 'all'; // 'all' 或分类 id
let editingDishId = null;    // 正在编辑的菜品 id，null 表示新增
let pendingImage = null;     // 菜品表单中当前选定的图片 dataURL

/* ---------- 工具函数 ---------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

/* ---------- 存储 ---------- */

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // 首次使用：写入默认分类
      state.categories = DEFAULT_CATEGORIES.map((name) => ({ id: uid(), name }));
      save();
      return;
    }
    const data = JSON.parse(raw);
    state.dishes = Array.isArray(data.dishes) ? data.dishes : [];
    state.categories = Array.isArray(data.categories) ? data.categories : [];
    state.picked = Array.isArray(data.picked) ? data.picked : [];
  } catch (e) {
    console.warn('读取本地数据失败，将使用空数据', e);
  }
  prunePicked();
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    alert('保存失败：浏览器本地存储空间不足。可以删掉一些菜品图片再试。');
    return false;
  }
}

/* 清理已点清单里已被删除的菜品 */
function prunePicked() {
  const before = state.picked.length;
  state.picked = state.picked.filter((p) => state.dishes.some((d) => d.id === p.dishId));
  if (state.picked.length !== before) save();
}

/* ---------- 查询辅助 ---------- */

function catName(categoryId) {
  const c = state.categories.find((x) => x.id === categoryId);
  return c ? c.name : '未分类';
}

function pickedQty(dishId) {
  const p = state.picked.find((x) => x.dishId === dishId);
  return p ? p.qty : 0;
}

function totalPicked() {
  return state.picked.reduce((s, p) => s + p.qty, 0);
}

function dishCountByCat(categoryId) {
  return state.dishes.filter((d) => d.categoryId === categoryId).length;
}

/* ---------- 视图切换 ---------- */

function switchView(name) {
  currentView = name;
  document.querySelectorAll('.view').forEach((v) => {
    v.hidden = v.id !== 'view-' + name;
  });
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.view === name);
  });
  window.scrollTo(0, 0);
}

/* ---------- 渲染：菜单 ---------- */

function renderMenuView() {
  // 当前分类被删除时回到全部
  if (currentCategory !== 'all' && !state.categories.some((c) => c.id === currentCategory)) {
    currentCategory = 'all';
  }

  document.getElementById('dishTotal').textContent = state.dishes.length;

  const hasDishes = state.dishes.length > 0;
  document.getElementById('menuEmpty').hidden = hasDishes;
  document.querySelector('.menu-body').hidden = !hasDishes;

  if (!hasDishes) return;

  const rail = document.getElementById('catRail');
  rail.innerHTML = [
    `<button class="cat-item ${currentCategory === 'all' ? 'active' : ''}" data-action="filter-cat" data-cat="all">全部<span>${state.dishes.length}</span></button>`,
    ...state.categories.map((c) => `
      <button class="cat-item ${currentCategory === c.id ? 'active' : ''}"
              data-action="filter-cat" data-cat="${c.id}">${escapeHtml(c.name)}<span>${dishCountByCat(c.id)}</span></button>`),
  ].join('');

  const filtered = currentCategory === 'all'
    ? state.dishes
    : state.dishes.filter((d) => d.categoryId === currentCategory);

  const grid = document.getElementById('dishGrid');
  grid.innerHTML = filtered.length === 0
    ? '<div class="grid-empty muted">这个分类还没有菜</div>'
    : filtered.map((d) => {
      const qty = pickedQty(d.id);
      return `
        <div class="dish-card">
          <div class="dish-thumb" data-action="open-detail" data-id="${d.id}">
            ${d.image
              ? `<img src="${d.image}" alt="${escapeHtml(d.name)}">`
              : `<span class="thumb-fallback">${escapeHtml(d.name.slice(0, 1))}</span>`}
            ${qty > 0 ? `<span class="dish-qty">×${qty}</span>` : ''}
          </div>
          <div class="dish-body">
            <div class="dish-name" data-action="open-detail" data-id="${d.id}">${escapeHtml(d.name)}</div>
            ${d.chef ? `<div class="dish-meta">大厨 ${escapeHtml(d.chef)}</div>` : ''}
            ${d.method ? `<div class="dish-meta">做法 ${escapeHtml(d.method)}</div>` : ''}
            <button class="btn primary block" data-action="pick" data-id="${d.id}">点这道菜</button>
          </div>
        </div>`;
    }).join('');
}

/* ---------- 渲染：已点 ---------- */

function renderPickedView() {
  const items = [...state.picked]
    .sort((a, b) => b.lastPickedAt - a.lastPickedAt)
    .map((p) => {
      const dish = state.dishes.find((d) => d.id === p.dishId);
      if (!dish) return '';
      const meta = [
        dish.chef ? `大厨 ${dish.chef}` : '',
        dish.method ? `做法 ${dish.method}` : '',
      ].filter(Boolean).join(' · ');
      return `
        <div class="picked-item">
          <div class="picked-thumb">
            ${dish.image
              ? `<img src="${dish.image}" alt="${escapeHtml(dish.name)}">`
              : escapeHtml(dish.name.slice(0, 1))}
          </div>
          <div class="picked-info">
            <div class="picked-name-row">
              <span class="picked-name">${escapeHtml(dish.name)}</span>
              <span class="qty-tag">×${p.qty}</span>
            </div>
            ${meta ? `<div class="picked-meta">${escapeHtml(meta)}</div>` : ''}
            <div class="picked-time">${formatTime(p.lastPickedAt)} 点的</div>
          </div>
          <button class="btn text danger small" data-action="unpick" data-id="${p.dishId}">撤销</button>
        </div>`;
    }).join('');

  const total = totalPicked();
  document.getElementById('pickedCount').textContent = total;
  document.getElementById('pickedList').innerHTML = items;
  document.getElementById('pickedList').hidden = total === 0;
  document.getElementById('pickedEmpty').hidden = total > 0;
  document.getElementById('finishWrap').hidden = total === 0;
}

/* ---------- 渲染：我的 ---------- */

function renderMeView() {
  document.getElementById('statDishes').textContent = state.dishes.length;
  document.getElementById('statCats').textContent = state.categories.length;
  document.getElementById('statPicked').textContent = totalPicked();

  const list = document.getElementById('manageList');
  document.getElementById('manageEmpty').hidden = state.dishes.length > 0;
  list.innerHTML = state.dishes.map((d) => {
    const sub = [catName(d.categoryId), d.method ? `做法 ${d.method}` : ''].filter(Boolean).join(' · ');
    return `
      <div class="manage-item">
        <div class="manage-thumb">
          ${d.image
            ? `<img src="${d.image}" alt="${escapeHtml(d.name)}">`
            : escapeHtml(d.name.slice(0, 1))}
        </div>
        <div class="manage-info">
          <div class="manage-name">${escapeHtml(d.name)}</div>
          <div class="manage-sub">${escapeHtml(sub)}</div>
        </div>
        <div class="manage-actions">
          <button class="btn text small" data-action="edit-dish" data-id="${d.id}">编辑</button>
          <button class="btn text small danger" data-action="delete-dish" data-id="${d.id}">删除</button>
        </div>
      </div>`;
  }).join('');

  document.getElementById('catList').innerHTML = state.categories.map((c) => `
    <div class="cat-manage-item">
      <div class="cat-manage-info">
        <span class="cat-manage-name">${escapeHtml(c.name)}</span>
        <span class="muted small">${dishCountByCat(c.id)} 道</span>
      </div>
      <div class="manage-actions">
        <button class="btn text small" data-action="rename-cat" data-id="${c.id}">重命名</button>
        <button class="btn text small danger" data-action="delete-cat" data-id="${c.id}">删除</button>
      </div>
    </div>`).join('');
}

function renderBadge() {
  const n = totalPicked();
  const b = document.getElementById('pickedBadge');
  b.hidden = n === 0;
  b.textContent = n > 99 ? '99+' : String(n);
}

function renderAll() {
  renderMenuView();
  renderPickedView();
  renderMeView();
  renderBadge();
}

/* ---------- 弹层 ---------- */

function showModal(id, html) {
  const m = document.getElementById(id);
  m.innerHTML = `<div class="modal-sheet">${html}</div>`;
  m.hidden = false;
  document.body.classList.add('modal-open');
}

function closeAllModals() {
  ['detailModal', 'dishModal'].forEach((id) => {
    const m = document.getElementById(id);
    m.hidden = true;
    m.innerHTML = '';
  });
  document.body.classList.remove('modal-open');
  editingDishId = null;
  pendingImage = null;
}

/* ---------- 菜品详情 ---------- */

function openDetail(id) {
  const dish = state.dishes.find((d) => d.id === id);
  if (!dish) return;
  const qty = pickedQty(id);
  const chips = [
    dish.chef ? `大厨 ${dish.chef}` : '',
    dish.method ? `做法 ${dish.method}` : '',
    catName(dish.categoryId),
  ].filter(Boolean).map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join('');

  showModal('detailModal', `
    <button class="sheet-close" data-action="close-modal" aria-label="关闭">×</button>
    ${dish.image
      ? `<img class="detail-img" src="${dish.image}" alt="${escapeHtml(dish.name)}">`
      : `<div class="detail-img placeholder"><span>${escapeHtml(dish.name.slice(0, 1))}</span></div>`}
    <div class="modal-body">
      <h2 class="detail-name">${escapeHtml(dish.name)}</h2>
      <div class="detail-chips">${chips}</div>
      ${dish.steps
        ? `<div class="detail-steps-wrap"><h3>做法</h3><p class="detail-steps">${escapeHtml(dish.steps)}</p></div>`
        : ''}
      <div class="detail-actions">
        <button class="btn primary block" data-action="detail-pick" data-id="${id}">
          ${qty > 0 ? `再点一份（已点 ×${qty}）` : '点这道菜'}
        </button>
      </div>
    </div>`);
}

/* ---------- 点菜 ---------- */

function pickDish(dishId) {
  if (!state.dishes.some((d) => d.id === dishId)) return;
  const item = state.picked.find((p) => p.dishId === dishId);
  if (item) {
    item.qty += 1;
    item.lastPickedAt = Date.now();
  } else {
    state.picked.push({ dishId, qty: 1, lastPickedAt: Date.now() });
  }
  save();
  renderAll();
  // 详情弹层打开时刷新按钮上的数量
  if (!document.getElementById('detailModal').hidden) openDetail(dishId);
}

function unpickDish(dishId) {
  state.picked = state.picked.filter((p) => p.dishId !== dishId);
  save();
  renderAll();
}

function endMeal() {
  if (!confirm('确定结束这次聚餐吗？\n结束后会清空所有已点菜品。')) return;
  state.picked = [];
  save();
  renderAll();
  switchView('menu');
}

/* ---------- 菜品编辑 ---------- */

function openDishForm(id) {
  editingDishId = id || null;
  const dish = id ? state.dishes.find((d) => d.id === id) : null;
  pendingImage = dish ? dish.image || null : null;

  const options = [
    `<option value="">未分类</option>`,
    ...state.categories.map((c) => `
      <option value="${c.id}" ${dish && dish.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`),
  ].join('');

  showModal('dishModal', `
    <div class="modal-head">
      <h2>${dish ? '编辑菜品' : '上架菜品'}</h2>
      <button class="btn text" data-action="close-modal">取消</button>
    </div>
    <div class="modal-body">
      <label class="field">
        <span>菜名</span>
        <input id="dishName" maxlength="20" placeholder="比如：番茄炒蛋"
               value="${dish ? escapeHtml(dish.name) : ''}">
      </label>
      <div class="field-row">
        <label class="field">
          <span>分类</span>
          <select id="dishCategory">${options}</select>
        </label>
        <label class="field">
          <span>大厨</span>
          <input id="dishChef" maxlength="10" placeholder="谁来做"
                 value="${dish ? escapeHtml(dish.chef || '') : ''}">
        </label>
      </div>
      <label class="field">
        <span>做法</span>
        <input id="dishMethod" maxlength="10" placeholder="比如：清蒸、油炸、红烧"
               value="${dish ? escapeHtml(dish.method || '') : ''}">
      </label>
      <div class="field">
        <span>图片（可选）</span>
        <div class="image-picker">
          <div class="dish-preview" id="dishPreview">
            ${pendingImage
              ? `<img src="${pendingImage}" alt="菜品图片">`
              : '<span class="muted">暂无图片</span>'}
          </div>
          <div class="image-actions">
            <label class="btn small">选择图片
              <input type="file" id="dishImageInput" accept="image/*" hidden>
            </label>
            <button class="btn small text danger" id="removeImageBtn"
                    data-action="remove-image" ${pendingImage ? '' : 'hidden'}>移除图片</button>
          </div>
        </div>
      </div>
      <label class="field">
        <span>详细做法（可选）</span>
        <textarea id="dishSteps" rows="4"
                  placeholder="写写怎么做，家人点菜时能看到">${dish ? escapeHtml(dish.steps || '') : ''}</textarea>
      </label>
      <button class="btn primary block" data-action="save-dish">保存</button>
    </div>`);
}

function saveDishForm() {
  const nameEl = document.getElementById('dishName');
  const name = (nameEl ? nameEl.value : '').trim();
  if (!name) {
    alert('请先填写菜名');
    nameEl && nameEl.focus();
    return;
  }

  const categoryId = document.getElementById('dishCategory').value || null;
  const chef = document.getElementById('dishChef').value.trim();
  const method = document.getElementById('dishMethod').value.trim();
  const steps = document.getElementById('dishSteps').value.trim();

  if (editingDishId) {
    const dish = state.dishes.find((d) => d.id === editingDishId);
    if (dish) Object.assign(dish, { name, categoryId, chef, method, image: pendingImage, steps });
  } else {
    state.dishes.push({
      id: uid(), name, categoryId, chef, method, image: pendingImage, steps, createdAt: Date.now(),
    });
  }

  if (!save()) return; // 存储失败时保留表单，让用户处理
  closeAllModals();
  renderAll();
}

function deleteDish(id) {
  const dish = state.dishes.find((d) => d.id === id);
  if (!dish) return;
  if (!confirm(`确定删除「${dish.name}」吗？`)) return;
  state.dishes = state.dishes.filter((d) => d.id !== id);
  state.picked = state.picked.filter((p) => p.dishId !== id);
  save();
  renderAll();
}

/* ---------- 分类管理 ---------- */

function addCategory() {
  const input = document.getElementById('newCatName');
  const name = (input.value || '').trim();
  if (!name) {
    input.focus();
    return;
  }
  if (state.categories.some((c) => c.name === name)) {
    alert('已经有这个分类了');
    return;
  }
  state.categories.push({ id: uid(), name });
  save();
  renderAll();
  document.getElementById('newCatName').value = '';
}

function renameCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const name = prompt('新的分类名称', cat.name);
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) {
    alert('分类名称不能为空');
    return;
  }
  if (state.categories.some((c) => c.id !== id && c.name === trimmed)) {
    alert('已经有这个分类了');
    return;
  }
  cat.name = trimmed;
  save();
  renderAll();
}

function deleteCategory(id) {
  const cat = state.categories.find((c) => c.id === id);
  if (!cat) return;
  const count = dishCountByCat(id);
  const tip = count > 0
    ? `删除分类「${cat.name}」？其中 ${count} 道菜会变为未分类。`
    : `确定删除分类「${cat.name}」吗？`;
  if (!confirm(tip)) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  state.dishes.forEach((d) => {
    if (d.categoryId === id) d.categoryId = null;
  });
  if (currentCategory === id) currentCategory = 'all';
  save();
  renderAll();
}

/* ---------- 数据备份 ---------- */

function buildBackup() {
  return {
    app: 'family-order',
    version: 1,
    exportedAt: new Date().toISOString(),
    categories: state.categories.map((c) => ({ id: c.id, name: c.name })),
    dishes: state.dishes,
  };
}

function exportData() {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const a = document.createElement('a');
  a.href = url;
  a.download = `家庭点餐备份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(file) {
  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch (e) {
    alert('文件不是有效的备份（JSON 解析失败）');
    return;
  }
  if (!raw || !Array.isArray(raw.dishes) || !Array.isArray(raw.categories)) {
    alert('文件内容不是家庭点餐的备份');
    return;
  }

  const categories = raw.categories
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : uid(),
      name: c.name.trim().slice(0, 8),
    }));

  const catIds = new Set(categories.map((c) => c.id));
  const dishes = raw.dishes
    .filter((d) => d && typeof d.name === 'string' && d.name.trim())
    .map((d) => ({
      id: typeof d.id === 'string' ? d.id : uid(),
      name: d.name.trim().slice(0, 20),
      categoryId: catIds.has(d.categoryId) ? d.categoryId : null,
      chef: String(d.chef || '').trim().slice(0, 10),
      method: String(d.method || '').trim().slice(0, 10),
      image: typeof d.image === 'string' && d.image.startsWith('data:image/') ? d.image : null,
      steps: String(d.steps || '').trim(),
      createdAt: typeof d.createdAt === 'number' ? d.createdAt : Date.now(),
    }));

  if (!confirm(`导入会覆盖当前菜单和分类。\n备份中有 ${dishes.length} 道菜、${categories.length} 个分类，确定导入吗？`)) return;

  state.dishes = dishes;
  state.categories = categories;
  state.picked = state.picked.filter((p) => dishes.some((d) => d.id === p.dishId));
  if (currentCategory !== 'all' && !catIds.has(currentCategory)) currentCategory = 'all';

  if (!save()) return;
  renderAll();
  switchView('me');
  alert(`导入成功：${dishes.length} 道菜、${categories.length} 个分类`);
}

/* ---------- 图片压缩 ---------- */

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // 透明图统一铺白底
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', IMAGE_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

/* ---------- 事件绑定 ---------- */

function bind() {
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) {
      switchView(tab.dataset.view);
      return;
    }

    const el = e.target.closest('[data-action]');
    if (!el) {
      // 点击遮罩关闭弹层
      if (e.target.classList.contains('modal')) closeAllModals();
      return;
    }

    const { action, id } = el.dataset;

    switch (action) {
      case 'filter-cat':
        currentCategory = el.dataset.cat;
        renderMenuView();
        break;
      case 'open-detail':
        openDetail(id);
        break;
      case 'pick':
      case 'detail-pick':
        pickDish(id);
        break;
      case 'unpick':
        unpickDish(id);
        break;
      case 'end-meal':
        endMeal();
        break;
      case 'goto-menu':
        switchView('menu');
        break;
      case 'goto-add-dish':
        openDishForm(null);
        break;
      case 'close-modal':
        closeAllModals();
        break;
      case 'edit-dish':
        openDishForm(id);
        break;
      case 'delete-dish':
        deleteDish(id);
        break;
      case 'save-dish':
        saveDishForm();
        break;
      case 'remove-image':
        pendingImage = null;
        document.getElementById('dishPreview').innerHTML = '<span class="muted">暂无图片</span>';
        document.getElementById('removeImageBtn').hidden = true;
        break;
      case 'rename-cat':
        renameCategory(id);
        break;
      case 'delete-cat':
        deleteCategory(id);
        break;
      case 'export-data':
        exportData();
        break;
    }
  });

  document.getElementById('addCatBtn').addEventListener('click', addCategory);
  document.getElementById('newCatName').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addCategory();
  });

  // 图片选择
  document.addEventListener('change', async (e) => {
    if (e.target.id === 'importFile') {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) await importData(f);
      return;
    }
    if (e.target.id !== 'dishImageInput') return;
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      pendingImage = await compressImage(file);
      document.getElementById('dishPreview').innerHTML =
        `<img src="${pendingImage}" alt="菜品图片">`;
      document.getElementById('removeImageBtn').hidden = false;
    } catch (err) {
      alert(err.message || '图片处理失败');
    }
    e.target.value = '';
  });
}

/* ---------- 启动 ---------- */

load();
bind();
renderAll();
switchView('menu');

/* ---------- PWA：注册离线缓存 ---------- */

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => {
      console.warn('离线缓存注册失败', e);
    });
  });
}

/* ---------- PWA：安装到主屏幕 ---------- */

let deferredPrompt = null;

const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

if (!isStandalone && isIOS) {
  document.getElementById('installBlock').hidden = false;
  document.getElementById('installHint').textContent =
    '点击浏览器底部的「分享」按钮，选择「添加到主屏幕」。';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installBlock').hidden = false;
  document.getElementById('installBtn').hidden = false;
});

document.getElementById('installBtn').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  document.getElementById('installBlock').hidden = true;
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installBlock').hidden = true;
});
