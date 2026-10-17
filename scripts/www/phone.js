/**
 * 手机端记录 App（离线）
 *
 * 定位：只在手机上"记"，不管库存、不做汇总。
 *   手机记录 → 导出文件 → 内网导入终端/U盘 → 内网电脑「导入记录」时统一扣库存
 *
 * 为什么手机不扣库存：
 *   1) 手机上没有可信的库存数据，各记各的必然对不上；
 *   2) 库存是"实验室的账"，应该由内网那台机器统一管；
 *   3) 手机断网也能用，不需要实时同步。
 *
 * 数据类型：全部存 localStorage，导出时打包成 lab.notebook.v1 格式，
 * 与内网电脑端完全兼容，内网导入时能自动去重并扣库存。
 */

/* ===================== 基础工具 ===================== */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function store(key, val) {
  if (val === undefined) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.error(e); }
  return val;
}

function uid() {
  try {
    if (window.crypto && window.crypto.getRandomValues) {
      const b = new Uint8Array(16);
      window.crypto.getRandomValues(b);
      return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* 降级 */ }
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fmtTime(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function r3(n) { return Math.round((Number(n) || 0) * 1000) / 1000; }

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + type;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.className = ''; }, 2600);
}

/* ===================== 本机状态 ===================== */

const App = {
  me: null,          // { empNo, name, system }
  records: [],       // 本机所有记录
  draft: null,       // 正在编辑的记录

  load() {
    this.me = store('pn_me') || null;
    this.records = store('pn_records') || [];
  },

  saveMe(me) {
    this.me = me;
    store('pn_me', me);
  },

  saveRecords() {
    store('pn_records', this.records);
  },

  /** 把一条记录存入本机（同 uid 覆盖） */
  upsert(rec) {
    const i = this.records.findIndex((x) => x.uid === rec.uid);
    if (i >= 0) this.records[i] = rec;
    else this.records.unshift(rec);
    this.records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    this.saveRecords();
  },

  /** 待导出的记录（还没有导出过的） */
  pending() {
    return this.records.filter((r) => !r.exported);
  }
};

/* ===================== 页面切换 ===================== */

let currentTab = 'new';

function showTab(name) {
  currentTab = name;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  $$('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + name));
  if (name === 'new') renderNew();
  if (name === 'list') renderList();
  if (name === 'me') renderMe();
}

/* ===================== 新建记录 ===================== */

/**
 * 编辑中的记录（草稿）
 * { uid, date, system, project, type, steps, status, resultTag, notes, materials: [{code, alias, qty, unit}] }
 */
function newDraft() {
  return {
    uid: uid(),
    date: today(),
    system: (App.me && App.me.system) || 'LI-LT',
    project: '',
    type: '测试',
    steps: '',
    status: '完成',
    resultTag: '待测',
    notes: '',
    materials: [],
    createdAt: new Date().toISOString(),
    revision: 1
  };
}

function renderNew() {
  const pane = $('#pane-new');
  if (!App.draft) App.draft = newDraft();
  const d = App.draft;
  const sys = getSystem(d.system) || SYSTEMS[0];
  const tpls = templatesOfSystem(d.system);

  pane.innerHTML = `
    <div class="sec">
      <div class="sec-title">体系</div>
      <select id="fSystem">
        ${SYSTEMS.map((s) => `<option value="${s.id}" ${s.id === d.system ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select>
    </div>

    <div class="sec">
      <div class="sec-title">常用实验（点一下自动填好）</div>
      <div class="tpls">
        ${tpls.length ? tpls.map((t) => `
          <div class="tpl" data-tpl="${t.id}">
            <div class="tpl-n">${esc(t.name)}</div>
            <div class="tpl-m">${esc(t.type)}</div>
          </div>`).join('') : '<div class="muted small">该体系暂无模板，可手动填写</div>'}
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">基本信息</div>
      <label class="fld"><span>日期</span><input type="date" id="fDate" value="${esc(d.date)}" /></label>
      <label class="fld"><span>项目 / 课题</span><input type="text" id="fProject" value="${esc(d.project)}" placeholder="如：高电压正极" /></label>
      <label class="fld"><span>实验类型</span>
        <select id="fType">${EXP_TYPES.map((t) => `<option value="${t}" ${t === d.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </label>
    </div>

    <div class="sec">
      <div class="sec-title">用了哪些料</div>
      <div id="matList"></div>
      <button class="btn ghost sm" id="btnAddMat">＋ 加一种料</button>
      <div class="muted small" style="margin-top:8px">
        手机只记用量，<b>不扣库存</b>。导入内网电脑时才会自动扣。
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">流程与结论</div>
      <label class="fld"><span>步骤摘要（只写流程，不写参数）</span>
        <textarea id="fSteps" rows="2" placeholder="混合 → 涂布 → 组装">${esc(d.steps)}</textarea>
      </label>
      <label class="fld"><span>备注</span>
        <textarea id="fNotes" rows="2" placeholder="现象 / 异常">${esc(d.notes)}</textarea>
      </label>
      <div class="grid2">
        <label class="fld"><span>状态</span>
          <select id="fStatus">${STATUSES.map((s) => `<option value="${s}" ${s === d.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </label>
        <label class="fld"><span>结果</span>
          <select id="fResult">${RESULT_TAGS.map((s) => `<option value="${s}" ${s === d.resultTag ? 'selected' : ''}>${s}</option>`).join('')}</select>
        </label>
      </div>
    </div>

    <div class="actions">
      <button class="btn big" id="btnSave">保存到手机</button>
      <button class="btn gray" id="btnReset">清空重填</button>
    </div>
  `;

  // 体系切换
  $('#fSystem').addEventListener('change', (e) => {
    App.draft.system = e.target.value;
    // 换体系时清掉不匹配的物料
    App.draft.materials = [];
    App.draft.steps = '';
    renderNew();
  });

  // 模板
  $$('.tpl', pane).forEach((node) => {
    node.addEventListener('click', () => {
      const t = tpls.find((x) => x.id === node.dataset.tpl);
      if (!t) return;
      App.draft.type = t.type;
      App.draft.steps = t.steps;
      App.draft.notes = t.notes || '';
      App.draft.resultTag = t.resultTag || '待测';
      App.draft.materials = materialRowsForTemplate(t, App.draft.system);
      renderNew();
      toast(`已套用「${t.name}」`, 'ok');
    });
  });

  // 基本字段
  const bind = (sel, key) => {
    const node = $(sel);
    if (node) node.addEventListener('input', (e) => { App.draft[key] = e.target.value; });
  };
  bind('#fDate', 'date');
  bind('#fProject', 'project');
  bind('#fSteps', 'steps');
  bind('#fNotes', 'notes');
  $('#fType').addEventListener('change', (e) => { App.draft.type = e.target.value; });
  $('#fStatus').addEventListener('change', (e) => { App.draft.status = e.target.value; });
  $('#fResult').addEventListener('change', (e) => { App.draft.resultTag = e.target.value; });

  $('#btnAddMat').addEventListener('click', () => {
    App.draft.materials.push({ role: '', code: '', alias: '', qty: '', unit: '' });
    renderMatList();
  });

  $('#btnSave').addEventListener('click', saveDraft);
  $('#btnReset').addEventListener('click', () => {
    App.draft = newDraft();
    renderNew();
    toast('已清空');
  });

  renderMatList();
}

/** 按模板的用途分类，预先建好空白物料行 */
function materialRowsForTemplate(t, systemId) {
  return (t.roles || []).map((role) => ({ role, code: '', alias: '', qty: '', unit: '' }));
}

function renderMatList() {
  const box = $('#matList');
  if (!box) return;
  const d = App.draft;

  if (!d.materials.length) {
    box.innerHTML = '<div class="muted small" style="padding:6px 0">还没有料。选上面的模板会自动列出需要准备的分类。</div>';
    return;
  }

  box.innerHTML = '';
  d.materials.forEach((row, i) => {
    const opts = materialsForRole(row.role, d.system);
    const wrap = document.createElement('div');
    wrap.className = 'mat-row';
    wrap.innerHTML = `
      <div class="mat-head">
        <span class="role">${esc(ROLE_NAME[row.role] || '自选')}</span>
        <button class="del" data-del="${i}">×</button>
      </div>
      <div class="mat-body">
        <select data-code="${i}">
          <option value="">${opts.length ? '— 选择物料 —' : '该分类暂无物料'}</option>
          ${opts.map((m) => `<option value="${esc(m.code)}" ${m.code === row.code ? 'selected' : ''}>${esc(m.alias)}</option>`).join('')}
        </select>
        <input type="number" step="0.001" min="0" placeholder="用量" value="${esc(row.qty)}" data-qty="${i}" />
        <span class="unit">${esc(row.unit || '')}</span>
      </div>`;
    box.appendChild(wrap);
  });

  box.querySelectorAll('[data-code]').forEach((sel) => {
    sel.addEventListener('change', (e) => {
      const i = Number(sel.dataset.code);
      const code = e.target.value;
      const mat = findMaterial(code, d.system);
      d.materials[i].code = code;
      d.materials[i].alias = mat ? mat.alias : '';
      d.materials[i].unit = mat ? mat.unit : '';
      renderMatList();
    });
  });

  box.querySelectorAll('[data-qty]').forEach((inp) => {
    inp.addEventListener('input', (e) => {
      d.materials[Number(inp.dataset.qty)].qty = e.target.value;
    });
  });

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      d.materials.splice(Number(btn.dataset.del), 1);
      renderMatList();
    });
  });
}

/**
 * 从预设物料库找物料。
 * 手机上没有"实际库存"概念，物料库只是"可选清单"；
 * 有没有货由内网电脑核对。代号规则与电脑端完全一致（presetMaterialCode），
 * 这样导入时能自动对应上。
 */
function findMaterial(code, systemId) {
  return expandSystemMaterials(systemId).find((m) => m.code === code) || null;
}

function materialsForRole(roleId, systemId) {
  return expandSystemMaterials(systemId).filter((m) => !roleId || m.role === roleId);
}

function saveDraft() {
  const d = App.draft;
  if (!d.date) return toast('请选择日期', 'err');
  const mats = d.materials.filter((m) => m.code && Number(m.qty) > 0);
  if (!mats.length) return toast('请至少填写一种料的用量', 'err');

  const rec = {
    ...d,
    materials: mats.map((m) => ({
      code: m.code, alias: m.alias, qty: r3(m.qty), unit: m.unit
    })),
    savedAt: new Date().toISOString(),
    exported: false
  };
  App.upsert(rec);
  App.draft = newDraft();
  renderNew();
  toast('已保存到手机，记得导出', 'ok');
}

/* ===================== 记录列表 / 导出 ===================== */

function renderList() {
  const pane = $('#pane-list');
  const list = App.records;
  const pending = App.pending();

  pane.innerHTML = `
    <div class="sec">
      <div class="sec-title">导出到内网</div>
      <div class="muted small" style="margin-bottom:10px">
        手机不能直接连内网。请把导出的文件通过<b>导入终端或 U 盘</b>交给内网电脑，
        在内网程序的「导入记录」里导入，那时才会扣库存。
      </div>
      <button class="btn big" id="btnExport" ${pending.length ? '' : 'disabled'}>
        导出 ${pending.length} 条待传记录
      </button>
      <div class="muted small" style="margin-top:8px">
        共 ${list.length} 条记录，其中 ${pending.length} 条还没导出。
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">本机记录</div>
      ${list.length ? list.map((r) => `
        <div class="rec">
          <div class="rec-head">
            <span class="rec-sys">${esc(systemName(r.system))}</span>
            <span class="rec-date">${esc(r.date)}</span>
          </div>
          <div class="rec-t">${esc(r.project || '（未填项目）')} · ${esc(r.type)}</div>
          <div class="rec-m">
            ${(r.materials || []).length} 种料
            · ${esc(r.resultTag || '')}
            ${r.exported ? '<span class="tag ok">已导出</span>' : '<span class="tag warn">待导出</span>'}
          </div>
          <div class="rec-ops">
            <button class="btn gray sm" data-edit="${esc(r.uid)}">改</button>
            <button class="btn danger sm" data-del="${esc(r.uid)}">删</button>
          </div>
        </div>`).join('') : '<div class="muted small">还没有记录。</div>'}
    </div>
  `;

  $('#btnExport').addEventListener('click', exportRecords);

  pane.querySelectorAll('[data-edit]').forEach((b) => {
    b.addEventListener('click', () => {
      const r = App.records.find((x) => x.uid === b.dataset.edit);
      if (!r) return;
      App.draft = JSON.parse(JSON.stringify(r));
      showTab('new');
    });
  });

  pane.querySelectorAll('[data-del]').forEach((b) => {
    b.addEventListener('click', () => {
      if (!confirm('删除这条记录？删除后还能重新填，但导出的历史不受影响。')) return;
      App.records = App.records.filter((x) => x.uid !== b.dataset.del);
      App.saveRecords();
      renderList();
      toast('已删除');
    });
  });
}

function exportRecords() {
  const pending = App.pending();
  if (!pending.length) return toast('没有待导出的记录', 'err');

  const payload = {
    schema: 'lab.notebook.v1',
    from: 'phone',
    exported_at: new Date().toISOString(),
    operator: {
      empNo: App.me.empNo,
      name: App.me.name,
      system: App.me.system || ''
    },
    experiments: pending.map((r) => ({
      uid: r.uid,
      revision: r.revision || 1,
      expCode: r.expCode || '',        // 手机不生成正式编号，内网导入时补
      date: r.date,
      system: r.system,
      project: r.project || '',
      type: r.type,
      status: r.status,
      resultTag: r.resultTag,
      materials: r.materials || [],
      steps: r.steps || '',
      notes: r.notes || ''
    }))
  };

  const text = JSON.stringify(payload, null, 2);
  const fname = `待传记录_${App.me.empNo}_${stamp()}.json`;

  downloadOrShare(text, fname, () => {
    // 标记为已导出
    pending.forEach((r) => { r.exported = true; r.exportedAt = new Date().toISOString(); });
    App.saveRecords();
    renderList();
    toast(`已导出 ${pending.length} 条，请传到内网`, 'ok');
  });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * 手机上导出文件的方式，按环境尝试：
 *   1) 支持文件系统访问 API → 弹保存框
 *   2) 普通浏览器/WebView → a[download]
 *   3) 微信内打开 → 提示用浏览器打开
 */
function downloadOrShare(text, filename, onDone) {
  const isWeChat = /MicroMessenger/i.test(navigator.userAgent);
  if (isWeChat) {
    toast('微信里不能保存文件，请点右上角用浏览器打开', 'err');
    return;
  }

  try {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 150);
    if (onDone) onDone();
  } catch (e) {
    // 极老环境：退化成可全选复制
    showTextFallback(text, filename);
  }
}

/** 兜底：把内容显示出来，让用户自己复制或截图 */
function showTextFallback(text, filename) {
  const box = $('#fallback');
  $('#fallbackName').textContent = filename;
  $('#fallbackText').value = text;
  box.classList.add('show');
}

/* ===================== 我的 ===================== */

function renderMe() {
  const pane = $('#pane-me');
  const me = App.me || {};
  pane.innerHTML = `
    <div class="sec">
      <div class="sec-title">我的信息</div>
      <label class="fld"><span>工号</span><input type="text" id="mEmpNo" value="${esc(me.empNo || '')}" placeholder="如 U023" /></label>
      <label class="fld"><span>姓名</span><input type="text" id="mName" value="${esc(me.name || '')}" placeholder="张三" /></label>
      <label class="fld"><span>主攻体系</span>
        <select id="mSystem">
          <option value="">— 选择 —</option>
          ${SYSTEMS.map((s) => `<option value="${s.id}" ${s.id === me.system ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <button class="btn" id="btnSaveMe">保存</button>
    </div>

    <div class="sec">
      <div class="sec-title">这台手机上的数据</div>
      <div class="muted small">记录 ${App.records.length} 条，其中 ${App.pending().length} 条待导出。</div>
      <div class="actions" style="margin-top:12px">
        <button class="btn gray" id="btnExportAll">导出全部记录（含已导出的）</button>
        <button class="btn danger" id="btnClearAll">清空本机记录</button>
      </div>
    </div>

    <div class="sec">
      <div class="sec-title">使用须知</div>
      <div class="muted small" style="line-height:1.9">
        1. 手机上<b>只记录、不管库存</b>。库存由内网电脑统一管理。<br>
        2. 手机不能连内网，记录靠<b>导出文件 + 导入终端/U盘</b>传进去。<br>
        3. 清空或卸载 App 会丢本机记录，导出后请尽快传到内网。<br>
        4. 不要填具体配方比例、工艺温度、比能量数值。
      </div>
    </div>
  `;

  $('#btnSaveMe').addEventListener('click', () => {
    const empNo = $('#mEmpNo').value.trim();
    const name = $('#mName').value.trim();
    const system = $('#mSystem').value;
    if (!empNo) return toast('请填工号', 'err');
    if (!name) return toast('请填姓名', 'err');
    if (!/^[A-Za-z0-9_-]{1,20}$/.test(empNo)) return toast('工号只能用字母数字下划线', 'err');
    App.saveMe({ empNo, name, system });
    toast('已保存', 'ok');
    showTab('new');
  });

  $('#btnExportAll').addEventListener('click', () => {
    if (!App.records.length) return toast('没有记录', 'err');
    const all = App.records;
    const payload = {
      schema: 'lab.notebook.v1',
      from: 'phone',
      exported_at: new Date().toISOString(),
      operator: { empNo: App.me.empNo, name: App.me.name, system: App.me.system || '' },
      experiments: all.map((r) => ({
        uid: r.uid, revision: r.revision || 1, expCode: r.expCode || '',
        date: r.date, system: r.system, project: r.project || '', type: r.type,
        status: r.status, resultTag: r.resultTag, materials: r.materials || [],
        steps: r.steps || '', notes: r.notes || ''
      }))
    };
    downloadOrShare(JSON.stringify(payload, null, 2),
      `全部记录_${App.me.empNo}_${stamp()}.json`, () => toast('已导出全部记录', 'ok'));
  });

  $('#btnClearAll').addEventListener('click', () => {
    if (!confirm('清空本机全部记录？导出的文件不受影响，但本机将不再保留副本。')) return;
    App.records = [];
    App.saveRecords();
    renderMe();
    toast('已清空');
  });
}

/* ===================== 启动 ===================== */

document.addEventListener('DOMContentLoaded', () => {
  App.load();

  $$('.tab').forEach((t) => {
    t.addEventListener('click', () => showTab(t.dataset.tab));
  });

  $('#fallbackClose').addEventListener('click', () => {
    $('#fallback').classList.remove('show');
  });

  // 首次使用强制填身份
  if (!App.me || !App.me.empNo) {
    showTab('me');
    toast('请先填写工号和姓名');
    return;
  }

  showTab('new');
});
